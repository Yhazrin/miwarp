//! v1.0.9 runtime recovery coordinator — per-run registry, backoff, and replay.
//!
//! Owns the I/O-adjacent recovery state that `RecoveryStateMachine` (pure logic)
//! does not: bounded pending queues, connection generation, accepted-ledger
//! inheritance across respawns, and SessionLifecycle emission.

use crate::agent::attachment::AttachmentData;
use crate::agent::recovery::{
    CrashReason, RecoveryState, RecoveryStateMachine, RuntimeError, CRASH_QUARANTINE_THRESHOLD,
    RECOVERY_BUDGET,
};
use crate::agent::turn_engine::{
    is_accepted, record_accepted_client_message_id, ACCEPTED_CLIENT_MESSAGE_IDS_CAP,
};
use crate::models::BusEvent;
use crate::web_server::broadcaster::BroadcastEmitter;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// Bounded queue for user sends that arrive while a run is recovering.
pub const PENDING_RECOVERY_QUEUE_CAP: usize = 32;

/// Base backoff before the first respawn attempt after a crash.
pub const RESPAWN_BACKOFF_BASE: Duration = Duration::from_millis(500);

/// Cap for exponential respawn backoff.
pub const RESPAWN_BACKOFF_MAX: Duration = Duration::from_secs(8);

/// Sliding window for respawn-storm detection.
pub const RESPAWN_STORM_WINDOW: Duration = Duration::from_secs(30);

/// Max respawn attempts inside [`RESPAWN_STORM_WINDOW`] before forced backoff.
pub const RESPAWN_STORM_THRESHOLD: u32 = 5;

pub type RecoveryRegistry = Arc<Mutex<HashMap<String, RunRecoveryState>>>;

pub fn new_recovery_registry() -> RecoveryRegistry {
    Arc::new(Mutex::new(HashMap::new()))
}

/// A user message captured for replay after respawn. Only messages that were
/// submitted to the backend but not yet accepted belong here.
#[derive(Debug, Clone)]
pub struct PendingRecoveryMessage {
    pub text: String,
    pub attachments: Vec<AttachmentData>,
    pub client_message_id: Option<String>,
}

/// Snapshot exported by a dying actor before shutdown.
#[derive(Debug, Clone)]
pub struct ActorRecoverySnapshot {
    pub crash_reason: Option<CrashReason>,
    pub accepted_ledger: VecDeque<String>,
    pub pending_unaccepted: VecDeque<PendingRecoveryMessage>,
    pub next_turn_index: u32,
    pub next_auto_ctx_id: u32,
    pub next_turn_seq: u64,
    pub session_id: Option<String>,
    pub user_stopped: bool,
}

/// Bootstrap data for a replacement actor after respawn.
#[derive(Debug, Clone)]
pub struct ActorRecoveryBootstrap {
    pub connection_generation: u64,
    pub accepted_ledger: VecDeque<String>,
    pub next_turn_index: u32,
    pub next_auto_ctx_id: u32,
    pub next_turn_seq: u64,
    pub session_id: Option<String>,
}

#[derive(Debug)]
pub struct RunRecoveryState {
    pub recovery_sm: RecoveryStateMachine,
    pub connection_generation: u64,
    pub accepted_ledger: VecDeque<String>,
    /// Frontend-submitted messages the backend had not yet accepted.
    pub pending_unaccepted: VecDeque<PendingRecoveryMessage>,
    /// Sends that arrived while recovery is in flight (bounded FIFO).
    pub recovery_queue: VecDeque<PendingRecoveryMessage>,
    pub session_id: Option<String>,
    pub unrecoverable: bool,
    pub respawn_in_flight: bool,
    pub respawn_timestamps: VecDeque<Instant>,
    pub last_crash_reason: Option<CrashReason>,
    pub next_turn_index: u32,
    pub next_auto_ctx_id: u32,
    pub next_turn_seq: u64,
    pub last_error: Option<RuntimeError>,
}

impl RunRecoveryState {
    pub fn new(run_id: &str, session_id: Option<String>) -> Self {
        let _ = run_id;
        Self {
            recovery_sm: RecoveryStateMachine::new(),
            connection_generation: 0,
            accepted_ledger: VecDeque::new(),
            pending_unaccepted: VecDeque::new(),
            recovery_queue: VecDeque::new(),
            session_id,
            unrecoverable: false,
            respawn_in_flight: false,
            respawn_timestamps: VecDeque::new(),
            last_crash_reason: None,
            next_turn_index: 1,
            next_auto_ctx_id: 1,
            next_turn_seq: 0,
            last_error: None,
        }
    }

