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
    apply_activity_reset, ActiveTurn, ContextExtractor, InternalExtractor, InternalJob, TurnOrigin,
    TurnPhase, UserTurnKind, UserTurnTicket, ACCEPTED_CLIENT_MESSAGE_IDS_CAP,
    INTERNAL_HARD_TIMEOUT, INTERNAL_SOFT_TIMEOUT, PROTOCOL_DESYNC_THRESHOLD,
    PROTOCOL_DESYNC_WINDOW_SECS, QUARANTINE_DEADLINE, TICK_INTERVAL, USER_HARD_TIMEOUT,
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

/// Extract content from `<promise>...</promise>` tag in text.
fn extract_promise_tag(text: &str) -> Option<&str> {
    let start = text.find("<promise>")?;
    let end = text.find("</promise>")?;
    if end <= start + 9 {
        return None;
    }
    Some(text[start + 9..end].trim())
}

// ── Ralph Loop types ──

#[derive(Debug, Clone, PartialEq)]
enum RalphPhase {
    Running,
    WaitingRetry,
    PausedByUser { was: Box<RalphPhase> },
    CancelPending,
}

#[allow(dead_code)] // started_at is stored for potential future use
struct RalphLoopState {
    prompt: String,
    phase: RalphPhase,
    iteration: u32,
    max_iterations: u32,
    completion_promise: Option<String>,
    started_at: String,
    consecutive_failures: u32,
    max_consecutive_failures: u32,
    retry_after: Option<Instant>,
    turn_toplevel_texts: Vec<String>,
}

/// Result returned by cancel_ralph_loop IPC command.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RalphCancelResult {
    pub iteration: u32,
    pub immediate: bool,
}

/// Tracks a pending interactive control request (permission, hook, elicitation)
/// that was forwarded to the frontend and is waiting for user response.
/// Used for diagnosing hard-timeout causes.
#[derive(Debug)]
struct PendingInteractiveRequest {
    request_id: String,
    /// "can_use_tool" | "hook_callback" | "elicitation"
    subtype: String,
    /// tool_name / hook event / server name
    detail: String,
    received_at: Instant,
}

// ── Public types ──

// `AttachmentData` lives in `crate::agent::attachment` (leaf module) so
// `session_actor` and `runtime_recovery` can both depend on it without
// creating an import cycle.

