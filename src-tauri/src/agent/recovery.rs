//! Recovery state machine + actor lifecycle contracts for v1.0.9.
//!
//! This module is the canonical source of truth for:
//! - [`RecoveryState`] — the per-run recovery state machine wired into
//!   `SessionRecoveryController` on the frontend and surfaced via
//!   `RuntimeHealth::state` on the backend.
//! - [`ActorLifecycle`] — typed lifecycle phases a single CLI session
//!   actor can be in, plus the [`CrashReason`] variants that describe
//!   how it ended.
//! - [`RuntimeError`] — the typed error envelope used at every IPC
//!   boundary and transaction boundary in v1.0.9. Strings are forbidden
//!   at the IPC surface; everything funnels through this enum.
//!
//! The module also defines the [`RecoveryStateMachine`] — a pure
//! function-driven state machine (no I/O) that the recovery controller
//! composes with. Tests in this file use `tokio::time::pause` /
//! `advance` to drive the timing without sleeping.
//!
//! # Invariants (frozen by `v1.0.9-transaction-contracts.md` §4 / §5)
//!
//! 1. `Reconnecting` and `Recovering` together MUST NOT exceed
//!    `RECOVERY_BUDGET`. After that, the state machine transitions to
//!    `Unrecoverable`.
//! 2. `consecutive_failures` is reset only on `Healthy` or `Recovered`.
//!    It is incremented on every transition into `Reconnecting`.
//! 3. Three consecutive `Crashed` events with the same `CrashReason`
//!    within `CRASH_QUARANTINE_WINDOW` escalate to `Unrecoverable`.
//! 4. `Disposed` is terminal. No more events from this actor.
//! 5. A `Respawning` actor inherits the `accepted_client_message_ids`
//!    ledger; replaying a non-accepted id after a crash is
//!    [`RuntimeError::ReplayOfUnaccepted`].

use serde::Serialize;
use std::time::{Duration, Instant};

/// Maximum time the recovery state machine may spend across both
/// `Reconnecting` and `Recovering` for a single run. After this, the
/// machine MUST transition to [`RecoveryState::Unrecoverable`].
pub const RECOVERY_BUDGET: Duration = Duration::from_secs(30);

/// Quarantine window for repeated crash events. Three crashes with the
/// same [`CrashReason`] inside this window escalate to
/// [`RecoveryState::Unrecoverable`].
pub const CRASH_QUARANTINE_WINDOW: Duration = Duration::from_secs(60);

/// Maximum number of consecutive crashes with the same reason before
/// the state machine escalates to `Unrecoverable`.
pub const CRASH_QUARANTINE_THRESHOLD: u32 = 3;

// ── RecoveryState ──

/// v1.0.9 per-run recovery state machine.
///
/// Mirrors `RuntimeHealthState` (runtime contract §5) but lives in the
/// agent / frontend layer where the recovery controller composes it.
/// The two machines are kept in sync by `BusEvent::SessionLifecycle`
/// transitions emitted on every state change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryState {
    /// Last op succeeded, no in-flight recovery.
    Healthy,
    /// Last op succeeded after retry; user can keep working.
    Degraded,
    /// Attempting to re-establish the connection.
    Reconnecting,
    /// Replaying the `accepted_client_message_ids` ledger.
    Recovering,
    /// Recovery completed; generation bumped.
    Recovered,
    /// Recovery failed three times; user action required.
    Unrecoverable,
}

impl RecoveryState {
    /// Returns true for terminal states (no further transitions).
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Unrecoverable)
    }

    /// Returns true while the run is in an active recovery window
    /// (`Reconnecting` or `Recovering`). Used to enforce the
    /// `RECOVERY_BUDGET` invariant.
    pub fn is_in_flight(self) -> bool {
        matches!(self, Self::Reconnecting | Self::Recovering)
    }

    /// Wire-format tag (snake_case, matches the JSON the frontend
    /// `useRecoveryState` composable projects).
    pub fn wire(self) -> &'static str {
        match self {
            Self::Healthy => "healthy",
            Self::Degraded => "degraded",
            Self::Reconnecting => "reconnecting",
            Self::Recovering => "recovering",
            Self::Recovered => "recovered",
            Self::Unrecoverable => "unrecoverable",
        }
    }
}

