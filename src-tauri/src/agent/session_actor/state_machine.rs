//! Session Actor — single owner of a Claude CLI session's entire lifecycle.
//!
//! One actor per run_id. All session mutations (send, control, stop) go through
//! the actor's mailbox (bounded mpsc channel), guaranteeing sequential execution
//! without external locks. The actor owns the process, stdin, stdout/stderr readers,
//! protocol state, and RunState emission — eliminating the cross-system coordination
//! that previously caused race conditions.

use crate::agent::adapter::ActorSessionMap;
use crate::agent::attachment::AttachmentData;
use crate::agent::claude_protocol::{validate_bus_event, ProtocolState};
use crate::agent::notify::notify_if_background;
use crate::agent::recovery::{CrashReason, RecoveryState};
use crate::agent::runtime_recovery::{
    classify_active_turn_eof, emit_session_lifecycle, on_actor_exit, ActorRecoveryBootstrap,
    ActorRecoverySnapshot, PendingRecoveryMessage, RecoveryRegistry,
};
use crate::agent::turn_engine::{
    apply_activity_reset, ActiveTurn, TurnOrigin, TurnPhase, UserTurnKind, UserTurnTicket,
    ACCEPTED_CLIENT_MESSAGE_IDS_CAP, PROTOCOL_DESYNC_THRESHOLD, PROTOCOL_DESYNC_WINDOW_SECS,
    QUARANTINE_DEADLINE, QUEUED_USER_CAP, STOP_ESCALATION_KILL, TICK_INTERVAL, USER_HARD_TIMEOUT,
    USER_SOFT_TIMEOUT,
};
use crate::models::{
    max_attachment_size, now_iso, AgentRuntimeKind, BusEvent, RalphCompleteReason, RunStatus,
    ALLOWED_DOC_TYPES, ALLOWED_IMAGE_TYPES,
};
use crate::storage;
use crate::storage::runs;
use crate::storage::shared;
use crate::web_server::broadcaster::BroadcastEmitter;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::Duration;
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout};
use tokio::sync::{mpsc, oneshot, watch};
use tokio_util::sync::CancellationToken;

struct SessionActor {
    emitter: Arc<BroadcastEmitter>,
    sessions: ActorSessionMap,
    run_id: String,
    tag: Arc<()>,
    protocol: ProtocolState,
    /// Current RunState string — identity dedup: skip emit if unchanged.
    state: String,
    stdin: Option<ChildStdin>,
    child: Option<Child>,
    cancel: CancellationToken,
    pending_interrupt: bool,
    control_waiters: HashMap<String, oneshot::Sender<Value>>,
    shutdown_tx: Option<oneshot::Sender<()>>,

    // ── Turn Transaction Engine fields ──
    /// Current active turn (None when idle).
    active_turn: Option<ActiveTurn>,
    /// Queue of pending user messages.
    queued_user: VecDeque<UserTurnTicket>,
    /// v1.0.9 Phase 2: bounded FIFO ledger of client_message_ids the actor
    /// has already accepted (i.e. reply.send(Ok(())) was reached). Used to
    /// dedupe retries across queue + ledger so a reconnect-retry that
    /// re-dispatches a previously-accepted submit resolves idempotently
    /// without creating a second turn. Bounded by
    /// `ACCEPTED_CLIENT_MESSAGE_IDS_CAP`; eviction is FIFO.
    accepted_client_message_ids: VecDeque<String>,
    /// Next turn index (all user messages including slash). Starts from resume baseline.
    next_turn_index: u32,
    /// Next auto_ctx_id (Normal user messages only). Starts from resume baseline.
    ///
    /// NOTE: this counter is still allocated and snapshotted for resume
    /// continuity, but the field on `UserTurnKind::Normal` is no longer
    /// consumed (auto-context was disabled — see `on_user_turn_finished`
    /// removal). The counter is preserved so existing recovery snapshots
    /// continue to deserialize without losing the resume baseline.
    next_auto_ctx_id: u32,
    /// Monotonically increasing turn seq for ordering.
    next_turn_seq: u64,
    /// Quarantine: freeze dispatch until CLI reports a turn-boundary state.
    quarantine_until_result: bool,
    quarantine_deadline: Option<Instant>,
    interrupt_sent_for_quarantine: bool,
    /// Set after quarantine kill — reject new messages, break run loop.
    terminated: bool,
    /// JSON parse failures in handle_stdout_line (before map_event).
    /// Complements ParserStats.parse_warn_count (field-level malformation).
    json_parse_fail_count: u32,
    /// v1.0.6 / hardening A2: sliding-window parse-fail timestamps (epoch ms).
    /// Used to detect protocol desync when failures exceed the threshold
    /// within PROTOCOL_DESYNC_WINDOW_SECS.
    parse_fail_window: Vec<u64>,
    /// v1.0.6 / hardening A2: a one-shot guard so we only emit ProtocolDesync
    /// once per session even if parse failures keep coming.
    desync_emitted: bool,