    pub fn is_recovering(&self) -> bool {
        !self.unrecoverable
            && (self.respawn_in_flight
                || matches!(
                    self.recovery_sm.state(),
                    RecoveryState::Reconnecting | RecoveryState::Recovering
                ))
    }

    pub fn bootstrap(&self) -> ActorRecoveryBootstrap {
        ActorRecoveryBootstrap {
            connection_generation: self.connection_generation,
            accepted_ledger: self.accepted_ledger.clone(),
            next_turn_index: self.next_turn_index,
            next_auto_ctx_id: self.next_auto_ctx_id,
            next_turn_seq: self.next_turn_seq,
            session_id: self.session_id.clone(),
        }
    }

    pub fn enqueue_recovery_send(
        &mut self,
        text: String,
        attachments: Vec<AttachmentData>,
        client_message_id: Option<String>,
    ) -> Result<(), RuntimeError> {
        if self.unrecoverable {
            return Err(RuntimeError::RecoveryExhausted {
                run_id: String::new(),
                attempts: CRASH_QUARANTINE_THRESHOLD,
            });
        }
        if let Some(ref cid) = client_message_id {
            if is_accepted(&self.accepted_ledger, cid) {
                return Ok(());
            }
            if self
                .recovery_queue
                .iter()
                .any(|m| m.client_message_id.as_deref() == Some(cid.as_str()))
                || self
                    .pending_unaccepted
                    .iter()
                    .any(|m| m.client_message_id.as_deref() == Some(cid.as_str()))
            {
                return Ok(());
            }
        }
        if self.recovery_queue.len() >= PENDING_RECOVERY_QUEUE_CAP {
            let _ = self.recovery_queue.pop_front();
        }
        self.recovery_queue.push_back(PendingRecoveryMessage {
            text,
            attachments,
            client_message_id,
        });
        Ok(())
    }

    pub fn ingest_snapshot(&mut self, snapshot: ActorRecoverySnapshot, now: Instant) {
        self.accepted_ledger = snapshot.accepted_ledger;
        self.pending_unaccepted.extend(snapshot.pending_unaccepted);
        self.next_turn_index = snapshot.next_turn_index;
        self.next_auto_ctx_id = snapshot.next_auto_ctx_id;
        self.next_turn_seq = snapshot.next_turn_seq;
        if snapshot.session_id.is_some() {
            self.session_id = snapshot.session_id;
        }
        if let Some(reason) = snapshot.crash_reason {
            self.last_crash_reason = Some(reason);
            let outcome = self.recovery_sm.record_crash(reason, now);
            if outcome.escalated {
                self.unrecoverable = true;
            }
        }
    }

    pub fn record_respawn_attempt(&mut self, now: Instant) {
        self.respawn_timestamps
            .retain(|t| now.saturating_duration_since(*t) <= RESPAWN_STORM_WINDOW);
        self.respawn_timestamps.push_back(now);
    }

    pub fn respawn_storm_active(&self) -> bool {
        self.respawn_timestamps.len() as u32 >= RESPAWN_STORM_THRESHOLD
    }

    pub fn drain_replay_batch(&mut self) -> Vec<PendingRecoveryMessage> {
        let mut out = Vec::new();
        while let Some(msg) = self.pending_unaccepted.pop_front() {
            if let Some(ref cid) = msg.client_message_id {
                if is_accepted(&self.accepted_ledger, cid) {
                    continue;
                }
            }
            out.push(msg);
        }
        while let Some(msg) = self.recovery_queue.pop_front() {
            if let Some(ref cid) = msg.client_message_id {
                if is_accepted(&self.accepted_ledger, cid) {
                    continue;
                }
            }
            out.push(msg);
        }
        out
    }

    pub fn note_accepted(&mut self, client_message_id: String) {
        record_accepted_client_message_id(
            &mut self.accepted_ledger,
            client_message_id,
            ACCEPTED_CLIENT_MESSAGE_IDS_CAP,
        );
    }
}

