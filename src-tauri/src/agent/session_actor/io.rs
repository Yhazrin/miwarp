//! Session Actor — single owner of a Claude CLI session's entire lifecycle.
//!
//! One actor per run_id. All session mutations (send, control, stop) go through
//! the actor's mailbox (bounded mpsc channel), guaranteeing sequential execution
//! without external locks. The actor owns the process, stdin, stdout/stderr readers,
//! protocol state, and RunState emission — eliminating the cross-system coordination
//! that previously caused race conditions.

use crate::agent::attachment::AttachmentData;
use crate::agent::recovery::CrashReason;
use crate::agent::runtime_recovery::PendingRecoveryMessage;
use crate::agent::turn_engine::{
    record_accepted_client_message_id, ActiveTurn, TurnOrigin, TurnPhase, UserTurnKind,
    UserTurnTicket, ACCEPTED_CLIENT_MESSAGE_IDS_CAP, QUARANTINE_DEADLINE, STOP_ESCALATION_KILL,
    USER_HARD_TIMEOUT, USER_SOFT_TIMEOUT,
};
use crate::models::{BusEvent, RalphCompleteReason, RunStatus};
use serde_json::Value;
use std::time::Duration;
use std::time::Instant;
use tokio::io::AsyncWriteExt;
use tokio::sync::oneshot;

use super::state_machine::SessionActor;
use super::types::{ActorStopReason, StopSource};
use super::util::{build_user_payload, extract_promise_tag, RalphPhase};

impl SessionActor {
    pub(super) async fn try_dispatch(&mut self) {
        if self.active_turn.is_some() || self.quarantine_until_result || self.terminated {
            return;
        }

        // Try user queue first. Ralph yields to user messages.
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

        // Ralph loop: dispatch ralph prompt when user queue is empty and phase is Running
        if let Some(ref mut ralph) = self.ralph_loop {
            match ralph.phase {
                RalphPhase::Running => {
                    let prompt = ralph.prompt.clone();
                    self.start_ralph_turn(prompt).await;
                }
                RalphPhase::WaitingRetry => {
                    if let Some(deadline) = ralph.retry_after {
                        if Instant::now() >= deadline {
                            // Backoff expired — transition to Running and dispatch
                            ralph.phase = RalphPhase::Running;
                            ralph.retry_after = None;
                            let prompt = ralph.prompt.clone();
                            self.start_ralph_turn(prompt).await;
                        }
                    }
                }
                _ => {}
            }
        }
    }

    /// Start a user turn: write to stdin, emit events, set active_turn.
    pub(super) async fn start_user_turn(&mut self, ticket: UserTurnTicket) {
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
            UserTurnKind::Normal => {
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
                // Note: the caller already received Ok(()) on queue acceptance.
                // The stdin failure is handled internally — actor will crash and
                // the frontend will see RunState(stopped) via the event bus.
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
            // Caller already received Ok(()) on queue acceptance.
            // Log the durable acceptance failure for diagnostics.
            log::warn!(
                "[turn] durable acceptance ambiguous for turn_index={}: {}",
                ticket.turn_index,
                error
            );
        }
    }

    // ── Ralph Loop methods ──

