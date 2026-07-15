//! Turn Transaction Engine — turn data model and activity-reset helpers.
//!
//! Every stdin write belongs to an explicit turn (User or Ralph). The
//! engine provides the data model and the pure `apply_activity_reset`
//! helper used by the session actor on CLI activity. The previous
//! internal-turn / auto-context machinery (ContextExtractor,
//! InternalJob, should_trigger_auto_context) was removed in P0-C2
//! because auto-context is disabled.

use std::collections::VecDeque;
use std::time::Instant;

use super::attachment::AttachmentData;

// ── Turn types ──

#[derive(Debug, Clone, PartialEq)]
pub enum TurnOrigin {
    User(UserTurnKind),
    /// Ralph loop auto-resend turn. Does not trigger auto-context.
    Ralph,
}

#[derive(Debug, Clone, PartialEq)]
pub enum UserTurnKind {
    /// Normal user message.
    Normal,
    /// Slash command — does not trigger auto-context.
    Slash { command: String },
}

#[derive(Debug, Clone, PartialEq)]
pub enum TurnPhase {
    Active,
    /// Soft timeout reached — extractor finalized, events suppressed.
    Draining,
}

pub struct ActiveTurn {
    pub turn_seq: u64,
    pub origin: TurnOrigin,
    pub phase: TurnPhase,
    pub started_at: Instant,
    pub soft_deadline: Instant,
    pub hard_deadline: Instant,
    /// Unified turn index (includes slash), aligns with frontend turnUsages.
    pub turn_index: u32,
}

pub struct UserTurnTicket {
    pub ticket_seq: u64,
    pub text: String,
    pub attachments: Vec<AttachmentData>,
    pub kind: UserTurnKind,
    pub turn_index: u32,
    /// v1.0.9: optional client-side idempotency token. Used for dedup and
    /// diagnostic breadcrumbs only — never emitted in user-visible content.
    pub client_message_id: Option<String>,
}

// ── Default timeouts ──
// Re-exported from `super::constants` for backward compatibility.
// New code should import from `crate::agent::constants` directly.

pub use super::constants::{
    ACCEPTED_CLIENT_MESSAGE_IDS_CAP, PROTOCOL_DESYNC_THRESHOLD, PROTOCOL_DESYNC_WINDOW_SECS,
    QUARANTINE_DEADLINE, QUEUED_USER_CAP, STOP_ESCALATION_KILL, TICK_INTERVAL, USER_HARD_TIMEOUT,
    USER_SOFT_TIMEOUT,
};

// ── Accepted client_message_id ledger helpers ──
// Pure functions shared between the session actor and the runtime recovery
// registry. Kept here (next to the cap constant) so the actor and recovery
// module can both depend on this leaf-level helper without forming an
// import cycle.

/// Insert a `client_message_id` into the accepted ledger with FIFO eviction
/// at `cap`. Idempotent: re-inserting an id that already exists is a no-op
/// so a recovered retry cannot leak duplicates.
pub fn record_accepted_client_message_id(ledger: &mut VecDeque<String>, cid: String, cap: usize) {
    if ledger.iter().any(|s| s == &cid) {
        return;
    }
    if ledger.len() >= cap {
        if let Some(evicted) = ledger.pop_front() {
            log::debug!(
                "[turn] accepted ledger at cap={}, evicting oldest id (prefix={})",
                cap,
                evicted.chars().take(8).collect::<String>()
            );
        }
    }
    ledger.push_back(cid);
}

/// Predicate used by `handle_send_message` to dedupe a retry whose id has
/// already been recorded as accepted.
pub fn is_accepted(ledger: &VecDeque<String>, cid: &str) -> bool {
    ledger.iter().any(|s| s == cid)
}

// ── Activity-based deadline reset ──

/// Activity-based deadline reset on CLI stdout. Called from handle_stdout_line.
///
/// Rules:
/// - quarantine → skip (turn is already None; quarantine has its own 10s deadline)
/// - internal turn → skip (Draining phase depends on fixed deadline)
/// - user/ralph turn → extend hard_deadline to now + USER_HARD_TIMEOUT
///
/// Returns true if hard_deadline was extended.
pub fn apply_activity_reset(quarantine: bool, active_turn: &mut Option<ActiveTurn>) -> bool {
    if quarantine {
        return false;
    }
    let Some(turn) = active_turn.as_mut() else {
        return false;
    };
    turn.hard_deadline = Instant::now() + USER_HARD_TIMEOUT;
    true
}

// ── Unit tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    // ── Activity reset tests ──

    fn make_turn(origin: TurnOrigin) -> ActiveTurn {
        let now = Instant::now();
        ActiveTurn {
            turn_seq: 1,
            origin,
            phase: TurnPhase::Active,
            started_at: now,
            soft_deadline: now + USER_SOFT_TIMEOUT,
            hard_deadline: now + Duration::from_secs(10), // short, so we can assert change
            turn_index: 0,
        }
    }

    #[test]
    fn activity_reset_user_turn_extends_deadline() {
        let mut turn = Some(make_turn(TurnOrigin::User(UserTurnKind::Normal)));
        let before = turn.as_ref().unwrap().hard_deadline;
        assert!(apply_activity_reset(false, &mut turn));
        assert!(turn.as_ref().unwrap().hard_deadline > before);
    }

    #[test]
    fn activity_reset_ralph_turn_extends_deadline() {
        let mut turn = Some(make_turn(TurnOrigin::Ralph));
        let before = turn.as_ref().unwrap().hard_deadline;
        assert!(apply_activity_reset(false, &mut turn));
        assert!(turn.as_ref().unwrap().hard_deadline > before);
    }

    #[test]
    fn activity_reset_quarantine_skips() {
        let mut turn = Some(make_turn(TurnOrigin::User(UserTurnKind::Normal)));
        let before = turn.as_ref().unwrap().hard_deadline;
        assert!(!apply_activity_reset(true, &mut turn));
        assert_eq!(turn.as_ref().unwrap().hard_deadline, before);
    }

    #[test]
    fn activity_reset_no_turn_returns_false() {
        let mut turn: Option<ActiveTurn> = None;
        assert!(!apply_activity_reset(false, &mut turn));
    }
}