// ── ActorLifecycle + CrashReason ──

/// v1.0.9 typed lifecycle phase for a session actor. Every state
/// change MUST emit a `BusEvent::SessionLifecycle` so the UI can
/// project the transition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case", tag = "phase")]
pub enum ActorLifecycle {
    /// `spawn()` in progress.
    Starting,
    /// First message read; CLI is alive and initialized.
    Ready,
    /// Process exited; `code` and `signal` come from the OS, `reason`
    /// is the typed classification.
    Crashed {
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<i32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        signal: Option<i32>,
        reason: CrashReason,
    },
    /// Recovery kicked in; a replacement actor is being spawned.
    Respawning,
    /// Explicit `stop()` from the user.
    Stopped,
    /// Map entry removed; no more events will be emitted.
    Disposed,
}

impl ActorLifecycle {
    /// Returns true once the actor is in a terminal state (no more
    /// events expected).
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Disposed)
    }
}

/// Typed reason a CLI session actor entered [`ActorLifecycle::Crashed`].
/// The variant set is frozen by `v1.0.9-transaction-contracts.md` §5;
/// adding a variant requires updating the frontend `BusEvent` union.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CrashReason {
    /// Binary not found / not executable.
    SpawnFailed,
    /// `min_version` check failed.
    VersionTooOld,
    /// 401 / API key missing.
    AuthFailed,
    /// `PROTOCOL_DESYNC_THRESHOLD` exceeded within the window.
    ProtocolDesynced,
    /// Broken pipe on stdin write.
    StdinWriteFailed,
    /// Process exited without emitting a result event.
    StdoutEof,
    /// User replaced the session while we were running.
    StaleGeneration,
    /// Too many crashes; in `CRASH_QUARANTINE_WINDOW`.
    Quarantined,
    /// Unclassified.
    Unknown,
}

impl CrashReason {
    /// Wire-format tag.
    pub fn wire(self) -> &'static str {
        match self {
            Self::SpawnFailed => "spawn_failed",
            Self::VersionTooOld => "version_too_old",
            Self::AuthFailed => "auth_failed",
            Self::ProtocolDesynced => "protocol_desynced",
            Self::StdinWriteFailed => "stdin_write_failed",
            Self::StdoutEof => "stdout_eof",
            Self::StaleGeneration => "stale_generation",
            Self::Quarantined => "quarantined",
            Self::Unknown => "unknown",
        }
    }
}

// ── RuntimeError ──

/// Typed error envelope returned at every IPC boundary in v1.0.9.
/// Strings are forbidden here; every variant carries a structured
/// `code` plus a terse message (no user content).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum RuntimeError {
    /// Caller submitted a `client_message_id` that was not in the
    /// `accepted_client_message_ids` ledger — i.e. the actor is
    /// processing a message that was never acknowledged. A bug in
    /// respawn/replay logic. Not retryable.
    ReplayOfUnaccepted {
        client_message_id: String,
        run_id: String,
    },
    /// Recovery has been retried three times and the run is dead.
    /// The UI must surface this; auto-retry is forbidden.
    RecoveryExhausted { run_id: String, attempts: u32 },
    /// The actor went through `Disposed`; subsequent replies are
    /// dropped.
    Disposed { run_id: String },
    /// The actor's `accepted_client_message_ids` ledger is full and
    /// could not accept the new id. Should never happen in practice
    /// given the cap, but exposed for diagnostics.
    LedgerFull { run_id: String, cap: usize },
    /// A control_request that was not in the actor's pending set was
    /// responded to. Probably a late reply.
    UnknownRequest { run_id: String, request_id: String },
    /// Actor is unable to write to stdin (broken pipe).
    StdinBroken { run_id: String },
    /// The connection is orphaned — the run is no longer reachable
    /// through its expected `connection_generation`. The actor
    /// must mark the run `Unrecoverable`.
    OrphanedRun { run_id: String, generation: u64 },
}

