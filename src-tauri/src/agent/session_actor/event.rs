//! Session Actor — single owner of a Claude CLI session's entire lifecycle.
//!
//! One actor per run_id. All session mutations (send, control, stop) go through
//! the actor's mailbox (bounded mpsc channel), guaranteeing sequential execution
//! without external locks. The actor owns the process, stdin, stdout/stderr readers,
//! protocol state, and RunState emission — eliminating the cross-system coordination
//! that previously caused race conditions.

use crate::agent::recovery::RecoveryState;
use crate::agent::runtime_recovery::{
    emit_session_lifecycle, on_actor_exit, ActorRecoverySnapshot, PendingRecoveryMessage,
};
use crate::models::{now_iso, BusEvent, RunStatus};
use crate::storage;
use crate::storage::runs;
use std::collections::VecDeque;
use std::sync::Arc;

use super::state_machine::SessionActor;
use super::types::ActorStopReason;
use super::util::map_state_to_run_status;

impl SessionActor {
    pub(super) fn is_still_registered(&self) -> bool {
        let Ok(map) = self.sessions.try_lock() else {
            // Mailbox is contended; prefer emitting so a live actor is not silenced.
            return true;
        };
        map.get(&self.run_id)
            .map(|handle| std::sync::Arc::ptr_eq(&self.tag, &handle.tag))
            .unwrap_or(false)
    }

    /// Emit a RunState event with identity dedup. Single entry point.
    pub(super) fn emit_state(
        &mut self,
        new_state: &str,
        exit_code: Option<i32>,
        error: Option<String>,
        update_meta: bool,
    ) {
        if !self.is_still_registered() {
            log::debug!(
                "[actor] skip emit_state: run={} -> {} (no longer registered)",
                self.run_id,
                new_state
            );
            return;
        }
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
    pub(super) fn finalize_meta(&self, exit_code: Option<i32>) {
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
    pub(super) fn trigger_auto_commit(&self) {
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

    pub(super) fn build_recovery_snapshot(&self) -> ActorRecoverySnapshot {
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

    pub(super) async fn cleanup(mut self) {
        log::debug!("[actor] cleanup starting: run_id={}", self.run_id);

        let snapshot = self.build_recovery_snapshot();
        // P0-4: log the typed stop reason `last_stop_reason` so a
        // misbehaving call chain (Stop → no reason in IPC reply) shows
        // up in the log even if no BusEvent was emitted.
        log::debug!(
            "[actor] cleanup reason: run_id={}, last_stop_reason={:?}",
            self.run_id,
            self.last_stop_reason
        );

        // P0-4: distinguish "user / cancel requested" from "natural EOF"
        // — both flip `user_stopped=true` historically, so we read the
        // typed `last_stop_reason` instead when deciding whether the
        // actor quit on its own. A `StreamEof` reason means "CLI finished
        // its turn normally" — we must NOT call this a crash.
        let user_initiated_stop = matches!(
            self.last_stop_reason,
            Some(ActorStopReason::UserRequested) | Some(ActorStopReason::Cancelled)
        );
        let should_recover =
            self.recoverable_exit && !user_initiated_stop && snapshot.crash_reason.is_some();

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
                    // P0-4: use the typed reason to decide between
                    // "stopped" / "crashed" instead of the historical
                    // boolean. A cancel that the CLI didn't react to
                    // now correctly reports `stopped`; a natural EOF
                    // followed by a parse error reports `crashed`.
                    match self.last_stop_reason {
                        Some(ActorStopReason::UserRequested) | Some(ActorStopReason::Cancelled) => {
                            "stopped"
                        }
                        _ => "crashed",
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
    pub(super) fn persist_idle_running(&self, target: RunStatus) {
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
#[cfg(test)]
pub(crate) use crate::agent::turn_engine::record_accepted_client_message_id;