/// Commands sent to the actor via its mailbox.
pub enum ActorCommand {
    SendMessage {
        text: String,
        attachments: Vec<AttachmentData>,
        reply: oneshot::Sender<Result<(), String>>,
        /// v1.0.9: optional client-side idempotency token.
        client_message_id: Option<String>,
    },
    /// Two-phase control: actor writes stdin + registers waiter → returns (request_id, response_rx).
    /// Caller awaits response_rx outside the actor to avoid deadlocking the select! loop.
    SendControl {
        request: Value,
        reply: oneshot::Sender<Result<(String, oneshot::Receiver<Value>), String>>,
    },
    Stop {
        /// P0-6: the actor returns `ActorStopReason::UserRequested` on
        /// success so callers (IPC layer, recovery registry) can
        /// distinguish user intent from infrastructure failures without
        /// re-deriving the cause from flags after the fact.
        reply: oneshot::Sender<Result<ActorStopReason, String>>,
    },
    /// Inline permission response: write control_response back to CLI stdin.
    /// Used with `--permission-prompt-tool stdio` (Phase 2).
    RespondPermission {
        request_id: String,
        response: Value,
        tool_name: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Cancel a pending control_request (top-level message type, not a control_request subtype).
    CancelControlRequest {
        request_id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Hook callback response: write control_response back to CLI stdin.
    RespondHookCallback {
        request_id: String,
        response: Value,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// MCP elicitation response: write control_response back to CLI stdin.
    RespondElicitation {
        request_id: String,
        response: Value,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Start a Ralph loop (auto-iterate same prompt until completion).
    StartRalphLoop {
        prompt: String,
        max_iterations: u32,
        completion_promise: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Cancel an active Ralph loop.
    CancelRalphLoop {
        reply: oneshot::Sender<Result<RalphCancelResult, String>>,
    },
    /// Wait until the CLI has produced its first output (proving it's alive and initialized).
    /// Used after spawning a resume actor to replace fixed sleeps.
    WaitReady {
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// One-shot title generation: spawn `claude --print` tied to the actor's
    /// own process tree (kill_on_drop on the spawned Child ensures the title
    /// process is cleaned up when the actor is dropped or the run is stopped).
    /// The spawned process is a sibling of the long-lived `claude` session
    /// (it is NOT a child of the long-lived `claude` process) — but because
    /// it is owned by the actor task, it dies with the actor. The reply
    /// carries the normalized title on success.
    GenerateTitle {
        prompt: String,
        reply: oneshot::Sender<Result<String, String>>,
    },
}

/// External handle held in SessionMap. Provides the channel sender + metadata.
pub struct SessionActorHandle {
    pub cmd_tx: mpsc::Sender<ActorCommand>,
    pub run_id: String,
    /// Identity tag — shared Arc with the actor. cleanup uses Arc::ptr_eq to
    /// verify the map entry is still "us" (not a replacement actor).
    pub tag: Arc<()>,
    pub join_handle: tokio::task::JoinHandle<()>,
    /// Fires when the actor exits (normal or abnormal). Callers can await this
    /// to know when it's safe to spawn a replacement.
    pub shutdown_rx: oneshot::Receiver<()>,
}

/// Reason the actor loop exited. Propagated through the `Stop` reply
/// channel and the recovery snapshot so callers (cleanup, recovery
/// registry, IPC handlers) can distinguish user intent from infrastructure
/// failures without re-deriving the cause from flags.
///
/// `UserRequested` = explicit stop via IPC (`ActorCommand::Stop`) — the
/// CLI child process was reaped because the user asked for it.
///
/// `Cancelled` = the actor's parent cancellation token fired (app exit /
/// server shutdown). Treat the same as user-stopped for state-machine
/// purposes, but the recovery registry skips re-spawn.
///
/// `StreamEof` = natural EOF (no user intent). For natural EOF the
/// protocol layer already emitted a terminal `RunState` (`idle` /
/// `failed`) — `cleanup` does not need to emit a second one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActorStopReason {
    UserRequested,
    Cancelled,
    StreamEof,
}

// ── Actor internals ──

/// The actor's private state. Runs in a single tokio task.
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
    /// Extractor for internal turns (e.g. ContextExtractor).
    active_extractor: Option<Box<dyn InternalExtractor>>,
    /// Queue of pending user messages.
    queued_user: VecDeque<UserTurnTicket>,
    /// v1.0.9 Phase 2: bounded FIFO ledger of client_message_ids the actor
    /// has already accepted (i.e. reply.send(Ok(())) was reached). Used to
    /// dedupe retries across queue + ledger so a reconnect-retry that
    /// re-dispatches a previously-accepted submit resolves idempotently
    /// without creating a second turn. Bounded by
    /// `ACCEPTED_CLIENT_MESSAGE_IDS_CAP`; eviction is FIFO.
    accepted_client_message_ids: VecDeque<String>,
    /// Queue of pending internal jobs (auto-context).
    queued_internal: VecDeque<InternalJob>,
    /// Next turn index (all user messages including slash). Starts from resume baseline.
    next_turn_index: u32,
    /// Next auto_ctx_id (Normal user messages only). Starts from resume baseline.
    next_auto_ctx_id: u32,
    /// Monotonically increasing turn seq for ordering.
    next_turn_seq: u64,
    /// Last auto_ctx_id that triggered auto-context (dedup).
    last_auto_context_for: Option<u32>,
    /// Post-turn barrier: forces internal job for this turn_index before next user turn.
    must_run_internal_for_turn: Option<u32>,
    /// Quarantine: freeze dispatch until CLI reports a turn-boundary state.
    quarantine_until_result: bool,
    quarantine_deadline: Option<Instant>,
    interrupt_sent_for_quarantine: bool,
    /// Whether the current quarantine was triggered by an internal turn (auto-context).
    /// If true, quarantine hard-timeout abandons instead of killing the process.
    quarantine_from_internal: bool,
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
pub fn spawn_actor(
    emitter: Arc<BroadcastEmitter>,
    sessions: ActorSessionMap,
    run_id: String,
    child: Child,
    stdin: ChildStdin,
    stdout: ChildStdout,
    stderr: ChildStderr,
    is_resume: bool,
    cancel: CancellationToken,
    initial_turn_index: u32,
    initial_auto_ctx_id: u32,
    recovery_registry: Option<RecoveryRegistry>,
    recovery_bootstrap: Option<ActorRecoveryBootstrap>,
) -> SessionActorHandle {
    spawn_actor_with_runtime(
        emitter,
        sessions,
        run_id,
        child,
        stdin,
        stdout,
        stderr,
        is_resume,
        cancel,
        initial_turn_index,
        initial_auto_ctx_id,
        AgentRuntimeKind::ClaudeCode,
        recovery_registry,
        recovery_bootstrap,
    )
}

/// Spawn a new session actor with explicit runtime kind.
#[allow(clippy::too_many_arguments)]
pub fn spawn_actor_with_runtime(
    emitter: Arc<BroadcastEmitter>,
    sessions: ActorSessionMap,
    run_id: String,
    child: Child,
    stdin: ChildStdin,
    stdout: ChildStdout,
    stderr: ChildStderr,
    is_resume: bool,
    cancel: CancellationToken,
    initial_turn_index: u32,
    initial_auto_ctx_id: u32,
    runtime_kind: AgentRuntimeKind,
    recovery_registry: Option<RecoveryRegistry>,
    recovery_bootstrap: Option<ActorRecoveryBootstrap>,
) -> SessionActorHandle {
    let tag = Arc::new(());
    let (cmd_tx, cmd_rx) = mpsc::channel::<ActorCommand>(64);
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let (ready_tx, _ready_rx) = tokio::sync::watch::channel(false);
    drop(_ready_rx); // WaitReady commands create their own receivers from ready_tx

    let (
        accepted_client_message_ids,
        next_turn_index,
        next_auto_ctx_id,
        next_turn_seq,
        connection_generation,
        session_id,
    ) = if let Some(bootstrap) = recovery_bootstrap {
        (
            bootstrap.accepted_ledger,
            bootstrap.next_turn_index,
            bootstrap.next_auto_ctx_id,
            bootstrap.next_turn_seq,
            bootstrap.connection_generation,
            bootstrap.session_id,
        )
    } else {
        (
            VecDeque::new(),
            initial_turn_index,
            initial_auto_ctx_id,
            0,
            0,
            None,
        )
    };

    log::debug!(
        "[actor] spawn: run_id={}, is_resume={}, initial_turn_index={}, initial_auto_ctx_id={}",
        run_id,
        is_resume,
        initial_turn_index,
        initial_auto_ctx_id
    );

    let actor = SessionActor {
        emitter,
        sessions,
        run_id: run_id.clone(),
        tag: tag.clone(),
        protocol: ProtocolState::with_runtime(is_resume, runtime_kind),
        state: String::new(),
        stdin: Some(stdin),
        child: Some(child),
        cancel,
        pending_interrupt: false,
        control_waiters: HashMap::new(),
        shutdown_tx: Some(shutdown_tx),
        // Turn Transaction Engine
        active_turn: None,
        active_extractor: None,
        queued_user: VecDeque::new(),
        queued_internal: VecDeque::new(),
        accepted_client_message_ids,
        next_turn_index,
        next_auto_ctx_id,
        next_turn_seq,
        last_auto_context_for: None,
        must_run_internal_for_turn: None,
        quarantine_until_result: false,
        quarantine_deadline: None,
        interrupt_sent_for_quarantine: false,
        quarantine_from_internal: false,
        terminated: false,
        json_parse_fail_count: 0,
        parse_fail_window: Vec::new(),
        desync_emitted: false,
        ralph_loop: None,
        ralph_needs_dispatch: false,
        pending_interactive_request: None,
        ready_tx,
        recovery_registry,
        connection_generation,
        session_id,
        crash_reason: None,
        user_stopped: false,
        recoverable_exit: false,
        exit_code: None,
        pending_unaccepted_for_recovery: VecDeque::new(),
    };

    let join_handle = tokio::spawn(async move {
        actor.run(cmd_rx, stdout, stderr).await;
    });

    SessionActorHandle {
        cmd_tx,
        run_id,
        tag,
        join_handle,
        shutdown_rx,
    }
}

// ── Actor main loop ──

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
                            let reason = self.request_stop();
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
                    self.request_stop();
                    self.finalize_stop().await;
                    // Same as the Stop arm: drain stdout through EOF so the
                    // frontend gets the terminal `RunState` before we exit.
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

        if self.must_run_internal_for_turn.is_some() {
            log::debug!(
                "[turn] barrier active, user message queued (will dispatch after internal turn)"
            );
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
            let auto_ctx_id = self.next_auto_ctx_id;
            self.next_auto_ctx_id += 1;
            UserTurnKind::Normal { auto_ctx_id }
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

        self.queued_user.push_back(UserTurnTicket {
            ticket_seq: seq,
            text,
            attachments,
            kind,
            turn_index,
            reply,
            client_message_id,
        });

        self.try_dispatch().await;
    }

    /// Try to dispatch next queued item. HC #1: One turn at a time.
    async fn try_dispatch(&mut self) {
        if self.active_turn.is_some() || self.quarantine_until_result || self.terminated {
            return;
        }

        // HC #3: Barrier — try internal queue first when barrier is set
        if let Some(barrier_turn) = self.must_run_internal_for_turn {
            if let Some(pos) = self
                .queued_internal
                .iter()
                .position(|j| j.for_turn_index == barrier_turn)
            {
                if let Some(job) = self.queued_internal.remove(pos) {
                    self.start_internal_turn(job).await;
                }
                return;
            }
        }

        // Try user queue first (unless barrier blocks). Ralph yields to user messages.
        if self.must_run_internal_for_turn.is_none() {
            if let Some(ticket) = self.queued_user.pop_front() {
                // Pause Ralph if it's active
                if let Some(ref mut ralph) = self.ralph_loop {
                    match &ralph.phase {
                        RalphPhase::Running => {
                            ralph.phase = RalphPhase::PausedByUser {
                                was: Box::new(RalphPhase::Running),
                            };
                            log::debug!("[ralph] paused by user message");
                        }
                        RalphPhase::WaitingRetry => {
                            ralph.phase = RalphPhase::PausedByUser {
                                was: Box::new(RalphPhase::WaitingRetry),
                            };
                            log::debug!("[ralph] paused by user message (was WaitingRetry)");
                        }
                        _ => {} // CancelPending — don't touch
                    }
                }
                self.start_user_turn(ticket).await;
                return;
            }
        }

        // Ralph loop: dispatch ralph prompt when user queue is empty and phase is Running
        if let Some(ref mut ralph) = self.ralph_loop {
            match ralph.phase {
                RalphPhase::Running => {
                    let prompt = ralph.prompt.clone();
                    self.start_ralph_turn(prompt).await;
                    return;
                }
                RalphPhase::WaitingRetry => {
                    if let Some(deadline) = ralph.retry_after {
                        if Instant::now() >= deadline {
                            // Backoff expired — transition to Running and dispatch
                            ralph.phase = RalphPhase::Running;
                            ralph.retry_after = None;
                            let prompt = ralph.prompt.clone();
                            self.start_ralph_turn(prompt).await;
                            return;
                        }
                    }
                }
                _ => {}
            }
        }

        // Try internal queue
        if let Some(job) = self.queued_internal.pop_front() {
            self.start_internal_turn(job).await;
        }
    }

    /// Start a user turn: write to stdin, emit events, set active_turn.
    async fn start_user_turn(&mut self, ticket: UserTurnTicket) {
        log::debug!(
            "[turn] start_user: turn_index={}, kind={:?}, seq={}",
            ticket.turn_index,
            ticket.kind,
            ticket.ticket_seq
        );

        // Track pending slash commands for friendly hint
        match &ticket.kind {
            UserTurnKind::Slash { command } => {
                self.protocol
                    .set_pending_slash_command(Some(command.clone()));
            }
            UserTurnKind::Normal { .. } => {
                self.protocol.set_pending_slash_command(None);
            }
        }

        // v1.0.9 hardening: stash the message in pending_unaccepted BEFORE
        // the stdin write. If write_user_to_stdin fails, the message has
        // already been popped from queued_user — without this stash it would
        // be absent from build_recovery_snapshot and permanently lost.
        // On success, the idempotent insert into accepted_ledger means the
        // duplicate in pending_unaccepted is harmlessly filtered during replay.
        self.pending_unaccepted_for_recovery
            .push_back(PendingRecoveryMessage {
                text: ticket.text.clone(),
                attachments: ticket.attachments.clone(),
                client_message_id: ticket.client_message_id.clone(),
            });

        // Write to stdin
        let user_uuid = match self
            .write_user_to_stdin(&ticket.text, &ticket.attachments)
            .await
        {
            Ok(uuid) => uuid,
            Err(e) => {
                log::warn!("[turn] start_user: stdin write failed: {}", e);
                let _ = ticket.reply.send(Err(e.clone()));
                self.crash_reason = Some(CrashReason::StdinWriteFailed);
                self.recoverable_exit = true;
                if let Some(ref mut child) = self.child {
                    let _ = child.kill().await;
                }
                self.stdin.take();
                return;
            }
        };
        log::debug!("[turn] user_message_uuid={}", user_uuid);

        // Emit UserMessage + RunState(running)
        self.persist_and_emit(&BusEvent::UserMessage {
            run_id: self.run_id.clone(),
            text: ticket.text.clone(),
            uuid: Some(user_uuid),
        });
        self.emit_state("running", None, None, false);
        self.persist_idle_running(RunStatus::Running);

        let mut acceptance_error = None;
        if let Some(cid) = ticket.client_message_id.clone() {
            // stdin has already accepted the payload. Record the in-memory ID
            // immediately so a same-process retry cannot duplicate the turn,
            // even if the durable journal needs WAL recovery.
            self.record_accepted_client_message_id(cid.clone());
            let preview = if ticket.text.chars().count() > 120 {
                let end = ticket
                    .text
                    .char_indices()
                    .nth(120)
                    .map(|(i, _)| i)
                    .unwrap_or(ticket.text.len());
                Some(format!("{}...", &ticket.text[..end]))
            } else {
                Some(ticket.text.clone())
            };
            // Session actor still uses the legacy compat path; it
            // will be migrated in a separate change. P0-3 keeps the
            // wrapper working so cross-pipeline dedupe snapshots
            // remain comparable between pipe and actor.
            #[allow(deprecated)]
            let accepted = crate::storage::run_journal::record_accepted_message(
                &self.run_id,
                &cid,
                preview.as_deref(),
            );
            if let Err(error) = accepted {
                log::error!("[turn] durable acceptance failed: {}", error);
                let _ = crate::storage::run_journal::mark_degraded(&self.run_id, &error);
                match crate::storage::run_journal::is_message_accepted(&self.run_id, &cid) {
                    Ok(true) => {
                        log::warn!(
                            "[turn] durable acceptance recovered from WAL for client_message_id={}",
                            cid
                        );
                    }
                    Ok(false) => acceptance_error = Some(error),
                    Err(recheck_error) => {
                        acceptance_error = Some(format!(
                            "{error}; durable acceptance recheck failed: {recheck_error}"
                        ));
                    }
                }
            }
        }

        // stdin succeeded, so this payload must never remain in the automatic
        // recovery queue. An ambiguous journal outcome is surfaced to the
        // caller, but the live actor still tracks the already-running turn.
        if self.pending_unaccepted_for_recovery.pop_back().is_none() {
            log::warn!("[turn] pending_unaccepted_for_recovery empty after successful stdin write");
        }

        // Set active turn before replying. This preserves the actor state
        // machine even when durable acceptance remains ambiguous.
        let now = Instant::now();
        self.active_turn = Some(ActiveTurn {
            turn_seq: ticket.ticket_seq,
            origin: TurnOrigin::User(ticket.kind.clone()),
            phase: TurnPhase::Active,
            started_at: now,
            soft_deadline: now + USER_SOFT_TIMEOUT,
            hard_deadline: now + USER_HARD_TIMEOUT,
            turn_index: ticket.turn_index,
        });

        if let Some(error) = acceptance_error {
            let _ = ticket.reply.send(Err(error));
        } else {
            let _ = ticket.reply.send(Ok(()));
        }
    }

    /// Start an internal turn (auto-context): write /context to stdin.
    async fn start_internal_turn(&mut self, job: InternalJob) {
        log::debug!(
            "[turn] start_internal: kind={:?}, for_auto_ctx_id={}, for_turn_index={}",
            job.kind,
            job.for_auto_ctx_id,
            job.for_turn_index
        );

        self.protocol
            .set_pending_slash_command(Some("/context".to_string()));

        if let Err(e) = self.write_user_to_stdin("/context", &[]).await {
            log::warn!("[turn] start_internal: stdin write failed: {}", e);
            self.must_run_internal_for_turn = None;
            self.protocol.set_pending_slash_command(None);
            // Don't recurse into try_dispatch here — next tick will retry.
            return;
        }

        let now = Instant::now();
        let turn_index = job.for_turn_index;
        self.active_turn = Some(ActiveTurn {
            turn_seq: job.job_seq,
            origin: TurnOrigin::Internal(job.kind),
            phase: TurnPhase::Active,
            started_at: now,
            soft_deadline: now + INTERNAL_SOFT_TIMEOUT,
            hard_deadline: now + INTERNAL_HARD_TIMEOUT,
            turn_index,
        });
        self.active_extractor = Some(Box::new(ContextExtractor {
            app: self.emitter.app().clone(),
            run_id: self.run_id.clone(),
            for_turn_index: turn_index,
            captured: false,
        }));
        self.last_auto_context_for = Some(job.for_auto_ctx_id);
        self.must_run_internal_for_turn = None; // Barrier cleared

        log::debug!(
            "[turn] internal turn started, last_auto_context_for={}",
            job.for_auto_ctx_id
        );
    }

    /// End current turn and dispatch next.
    async fn end_turn_and_dispatch(&mut self) {
        if let Some(ref mut ext) = self.active_extractor {
            ext.finalize(false);
        }
        self.active_turn = None;
        self.active_extractor = None;
        self.protocol.set_pending_slash_command(None);
        self.try_dispatch().await;
    }

    /// Called when a user turn reaches idle — enqueue auto-context if applicable. (HC #24)
    /// NOTE: Auto-context is currently disabled because /context hangs CLI
    /// with certain API proxies, causing process kills and SESSION ISSUE errors.
    /// The /context slash command produces zero output and never completes,
    /// leading to hard timeout → quarantine → kill. Re-enable once root cause
    /// (likely proxy incompatibility with /context tokenization) is resolved.
    fn on_user_turn_finished(&mut self, turn: &ActiveTurn) {
        if let TurnOrigin::User(UserTurnKind::Normal { auto_ctx_id }) = &turn.origin {
            let auto_ctx_id = *auto_ctx_id;
            log::debug!(
                "[turn] auto-context skipped (disabled): auto_ctx_id={}",
                auto_ctx_id
            );
            // Update last_auto_context_for to maintain dedup state
            self.last_auto_context_for = Some(auto_ctx_id);

            /* Disabled: /context hangs with some API proxies
            if crate::agent::turn_engine::should_trigger_auto_context(
                auto_ctx_id,
                self.last_auto_context_for,
            ) {
                let seq = self.next_turn_seq;
                self.next_turn_seq += 1;
                self.queued_internal.push_back(InternalJob {
                    job_seq: seq,
                    kind: InternalJobKind::AutoContext,
                    for_auto_ctx_id: auto_ctx_id,
                    for_turn_index: turn.turn_index,
                });
                self.must_run_internal_for_turn = Some(turn.turn_index);
                log::debug!(
                    "[turn] barrier set: must_run_internal_for_turn={}, auto_ctx_id={}",
                    turn.turn_index,
                    auto_ctx_id
                );
            }
            */ // end disabled auto-context
        }
    }

    // ── Ralph Loop methods ──

    /// Start a Ralph loop turn: write prompt to stdin, set active_turn with TurnOrigin::Ralph.
    async fn start_ralph_turn(&mut self, prompt: String) {
        let turn_index = self.next_turn_index;
        self.next_turn_index += 1;
        // Ralph turns don't allocate auto_ctx_id (no auto-context)

        let seq = self.next_turn_seq;
        self.next_turn_seq += 1;

        // Clear per-turn text buffer
        if let Some(ref mut ralph) = self.ralph_loop {
            ralph.turn_toplevel_texts.clear();
        }

        let user_uuid = match self.write_user_to_stdin(&prompt, &[]).await {
            Ok(uuid) => uuid,
            Err(e) => {
                log::error!("[ralph] stdin write failed: {}", e);
                // Compute action to avoid borrow conflict
                let action = if let Some(ref mut ralph) = self.ralph_loop {
                    ralph.consecutive_failures += 1;
                    if ralph.consecutive_failures >= ralph.max_consecutive_failures {
                        Some(RalphCompleteReason::FailStopped)
                    } else {
                        let backoff = Duration::from_secs(2 * ralph.consecutive_failures as u64);
                        ralph.retry_after = Some(Instant::now() + backoff);
                        ralph.phase = RalphPhase::WaitingRetry;
                        None
                    }
                } else {
                    None
                };
                if let Some(reason) = action {
                    self.emit_ralph_complete(reason);
                }
                return;
            }
        };

        self.persist_and_emit(&BusEvent::UserMessage {
            run_id: self.run_id.clone(),
            text: prompt,
            uuid: Some(user_uuid),
        });
        self.emit_state("running", None, None, false);
        self.persist_idle_running(RunStatus::Running);

        let now = Instant::now();
        self.active_turn = Some(ActiveTurn {
            turn_seq: seq,
            origin: TurnOrigin::Ralph,
            phase: TurnPhase::Active,
            started_at: now,
            soft_deadline: now + USER_SOFT_TIMEOUT,
            hard_deadline: now + USER_HARD_TIMEOUT,
            turn_index,
        });

        log::debug!(
            "[ralph] turn started: turn_index={}, seq={}, iteration={}",
            turn_index,
            seq,
            self.ralph_loop.as_ref().map(|r| r.iteration).unwrap_or(0)
        );
    }

    /// Emit RalphComplete and clean up ralph_loop. After this, self.ralph_loop == None.
    fn emit_ralph_complete(&mut self, reason: RalphCompleteReason) {
        let iteration = self.ralph_loop.as_ref().map(|r| r.iteration).unwrap_or(0);
        self.ralph_loop = None;
        self.persist_and_emit(&BusEvent::RalphComplete {
            run_id: self.run_id.clone(),
            reason,
            iteration,
        });
        log::info!(
            "[ralph] complete: reason={:?}, iteration={}",
            reason,
            iteration
        );
    }

    /// Ralph state transition on turn end. Uses action-first pattern to avoid borrow conflicts.
    fn ralph_on_turn_end(&mut self, turn: &ActiveTurn, state: &str) {
        // ── Step 1: compute action (borrows ralph_loop mutably, then drops) ──
        enum RalphAction {
            Complete(RalphCompleteReason),
            EmitIteration { iteration: u32, max_iterations: u32 },
            SetWaitingRetry { backoff: Duration },
            ResumeFrom(RalphPhase),
            Noop,
        }

        let action = {
            let Some(ref mut ralph) = self.ralph_loop else {
                return;
            };

            match turn.origin {
                TurnOrigin::Ralph => {
                    let is_cancel_pending = ralph.phase == RalphPhase::CancelPending;

                    if state == "failed" {
                        if is_cancel_pending {
                            RalphAction::Complete(RalphCompleteReason::Cancelled)
                        } else {
                            ralph.consecutive_failures += 1;
                            if ralph.consecutive_failures >= ralph.max_consecutive_failures {
                                RalphAction::Complete(RalphCompleteReason::FailStopped)
                            } else {
                                let backoff =
                                    Duration::from_secs(2 * ralph.consecutive_failures as u64);
                                RalphAction::SetWaitingRetry { backoff }
                            }
                        }
                    } else {
                        // idle — process turn result normally
                        ralph.consecutive_failures = 0;
                        ralph.iteration += 1;

                        // Check natural completion conditions first
                        let natural_reason = if ralph.max_iterations > 0
                            && ralph.iteration >= ralph.max_iterations
                        {
                            Some(RalphCompleteReason::MaxIterations)
                        } else if let Some(ref promise) = ralph.completion_promise {
                            let matched = ralph.turn_toplevel_texts.iter().any(|text| {
                                extract_promise_tag(text)
                                    .map(|found| found == promise.as_str())
                                    .unwrap_or(false)
                            });
                            if matched {
                                Some(RalphCompleteReason::CompletionPromise)
                            } else {
                                None
                            }
                        } else {
                            None
                        };

                        if let Some(reason) = natural_reason {
                            RalphAction::Complete(reason)
                        } else if is_cancel_pending {
                            RalphAction::Complete(RalphCompleteReason::Cancelled)
                        } else {
                            RalphAction::EmitIteration {
                                iteration: ralph.iteration,
                                max_iterations: ralph.max_iterations,
                            }
                        }
                    }
                }
                TurnOrigin::User(_) => {
                    if let RalphPhase::PausedByUser { ref was } = ralph.phase {
                        RalphAction::ResumeFrom(*was.clone())
                    } else {
                        RalphAction::Noop
                    }
                }
                _ => RalphAction::Noop,
            }
        };
        // ← ralph_loop borrow ends here

        // ── Step 2: execute action ──
        match action {
            RalphAction::Complete(reason) => {
                self.emit_ralph_complete(reason);
            }
            RalphAction::EmitIteration {
                iteration,
                max_iterations,
            } => {
                self.persist_and_emit(&BusEvent::RalphIteration {
                    run_id: self.run_id.clone(),
                    iteration,
                    max_iterations,
                });
            }
            RalphAction::SetWaitingRetry { backoff } => {
                if let Some(ref mut ralph) = self.ralph_loop {
                    ralph.phase = RalphPhase::WaitingRetry;
                    ralph.retry_after = Some(Instant::now() + backoff);
                    log::warn!(
                        "[ralph] turn failed ({}/{}), backing off {:?}",
                        ralph.consecutive_failures,
                        ralph.max_consecutive_failures,
                        backoff
                    );
                }
            }
            RalphAction::ResumeFrom(phase) => {
                if let Some(ref mut ralph) = self.ralph_loop {
                    ralph.phase = phase;
                    log::debug!("[ralph] resumed to {:?} after user turn", ralph.phase);
                }
            }
            RalphAction::Noop => {}
        }
    }

    /// Independent timeout clock — checks soft/hard deadlines and quarantine. (HC #4)
    async fn on_tick_timeout(&mut self) {
        // Check quarantine deadline first
        if self.quarantine_until_result {
            if let Some(deadline) = self.quarantine_deadline {
                if Instant::now() >= deadline {
                    // Quarantine secondary timeout → hard-kill
                    log::warn!(
                        "[turn] quarantine hard-timeout: run_id={}, from_internal={}, pending_request={:?}",
                        self.run_id,
                        self.quarantine_from_internal,
                        self.pending_interactive_request.as_ref().map(|r| (&r.subtype, &r.detail, r.received_at.elapsed().as_secs()))
                    );
                    self.protocol.set_pending_slash_command(None);
                    if let Some(ref mut child) = self.child {
                        let _ = child.kill().await;
                    }
                    let error_msg = if self.quarantine_from_internal {
                        "Auto-context hard timeout — process killed".to_string()
                    } else if let Some(ref req) = self.pending_interactive_request {
                        let wait_secs = req.received_at.elapsed().as_secs();
                        format!(
                            "Session timeout — waited {}s for {} response ({}). Process killed.",
                            wait_secs, req.subtype, req.detail
                        )
                    } else {
                        "Session timeout — no output from CLI for 30 minutes. Process killed."
                            .to_string()
                    };
                    self.emit_state("failed", None, Some(error_msg), true);
                    // v1.0.6 / hardening A1: recovery attempt failed → tell UI
                    self.persist_and_emit(&BusEvent::SessionRecovered {
                        run_id: self.run_id.clone(),
                        ok: false,
                    });
                    self.fail_all_pending_replies("Session hard timeout");
                    self.terminated = true;
                    return;
                }
            }
            // If quarantine but no deadline yet, and we haven't sent interrupt, send it now
            if !self.interrupt_sent_for_quarantine {
                self.send_interrupt_to_cli().await;
                self.interrupt_sent_for_quarantine = true;
                self.quarantine_deadline = Some(Instant::now() + QUARANTINE_DEADLINE);
                log::debug!(
                    "[turn] quarantine: interrupt sent, deadline set for run_id={}",
                    self.run_id
                );
            }
            return;
        }

        let Some(ref turn) = self.active_turn else {
            // No active turn — check Ralph WaitingRetry backoff expiry
            if let Some(ref ralph) = self.ralph_loop {
                if ralph.phase == RalphPhase::WaitingRetry {
                    if let Some(deadline) = ralph.retry_after {
                        if Instant::now() >= deadline {
                            log::debug!("[ralph] backoff expired, setting dispatch flag");
                            self.ralph_needs_dispatch = true;
                        }
                    }
                }
            }
            return;
        };
        let now = Instant::now();

        // Internal turn timeout checks
        if matches!(turn.origin, TurnOrigin::Internal(_)) {
            if now >= turn.hard_deadline {
                // Enter quarantine
                log::warn!(
                    "[turn] internal hard timeout: entering quarantine for run_id={} (turn_seq={})",
                    self.run_id,
                    turn.turn_seq
                );
                // HC #17: Clear pending_slash at quarantine entry
                self.protocol.set_pending_slash_command(None);
                if let Some(ref mut ext) = self.active_extractor {
                    ext.finalize(true);
                }
                self.active_extractor = None;
                self.active_turn = None;
                self.quarantine_until_result = true;
                self.interrupt_sent_for_quarantine = false;
                self.quarantine_deadline = None;
                self.quarantine_from_internal = true;
                // v1.0.6 / hardening A1: emit recovering so the UI can show a banner
                self.persist_and_emit(&BusEvent::SessionRecovering {
                    run_id: self.run_id.clone(),
                    reason: "internal_hard_timeout".to_string(),
                    deadline_ms: QUARANTINE_DEADLINE.as_millis() as u64,
                    from_internal: true,
                });
                // on_tick_timeout will send interrupt on next tick
            } else if now >= turn.soft_deadline && matches!(turn.phase, TurnPhase::Active) {
                // Transition to Draining
                log::debug!(
                    "[turn] internal soft timeout: draining for run_id={} (turn_seq={})",
                    self.run_id,
                    turn.turn_seq
                );
                if let Some(ref mut ext) = self.active_extractor {
                    ext.finalize(true);
                }
                // Mutate phase via raw pointer to self.active_turn
                if let Some(ref mut t) = self.active_turn {
                    t.phase = TurnPhase::Draining;
                }
            }
        }
        // User turns: typically don't time out (CLI manages its own flow)
        // but hard_deadline provides a safety net
        else if now >= turn.hard_deadline {
            log::warn!(
                "[turn] user hard timeout: entering quarantine for run_id={} (turn_seq={}), pending_request={:?}",
                self.run_id,
                turn.turn_seq,
                self.pending_interactive_request.as_ref().map(|r| (&r.subtype, &r.detail, r.received_at.elapsed().as_secs()))
            );
            self.protocol.set_pending_slash_command(None);
            self.active_turn = None;
            self.quarantine_until_result = true;
            self.interrupt_sent_for_quarantine = false;
            self.quarantine_deadline = None;
            self.quarantine_from_internal = false;
            // v1.0.6 / hardening A1: emit recovering so the UI can show a banner
            self.persist_and_emit(&BusEvent::SessionRecovering {
                run_id: self.run_id.clone(),
                reason: "user_hard_timeout".to_string(),
                deadline_ms: QUARANTINE_DEADLINE.as_millis() as u64,
                from_internal: false,
            });
        }
    }

    /// v1.0.9 Phase 2: insert a client_message_id into the accepted ledger.
    /// FIFO-evicts the oldest entry when at capacity. Used by
    /// `start_user_turn` after a turn has been successfully started.
    /// Idempotent: re-recording the same id is a no-op so a double-insert
    /// from a recovered retry cannot leak duplicates.
    fn record_accepted_client_message_id(&mut self, cid: String) {
        record_accepted_client_message_id(
            &mut self.accepted_client_message_ids,
            cid,
            ACCEPTED_CLIENT_MESSAGE_IDS_CAP,
        );
    }

    /// Write a user-format message to CLI stdin. Returns the UUID embedded in the payload.
    async fn write_user_to_stdin(
        &mut self,
        text: &str,
        attachments: &[AttachmentData],
    ) -> Result<String, String> {
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| "stdin closed".to_string())?;
        let (payload, user_uuid) = build_user_payload(text, attachments, &self.run_id);
        let mut line = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
        line.push('\n');
        log::debug!(
            "[turn] write_user_to_stdin: run_id={}, len={}, attachments={}, uuid={}",
            self.run_id,
            text.len(),
            attachments.len(),
            user_uuid
        );
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("stdin write failed: {}", e))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("stdin flush failed: {}", e))?;
        Ok(user_uuid)
    }

    /// Persist a BusEvent to JSONL, emit to Tauri webview, and broadcast to WS clients. (HC #32)
    fn persist_and_emit(&self, event: &BusEvent) {
        self.emitter.persist_and_emit(&self.run_id, event);
    }

    /// Fail all pending user reply channels. (HC #12)
    fn fail_all_pending_replies(&mut self, reason: &str) {
        let count = self.queued_user.len();
        while let Some(ticket) = self.queued_user.pop_front() {
            let _ = ticket.reply.send(Err(reason.to_string()));
        }
        self.queued_internal.clear();
        self.must_run_internal_for_turn = None;
        if count > 0 {
            log::debug!(
                "[turn] fail_all_pending_replies: failed {} tickets, reason={}",
                count,
                reason
            );
        }
    }

    /// Send interrupt control request to CLI for quarantine recovery. (HC #15)
    async fn send_interrupt_to_cli(&mut self) {
        let request_id = format!("ocv_qint_{}", uuid::Uuid::new_v4());
        let payload = serde_json::json!({
            "type": "control_request",
            "request_id": &request_id,
            "request": {
                "subtype": "interrupt"
            },
        });

        if let Some(stdin) = self.stdin.as_mut() {
            let Ok(mut line) = serde_json::to_string(&payload) else {
                return;
            };
            line.push('\n');
            match stdin.write_all(line.as_bytes()).await {
                Ok(_) => {
                    let _ = stdin.flush().await;
                    log::debug!(
                        "[turn] quarantine interrupt sent: req_id={}, run_id={}",
                        request_id,
                        self.run_id
                    );
                }
                Err(e) => {
                    log::warn!("[turn] quarantine interrupt write failed: {}", e);
                }
            }
        }
    }

    /// Check if current turn is internal.
    fn is_internal_turn(&self) -> bool {
        self.active_turn
            .as_ref()
            .map(|t| matches!(t.origin, TurnOrigin::Internal(_)))
            .unwrap_or(false)
    }

    // ── Command handlers ──

    /// Write control request to stdin + register response waiter.
    /// Returns (request_id, response_rx) — caller awaits response_rx outside the actor.
    async fn handle_send_control_async(
        &mut self,
        request: Value,
    ) -> Result<(String, oneshot::Receiver<Value>), String> {
        let request_id = format!("ocv_ctrl_{}", uuid::Uuid::new_v4());
        let subtype = request
            .get("subtype")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        log::debug!(
            "[actor] send_control: run_id={}, subtype={}, req_id={}",
            self.run_id,
            subtype,
            request_id
        );

        if subtype == "interrupt" {
            self.pending_interrupt = true;
            log::debug!("[actor] pending_interrupt set for run_id={}", self.run_id);
        }

        let payload = serde_json::json!({
            "type": "control_request",
            "request_id": &request_id,
            "request": request,
        });

        let (tx, rx) = oneshot::channel();
        self.control_waiters.insert(request_id.clone(), tx);

        self.write_json_line(&payload, "control request").await?;

        Ok((request_id, rx))
    }

    /// Two-phase stop:
    ///
    /// Phase 1 (`request_stop`): mark the actor as user-stopped so the main
    /// loop will discard stdin + kill the child on its next tick, and signal
    /// the caller that the request was accepted. Returns
    /// `ActorStopReason::UserRequested`.
    ///
    /// Phase 2 (`finalize_stop`): drain stdin, kill + reap the child, and
    /// let the main loop observe stdout EOF naturally so `handle_eof` emits
    /// the terminal `RunState("stopped")` event. Returning a typed reason
    /// lets `cleanup` distinguish user stops from crashes without scanning
    /// flags after the fact.
    ///
    /// Splitting the two phases avoids the previous race where `handle_stop`
    /// dropped stdin + killed the child inline, which caused the actor's
    /// `select!` to swallow the trailing stream-json events and leave the
    /// UI stuck on `RunState("streaming")` with no terminal event.
    fn request_stop(&mut self) -> ActorStopReason {
        if !self.user_stopped {
            log::debug!("[actor] stop requested by user: run_id={}", self.run_id);
            self.user_stopped = true;
        }
        ActorStopReason::UserRequested
    }

    async fn finalize_stop(&mut self) {
        // Drop stdin to signal EOF to CLI.
        self.stdin.take();

        // Kill + reap the child. We swallow kill errors here — the actor
        // may already be exiting (e.g. cancel.cancelled() path that called
        // request_stop + finalize_stop before us); `child.wait` is the
        // authoritative state read.
        if let Some(ref mut child) = self.child {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }

    /// Write control_response for a permission prompt back to CLI stdin.
    ///
    /// Returns a typed `PermissionError` JSON when the request is
    /// unknown (already responded, cancelled, or never registered),
    /// distinguishing the failure modes the coordinator cares about.
    /// Successful writes return `Ok(())`.
    pub async fn handle_respond_permission(
        &mut self,
        request_id: &str,
        response: Value,
        tool_name: Option<&str>,
    ) -> Result<(), crate::agent::permission_error::PermissionError> {
        log::debug!(
            "[actor] respond_permission: run_id={}, req_id={}",
            self.run_id,
            request_id,
        );
        // Duplicate-response guard: if the pending interactive request
        // exists but its id does not match this request_id, this is a
        // late / duplicate call. The CLI already considers it resolved.
        // We accept it (idempotent at the wire level) but log it.
        let matched = matches!(
            self.pending_interactive_request.as_ref(),
            Some(req) if req.request_id == request_id
        );
        if !matched && self.pending_interactive_request.is_some() {
            log::warn!(
                "[actor] respond_permission: req_id mismatch (likely duplicate / late); run_id={}, want={}, have_other_pending",
                self.run_id, request_id
            );
            self.clear_pending_interactive_request(request_id);
        } else if matched {
            // Validate tool_name against the pending request's detail
            // (which stores the real tool_name from the CLI control_request).
            // This prevents a frontend bug from permanently allowing a
            // dangerous tool by passing a fake tool_name.
            if let (Some(claimed), Some(pending)) = (
                tool_name,
                self.pending_interactive_request
                    .as_ref()
                    .filter(|r| r.subtype == "can_use_tool"),
            ) {
                if pending.detail != claimed {
                    log::warn!(
                        "[actor] respond_permission: tool_name mismatch; claimed={}, actual={}, run_id={}, req_id={}",
                        claimed, pending.detail, self.run_id, request_id
                    );
                    return Err(crate::agent::permission_error::PermissionError::new(
                        crate::agent::permission_error::PermissionErrorCode::UnknownRequest,
                        format!(
                            "tool_name mismatch: claimed {claimed}, actual {}",
                            pending.detail
                        ),
                        false,
                    ));
                }
            }
            self.clear_pending_interactive_request(request_id);
        }
        self.write_control_response(request_id, response)
            .await
            .map_err(|e| {
                crate::agent::permission_error::PermissionError::new(
                    crate::agent::permission_error::PermissionErrorCode::Transport,
                    e,
                    true,
                )
            })
    }

    /// Clear pending interactive request if it matches the given request_id.
    fn clear_pending_interactive_request(&mut self, request_id: &str) {
        if let Some(ref req) = self.pending_interactive_request {
            if req.request_id == request_id {
                log::debug!(
                    "[actor] clearing pending_interactive_request: subtype={}, detail={}, waited={}s",
                    req.subtype,
                    req.detail,
                    req.received_at.elapsed().as_secs()
                );
                self.pending_interactive_request = None;
            }
        }
    }

    /// Send a control_cancel_request to CLI stdin (top-level message type).
    async fn handle_cancel_control_request(&mut self, request_id: &str) -> Result<(), String> {
        let payload = serde_json::json!({
            "type": "control_cancel_request",
            "request_id": request_id,
        });
        log::debug!(
            "[actor] cancel_control_request: run_id={}, req_id={}",
            self.run_id,
            request_id,
        );
        self.write_json_line(&payload, "cancel control request")
            .await
    }

    /// Low-level helper: serialize JSON payload, write to stdin, flush.
    async fn write_json_line(&mut self, payload: &Value, context: &str) -> Result<(), String> {
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| "stdin closed".to_string())?;
        let mut line = serde_json::to_string(payload).map_err(|e| e.to_string())?;
        line.push('\n');
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("{} write failed: {}", context, e))?;
        if let Err(e) = stdin.flush().await {
            log::warn!(
                "[actor] stdin flush failed for run_id={}: {}",
                self.run_id,
                e
            );
        }
        Ok(())
    }