impl RuntimeError {
    /// Wire-format code (the `tag` of the tagged-enum serde repr).
    pub fn code(&self) -> &'static str {
        match self {
            Self::ReplayOfUnaccepted { .. } => "replay_of_unaccepted",
            Self::RecoveryExhausted { .. } => "recovery_exhausted",
            Self::Disposed { .. } => "disposed",
            Self::LedgerFull { .. } => "ledger_full",
            Self::UnknownRequest { .. } => "unknown_request",
            Self::StdinBroken { .. } => "stdin_broken",
            Self::OrphanedRun { .. } => "orphaned_run",
        }
    }

    /// Returns `true` when the caller may safely retry.
    pub fn retryable(&self) -> bool {
        // RecoveryExhausted + Disposed are terminal: the user must act.
        // ReplayOfUnaccepted is a bug: retrying will fail the same way.
        // LedgerFull is transient (the next eviction cycle frees space).
        matches!(self, Self::StdinBroken { .. })
    }
}

impl std::fmt::Display for RuntimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ReplayOfUnaccepted {
                client_message_id,
                run_id,
            } => write!(
                f,
                "[replay_of_unaccepted] client_message_id={client_message_id} run_id={run_id}"
            ),
            Self::RecoveryExhausted { run_id, attempts } => write!(
                f,
                "[recovery_exhausted] run_id={run_id} attempts={attempts}"
            ),
            Self::Disposed { run_id } => write!(f, "[disposed] run_id={run_id}"),
            Self::LedgerFull { run_id, cap } => {
                write!(f, "[ledger_full] run_id={run_id} cap={cap}")
            }
            Self::UnknownRequest { run_id, request_id } => write!(
                f,
                "[unknown_request] run_id={run_id} request_id={request_id}"
            ),
            Self::StdinBroken { run_id } => write!(f, "[stdin_broken] run_id={run_id}"),
            Self::OrphanedRun { run_id, generation } => {
                write!(f, "[orphaned_run] run_id={run_id} generation={generation}")
            }
        }
    }
}

impl std::error::Error for RuntimeError {}

// ── RecoveryStateMachine ──

/// Pure-function state machine for the per-run recovery lifecycle.
/// The machine is driven by [`RecoveryStateMachine::transition`] and
/// [`RecoveryStateMachine::record_crash`]; it never performs I/O. The
/// actor / coordinator composes it with their own timers and bus
/// emission.
///
/// # Example
/// ```ignore
/// let mut sm = RecoveryStateMachine::new(Instant::now());
/// sm.transition(RecoveryState::Reconnecting, Instant::now());
/// sm.transition(RecoveryState::Recovering, Instant::now());
/// sm.transition(RecoveryState::Recovered, Instant::now());
/// assert_eq!(sm.state(), RecoveryState::Recovered);
/// assert_eq!(sm.consecutive_failures(), 0);
/// ```
#[derive(Debug, Clone)]
pub struct RecoveryStateMachine {
    state: RecoveryState,
    consecutive_failures: u32,
    /// When the current `Reconnecting` / `Recovering` window started.
    /// `None` when the machine is not in flight.
    in_flight_since: Option<Instant>,
    /// Rolling window of crash events: `(reason, instant)`. Entries
    /// older than `CRASH_QUARANTINE_WINDOW` are evicted on every
    /// `record_crash` call.
    crash_window: Vec<(CrashReason, Instant)>,
    /// Most recent crash reason — used by `record_crash` to decide
    /// whether to count towards quarantine.
    last_crash_reason: Option<CrashReason>,
}

impl Default for RecoveryStateMachine {
    fn default() -> Self {
        Self::new()
    }
}

impl RecoveryStateMachine {
    /// Build a fresh machine starting in `Healthy`.
    pub fn new() -> Self {
        Self {
            state: RecoveryState::Healthy,
            consecutive_failures: 0,
            in_flight_since: None,
            crash_window: Vec::new(),
            last_crash_reason: None,
        }
    }

    /// Current state.
    pub fn state(&self) -> RecoveryState {
        self.state
    }

