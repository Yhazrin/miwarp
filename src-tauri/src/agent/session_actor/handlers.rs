//! Session Actor — single owner of a Claude CLI session's entire lifecycle.
//!
//! One actor per run_id. All session mutations (send, control, stop) go through
//! the actor's mailbox (bounded mpsc channel), guaranteeing sequential execution
//! without external locks. The actor owns the process, stdin, stdout/stderr readers,
//! protocol state, and RunState emission — eliminating the cross-system coordination
//! that previously caused race conditions.

use crate::agent::claude_protocol::validate_bus_event;
use crate::agent::notify::notify_if_background;
use crate::agent::recovery::CrashReason;
use crate::agent::runtime_recovery::classify_active_turn_eof;
use crate::agent::turn_engine::{
    apply_activity_reset, TurnOrigin, PROTOCOL_DESYNC_THRESHOLD, PROTOCOL_DESYNC_WINDOW_SECS,
};
use crate::models::{BusEvent, RunStatus};
use crate::storage;
use crate::storage::shared;
use serde_json::Value;
use std::time::Instant;

use super::state_machine::SessionActor;
use super::types::{PendingInteractiveRequest, StopSource};
use super::util::is_protocol_noise;

impl SessionActor {
    pub(super) async fn handle_stdout_line(&mut self, text: &str, line_num: u64) {
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
                // P0-C3: noise pre-filter. CLI startup banners / debug
                // lines / progress fragments are routinely non-JSON and
                // should NOT count toward the desync threshold — otherwise
                // a single noisy banner kills the run before the stream
                // settles. We still surface them to the events log so
                // users can see them, but the sliding-window counter and
                // the threshold check only see "real" parse failures
                // (lines that look like they tried to be JSON).
                if is_protocol_noise(text) {
                    log::trace!(
                        "[actor] parse-fail line classified as protocol noise: {}",
                        shared::truncate_str(text, 100)
                    );
                    // HC #16: parse failure during quarantine → swallow
                    if self.quarantine_until_result {
                        log::trace!("[turn] quarantine: swallowed noise line");
                        return;
                    }
                    // User turn or idle → emit Raw so the UI can render
                    // the banner / progress line.
                    self.persist_and_emit(&BusEvent::Raw {
                        run_id: self.run_id.clone(),
                        source: "claude_stdout_text".to_string(),
                        data: Value::String(text.to_string()),
                    });
                    return;
                }
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
                // HC #33: control events during quarantine → swallow (no
                // user-visible interactive dialog should ever appear while
                // we're waiting on a turn-boundary).
                log::trace!(
                    "[turn] quarantine: swallowed control event type={}",
                    event_type
                );
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
                        self.protocol.set_pending_slash_command(None);
                        // v1.0.6 / hardening A1: surface the recovery so the
                        // UI banner can dismiss.
                        self.persist_and_emit(&BusEvent::SessionRecovered {
                            run_id: self.run_id.clone(),
                            ok: state == "idle",
                        });
                        // Don't emit quarantine RunState to frontend
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
            self.handle_control_event(&parsed, event_type).await;
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

                    // Turn completion: idle or failed → ralph + end turn
                    if (emit_state == "idle" || emit_state == "failed")
                        && self.active_turn.is_some()
                    {
                        let turn = self.active_turn.take().expect("active_turn checked above");
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
                BusEvent::MessageComplete {
                    ref text,
                    ref parent_tool_use_id,
                    ..
                } => {
                    // Ralph: accumulate top-level assistant text (only during ralph turns).
                    // The internal-turn extractor that previously lived in Step 4a has
                    // been removed — auto-context is disabled. Ralph completion-promise
                    // detection still needs turn_toplevel_texts populated though.
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
    pub(super) async fn handle_control_event(&mut self, parsed: &Value, event_type: &str) {
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

    pub(super) fn handle_stderr_line(&mut self, text: &str) {
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
    pub(super) async fn handle_eof(&mut self) {
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
            self.quarantine_until_result = false;
            return;
        }

        log::debug!(
            "[actor] EOF cleanup: run_id={}, got_result={}, exit_code={:?}",
            self.run_id,
            self.protocol.got_result_event,
            exit_code
        );

        // P0-4: stamp `StreamEof` so `cleanup` and the recovery snapshot
        // observe the typed reason for an actor that quit on its own
        // (no Stop / Cancel command preceeded EOF). First-write-wins in
        // `request_stop` ensures a prior `UserRequested` / `Cancelled`
        // stamp is NOT overwritten — only un-stamped actors pick up
        // `StreamEof` here.
        if !self.user_stopped && !self.cancel.is_cancelled() {
            // Natural EOF: no user intent. Use the public-ish
            // `request_stop(StopSource::Eof)` entry point so the reason
            // stamp lives behind a single function (consistent with
            // the Stop / Cancel arms in the main select! loop).
            self.request_stop(StopSource::Eof);
        }

        // Fail all pending user replies on EOF (HC #12)
        self.fail_all_pending_replies("Session ended");
        self.active_turn = None;
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
            // have a different in-app banner for those. Note: the
            // `is_internal_turn` gate was removed alongside P0-C2's
            // internal-turn deprecation; we always notify here for now.
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
        } else {
            self.finalize_meta(exit_code);
            self.trigger_auto_commit();
            // v1.0.6 / hardening A4: also notify on natural result completion
            // when the window is in the background. Auto-commit failures
            // (rare) are surfaced in app; we only ping on the happy path.
            // Note: `is_internal_turn` gate removed with P0-C2.
            let title = "MiWarp · 运行完成";
            let body = self.run_id.clone();
            notify_if_background(self.emitter.app(), title, &body);
        }
    }
}