    // ── Ralph Loop fields ──
    /// Ralph loop state (None = inactive / completed).
    ralph_loop: Option<RalphLoopState>,
    /// Flag set by on_tick_timeout when WaitingRetry expires, consumed by main loop.
    ralph_needs_dispatch: bool,

    // ── Observability: pending interactive request tracking ──
    /// Tracks the most recent interactive control request awaiting user response.
    /// Set when emitting PermissionPrompt / HookCallback(PreToolUse) / ElicitationPrompt.
    /// Cleared when the response is received. Retained during quarantine for diagnostics.
    pending_interactive_request: Option<PendingInteractiveRequest>,

    // ── v1.0.9 runtime recovery ──
    recovery_registry: Option<RecoveryRegistry>,
    connection_generation: u64,
    session_id: Option<String>,
    crash_reason: Option<CrashReason>,
    user_stopped: bool,
    recoverable_exit: bool,
    exit_code: Option<i32>,
    /// Stash of messages captured before stdin write in `start_user_turn`.
    /// If the write succeeds, the message is harmlessly filtered during
    /// replay (it's already in the accepted ledger). If stdin fails, this
    /// ensures the message survives into `build_recovery_snapshot`.
    pending_unaccepted_for_recovery: VecDeque<PendingRecoveryMessage>,

    // ── Readiness signal ──
    /// Sends `true` on first CLI output (stdout line). WaitReady commands clone a receiver.
    ready_tx: watch::Sender<bool>,

    // ── P0-4 hardening: real stop-reason propagation ──
    /// The last `ActorStopReason` stamped by the actor (or `None` if the
    /// actor hasn't been stopped yet). Set by `request_stop` (with the
    /// matching `StopSource`), and also stamped by `handle_eof` when EOF
    /// arrives without prior user/cancel intent (`StreamEof`).
    ///
    /// `cleanup` reads this to decide whether the run was user-initiated
    /// (`UserRequested`), app-initiated (`Cancelled`), or natural
    /// (`StreamEof`). The IPC layer also surfaces it via the `Stop`
    /// reply channel so callers can record intent in run metadata.
    last_stop_reason: Option<ActorStopReason>,

    // ── P0-C4 hardening: stop escalation kill signal ──
    /// Receiver half of the stop-escalation oneshot. The sender is
    /// held by the timer task that `request_stop` spawns; if the
    /// timer fires before stdout EOF (i.e. the CLI is wedged in a
    /// no-output tight loop), the actor's main `select!` picks this
    /// up and calls `child.start_kill()`.
    ///
    /// Wrapped in `Option` so the actor can swap it out once it has
    /// fired (the timer is one-shot by construction — we don't want a
    /// stale sender leaking across a stop + resume cycle).
    stop_kill_rx: Option<oneshot::Receiver<()>>,
}

// ── Spawn entry point ──