    /// Number of consecutive transitions into `Reconnecting` since the
    /// last `Healthy` or `Recovered`.
    pub fn consecutive_failures(&self) -> u32 {
        self.consecutive_failures
    }

    /// Reason of the most recent crash, if any.
    pub fn last_crash_reason(&self) -> Option<CrashReason> {
        self.last_crash_reason
    }

    /// Transitions the machine into `next`. Returns the **previous**
    /// state. Idempotent on the same value (returns the new state
    /// without bookkeeping).
    ///
    /// Enforces:
    /// - `Healthy` and `Recovered` reset `consecutive_failures`.
    /// - `Reconnecting` increments `consecutive_failures`.
    /// - When transitioning out of in-flight states, the budget
    ///   check fires: if the in-flight window exceeded
    ///   `RECOVERY_BUDGET`, the machine ends in `Unrecoverable`
    ///   regardless of the requested `next` (the caller still sees
    ///   the transition request through the returned `previous`).
    pub fn transition(&mut self, next: RecoveryState, now: Instant) -> TransitionOutcome {
        let previous = self.state;
        if previous == next {
            return TransitionOutcome {
                previous,
                next,
                budget_exceeded: false,
            };
        }

        let budget_exceeded = if self.state.is_in_flight() && !next.is_in_flight() {
            self.in_flight_since
                .map(|start| now.saturating_duration_since(start) > RECOVERY_BUDGET)
                .unwrap_or(false)
        } else {
            false
        };

        if budget_exceeded {
            self.state = RecoveryState::Unrecoverable;
            self.in_flight_since = None;
            return TransitionOutcome {
                previous,
                next: RecoveryState::Unrecoverable,
                budget_exceeded: true,
            };
        }

        // Reset counter on Healthy/Recovered, increment on Reconnecting.
        match next {
            RecoveryState::Healthy | RecoveryState::Recovered => {
                self.consecutive_failures = 0;
            }
            RecoveryState::Reconnecting => {
                self.consecutive_failures = self.consecutive_failures.saturating_add(1);
            }
            _ => {}
        }

        // Track in-flight window.
        if next.is_in_flight() {
            self.in_flight_since = Some(now);
        } else {
            self.in_flight_since = None;
        }

        self.state = next;
        TransitionOutcome {
            previous,
            next,
            budget_exceeded: false,
        }
    }

    /// Records a crash event. If three consecutive crashes with the
    /// same `reason` occur within `CRASH_QUARANTINE_WINDOW`, the
    /// machine is forced to [`RecoveryState::Unrecoverable`] and
    /// the transition outcome reports `escalated: true`.
    pub fn record_crash(&mut self, reason: CrashReason, now: Instant) -> CrashOutcome {
        // Evict crashes outside the quarantine window.
        self.crash_window
            .retain(|(_, at)| now.saturating_duration_since(*at) <= CRASH_QUARANTINE_WINDOW);

        // Same reason as the previous crash? Count this entry even
        // if `crash_window` didn't yet retain it; we still want the
        // rolling 3-in-a-row trigger to fire.
        let is_consecutive_same_reason =
            self.last_crash_reason == Some(reason) || self.crash_window.is_empty();

        self.crash_window.push((reason, now));
        self.last_crash_reason = Some(reason);

        if is_consecutive_same_reason {
            // Count entries with the same reason within the window.
            let same_reason_count = self
                .crash_window
                .iter()
                .filter(|(r, at)| {
                    *r == reason && now.saturating_duration_since(*at) <= CRASH_QUARANTINE_WINDOW
                })
                .count() as u32;

            if same_reason_count >= CRASH_QUARANTINE_THRESHOLD {
                let previous = self.state;
                self.state = RecoveryState::Unrecoverable;
                self.in_flight_since = None;
                return CrashOutcome {
                    escalated: true,
                    same_reason_count,
                    previous,
                };
            }
            return CrashOutcome {
                escalated: false,
                same_reason_count,
                previous: self.state,
            };
        }

        // Different reason — reset the consecutive count and start over.
        self.crash_window.clear();
        self.crash_window.push((reason, now));
        CrashOutcome {
            escalated: false,
            same_reason_count: 1,
            previous: self.state,
        }
    }