    /// Start a Ralph loop turn: write prompt to stdin, set active_turn with TurnOrigin::Ralph.
    pub(super) async fn start_ralph_turn(&mut self, prompt: String) {
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
    pub(super) fn emit_ralph_complete(&mut self, reason: RalphCompleteReason) {
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
    pub(super) fn ralph_on_turn_end(&mut self, turn: &ActiveTurn, state: &str) {
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
                } // TurnOrigin::Ralph was matched above. TurnOrigin::Internal
                  // was removed in P0-C2; no other variants remain.
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

    /// P0-C4: poll the stop-escalation oneshot inside the actor's main
    /// `select!` without forcing the caller to unwrap the `Option`.
    /// Returns `true` when the timer fired (caller should hard-kill the
    /// child). Returns `false` while the timer is either unset or still
    /// pending — in both cases the `select!` arm simply stays asleep.
    ///
    /// Wrapped in `async` so it can be `.await`-ed inside `select!`
    /// without a manual `Pin`. Internally just `Option::take()`s the
    /// receiver into a local future and awaits it; if no timer was
    /// scheduled, it `Pending::pending()`s forever (the arm is dead).
    pub(super) async fn poll_stop_kill(rx: &mut Option<oneshot::Receiver<()>>) -> bool {
        match rx {
            Some(inner) => match inner.await {
                Ok(()) => true,
                // Sender dropped → timer was cancelled (EOF arrived first
                // and the timer task exited without sending). Treat as
                // "no kill needed" so the select! arm fires harmlessly.
                Err(_) => false,
            },
            None => std::future::pending().await,
        }
    }

    /// Independent timeout clock — checks soft/hard deadlines and quarantine. (HC #4)
    pub(super) async fn on_tick_timeout(&mut self) {
        // Check quarantine deadline first
        if self.quarantine_until_result {
            if let Some(deadline) = self.quarantine_deadline {
                if Instant::now() >= deadline {
                    // Quarantine secondary timeout → hard-kill
                    log::warn!(
                        "[turn] quarantine hard-timeout: run_id={}, pending_request={:?}",
                        self.run_id,
                        self.pending_interactive_request.as_ref().map(|r| (
                            &r.subtype,
                            &r.detail,
                            r.received_at.elapsed().as_secs()
                        ))
                    );
                    self.protocol.set_pending_slash_command(None);
                    if let Some(ref mut child) = self.child {
                        let _ = child.kill().await;
                    }
                    let error_msg = if let Some(ref req) = self.pending_interactive_request {
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

        // User turns: typically don't time out (CLI manages its own flow)
        // but hard_deadline provides a safety net
        if now >= turn.hard_deadline {
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
    pub(super) fn record_accepted_client_message_id(&mut self, cid: String) {
        record_accepted_client_message_id(
            &mut self.accepted_client_message_ids,
            cid,
            ACCEPTED_CLIENT_MESSAGE_IDS_CAP,
        );
    }

    /// Write a user-format message to CLI stdin. Returns the UUID embedded in the payload.
    pub(super) async fn write_user_to_stdin(
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
    pub(super) fn persist_and_emit(&self, event: &BusEvent) {
        self.emitter.persist_and_emit(&self.run_id, event);
    }

    /// Drain all queued user turns. (HC #12)
    /// Replies were already sent on queue acceptance, so this just clears the
    /// queue. Logging retained for diagnostics.
    pub(super) fn fail_all_pending_replies(&mut self, reason: &str) {
        let count = self.queued_user.len();
        self.queued_user.clear();
        if count > 0 {
            log::debug!(
                "[turn] fail_all_pending_replies: drained {} tickets, reason={}",
                count,
                reason
            );
        }
    }

    /// Send interrupt control request to CLI for quarantine recovery. (HC #15)
    pub(super) async fn send_interrupt_to_cli(&mut self) {
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

    // ── Command handlers ──

    /// Write control request to stdin + register response waiter.
    /// Returns (request_id, response_rx) — caller awaits response_rx outside the actor.
    pub(super) async fn handle_send_control_async(
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
    /// the caller that the request was accepted. Returns the typed
    /// `ActorStopReason` derived from the supplied `StopSource` so the
    /// reply channel, recovery snapshot, and `cleanup` all observe a
    /// consistent reason (not a placeholder `UserRequested`).
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
    pub(super) fn request_stop(&mut self, source: StopSource) -> ActorStopReason {
        let reason = source.reason();
        match source {
            StopSource::User => {
                if !self.user_stopped {
                    log::debug!(
                        "[actor] stop requested by user: run_id={}, reason={:?}",
                        self.run_id,
                        reason
                    );
                    self.user_stopped = true;
                }
            }
            StopSource::Cancel => {
                log::debug!(
                    "[actor] external cancellation: run_id={}, reason={:?}",
                    self.run_id,
                    reason
                );
                // `user_stopped` is the historical flag the recovery
                // machinery reads; mirrors its meaning for cancel.
                self.user_stopped = true;
            }
            StopSource::Eof => {
                log::debug!(
                    "[actor] natural EOF stop: run_id={}, reason={:?}",
                    self.run_id,
                    reason
                );
            }
        }
        // P0-4: stamp `last_stop_reason` so `cleanup` (and the recovery
        // snapshot) observe the *typed* reason instead of the historical
        // `user_stopped: bool` flag. First-write-wins — once the actor
        // is told to stop, later callers see the original reason rather
        // than overwriting it.
        if self.last_stop_reason.is_none() {
            self.last_stop_reason = Some(reason);
        }
        // P0-C4: schedule a hard-kill escalation if EOF doesn't arrive
        // first. Only the first user/cancel stop spawns a timer — later
        // calls are no-ops because `stop_kill_rx` is already Some.
        // `Eof` is excluded: by the time we know about EOF the child is
        // already gone, no escalation is needed.
        if !matches!(source, StopSource::Eof) && self.stop_kill_rx.is_none() {
            self.arm_stop_kill_timer();
        }
        reason
    }

    /// P0-C4: arm the 5-second escalation timer. Called from
    /// `request_stop` when the actor first learns it should stop.
    ///
    /// `request_stop` is sync (`&mut self`, no async), so the timer is
    /// spawned onto the runtime rather than awaited inline. After
    /// `STOP_ESCALATION_KILL` seconds the spawned task sends `()` on
    /// `stop_kill_rx`; the actor's main `select!` then calls
    /// `child.start_kill()` to free the wedged CLI.
    pub(super) fn arm_stop_kill_timer(&mut self) {
        let (tx, rx) = oneshot::channel::<()>();
        self.stop_kill_rx = Some(rx);
        tokio::spawn(async move {
            tokio::time::sleep(STOP_ESCALATION_KILL).await;
            // If the actor's main loop has already drained the receiver
            // (EOF arrived first), the send is a silent no-op — `Err`
            // means the receiver was dropped, which is the expected
            // outcome in that race.
            let _ = tx.send(());
        });
    }

    pub(super) async fn finalize_stop(&mut self) {
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
    pub(super) fn clear_pending_interactive_request(&mut self, request_id: &str) {
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
    pub(super) async fn handle_cancel_control_request(
        &mut self,
        request_id: &str,
    ) -> Result<(), String> {
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
    pub(super) async fn write_json_line(
        &mut self,
        payload: &Value,
        context: &str,
    ) -> Result<(), String> {
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
    pub(super) async fn write_control_response(
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
}