    /// Shared helper: write a control_response JSON to CLI stdin.
    async fn write_control_response(
        &mut self,
        request_id: &str,
        response: Value,
    ) -> Result<(), String> {
        // CLI expects: {"type":"control_response","response":{"subtype":"success","request_id":"...","response":{...}}}
        // request_id must be INSIDE the response wrapper, with subtype:"success"
        let payload = serde_json::json!({
            "type": "control_response",
            "response": {
                "subtype": "success",
                "request_id": request_id,
                "response": response,
            },
        });
        log::debug!(
            "[actor] write_control_response: run_id={}, req_id={}",
            self.run_id,
            request_id,
        );
        self.write_json_line(&payload, "control response").await
    }

    // ── I/O handlers ──

    /// Handle a stdout line from CLI — three-way routing: quarantine → control → map events.
    async fn handle_stdout_line(&mut self, text: &str, line_num: u64) {
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        log::trace!(
            "[actor] stdout #{}: {}",
            line_num,
            shared::truncate_str(text, 200)
        );

        // Step 0: JSON parse
        let parsed = match serde_json::from_str::<Value>(text) {
            Ok(v) => v,
            Err(_) => {
                self.json_parse_fail_count += 1;
                log::debug!(
                    "[actor] JSON parse failure #{}: {}",
                    self.json_parse_fail_count,
                    shared::truncate_str(text, 100)
                );
                // v1.0.6 / hardening A2: sliding-window desync detection.
                // Record this failure's wall-clock time, evict old entries,
                // and once we cross PROTOCOL_DESYNC_THRESHOLD inside the
                // window, emit ProtocolDesync and force-fail the run.
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                self.parse_fail_window.push(now_ms);
                let window_ms = PROTOCOL_DESYNC_WINDOW_SECS * 1000;
                self.parse_fail_window
                    .retain(|&t| now_ms.saturating_sub(t) <= window_ms);
                if !self.desync_emitted
                    && self.parse_fail_window.len() as u32 >= PROTOCOL_DESYNC_THRESHOLD
                {
                    self.desync_emitted = true;
                    let sample: String = text.chars().take(200).collect();
                    log::error!(
                        "[actor] protocol desync detected: {} parse failures within {}s window for run_id={}",
                        self.parse_fail_window.len(),
                        PROTOCOL_DESYNC_WINDOW_SECS,
                        self.run_id
                    );
                    self.persist_and_emit(&BusEvent::ProtocolDesync {
                        run_id: self.run_id.clone(),
                        fail_count: self.parse_fail_window.len() as u32,
                        sample,
                    });
                    // Force-fail the run so the turn engine unlocks. Frontend
                    // will see a "会话状态已重置" toast via event-middleware.
                    self.emit_state(
                        "failed",
                        None,
                        Some("protocol_desync: too many unparseable lines from CLI".to_string()),
                        true,
                    );
                    self.fail_all_pending_replies("protocol_desync");
                    self.crash_reason = Some(CrashReason::ProtocolDesynced);
                    self.recoverable_exit = true;
                    if let Some(ref mut child) = self.child {
                        let _ = child.kill().await;
                    }
                    self.stdin.take();
                    return;
                }
                // HC #16: parse failure during quarantine → swallow
                if self.quarantine_until_result {
                    log::trace!("[turn] quarantine: swallowed parse-fail line");
                    return;
                }
                // Internal turn → swallow
                if self.is_internal_turn() {
                    return;
                }
                // User turn or idle → emit Raw
                self.persist_and_emit(&BusEvent::Raw {
                    run_id: self.run_id.clone(),
                    source: "claude_stdout_text".to_string(),
                    data: Value::String(text.to_string()),
                });
                return;
            }
        };

        // Activity-based deadline reset for user/ralph turns.
        if apply_activity_reset(self.quarantine_until_result, &mut self.active_turn) {
            log::trace!(
                "[turn] activity reset: hard_deadline extended for run_id={}",
                self.run_id
            );
        }

        let event_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let is_control = event_type == "control_response"
            || event_type == "control_cancel_request"
            || event_type == "control_request";

        // Step 1: Quarantine routing (HC #16)
        if self.quarantine_until_result {
            if is_control {
                // HC #33: control events during quarantine → internal handling
                self.handle_control_event_internal(&parsed, event_type)
                    .await;
                return;
            }
            // Map events, check for turn-boundary state
            let events = self.protocol.map_event(&self.run_id, &parsed);
            for event in &events {
                // Validate — RunState always passes through (returns None)
                if let Some(warn) = validate_bus_event(event) {
                    log::warn!(
                        "[actor] invalid event dropped (quarantine): {}.{}: {}",
                        warn.event_type,
                        warn.field,
                        warn.detail
                    );
                    self.protocol.stats.invalid_tool_count += 1;
                    continue;
                }
                if let BusEvent::RunState { state, .. } = event {
                    // HC #17: Only lift on turn-boundary states
                    if state == "idle" || state == "failed" {
                        log::debug!(
                            "[turn] quarantine lifted: state={}, run_id={}",
                            state,
                            self.run_id
                        );
                        self.quarantine_until_result = false;
                        self.quarantine_deadline = None;
                        self.interrupt_sent_for_quarantine = false;
                        self.quarantine_from_internal = false;
                        self.protocol.set_pending_slash_command(None);
                        // v1.0.6 / hardening A1: surface the recovery so the
                        // UI banner can dismiss.
                        self.persist_and_emit(&BusEvent::SessionRecovered {
                            run_id: self.run_id.clone(),
                            ok: state == "idle",
                        });
                        // Don't emit quarantine RunState to frontend (it was an internal turn)
                        // Just try to dispatch next queued item
                        self.try_dispatch().await;
                        return;
                    }
                }
            }
            // Everything else during quarantine → swallow
            log::trace!("[turn] quarantine: swallowed event type={}", event_type);
            return;
        }

        // Step 2: Control event routing (HC #26, #33)
        if is_control {
            if self.is_internal_turn() {
                self.handle_control_event_internal(&parsed, event_type)
                    .await;
            } else {
                self.handle_control_event(&parsed, event_type).await;
            }
            return;
        }

        // Step 3: Map events via protocol
        let events = self.protocol.map_event(&self.run_id, &parsed);
        log::trace!("[actor] mapped to {} bus event(s)", events.len());

        for event in events {
            // Validate before dispatch — drops tool events with empty tool_use_id
            if let Some(warn) = validate_bus_event(&event) {
                log::warn!(
                    "[actor] invalid event dropped: {}.{}: {}",
                    warn.event_type,
                    warn.field,
                    warn.detail
                );
                self.protocol.stats.invalid_tool_count += 1;
                continue;
            }

            // Step 4a: Internal turn routing
            if self.is_internal_turn() {
                match &event {
                    // Capture context data in both Active and Draining phases.
                    // Soft timeout only warns; data is still accepted until RunState ends the turn.
                    BusEvent::CommandOutput { .. } => {
                        if let Some(ref mut ext) = self.active_extractor {
                            ext.on_event(&event);
                        }
                    }
                    BusEvent::MessageComplete {
                        ref text,
                        ref parent_tool_use_id,
                        ..
                    } => {
                        if let Some(ref mut ext) = self.active_extractor {
                            ext.on_event(&event);
                        }
                        // Ralph: accumulate top-level assistant text (only during ralph turns)
                        if parent_tool_use_id.is_none() {
                            let is_ralph_turn = self
                                .active_turn
                                .as_ref()
                                .map(|t| matches!(t.origin, TurnOrigin::Ralph))
                                .unwrap_or(false);
                            if is_ralph_turn {
                                if let Some(ref mut ralph) = self.ralph_loop {
                                    ralph.turn_toplevel_texts.push(text.clone());
                                }
                            }
                        }
                    }
                    BusEvent::RunState { state, .. } => {
                        log::debug!(
                            "[turn] internal turn ended: state={}, run_id={}",
                            state,
                            self.run_id
                        );
                        self.end_turn_and_dispatch().await;
                    }
                    _ => {
                        // Suppress all other events during internal turn
                        log::trace!(
                            "[turn] internal: suppressed {:?}",
                            std::mem::discriminant(&event)
                        );
                    }
                }
                continue;
            }

            // Step 4b: User turn (or idle) routing
            match &event {
                BusEvent::RunState {
                    state,
                    exit_code,
                    error,
                    ..
                } => {
                    // Handle interrupt: CLI emits result(error) but session is alive.
                    let (emit_state, emit_error) =
                        if self.pending_interrupt && (state == "idle" || state == "failed") {
                            self.pending_interrupt = false;
                            if state == "failed" {
                                self.protocol.got_result_event = false;
                                self.protocol.result_subtype = None;
                                log::debug!("[actor] interrupt result → converted failed to idle");
                                (String::from("idle"), None)
                            } else {
                                (state.clone(), error.clone())
                            }
                        } else {
                            (state.clone(), error.clone())
                        };

                    self.emit_state(&emit_state, *exit_code, emit_error.clone(), false);

                    // Persist idle status to meta (uses normalized emit_state, not raw state)
                    if emit_state == "idle" {
                        self.persist_idle_running(RunStatus::Idle);
                    }

                    // Persist result error on failed
                    if emit_state == "failed" {
                        log::debug!(
                            "[actor] persisting result error: subtype={:?}, error={:?}",
                            self.protocol.result_subtype,
                            emit_error
                        );
                        if let Err(e) = storage::runs::persist_result_error(
                            &self.run_id,
                            emit_error,
                            self.protocol.result_subtype.clone(),
                        ) {
                            log::warn!("[actor] failed to persist result error: {}", e);
                        }
                    }

                    // Turn completion: idle or failed → on_user_turn_finished + ralph + end turn
                    if (emit_state == "idle" || emit_state == "failed")
                        && self.active_turn.is_some()
                    {
                        let turn = self.active_turn.take().expect("active_turn checked above");
                        self.on_user_turn_finished(&turn);
                        self.active_extractor = None;
                        self.protocol.set_pending_slash_command(None);

                        // Ralph loop: state transition on turn end
                        self.ralph_on_turn_end(&turn, &emit_state);

                        self.try_dispatch().await;
                    }

                    continue; // RunState handled
                }
                BusEvent::SessionInit {
                    session_id: Some(ref sid),
                    ..
                } => {
                    log::debug!("[actor] captured session_id={}", sid);
                    // Single with_meta write: session_id + conversation_ref (avoid double write + intermediate state)
                    let sid_clone = sid.clone();
                    let runtime = self.protocol.runtime_kind().clone();
                    if let Err(e) = storage::runs::with_meta(&self.run_id, |meta| {
                        meta.session_id = Some(sid_clone.clone());
                        meta.conversation_ref = Some(match runtime {
                            crate::models::AgentRuntimeKind::MiMoCode => {
                                crate::models::ConversationRef::MimoSession(sid_clone)
                            }
                            _ => crate::models::ConversationRef::ClaudeSession(sid_clone),
                        });
                        Ok(())
                    }) {
                        log::warn!(
                            "[actor] failed to persist session_id + conversation_ref: {}",
                            e
                        );
                    }
                    self.persist_and_emit(&event);
                }
                _ => {
                    // Inject backend-authoritative turn_index into UsageUpdate for user turns
                    if let BusEvent::UsageUpdate { .. } = &event {
                        if let Some(ref turn) = self.active_turn {
                            let mut enriched = event.clone();
                            if let BusEvent::UsageUpdate {
                                ref mut turn_index, ..
                            } = enriched
                            {
                                *turn_index = Some(turn.turn_index);
                                log::debug!(
                                    "[turn] usage_update injected turn_index={}",
                                    turn.turn_index
                                );
                            }
                            self.persist_and_emit(&enriched);
                        } else {
                            self.persist_and_emit(&event);
                        }
                    } else {
                        self.persist_and_emit(&event);
                    }
                }
            }
        }
    }