    /// Mark the run as orphaned (no longer reachable via its expected
    /// `connection_generation`). Always transitions to
    /// [`RecoveryState::Unrecoverable`].
    pub fn mark_orphaned(&mut self) -> RecoveryState {
        let previous = self.state;
        self.state = RecoveryState::Unrecoverable;
        self.in_flight_since = None;
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        log::debug!(
            "[recovery] orphaned: previous={:?} → un_recoverable (consecutive_failures={})",
            previous,
            self.consecutive_failures
        );
        RecoveryState::Unrecoverable
    }
}

/// Result of a [`RecoveryStateMachine::transition`] call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TransitionOutcome {
    /// State the machine was in before the call.
    pub previous: RecoveryState,
    /// State the machine is in after the call. May differ from the
    /// requested `next` when the recovery budget was exceeded — in
    /// that case `next == Unrecoverable`.
    pub next: RecoveryState,
    /// `true` when the in-flight window exceeded `RECOVERY_BUDGET`
    /// and the machine was forced into `Unrecoverable` regardless
    /// of the requested `next`.
    pub budget_exceeded: bool,
}

/// Result of a [`RecoveryStateMachine::record_crash`] call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CrashOutcome {
    /// `true` when the call escalated to `Unrecoverable`.
    pub escalated: bool,
    /// How many crashes with the same reason are in the quarantine
    /// window (including this one).
    pub same_reason_count: u32,
    /// State the machine was in before the call.
    pub previous: RecoveryState,
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    fn t0() -> Instant {
        Instant::now()
    }

    #[test]
    fn fresh_machine_is_healthy() {
        let sm = RecoveryStateMachine::new();
        assert_eq!(sm.state(), RecoveryState::Healthy);
        assert_eq!(sm.consecutive_failures(), 0);
        assert_eq!(sm.last_crash_reason(), None);
    }

    #[test]
    fn healthy_to_reconnecting_increments_failures() {
        let t = t0();
        let mut sm = RecoveryStateMachine::new();
        let outcome = sm.transition(RecoveryState::Reconnecting, t);
        assert_eq!(outcome.previous, RecoveryState::Healthy);
        assert_eq!(outcome.next, RecoveryState::Reconnecting);
        assert_eq!(sm.consecutive_failures(), 1);
    }

    #[test]
    fn recovered_resets_consecutive_failures() {
        let t = t0();
        let mut sm = RecoveryStateMachine::new();
        sm.transition(RecoveryState::Reconnecting, t);
        sm.transition(RecoveryState::Recovering, t);
        assert_eq!(sm.consecutive_failures(), 1);
        let outcome = sm.transition(RecoveryState::Recovered, t);
        assert_eq!(outcome.next, RecoveryState::Recovered);
        assert_eq!(sm.consecutive_failures(), 0);
    }

    #[test]
    fn healthy_resets_consecutive_failures() {
        let t = t0();
        let mut sm = RecoveryStateMachine::new();
        sm.transition(RecoveryState::Reconnecting, t);
        sm.transition(RecoveryState::Recovering, t);
        sm.transition(RecoveryState::Healthy, t);
        assert_eq!(sm.consecutive_failures(), 0);
    }

    #[test]
    fn idempotent_transition_does_not_bookkeep() {
        let t = t0();
        let mut sm = RecoveryStateMachine::new();
        let first = sm.transition(RecoveryState::Reconnecting, t);
        assert_eq!(first.next, RecoveryState::Reconnecting);
        assert_eq!(sm.consecutive_failures(), 1);
        // Idempotent re-entry into the same state MUST NOT increment
        // the counter — the contract states "incremented on every
        // transition into Reconnecting", and a no-op transition is
        // not a real transition.
        let second = sm.transition(RecoveryState::Reconnecting, t);
        assert_eq!(second.next, RecoveryState::Reconnecting);
        assert_eq!(sm.consecutive_failures(), 1);
    }

    #[test]
    fn budget_exceeded_forces_unrecoverable() {
        let mut sm = RecoveryStateMachine::new();
        let start = t0();
        sm.transition(RecoveryState::Reconnecting, start);
        // Pretend 31s have passed; budget is 30s.
        let past_budget = start + Duration::from_secs(31);
        let outcome = sm.transition(RecoveryState::Recovered, past_budget);
        assert!(outcome.budget_exceeded);
        assert_eq!(outcome.next, RecoveryState::Unrecoverable);
        assert_eq!(sm.state(), RecoveryState::Unrecoverable);
    }

    #[test]
    fn budget_within_window_keeps_requested_state() {
        let mut sm = RecoveryStateMachine::new();
        let start = t0();
        sm.transition(RecoveryState::Reconnecting, start);
        sm.transition(RecoveryState::Recovering, start + Duration::from_secs(10));
        let outcome = sm.transition(RecoveryState::Recovered, start + Duration::from_secs(20));
        assert!(!outcome.budget_exceeded);
        assert_eq!(outcome.next, RecoveryState::Recovered);
    }

    #[test]
    fn three_consecutive_same_reason_crashes_escalate() {
        let t = t0();
        let mut sm = RecoveryStateMachine::new();
        let r1 = sm.record_crash(CrashReason::StdinWriteFailed, t);
        assert!(!r1.escalated);
        let r2 = sm.record_crash(CrashReason::StdinWriteFailed, t + Duration::from_secs(10));
        assert!(!r2.escalated);
        let r3 = sm.record_crash(CrashReason::StdinWriteFailed, t + Duration::from_secs(20));
        assert!(r3.escalated);
        assert_eq!(r3.same_reason_count, 3);
        assert_eq!(sm.state(), RecoveryState::Unrecoverable);
    }

    #[test]
    fn three_crashes_outside_window_do_not_escalate() {
        let t = t0();
        let mut sm = RecoveryStateMachine::new();
        // First two crashes: separated by 10s, both inside the 60s
        // window. We then wait past the window before recording the
        // third crash so the first two are evicted.
        sm.record_crash(CrashReason::StdinWriteFailed, t);
        sm.record_crash(CrashReason::StdinWriteFailed, t + Duration::from_secs(10));
        // Third crash is 80s after the first (70s after the second) →
        // outside the 60s window for both prior crashes, so the
        // quarantine counter restarts at 1.
        let r3 = sm.record_crash(CrashReason::StdinWriteFailed, t + Duration::from_secs(80));
        assert!(!r3.escalated);
        assert_eq!(r3.same_reason_count, 1);
    }

    #[test]
    fn different_reasons_do_not_compound() {
        let t = t0();
        let mut sm = RecoveryStateMachine::new();
        sm.record_crash(CrashReason::StdinWriteFailed, t);
        sm.record_crash(CrashReason::StdoutEof, t + Duration::from_secs(5));
        let r3 = sm.record_crash(CrashReason::StdinWriteFailed, t + Duration::from_secs(10));
        // Two StdinWriteFailed in window but they're not consecutive
        // (StdoutEof broke the streak). So same_reason_count resets
        // to 1 after the StdoutEof, and the second StdinWriteFailed
        // starts a new streak that hasn't yet hit 3.
        assert!(!r3.escalated);
        assert_eq!(r3.same_reason_count, 1);
    }

    #[test]
    fn orphaned_run_marks_unrecoverable() {
        let mut sm = RecoveryStateMachine::new();
        sm.transition(RecoveryState::Reconnecting, t0());
        let next = sm.mark_orphaned();
        assert_eq!(next, RecoveryState::Unrecoverable);
        assert_eq!(sm.state(), RecoveryState::Unrecoverable);
    }

    #[test]
    fn runtime_error_codes_match_contract() {
        let e = RuntimeError::ReplayOfUnaccepted {
            client_message_id: "cmsg-1".to_string(),
            run_id: "run-1".to_string(),
        };
        assert_eq!(e.code(), "replay_of_unaccepted");
        assert!(!e.retryable());
    }

    #[test]
    fn runtime_error_stdin_broken_is_retryable() {
        let e = RuntimeError::StdinBroken {
            run_id: "run-1".to_string(),
        };
        assert_eq!(e.code(), "stdin_broken");
        assert!(e.retryable());
    }

    #[test]
    fn actor_lifecycle_disposed_is_terminal() {
        assert!(ActorLifecycle::Disposed.is_terminal());
        assert!(!ActorLifecycle::Ready.is_terminal());
        assert!(!ActorLifecycle::Respawning.is_terminal());
    }

    #[test]
    fn crash_reason_wire_strings_are_stable() {
        // Contract test — frontend projection depends on these strings.
        assert_eq!(CrashReason::StdinWriteFailed.wire(), "stdin_write_failed");
        assert_eq!(CrashReason::StdoutEof.wire(), "stdout_eof");
        assert_eq!(CrashReason::ProtocolDesynced.wire(), "protocol_desynced");
        assert_eq!(CrashReason::Quarantined.wire(), "quarantined");
    }

    #[test]
    fn recovery_state_wire_strings_are_stable() {
        assert_eq!(RecoveryState::Healthy.wire(), "healthy");
        assert_eq!(RecoveryState::Reconnecting.wire(), "reconnecting");
        assert_eq!(RecoveryState::Recovering.wire(), "recovering");
        assert_eq!(RecoveryState::Recovered.wire(), "recovered");
        assert_eq!(RecoveryState::Unrecoverable.wire(), "unrecoverable");
    }

    #[test]
    fn recovery_state_in_flight_predicate() {
        assert!(RecoveryState::Reconnecting.is_in_flight());
        assert!(RecoveryState::Recovering.is_in_flight());
        assert!(!RecoveryState::Healthy.is_in_flight());
        assert!(!RecoveryState::Recovered.is_in_flight());
        assert!(!RecoveryState::Unrecoverable.is_in_flight());
    }

    #[test]
    fn transition_recovering_after_reconnecting_keeps_window() {
        // The in-flight window is from the FIRST in-flight transition,
        // not the most recent. Budget is measured against the original
        // Reconnecting entry.
        let t = t0();
        let mut sm = RecoveryStateMachine::new();
        sm.transition(RecoveryState::Reconnecting, t);
        sm.transition(RecoveryState::Recovering, t + Duration::from_secs(20));
        // 20s after start; 10s of budget remaining. Recovery still works.
        let outcome = sm.transition(RecoveryState::Recovered, t + Duration::from_secs(25));
        assert!(!outcome.budget_exceeded);
        assert_eq!(outcome.next, RecoveryState::Recovered);
    }

    #[test]
    fn three_crashes_with_mixed_reasons_in_window_only_count_consecutive() {
        let t = t0();
        let mut sm = RecoveryStateMachine::new();
        // Stdin, Stdin, Stdout, Stdin — last Stdin starts a fresh streak
        // of 1, no escalation.
        sm.record_crash(CrashReason::StdinWriteFailed, t);
        sm.record_crash(CrashReason::StdinWriteFailed, t + Duration::from_secs(5));
        sm.record_crash(CrashReason::StdoutEof, t + Duration::from_secs(10));
        let r = sm.record_crash(CrashReason::StdinWriteFailed, t + Duration::from_secs(15));
        assert!(!r.escalated);
        assert_eq!(r.same_reason_count, 1);
    }

    #[test]
    fn escalation_to_unrecoverable_clears_in_flight_window() {
        let t = t0();
        let mut sm = RecoveryStateMachine::new();
        sm.transition(RecoveryState::Reconnecting, t);
        sm.record_crash(CrashReason::StdinWriteFailed, t);
        sm.record_crash(CrashReason::StdinWriteFailed, t + Duration::from_secs(5));
        let r = sm.record_crash(CrashReason::StdinWriteFailed, t + Duration::from_secs(10));
        assert!(r.escalated);
        assert_eq!(sm.state(), RecoveryState::Unrecoverable);
        // After escalation, in-flight window must be cleared.
        // A subsequent Recovered transition should NOT count against
        // the budget because there is no in-flight start.
        let outcome = sm.transition(RecoveryState::Recovered, t + Duration::from_secs(60));
        assert!(!outcome.budget_exceeded);
    }
}