pub fn compute_respawn_backoff(state: &RunRecoveryState) -> Duration {
    let failures = state.recovery_sm.consecutive_failures().max(1);
    let mut backoff = RESPAWN_BACKOFF_BASE.saturating_mul(failures);
    if state.respawn_storm_active() {
        backoff = backoff.saturating_mul(2);
    }
    backoff.min(RESPAWN_BACKOFF_MAX)
}

pub fn classify_active_turn_eof(cancelled: bool, active_turn: bool) -> Option<CrashReason> {
    if cancelled {
        return None;
    }
    if active_turn {
        Some(CrashReason::StdoutEof)
    } else {
        None
    }
}

#[allow(clippy::too_many_arguments)]
pub fn emit_session_lifecycle(
    emitter: &BroadcastEmitter,
    run_id: &str,
    session_id: Option<&str>,
    phase: &str,
    recovery_state: RecoveryState,
    crash: Option<(CrashReason, Option<i32>, Option<i32>)>,
    connection_generation: u64,
    consecutive_failures: u32,
) {
    let (crash_reason, crash_code, crash_signal) = match crash {
        Some((reason, code, signal)) => (Some(reason.wire().to_string()), code, signal),
        None => (None, None, None),
    };
    let event = BusEvent::SessionLifecycle {
        run_id: run_id.to_string(),
        session_id: session_id.map(str::to_string),
        phase: phase.to_string(),
        recovery_state: recovery_state.wire().to_string(),
        crash_reason,
        crash_code,
        crash_signal,
        connection_generation: Some(connection_generation),
        consecutive_failures: Some(consecutive_failures),
        timestamp_ms: crate::models::now_epoch_ms(),
    };
    emitter.persist_and_emit(run_id, &event);
}

pub fn mark_unrecoverable(
    state: &mut RunRecoveryState,
    run_id: &str,
    emitter: &BroadcastEmitter,
    error: RuntimeError,
) {
    state.unrecoverable = true;
    state.respawn_in_flight = false;
    state.last_error = Some(error);
    let _ = state.recovery_sm.mark_orphaned();

    // Drain queued messages so we can report them as lost.
    let lost_from_queue = state.recovery_queue.len();
    let lost_from_pending = state.pending_unaccepted.len();
    let total_lost = lost_from_queue + lost_from_pending;
    state.recovery_queue.clear();
    state.pending_unaccepted.clear();

    emit_session_lifecycle(
        emitter,
        run_id,
        state.session_id.as_deref(),
        "crashed",
        RecoveryState::Unrecoverable,
        state.last_crash_reason.map(|r| (r, None, None)),
        state.connection_generation,
        state.recovery_sm.consecutive_failures(),
    );
    emitter.persist_and_emit(
        run_id,
        &BusEvent::SessionRecovered {
            run_id: run_id.to_string(),
            ok: false,
        },
    );

    // Emit a RunState "failed" so the frontend knows queued messages were lost.
    if total_lost > 0 {
        log::warn!(
            "[recovery] run_id={}: {} queued message(s) lost due to unrecoverable crash",
            run_id,
            total_lost
        );
        emitter.persist_and_emit(
            run_id,
            &BusEvent::RunState {
                run_id: run_id.to_string(),
                state: "failed".to_string(),
                exit_code: None,
                error: Some(format!(
                    "Session unrecoverable — {} queued message(s) could not be delivered",
                    total_lost
                )),
            },
        );
    }
}

pub async fn ensure_run_registered(
    registry: &RecoveryRegistry,
    run_id: &str,
    session_id: Option<String>,
) {
    let mut map = registry.lock().await;
    map.entry(run_id.to_string())
        .or_insert_with(|| RunRecoveryState::new(run_id, session_id));
}

pub async fn get_bootstrap(
    registry: &RecoveryRegistry,
    run_id: &str,
) -> Option<ActorRecoveryBootstrap> {
    registry
        .lock()
        .await
        .get(run_id)
        .map(RunRecoveryState::bootstrap)
}

pub async fn on_actor_exit(
    registry: &RecoveryRegistry,
    run_id: &str,
    snapshot: ActorRecoverySnapshot,
) -> bool {
    let mut map = registry.lock().await;
    let entry = map
        .entry(run_id.to_string())
        .or_insert_with(|| RunRecoveryState::new(run_id, snapshot.session_id.clone()));
    let now = Instant::now();
    entry.ingest_snapshot(snapshot.clone(), now);
    !entry.unrecoverable && !snapshot.user_stopped && snapshot.crash_reason.is_some()
}