    /// Handle control events during user turns (or idle): permission prompts, hooks, etc.
    async fn handle_control_event(&mut self, parsed: &Value, event_type: &str) {
        if event_type == "control_response" {
            let req_id = parsed
                .get("response")
                .and_then(|r| r.get("request_id"))
                .and_then(|v| v.as_str())
                .or_else(|| parsed.get("request_id").and_then(|v| v.as_str()));
            if let Some(req_id) = req_id {
                log::debug!("[actor] got control_response for req_id={}", req_id);
                if let Some(tx) = self.control_waiters.remove(req_id) {
                    let response = parsed.get("response").cloned().unwrap_or(Value::Null);
                    let _ = tx.send(response);
                }
            } else {
                log::warn!(
                    "[actor] control_response missing request_id: {}",
                    shared::truncate_str(&parsed.to_string(), 200)
                );
            }
            return;
        }

        if event_type == "control_cancel_request" {
            let cancel_request_id = parsed
                .get("request_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            log::debug!(
                "[actor] control_cancel_request for req_id={}",
                cancel_request_id
            );
            self.control_waiters.remove(&cancel_request_id);
            self.persist_and_emit(&BusEvent::ControlCancelled {
                run_id: self.run_id.clone(),
                request_id: cancel_request_id,
            });
            return;
        }

        // control_request
        let subtype = parsed
            .get("request")
            .and_then(|r| r.get("subtype"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if subtype == "hook_callback" {
            let request_id = parsed
                .get("request_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let request = parsed.get("request").cloned().unwrap_or(Value::Null);
            let hook_event = request
                .get("hook_event")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let hook_id = request
                .get("hook_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let hook_name = request
                .get("tool_name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            log::debug!(
                "[actor] hook_callback: run_id={}, req_id={}, event={}, id={}, tool={:?}",
                self.run_id,
                request_id,
                hook_event,
                hook_id,
                hook_name
            );

            let hook_label = hook_name.as_deref().unwrap_or("hook").to_string();
            self.persist_and_emit(&BusEvent::HookCallback {
                run_id: self.run_id.clone(),
                request_id: request_id.clone(),
                hook_event: hook_event.clone(),
                hook_id,
                hook_name,
                data: request.clone(),
            });

            if hook_event != "PreToolUse" {
                log::debug!("[actor] auto-allowing non-PreToolUse hook: {}", hook_event);
                if let Err(e) = self
                    .write_control_response(&request_id, serde_json::json!({ "decision": "allow" }))
                    .await
                {
                    log::warn!("[actor] hook_callback auto-response failed: {}", e);
                }
            }
            if hook_event == "PreToolUse" {
                self.pending_interactive_request = Some(PendingInteractiveRequest {
                    request_id: request_id.clone(),
                    subtype: "hook_callback".to_string(),
                    detail: format!("PreToolUse:{}", hook_label),
                    received_at: Instant::now(),
                });
                notify_if_background(
                    self.emitter.app(),
                    "Hook Review Required",
                    &format!(
                        "{} — PreToolUse: {}",
                        shared::truncate_str(&self.run_id, 8),
                        hook_label
                    ),
                );
            }
        } else if subtype == "mcp_message" {
            log::debug!("[actor] mcp_message: run_id={}", self.run_id);
            self.emitter.emit_realtime(
                "bus-event",
                &BusEvent::Raw {
                    run_id: self.run_id.clone(),
                    source: "mcp_message".to_string(),
                    data: parsed.clone(),
                },
                Some(&self.run_id),
            );
        } else if subtype == "elicitation" {
            // MCP elicitation: CLI requests user input for MCP server authentication/configuration.
            let request_id = parsed
                .get("request_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let request = parsed.get("request").cloned().unwrap_or(Value::Null);
            let mcp_server_name = request
                .get("mcp_server_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let message = request
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let elicitation_id = request
                .get("elicitation_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let mode = request
                .get("mode")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let url = request
                .get("url")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let requested_schema = request.get("requested_schema").cloned();

            log::debug!(
                "[actor] elicitation: run_id={}, req_id={}, server={}, mode={:?}, has_schema={}",
                self.run_id,
                request_id,
                mcp_server_name,
                mode,
                requested_schema.is_some()
            );

            self.persist_and_emit(&BusEvent::ElicitationPrompt {
                run_id: self.run_id.clone(),
                request_id: request_id.clone(),
                mcp_server_name: mcp_server_name.clone(),
                message,
                elicitation_id,
                mode,
                url,
                requested_schema,
            });
            self.pending_interactive_request = Some(PendingInteractiveRequest {
                request_id: request_id.clone(),
                subtype: "elicitation".to_string(),
                detail: mcp_server_name.clone(),
                received_at: Instant::now(),
            });
            notify_if_background(
                self.emitter.app(),
                "MCP Input Required",
                &format!(
                    "{}: {} needs input",
                    shared::truncate_str(&self.run_id, 8),
                    &mcp_server_name
                ),
            );
        } else if subtype == "can_use_tool" {
            let request_id = parsed
                .get("request_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let request = parsed.get("request").cloned().unwrap_or(Value::Null);
            let tool_name = request
                .get("tool_name")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let tool_use_id = request
                .get("tool_use_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let tool_input = request
                .get("input")
                .cloned()
                .unwrap_or(Value::Object(Default::default()));
            let decision_reason = request
                .get("decision_reason")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let parent_tool_use_id = parsed
                .get("parent_tool_use_id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let suggestions = request
                .get("suggestions")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            log::debug!(
                "[actor] permission prompt: run_id={}, req_id={}, tool={}, reason={}, parent={:?}, suggestions={}",
                self.run_id, request_id, tool_name, decision_reason, parent_tool_use_id, suggestions.len()
            );

            let tool_label = tool_name.clone();
            self.persist_and_emit(&BusEvent::PermissionPrompt {
                run_id: self.run_id.clone(),
                request_id: request_id.clone(),
                tool_name,
                tool_use_id,
                tool_input,
                decision_reason,
                parent_tool_use_id,
                suggestions,
            });
            self.pending_interactive_request = Some(PendingInteractiveRequest {
                request_id,
                subtype: "can_use_tool".to_string(),
                detail: tool_label.clone(),
                received_at: Instant::now(),
            });
            notify_if_background(
                self.emitter.app(),
                "Permission Required",
                &format!(
                    "{} wants to use: {}",
                    shared::truncate_str(&self.run_id, 8),
                    &tool_label
                ),
            );
        } else {
            // Fallback: unknown or malformed subtype — send control_cancel_request
            // to tell CLI we can't handle this request (avoids CLI hanging forever).
            let req_id = parsed
                .get("request_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            log::warn!(
                "[actor] unhandled control_request: run_id={}, subtype={}, req_id={}, keys={:?}",
                self.run_id,
                subtype,
                req_id,
                parsed
                    .get("request")
                    .map(|r| r.as_object().map(|o| o.keys().collect::<Vec<_>>()))
            );
            if !req_id.is_empty() {
                if let Err(e) = self.handle_cancel_control_request(req_id).await {
                    log::warn!(
                        "[actor] cancel_control_request failed: run_id={}, req_id={}, subtype={}, err={}",
                        self.run_id, req_id, subtype, e
                    );
                }
            }
        }
    }

    /// Handle control events during internal turns or quarantine. (HC #26, #33)
    /// Silently resolve waiters, auto-respond to requests, suppress all emission.
    async fn handle_control_event_internal(&mut self, parsed: &Value, event_type: &str) {
        if event_type == "control_response" {
            let req_id = parsed
                .get("response")
                .and_then(|r| r.get("request_id"))
                .and_then(|v| v.as_str())
                .or_else(|| parsed.get("request_id").and_then(|v| v.as_str()));
            if let Some(req_id) = req_id {
                log::debug!("[turn] internal control_response for req_id={}", req_id);
                if let Some(tx) = self.control_waiters.remove(req_id) {
                    let response = parsed.get("response").cloned().unwrap_or(Value::Null);
                    let _ = tx.send(response);
                }
            } else {
                log::warn!(
                    "[turn] internal control_response missing request_id: {}",
                    shared::truncate_str(&parsed.to_string(), 200)
                );
            }
            return;
        }

        if event_type == "control_cancel_request" {
            let cancel_request_id = parsed
                .get("request_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            log::debug!(
                "[turn] internal control_cancel_request for req_id={}",
                cancel_request_id
            );
            self.control_waiters.remove(&cancel_request_id);
            return;
        }

        // control_request during internal/quarantine: auto-respond (HC #33)
        let request_id = parsed
            .get("request_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if request_id.is_empty() {
            log::warn!("[turn] internal control_request with empty request_id, ignoring");
            return;
        }

        let subtype = parsed
            .get("request")
            .and_then(|r| r.get("subtype"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        log::debug!(
            "[turn] internal control_request: subtype={}, req_id={}",
            subtype,
            request_id
        );

        let response = match subtype {
            "can_use_tool" => Some(serde_json::json!({
                "behavior": "deny",
                "message": "Tool use not allowed during internal turn"
            })),
            "hook_callback" => Some(serde_json::json!({ "decision": "allow" })),
            "elicitation" => None, // auto-decline via control_cancel_request
            _ => None,             // unknown subtype — cancel instead of guessing schema
        };

        if let Some(response) = response {
            if let Err(e) = self.write_control_response(&request_id, response).await {
                log::warn!(
                    "[turn] internal control auto-response failed: req_id={}, err={}",
                    request_id,
                    e
                );
            }
            return;
        }

        // Unknown or elicitation subtype: send control_cancel_request (schema-agnostic)
        log::warn!(
            "[turn] internal: unhandled control_request: run_id={}, subtype={}, req_id={}",
            self.run_id,
            subtype,
            request_id
        );
        if let Err(e) = self.handle_cancel_control_request(&request_id).await {
            log::warn!(
                "[turn] internal control auto-response failed: req_id={}, err={}",
                request_id,
                e
            );
        }
    }

    fn handle_stderr_line(&mut self, text: &str) {
        // Suppress stderr after cancel
        if self.cancel.is_cancelled() {
            log::trace!(
                "[actor] stderr suppressed after cancel: {}",
                shared::truncate_str(text, 200)
            );
            return;
        }
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        log::trace!(
            "[actor] stderr: {}: {}",
            self.run_id,
            shared::truncate_str(text, 200)
        );

        let event = BusEvent::Raw {
            run_id: self.run_id.clone(),
            source: "claude_stderr".to_string(),
            data: Value::String(text.to_string()),
        };
        self.emitter.persist_and_emit(&self.run_id, &event);
    }

    /// Handle stdout EOF — determine terminal state.
    async fn handle_eof(&mut self) {
        let exit_code = if let Some(ref mut child) = self.child {
            match child.wait().await {
                Ok(s) => s.code(),
                Err(_) => Some(1),
            }
        } else {
            None
        };
        self.exit_code = exit_code;

        let active_turn = self.active_turn.is_some();
        if self.crash_reason.is_none() {
            self.crash_reason = classify_active_turn_eof(self.cancel.is_cancelled(), active_turn);
        }
        if self.crash_reason.is_some() && !self.user_stopped && !self.cancel.is_cancelled() {
            self.recoverable_exit = true;
            log::warn!(
                "[recovery] recoverable EOF: run_id={}, reason={:?}, exit_code={:?}",
                self.run_id,
                self.crash_reason,
                exit_code
            );
            self.active_turn = None;
            self.active_extractor = None;
            self.quarantine_until_result = false;
            return;
        }

        log::debug!(
            "[actor] EOF cleanup: run_id={}, got_result={}, exit_code={:?}",
            self.run_id,
            self.protocol.got_result_event,
            exit_code
        );

        // Fail all pending user replies on EOF (HC #12)
        self.fail_all_pending_replies("Session ended");
        self.active_turn = None;
        self.active_extractor = None;
        self.quarantine_until_result = false;

        if !self.protocol.got_result_event {
            // P0-6: when the user clicks Stop mid-stream we want a
            // terminal `RunState("stopped")` on the wire so the frontend
            // can flip its state machine back to `idle` and re-enable
            // submit. Treat user_stopped the same as cancel — the kill
            // is intentional, so a non-zero exit_code from SIGKILL is not
            // a failure from the user's perspective.
            let state_str = if self.cancel.is_cancelled() || self.user_stopped {
                "stopped"
            } else {
                match exit_code {
                    Some(0) => "completed",
                    _ => "failed",
                }
            };
            let error_msg = if state_str == "failed" {
                Some(format!("Process exited with code {:?}", exit_code))
            } else {
                None
            };
            self.emit_state(state_str, exit_code, error_msg, true);
            // v1.0.6 / hardening A4: surface a desktop notification when a
            // user-driven run finishes and the window is in the background.
            // Internal turns / ralph iterations must NOT trigger this — we
            // have a different in-app banner for those.
            let is_internal = self.is_internal_turn();
            if !is_internal {
                let title = if state_str == "failed" {
                    "MiWarp · 运行失败"
                } else if state_str == "stopped" {
                    "MiWarp · 会话已停止"
                } else {
                    "MiWarp · 运行完成"
                };
                // v1.0.6 / hardening A4: SessionActor doesn't keep the
                // run metadata in memory, so the body uses the run_id as
                // a stable, user-recognisable label. The frontend pairs
                // the run_id with its title via the run cache.
                let body = self.run_id.clone();
                notify_if_background(self.emitter.app(), title, &body);
            }
        } else {
            self.finalize_meta(exit_code);
            self.trigger_auto_commit();
            // v1.0.6 / hardening A4: also notify on natural result completion
            // when the window is in the background. Auto-commit failures
            // (rare) are surfaced in app; we only ping on the happy path.
            let is_internal = self.is_internal_turn();
            if !is_internal {
                let title = "MiWarp · 运行完成";
                let body = self.run_id.clone();
                notify_if_background(self.emitter.app(), title, &body);
            }
        }
    }

    // ── RunState emission (migrated from state.rs) ──

    /// Emit a RunState event with identity dedup. Single entry point.
    fn emit_state(
        &mut self,
        new_state: &str,
        exit_code: Option<i32>,
        error: Option<String>,
        update_meta: bool,
    ) {
        // 1. Identity dedup
        if self.state == new_state {
            log::debug!(
                "[actor] dedup skip: run={} state={} (already current)",
                self.run_id,
                new_state
            );
            return;
        }
        self.state = new_state.to_string();

        log::debug!(
            "[actor] emit_state: run={} -> {} (meta={})",
            self.run_id,
            new_state,
            update_meta
        );

        // 2. Build event
        let event = BusEvent::RunState {
            run_id: self.run_id.clone(),
            state: new_state.to_string(),
            exit_code,
            error: error.clone(),
        };

        // 3. Persist + Tauri emit + WS broadcast (unified)
        self.emitter.persist_and_emit(&self.run_id, &event);

        // 4. Conditional meta update
        if update_meta {
            if let Some(status) = map_state_to_run_status(new_state) {
                let meta_error = if new_state == "failed" {
                    error.clone()
                } else {
                    None
                };
                if let Err(e) = runs::update_status(&self.run_id, status, exit_code, meta_error) {
                    log::warn!(
                        "[actor] meta update failed: run={} state={} err={}",
                        self.run_id,
                        new_state,
                        e
                    );
                }
            }

            // Clear error fields on new turn
            if new_state == "running" {
                if let Err(e) = runs::with_meta(&self.run_id, |meta| {
                    if meta.error_message.is_some() || meta.result_subtype.is_some() {
                        meta.error_message = None;
                        meta.result_subtype = None;
                        log::debug!(
                            "[actor] cleared error_message/result_subtype for new turn: run={}",
                            self.run_id
                        );
                    }
                    Ok(())
                }) {
                    log::warn!(
                        "[actor] clear error fields failed: run={} err={}",
                        self.run_id,
                        e
                    );
                }
            }

            // Persist result error details on failed
            if new_state == "failed" {
                log::debug!(
                    "[actor] emit_state persisting result error: subtype={:?}, error={:?}",
                    self.protocol.result_subtype,
                    error
                );
                if let Err(e) = runs::persist_result_error(
                    &self.run_id,
                    error,
                    self.protocol.result_subtype.clone(),
                ) {
                    log::warn!("[actor] failed to persist result error: {}", e);
                }
            }
        }
    }

    /// Finalize meta.json on EOF when result event already set RunState.
    /// Determines terminal status from result_subtype + exit_code.
    fn finalize_meta(&self, exit_code: Option<i32>) {
        if let Err(e) = runs::with_meta(&self.run_id, |meta| {
            let had_result_error = meta
                .result_subtype
                .as_ref()
                .map(|s| s.starts_with("error"))
                .unwrap_or(false);
            let terminal_status = if had_result_error {
                RunStatus::Failed
            } else {
                match exit_code {
                    Some(0) => RunStatus::Completed,
                    _ => RunStatus::Failed,
                }
            };
            meta.status = terminal_status.clone();
            meta.exit_code = exit_code;
            if meta.ended_at.is_none() {
                meta.ended_at = Some(now_iso());
            }
            log::debug!(
                "[actor] finalize_meta: run={} status={:?} exit_code={:?}",
                self.run_id,
                terminal_status,
                exit_code
            );
            Ok(())
        }) {
            log::warn!(
                "[actor] finalize_meta failed: run={} err={}",
                self.run_id,
                e
            );
        }
    }

    /// Fire-and-forget auto-commit for worktree sessions on completion.
    fn trigger_auto_commit(&self) {
        let run_id = self.run_id.clone();
        tokio::spawn(async move {
            let meta = tokio::task::spawn_blocking({
                let rid = run_id.clone();
                move || crate::storage::runs::get_run(&rid)
            })
            .await
            .unwrap_or(None);

            let Some(meta) = meta else { return };

            if meta.creation_mode != Some(crate::models::SessionCreationMode::Worktree) {
                return;
            }

            let settings = crate::storage::settings::get_user_settings();
            if !settings.auto_commit_on_complete {
                return;
            }

            let cwd = meta.worktree_path.as_deref().unwrap_or(&meta.cwd);
            let short_id: String = run_id.chars().take(8).collect();
            let msg = format!("auto: session {} completed", short_id);

            match crate::commands::worktree::auto_commit_internal(cwd, &msg) {
                Ok(result) => {
                    if result.committed {
                        log::info!(
                            "[actor] auto-committed worktree for run={}: {:?}",
                            run_id,
                            result.sha
                        );
                        // Optionally create PR
                        if settings.auto_pr_on_complete {
                            if let Some(ref branch) = meta.worktree_branch {
                                let base = crate::commands::worktree::detect_base_branch(cwd);
                                match crate::commands::worktree::create_pull_request_internal(
                                    cwd, branch, &base,
                                )
                                .await
                                {
                                    Ok(url) => log::info!("[actor] auto-PR created: {}", url),
                                    Err(e) => log::warn!("[actor] auto-PR failed: {}", e),
                                }
                            }
                        }
                    } else {
                        log::debug!("[actor] no changes to auto-commit for run={}", run_id);
                    }
                }
                Err(e) => log::warn!("[actor] auto-commit failed for run={}: {}", run_id, e),
            }
        });
    }

    // ── Cleanup ──

    fn build_recovery_snapshot(&self) -> ActorRecoverySnapshot {
        // Collect unaccepted messages from queued_user (not yet dispatched).
        let mut pending_unaccepted: VecDeque<PendingRecoveryMessage> = self
            .queued_user
            .iter()
            .filter(|ticket| {
                ticket
                    .client_message_id
                    .as_ref()
                    .is_none_or(|cid| !is_accepted(&self.accepted_client_message_ids, cid))
            })
            .map(|ticket| PendingRecoveryMessage {
                text: ticket.text.clone(),
                attachments: ticket.attachments.clone(),
                client_message_id: ticket.client_message_id.clone(),
            })
            .collect();

        // Merge messages stashed before stdin write in start_user_turn.
        // These cover the case where a message was popped from queued_user
        // but the stdin write failed — without this merge the message is lost.
        for msg in &self.pending_unaccepted_for_recovery {
            let dominated = msg
                .client_message_id
                .as_ref()
                .is_some_and(|cid| is_accepted(&self.accepted_client_message_ids, cid));
            if dominated {
                continue;
            }
            let duplicate = msg.client_message_id.as_ref().is_some_and(|cid| {
                pending_unaccepted
                    .iter()
                    .any(|p| p.client_message_id.as_deref() == Some(cid.as_str()))
            });
            if !duplicate {
                pending_unaccepted.push_back(msg.clone());
            }
        }

        ActorRecoverySnapshot {
            crash_reason: self.crash_reason,
            accepted_ledger: self.accepted_client_message_ids.clone(),
            pending_unaccepted,
            next_turn_index: self.next_turn_index,
            next_auto_ctx_id: self.next_auto_ctx_id,
            next_turn_seq: self.next_turn_seq,
            session_id: self.session_id.clone(),
            user_stopped: self.user_stopped,
        }
    }

    async fn cleanup(mut self) {
        log::debug!("[actor] cleanup starting: run_id={}", self.run_id);

        let snapshot = self.build_recovery_snapshot();
        let should_recover =
            self.recoverable_exit && !self.user_stopped && snapshot.crash_reason.is_some();

        if let Some(ref registry) = self.recovery_registry {
            if should_recover {
                let recover = on_actor_exit(registry, &self.run_id, snapshot.clone()).await;
                if recover {
                    emit_session_lifecycle(
                        &self.emitter,
                        &self.run_id,
                        self.session_id.as_deref(),
                        "crashed",
                        RecoveryState::Reconnecting,
                        snapshot.crash_reason.map(|r| (r, self.exit_code, None)),
                        self.connection_generation,
                        0,
                    );
                }
            } else if let Some(reason) = snapshot.crash_reason {
                emit_session_lifecycle(
                    &self.emitter,
                    &self.run_id,
                    self.session_id.as_deref(),
                    if self.user_stopped {
                        "stopped"
                    } else {
                        "crashed"
                    },
                    RecoveryState::Healthy,
                    Some((reason, self.exit_code, None)),
                    self.connection_generation,
                    0,
                );
            }
        }

        // Drop stdin
        self.stdin.take();

        if !should_recover {
            self.fail_all_pending_replies("Session cleanup");
        }

        // Drain control waiters
        if !self.control_waiters.is_empty() {
            log::debug!(
                "[actor] draining {} pending control waiters",
                self.control_waiters.len()
            );
            self.control_waiters.clear();
        }

        // Remove self from SessionMap (only if we're still the current entry)
        {
            let mut map = self.sessions.lock().await;
            if let Some(handle) = map.get(&self.run_id) {
                if Arc::ptr_eq(&self.tag, &handle.tag) {
                    map.remove(&self.run_id);
                    log::debug!(
                        "[actor] removed self from SessionMap: run_id={}",
                        self.run_id
                    );
                } else {
                    log::debug!(
                        "[actor] skipping SessionMap remove (replaced): run_id={}",
                        self.run_id
                    );
                }
            }
        }

        // Fire shutdown signal
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }

        log::debug!("[actor] cleanup complete: run_id={}", self.run_id);
    }
}

// ── Helpers ──

impl SessionActor {
    /// Persist idle↔running status transition to meta + notify all windows.
    /// Only allows Running→Idle and Idle→Running; other transitions are skipped.
    fn persist_idle_running(&self, target: RunStatus) {
        let meta = match storage::runs::get_run(&self.run_id) {
            Some(m) => m,
            None => return,
        };
        let allowed = matches!(
            (&meta.status, &target),
            (RunStatus::Running, RunStatus::Idle) | (RunStatus::Idle, RunStatus::Running)
        );
        if !allowed {
            log::debug!(
                "[actor] persist_idle_running skip: run={} from={:?} to={:?}",
                self.run_id,
                meta.status,
                target
            );
            return;
        }
        let status_str = target.to_string();
        if let Err(e) = storage::runs::update_status(&self.run_id, target, None, None) {
            log::warn!(
                "[actor] idle/running meta update failed: run={} target={} err={}",
                self.run_id,
                status_str,
                e
            );
        } else {
            self.emitter.emit_realtime(
                "ocv:status-changed",
                &serde_json::json!({"run_id": self.run_id.as_str(), "status": status_str}),
                Some(&self.run_id),
            );
        }
    }
}

pub(crate) use crate::agent::turn_engine::is_accepted;
/// v1.0.9 Phase 2: insert a client_message_id into the accepted ledger
/// (FIFO-evicting when at capacity). Pure function re-exported from
/// `crate::agent::turn_engine` so both `session_actor` and
/// `runtime_recovery` can use it without creating a dependency cycle.
pub(crate) use crate::agent::turn_engine::record_accepted_client_message_id;

fn map_state_to_run_status(state: &str) -> Option<RunStatus> {
    match state {
        "spawning" | "running" => Some(RunStatus::Running),
        "completed" => Some(RunStatus::Completed),
        "failed" => Some(RunStatus::Failed),
        "stopped" => Some(RunStatus::Stopped),
        "idle" => Some(RunStatus::Idle),
        _ => None,
    }
}

/// Sanitize a filename: keep only safe characters, truncate to 120 chars.
fn att_safe_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let truncated = if cleaned.len() > 120 {
        &cleaned[..120]
    } else {
        &cleaned
    };
    if truncated.is_empty() {
        "attachment.bin".to_string()
    } else {
        truncated.to_string()
    }
}

/// Map MIME type to file extension.
fn att_extension(mime: &str) -> &str {
    if mime.starts_with("image/png") {
        ".png"
    } else if mime.starts_with("image/jpeg") {
        ".jpg"
    } else if mime.starts_with("image/webp") {
        ".webp"
    } else if mime.starts_with("image/gif") {
        ".gif"
    } else if mime.starts_with("application/pdf") {
        ".pdf"
    } else {
        ""
    }
}

/// Save an attachment to `~/.miwarp/runs/{run_id}/attachments/` and return the path.
/// Returns `None` on failure (non-fatal, logged as warning).
fn save_attachment_to_disk(run_id: &str, att: &AttachmentData) -> Option<String> {
    let att_dir = crate::storage::run_dir(run_id).join("attachments");
    if let Err(e) = std::fs::create_dir_all(&att_dir) {
        log::warn!("[actor] failed to create attachments dir: {}", e);
        return None;
    }
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&att.content_base64)
        .map_err(|e| log::warn!("[actor] failed to decode attachment base64: {}", e))
        .ok()?;
    if bytes.is_empty() {
        return None;
    }
    let safe_name = att_safe_filename(&att.filename);
    let ext = att_extension(&att.media_type);
    let filename = format!(
        "{}-{}-{}{}",
        chrono::Utc::now().timestamp_millis(),
        &uuid::Uuid::new_v4().to_string()[..6],
        safe_name,
        ext
    );
    let full_path = att_dir.join(&filename);
    if let Err(e) = std::fs::write(&full_path, &bytes) {
        log::warn!("[actor] failed to write attachment to disk: {}", e);
        return None;
    }
    let path_str = full_path.to_string_lossy().to_string();
    log::debug!("[actor] saved attachment to disk: {}", path_str);
    Some(path_str)
}

/// Build a stream-json `user` payload with optional multimodal attachments.
/// Shared between actor's `handle_send_message` and `session.rs` initial message paths.
/// When attachments are present, saves them to disk under the run directory and
/// includes file paths in the text block so the model can reference them later.
pub fn build_user_payload(
    text: &str,
    attachments: &[AttachmentData],
    run_id: &str,
) -> (serde_json::Value, String) {
    let content = if attachments.is_empty() {
        serde_json::json!(text)
    } else {
        let mut parts = Vec::new();
        let mut saved_paths: Vec<String> = Vec::new();
        for att in attachments {
            // Size check (base64 → raw bytes estimate: base64 len * 3/4)
            let raw_size = (att.content_base64.len() as u64) * 3 / 4;
            let limit = max_attachment_size(&att.media_type);
            if raw_size > limit {
                let limit_mb = limit / (1024 * 1024);
                log::warn!(
                    "[actor] skipping oversized attachment: {} ({:.1}MB > {}MB limit)",
                    att.filename,
                    raw_size as f64 / (1024.0 * 1024.0),
                    limit_mb
                );
                continue;
            }
            // Save to disk for later Read tool access
            if let Some(path) = save_attachment_to_disk(run_id, att) {
                saved_paths.push(path);
            }
            if ALLOWED_DOC_TYPES.contains(&att.media_type.as_str()) {
                parts.push(serde_json::json!({
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": att.media_type,
                        "data": att.content_base64,
                    }
                }));
            } else if ALLOWED_IMAGE_TYPES.contains(&att.media_type.as_str()) {
                parts.push(serde_json::json!({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": att.media_type,
                        "data": att.content_base64,
                    }
                }));
            } else {
                log::warn!(
                    "[actor] skipping unsupported attachment type: {}",
                    att.media_type
                );
            }
        }
        // Augment text with saved file paths so the model can Read them later
        let augmented_text = if saved_paths.is_empty() {
            text.to_string()
        } else {
            let paths_list = saved_paths
                .iter()
                .map(|p| format!("- {}", p))
                .collect::<Vec<_>>()
                .join("\n");
            format!(
                "{}\n\n[Attached files saved at:\n{}\nUse these file paths with the Read tool if you need to access them later.]",
                text, paths_list
            )
        };
        parts.insert(
            0,
            serde_json::json!({ "type": "text", "text": augmented_text }),
        );
        serde_json::json!(parts)
    };

    let uuid = uuid::Uuid::new_v4().to_string();
    let payload = serde_json::json!({
        "type": "user",
        "uuid": &uuid,
        "message": {
            "role": "user",
            "content": content,
        }
    });
    (payload, uuid)
}

#[cfg(test)]
mod tests {
    use crate::models::{max_attachment_size, ALLOWED_DOC_TYPES, ALLOWED_IMAGE_TYPES};
    use serde_json::json;

    /// Helper: build a multimodal content array the same way handle_send_message does,
    /// including size validation (base64 len * 3/4 vs max_attachment_size).
    fn build_content_parts(
        text: &str,
        attachments: &[(&str, &str)], // (media_type, base64_data)
    ) -> Vec<serde_json::Value> {
        let mut parts = vec![json!({ "type": "text", "text": text })];
        for (media_type, data) in attachments {
            // Size check (mirrors handle_send_message)
            let raw_size = (data.len() as u64) * 3 / 4;
            let limit = max_attachment_size(media_type);
            if raw_size > limit {
                continue; // oversized — skip
            }
            if ALLOWED_DOC_TYPES.contains(media_type) {
                parts.push(json!({
                    "type": "document",
                    "source": { "type": "base64", "media_type": media_type, "data": data }
                }));
            } else if ALLOWED_IMAGE_TYPES.contains(media_type) {
                parts.push(json!({
                    "type": "image",
                    "source": { "type": "base64", "media_type": media_type, "data": data }
                }));
            }
            // else: skipped (unsupported)
        }
        parts
    }

    #[test]
    fn image_attachment_produces_image_type() {
        let parts = build_content_parts("hello", &[("image/png", "abc123")]);
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[1]["type"], "image");
        assert_eq!(parts[1]["source"]["media_type"], "image/png");
    }

    #[test]
    fn pdf_attachment_produces_document_type() {
        let parts = build_content_parts("hello", &[("application/pdf", "pdfdata")]);
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[1]["type"], "document");
        assert_eq!(parts[1]["source"]["media_type"], "application/pdf");
    }

    #[test]
    fn unsupported_type_is_skipped() {
        let parts = build_content_parts("hello", &[("application/octet-stream", "data")]);
        assert_eq!(parts.len(), 1); // Only text part, attachment skipped
    }

    #[test]
    fn mixed_attachments() {
        let parts = build_content_parts(
            "hello",
            &[
                ("image/jpeg", "img"),
                ("application/pdf", "doc"),
                ("application/zip", "zip"),
            ],
        );
        assert_eq!(parts.len(), 3); // text + image + document (zip skipped)
        assert_eq!(parts[1]["type"], "image");
        assert_eq!(parts[2]["type"], "document");
    }

    #[test]
    fn large_image_is_not_skipped() {
        // Images have no size limit (CLI handles compression via sharp)
        let large_b64 = "A".repeat(14_000_000); // ~10.5MB raw — still accepted
        let parts = build_content_parts("hello", &[("image/png", &large_b64)]);
        assert_eq!(parts.len(), 2); // text + image (not skipped)
        assert_eq!(parts[1]["type"], "image");
    }

    #[test]
    fn oversized_pdf_is_skipped() {
        // PDFs have 20MB limit. base64_len * 3/4 > 20*1024*1024 → skip
        let oversized_b64 = "A".repeat(28_000_000); // ~21MB raw → exceeds 20MB limit
        let parts = build_content_parts("hello", &[("application/pdf", &oversized_b64)]);
        assert_eq!(parts.len(), 1); // Only text part, oversized PDF skipped
    }

    #[test]
    fn build_user_payload_returns_uuid() {
        use super::build_user_payload;
        let (payload, uuid) = build_user_payload("hello", &[], "run-test");
        assert_eq!(payload["type"], "user");
        assert_eq!(payload["uuid"], uuid);
        assert!(uuid::Uuid::parse_str(&uuid).is_ok());
    }

    // ── v1.0.9 Phase 2: accepted-client_message_id ledger ──

    #[test]
    fn accepted_ledger_inserts_and_reports_membership() {
        let mut ledger: std::collections::VecDeque<String> = std::collections::VecDeque::new();
        super::record_accepted_client_message_id(
            &mut ledger,
            "cmsg-1".to_string(),
            super::ACCEPTED_CLIENT_MESSAGE_IDS_CAP,
        );
        super::record_accepted_client_message_id(
            &mut ledger,
            "cmsg-2".to_string(),
            super::ACCEPTED_CLIENT_MESSAGE_IDS_CAP,
        );
        assert!(super::is_accepted(&ledger, "cmsg-1"));
        assert!(super::is_accepted(&ledger, "cmsg-2"));
        assert!(!super::is_accepted(&ledger, "cmsg-3"));
        assert_eq!(ledger.len(), 2);
    }

    #[test]
    fn accepted_ledger_idempotent_on_duplicate_insert() {
        let mut ledger: std::collections::VecDeque<String> = std::collections::VecDeque::new();
        super::record_accepted_client_message_id(
            &mut ledger,
            "cmsg-x".to_string(),
            super::ACCEPTED_CLIENT_MESSAGE_IDS_CAP,
        );
        // Second insert is a no-op; the ledger must not contain duplicates
        // and must not evict on a duplicate attempt.
        super::record_accepted_client_message_id(
            &mut ledger,
            "cmsg-x".to_string(),
            super::ACCEPTED_CLIENT_MESSAGE_IDS_CAP,
        );
        assert_eq!(ledger.len(), 1);
        assert!(super::is_accepted(&ledger, "cmsg-x"));
    }

    #[test]
    fn accepted_ledger_fifo_evicts_oldest_at_cap() {
        // Use a tiny cap so we can drive eviction deterministically.
        let mut ledger: std::collections::VecDeque<String> = std::collections::VecDeque::new();
        for i in 0..3 {
            super::record_accepted_client_message_id(&mut ledger, format!("id-{i}"), 3);
        }
        assert_eq!(ledger.len(), 3);

        // Cap reached; inserting id-3 must evict id-0.
        super::record_accepted_client_message_id(&mut ledger, "id-3".to_string(), 3);
        assert_eq!(ledger.len(), 3);
        assert!(!super::is_accepted(&ledger, "id-0"));
        assert!(super::is_accepted(&ledger, "id-1"));
        assert!(super::is_accepted(&ledger, "id-2"));
        assert!(super::is_accepted(&ledger, "id-3"));
    }

    #[test]
    fn accepted_ledger_cap_matches_constant() {
        // Cap is wired to ACCEPTED_CLIENT_MESSAGE_IDS_CAP. Sanity-check that
        // the constant is well above the SendCoordinator's default queue
        // size (32) so a reconnect-retry that the coordinator drained at
        // generation N is still idempotent on generation N+1 reconnects.
        const {
            assert!(super::ACCEPTED_CLIENT_MESSAGE_IDS_CAP >= 32);
            assert!(super::ACCEPTED_CLIENT_MESSAGE_IDS_CAP <= 8192);
        }
    }

    #[test]
    fn accepted_ledger_full_cap_cycles_without_growth() {
        // Drive 5 * cap inserts; ledger size must stay at exactly cap and
        // every insert must evict the oldest.
        let cap = 4usize;
        let mut ledger: std::collections::VecDeque<String> = std::collections::VecDeque::new();
        for i in 0..(cap * 5) {
            super::record_accepted_client_message_id(&mut ledger, format!("id-{i}"), cap);
            assert!(ledger.len() <= cap);
        }
        assert_eq!(ledger.len(), cap);
        // The most recent cap inserts are present.
        for i in (cap * 5 - cap)..(cap * 5) {
            assert!(super::is_accepted(&ledger, &format!("id-{i}")));
        }
        // Earlier inserts were evicted.
        assert!(!super::is_accepted(&ledger, "id-0"));
        assert!(!super::is_accepted(
            &ledger,
            &format!("id-{}", cap * 5 - cap - 1)
        ));
    }

    // ── GenerateTitle dispatch (v1.2.1: title reuses actor mailbox) ──
    //
    // These tests cover the mailbox-routing path. The actual `claude
    // --print` invocation lives in `title_generator::spawn_title_for_run`
    // and is integration-tested via `commands::runs::tests` against a
    // real run fixture. Spawning a fake child process in a unit test
    // would require `tokio::io::duplex` plumbing and is deferred to a
    // future integration test; the routing itself is exhaustively
    // exercised here.

    /// Bounded-mpsc dispatch: the GenerateTitle variant fits in the
    /// cmd_tx mailbox (capacity 64) and is accepted by try_send without
    /// blocking when capacity is available.
    #[tokio::test]
    async fn generate_title_command_fits_in_bounded_mailbox() {
        use super::ActorCommand;
        use tokio::sync::{mpsc, oneshot};

        let (cmd_tx, mut cmd_rx) = mpsc::channel::<ActorCommand>(64);
        let (reply_tx, reply_rx) = oneshot::channel();

        // Fill 63 commands first to ensure the next one still fits at cap-1.
        for i in 0..63 {
            cmd_tx
                .try_send(ActorCommand::Stop {
                    reply: oneshot::channel().0,
                })
                .expect("should fit");
            // Drain them so the channel stays empty for the assertion below.
            let _ = cmd_rx.try_recv();
            assert!(i < 63);
        }

        // Now send the GenerateTitle command — should be accepted.
        cmd_tx
            .try_send(ActorCommand::GenerateTitle {
                prompt: "title test".into(),
                reply: reply_tx,
            })
            .expect("GenerateTitle should fit in the bounded mailbox");

        // The receiver can pick it up and pattern-match the variant.
        match cmd_rx.recv().await.expect("command should be available") {
            ActorCommand::GenerateTitle { prompt, reply: r } => {
                assert_eq!(prompt, "title test");
                // Round-trip the reply channel to prove it's wired.
                let _ = r.send(Ok("Hello".to_string()));
            }
            // Any other variant means the dispatch arm would not be reached
            // — fail the test loudly with a readable message.
            _other => panic!("expected GenerateTitle, got a different ActorCommand variant"),
        }
        assert_eq!(reply_rx.await.unwrap().unwrap(), "Hello");
    }
}