/// Spawn a new session actor. Returns the handle to insert into SessionMap.
///
/// `stdout` and `stderr` are passed as owned values (taken from the Child)
/// so the actor's select! loop can borrow them independently without conflicting
/// with `&mut self`.
///
/// `initial_turn_index` and `initial_auto_ctx_id` are the resume baseline
/// (from `count_user_messages`). For new sessions, pass (0, 0).
#[allow(clippy::too_many_arguments)]

impl SessionActor {
    /// Main select! loop. Consumes self.
    async fn run(
        mut self,
        mut cmd_rx: mpsc::Receiver<ActorCommand>,
        stdout: ChildStdout,
        stderr: ChildStderr,
    ) {
        let mut stdout_lines = BufReader::new(stdout).lines();
        let mut stderr_lines = BufReader::new(stderr).lines();
        let mut line_count: u64 = 0;
        let mut tick = tokio::time::interval(TICK_INTERVAL);
        let mut ready_emitted = false;

        log::debug!(
            "[actor] started for run_id={}, is_resume={}",
            self.run_id,
            self.protocol.is_resume()
        );
        emit_session_lifecycle(
            &self.emitter,
            &self.run_id,
            self.session_id.as_deref(),
            "starting",
            RecoveryState::Healthy,
            None,
            self.connection_generation,
            0,
        );

        loop {
            // HC #18: terminated → break loop
            if self.terminated {
                log::debug!(
                    "[turn] terminated: breaking actor loop for run_id={}",
                    self.run_id
                );
                break;
            }

            tokio::select! {
                // 1. Commands from IPC layer
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(ActorCommand::SendMessage { text, attachments, reply, client_message_id }) => {
                            self.handle_send_message(text, attachments, client_message_id, reply).await;
                        }
                        Some(ActorCommand::Stop { reply }) => {
                            // P0-6: defer the actual stdin-discard + child-kill
                            // until we observe stdout EOF so the protocol
                            // layer's trailing events (and the terminal
                            // `RunState`) reach the frontend before the loop
                            // breaks. Reply immediately with the typed
                            // reason so the IPC caller knows the request was
                            // accepted.
                            //
                            // P0-4: stamp the typed source (`StopSource::User`)
                            // so `last_stop_reason`, the recovery snapshot,
                            // and `cleanup` all see `UserRequested` — not
                            // the placeholder `UserRequested` we used to
                            // return unconditionally.
                            let reason = self.request_stop(StopSource::User);
                            self.finalize_stop().await;
                            let _ = reply.send(Ok(reason));
                            // Do NOT break here — fall through to the stdout
                            // arm so `handle_eof` emits the terminal state.
                        }
                        Some(ActorCommand::SendControl { request, reply }) => {
                            let r = self.handle_send_control_async(request).await;
                            let _ = reply.send(r);
                        }
                        Some(ActorCommand::RespondPermission { request_id, response, tool_name, reply }) => {
                            let r = self.handle_respond_permission(&request_id, response, tool_name.as_deref()).await;
                            let _ = reply.send(r.map_err(|e| e.to_string()));
                        }
                        Some(ActorCommand::CancelControlRequest { request_id, reply }) => {
                            self.clear_pending_interactive_request(&request_id);
                            let r = self.handle_cancel_control_request(&request_id).await;
                            let _ = reply.send(r);
                        }
                        Some(ActorCommand::RespondHookCallback { request_id, response, reply }) => {
                            log::debug!("[actor] RespondHookCallback: run_id={}, req_id={}", self.run_id, request_id);
                            self.clear_pending_interactive_request(&request_id);
                            let result = self.write_control_response(&request_id, response).await;
                            let _ = reply.send(result);
                        }
                        Some(ActorCommand::RespondElicitation { request_id, response, reply }) => {
                            log::debug!("[actor] RespondElicitation: run_id={}, req_id={}", self.run_id, request_id);
                            self.clear_pending_interactive_request(&request_id);
                            let result = self.write_control_response(&request_id, response).await;
                            let _ = reply.send(result);
                        }
                        Some(ActorCommand::StartRalphLoop { prompt, max_iterations, completion_promise, reply }) => {
                            if self.ralph_loop.is_some() {
                                let _ = reply.send(Err("Ralph loop already active".into()));
                            } else {
                                let started_at = crate::models::now_iso();
                                self.ralph_loop = Some(RalphLoopState {
                                    prompt: prompt.clone(),
                                    phase: RalphPhase::Running,
                                    iteration: 0,
                                    max_iterations,
                                    completion_promise: completion_promise.clone(),
                                    started_at: started_at.clone(),
                                    consecutive_failures: 0,
                                    max_consecutive_failures: 3,
                                    retry_after: None,
                                    turn_toplevel_texts: Vec::new(),
                                });
                                self.persist_and_emit(&BusEvent::RalphStarted {
                                    run_id: self.run_id.clone(),
                                    prompt,
                                    max_iterations,
                                    completion_promise,
                                    started_at,
                                });
                                log::info!("[ralph] loop started: run_id={}, max_iterations={}", self.run_id, max_iterations);
                                let _ = reply.send(Ok(()));
                                self.try_dispatch().await;
                            }
                        }
                        Some(ActorCommand::CancelRalphLoop { reply }) => {
                            if let Some(ref mut ralph) = self.ralph_loop {
                                let iteration = ralph.iteration;
                                let has_active_ralph_turn = self
                                    .active_turn
                                    .as_ref()
                                    .map(|t| matches!(t.origin, TurnOrigin::Ralph))
                                    .unwrap_or(false);

                                if has_active_ralph_turn {
                                    ralph.phase = RalphPhase::CancelPending;
                                    log::info!("[ralph] cancel pending (active turn running)");
                                    let _ = reply.send(Ok(RalphCancelResult {
                                        iteration,
                                        immediate: false,
                                    }));
                                } else {
                                    let _ = reply.send(Ok(RalphCancelResult {
                                        iteration,
                                        immediate: true,
                                    }));
                                    self.emit_ralph_complete(RalphCompleteReason::Cancelled);
                                }
                            } else {
                                let _ = reply.send(Err("No active ralph loop".into()));
                            }
                        }
                        Some(ActorCommand::WaitReady { reply }) => {
                            let mut rx = self.ready_tx.subscribe();
                            if *rx.borrow() {
                                // Already ready
                                let _ = reply.send(Ok(()));
                            } else {
                                // Wait for first stdout line
                                tokio::spawn(async move {
                                    match rx.changed().await {
                                        Ok(_) if *rx.borrow() => {
                                            let _ = reply.send(Ok(()));
                                        }
                                        Ok(_) => {
                                            let _ = reply.send(Err("WaitReady changed but not ready".into()));
                                        }
                                        Err(_) => {
                                            let _ = reply.send(Err("Actor ready channel closed".into()));
                                        }
                                    }
                                });
                            }
                        }
                        Some(ActorCommand::GenerateTitle { prompt, reply }) => {
                            // Spawn the title-generation task on a fresh tokio task
                            // so the actor's main select! loop stays responsive
                            // (the title process can take up to 25s to time out).
                            // The spawned `claude --print` is created with
                            // kill_on_drop(true) and is owned by this task, so
                            // it dies with the actor even if the IPC caller
                            // drops its receiver.
                            let run_id = self.run_id.clone();
                            let sessions = self.sessions.clone();
                            tokio::spawn(async move {
                                let result = crate::agent::title_generator::spawn_title_for_run(
                                    &run_id,
                                    &prompt,
                                    sessions,
                                )
                                .await;
                                let _ = reply.send(result);
                            });
                        }
                        None => {
                            // All senders dropped — actor should exit
                            log::debug!("[actor] cmd_rx closed, exiting: run_id={}", self.run_id);
                            break;
                        }
                    }
                }
                // 2. stdout — main event stream from CLI
                result = stdout_lines.next_line() => {
                    match result {
                        Ok(Some(text)) => {
                            line_count += 1;
                            // Signal readiness on first CLI output (replaces fixed sleeps).
                            if !ready_emitted {
                                ready_emitted = true;
                                let _ = self.ready_tx.send(true);
                                emit_session_lifecycle(
                                    &self.emitter,
                                    &self.run_id,
                                    self.session_id.as_deref(),
                                    "ready",
                                    RecoveryState::Healthy,
                                    None,
                                    self.connection_generation,
                                    0,
                                );
                            }
                            self.handle_stdout_line(&text, line_count).await;
                        }
                        Ok(None) => {
                            log::debug!("[actor] stdout EOF after {} lines: run_id={}", line_count, self.run_id);
                            self.handle_eof().await;
                            break;
                        }
                        Err(e) => {
                            log::debug!("[actor] stdout read error: run_id={}, err={}", self.run_id, e);
                            self.handle_eof().await;
                            break;
                        }
                    }
                }
                // 3. stderr
                result = stderr_lines.next_line() => {
                    match result {
                        Ok(Some(text)) => {
                            self.handle_stderr_line(&text);
                        }
                        Ok(None) | Err(_) => {
                            // stderr EOF is normal — don't break the actor loop for it.
                        }
                    }
                }
                // 4. Independent timeout clock (HC #4)
                _ = tick.tick() => {
                    self.on_tick_timeout().await;
                    // Ralph: dispatch retry after backoff expires
                    if self.ralph_needs_dispatch {
                        self.ralph_needs_dispatch = false;
                        self.try_dispatch().await;
                    }
                }
                // 5. External cancellation (app exit)
                _ = self.cancel.cancelled() => {
                    log::debug!("[actor] cancelled: run_id={}", self.run_id);
                    // P0-4: stamp `StopSource::Cancel` so callers downstream
                    // see `ActorStopReason::Cancelled`, NOT `UserRequested`.
                    self.request_stop(StopSource::Cancel);
                    self.finalize_stop().await;
                    // Same as the Stop arm: drain stdout through EOF so the
                    // frontend gets the terminal `RunState` before we exit.
                }
                // 6. P0-C4: stop-escalation timer fired. The user pressed
                // Stop (or app cancellation kicked in), but the CLI is
                // wedged in a no-output tight loop and stdout EOF never
                // arrived. Hard-kill the child so the actor's main loop
                // observes EOF and `handle_eof` can emit the terminal
                // `RunState("stopped")`.
                kill = Self::poll_stop_kill(&mut self.stop_kill_rx) => {
                    if kill {
                        log::warn!(
                            "[actor] stop-escalation timer fired: hard-killing child for run_id={}",
                            self.run_id
                        );
                        if let Some(ref mut child) = self.child {
                            // `start_kill` is sync; the OS dispatches SIGKILL
                            // immediately and stdout will close, which the
                            // existing `stdout_lines.next_line()` arm picks
                            // up on the next loop iteration. We don't await
                            // `wait()` here — the natural EOF arm handles
                            // that.
                            let _ = child.start_kill();
                        }
                        // Mark the receiver consumed so a subsequent stop
                        // (e.g. cleanup-driven) doesn't accidentally fire
                        // the arm again. The actor is on its way out.
                        self.stop_kill_rx = None;
                    }
                }
            }
        }

        self.cleanup().await;
    }

    // ── Turn Transaction Engine ──

    /// Enqueue a user message and try to dispatch.
    async fn handle_send_message(
        &mut self,
        text: String,
        attachments: Vec<AttachmentData>,
        client_message_id: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    ) {
        if self.terminated {
            let _ = reply.send(Err("Session terminated".to_string()));
            return;
        }

        // v1.0.9 Phase 2: dedupe against the bounded accepted ledger FIRST.
        // This catches retries that re-dispatch after the original turn has
        // already moved out of queued_user (the Phase 1 dedupe only checked
        // the still-pending queue). The ledger is FIFO-bounded by
        // ACCEPTED_CLIENT_MESSAGE_IDS_CAP; evictions are logged.
        if let Some(ref cid) = client_message_id {
            if is_accepted(&self.accepted_client_message_ids, cid) {
                log::debug!(
                    "[turn] dedupe: client_message_id={} already accepted; resolving as accepted",
                    cid
                );
                let _ = reply.send(Ok(()));
                return;
            }
            match crate::storage::run_journal::is_message_accepted(&self.run_id, cid) {
                Ok(true) => {
                    log::debug!(
                        "[turn] dedupe: client_message_id={} durably accepted; resolving as accepted",
                        cid
                    );
                    self.record_accepted_client_message_id(cid.clone());
                    let _ = reply.send(Ok(()));
                    return;
                }
                Ok(false) => {}
                Err(error) => {
                    let failure = format!(
                        "{}: cannot verify client_message_id={}: {}",
                        crate::run_core::JOURNAL_DEDUPE_UNAVAILABLE_PREFIX,
                        cid,
                        error
                    );
                    log::error!("[turn] durable dedupe unavailable: {}", failure);
                    let _ = reply.send(Err(failure));
                    return;
                }
            }
        }

        if let Some(ref registry) = self.recovery_registry {
            let recovering = {
                let map = registry.lock().await;
                map.get(&self.run_id)
                    .map(|e| e.is_recovering())
                    .unwrap_or(false)
            };
            if recovering {
                let mut map = registry.lock().await;
                if let Some(entry) = map.get_mut(&self.run_id) {
                    if let Err(e) =
                        entry.enqueue_recovery_send(text, attachments, client_message_id)
                    {
                        let _ = reply.send(Err(e.to_string()));
                        return;
                    }
                    let _ = reply.send(Ok(()));
                    return;
                }
            }
        }

        // v1.0.9: dedupe by client_message_id within the queued_user set so a
        // retried submit that races with a still-pending send cannot queue a
        // second turn for the same user content. Idempotency is opt-in; if
        // the client omits the id we fall back to the historical behaviour.
        if let Some(ref cid) = client_message_id {
            if self
                .queued_user
                .iter()
                .any(|t| t.client_message_id.as_deref() == Some(cid.as_str()))
            {
                log::debug!(
                    "[turn] dedupe: client_message_id={} already queued; resolving as accepted",
                    cid
                );
                let _ = reply.send(Ok(()));
                return;
            }
        }

        // Allocate turn_index and determine kind
        let trimmed = text.trim();
        let turn_index = self.next_turn_index;
        self.next_turn_index += 1;

        let kind = if trimmed.starts_with('/') {
            UserTurnKind::Slash {
                command: trimmed.to_string(),
            }
        } else {
            // Advance next_auto_ctx_id to keep the resume baseline monotonic
            // even though auto-context itself is disabled (P0-C2).
            self.next_auto_ctx_id += 1;
            UserTurnKind::Normal
        };

        let seq = self.next_turn_seq;
        self.next_turn_seq += 1;

        log::debug!(
            "[turn] enqueue user: turn_index={}, kind={:?}, seq={}, client_message_id={:?}",
            turn_index,
            kind,
            seq,
            client_message_id,
        );

        // Guard against unbounded queue growth under IPC abuse.
        if self.queued_user.len() >= QUEUED_USER_CAP {
            log::warn!(
                "[turn] queued_user full ({}), rejecting message",
                self.queued_user.len()
            );
            let _ = reply.send(Err(format!(
                "Queue full: {} messages pending. Wait for the current turn to finish.",
                self.queued_user.len()
            )));
            return;
        }

        self.queued_user.push_back(UserTurnTicket {
            ticket_seq: seq,
            text,
            attachments,
            kind,
            turn_index,
            client_message_id,
        });

        // Reply immediately: the message is accepted into the actor's queue.
        // The actual CLI dispatch happens asynchronously when try_dispatch()
        // runs (which may be deferred if a turn is already active). This
        // prevents false timeouts when a long-running CLI turn (>45s) blocks
        // dispatch — the IPC returns quickly and the frontend's own transport
        // timeout is the real guard against hangs.
        let _ = reply.send(Ok(()));

        self.try_dispatch().await;
    }

    /// Try to dispatch next queued item. HC #1: One turn at a time.