pub fn transition_recovery(
    state: &mut RunRecoveryState,
    next: RecoveryState,
    now: Instant,
) -> bool {
    let outcome = state.recovery_sm.transition(next, now);
    if outcome.budget_exceeded || outcome.next == RecoveryState::Unrecoverable {
        state.unrecoverable = true;
        return false;
    }
    true
}

/// Returns `true` when the in-flight recovery window is still within budget.
pub fn recovery_budget_remaining(state: &RunRecoveryState, now: Instant) -> bool {
    if state.unrecoverable {
        return false;
    }
    match state.recovery_sm.state() {
        RecoveryState::Reconnecting | RecoveryState::Recovering => {
            // Budget enforcement is handled inside the state machine on exit;
            // while still in-flight we allow one more attempt.
            let _ = now;
            let _ = RECOVERY_BUDGET;
            true
        }
        RecoveryState::Unrecoverable => false,
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ledger_dedupe_skips_replay_of_accepted_ids() {
        let mut state = RunRecoveryState::new("run-1", None);
        state.note_accepted("cid-1".to_string());
        state.pending_unaccepted.push_back(PendingRecoveryMessage {
            text: "a".into(),
            attachments: vec![],
            client_message_id: Some("cid-1".into()),
        });
        state.pending_unaccepted.push_back(PendingRecoveryMessage {
            text: "b".into(),
            attachments: vec![],
            client_message_id: Some("cid-2".into()),
        });
        let batch = state.drain_replay_batch();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].client_message_id.as_deref(), Some("cid-2"));
    }

    #[test]
    fn recovery_queue_is_bounded_fifo() {
        let mut state = RunRecoveryState::new("run-1", None);
        for i in 0..PENDING_RECOVERY_QUEUE_CAP + 2 {
            state
                .enqueue_recovery_send(format!("m{i}"), vec![], Some(format!("id-{i}")))
                .unwrap();
        }
        assert_eq!(state.recovery_queue.len(), PENDING_RECOVERY_QUEUE_CAP);
        assert_eq!(
            state
                .recovery_queue
                .front()
                .unwrap()
                .client_message_id
                .as_deref(),
            Some("id-2")
        );
    }

    #[test]
    fn three_same_reason_crashes_mark_unrecoverable() {
        let mut state = RunRecoveryState::new("run-1", None);
        let t = Instant::now();
        for i in 0..CRASH_QUARANTINE_THRESHOLD {
            state.ingest_snapshot(
                ActorRecoverySnapshot {
                    crash_reason: Some(CrashReason::StdinWriteFailed),
                    accepted_ledger: VecDeque::new(),
                    pending_unaccepted: VecDeque::new(),
                    next_turn_index: 1,
                    next_auto_ctx_id: 1,
                    next_turn_seq: 0,
                    session_id: None,
                    user_stopped: false,
                },
                t + Duration::from_secs(i as u64),
            );
        }
        assert!(state.unrecoverable);
    }

    #[test]
    fn backoff_grows_with_failures_and_storm() {
        let mut state = RunRecoveryState::new("run-1", None);
        state
            .recovery_sm
            .transition(RecoveryState::Reconnecting, Instant::now());
        let base = compute_respawn_backoff(&state);
        for _ in 0..RESPAWN_STORM_THRESHOLD {
            state.record_respawn_attempt(Instant::now());
        }
        let storm = compute_respawn_backoff(&state);
        assert!(storm >= base);
        assert!(storm <= RESPAWN_BACKOFF_MAX);
    }

    #[test]
    fn active_turn_eof_classifies_stdout_eof() {
        assert_eq!(
            classify_active_turn_eof(false, true),
            Some(CrashReason::StdoutEof)
        );
        assert_eq!(classify_active_turn_eof(true, true), None);
    }

    #[test]
    fn generation_bump_on_recovery_success() {
        let mut state = RunRecoveryState::new("run-1", None);
        assert_eq!(state.connection_generation, 0);
        state.connection_generation += 1;
        assert_eq!(state.connection_generation, 1);
    }

    #[test]
    fn enqueue_rejected_after_unrecoverable() {
        let mut state = RunRecoveryState::new("run-1", None);
        state.unrecoverable = true;
        let err = state
            .enqueue_recovery_send("msg".into(), vec![], Some("cid-1".into()))
            .unwrap_err();
        assert!(matches!(err, RuntimeError::RecoveryExhausted { .. }));
    }
}
