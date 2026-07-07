//! Turn Transaction Engine — types, extractors, and gate functions.
//!
//! Every stdin write belongs to an explicit turn (User or Internal).
//! The engine provides the data model, the `InternalExtractor` trait for
//! pluggable extraction during internal turns, and pure gate functions
//! for auto-context dedup.

use crate::models::BusEvent;
use std::collections::VecDeque;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

use super::attachment::AttachmentData;

// ── Turn types ──

#[derive(Debug, Clone, PartialEq)]
pub enum TurnOrigin {
    User(UserTurnKind),
    Internal(InternalJobKind),
    /// Ralph loop auto-resend turn. Does not trigger auto-context.
    Ralph,
}

#[derive(Debug, Clone, PartialEq)]
pub enum UserTurnKind {
    /// Normal message — triggers auto-context. auto_ctx_id is fixed at allocation time.
    Normal { auto_ctx_id: u32 },
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

pub struct InternalJob {
    pub job_seq: u64,
    pub kind: InternalJobKind,
    pub for_auto_ctx_id: u32,
    pub for_turn_index: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum InternalJobKind {
    AutoContext,
}

// ── Internal extractor trait ──

pub trait InternalExtractor: Send {
    fn on_event(&mut self, event: &BusEvent);
    fn finalize(&mut self, timed_out: bool);
}

/// Extracts context data from /context command output during internal turns.
pub struct ContextExtractor {
    pub app: AppHandle,
    pub run_id: String,
    pub for_turn_index: u32,
    pub captured: bool,
}

impl InternalExtractor for ContextExtractor {
    fn on_event(&mut self, event: &BusEvent) {
        match event {
            BusEvent::CommandOutput { content, .. } => {
                log::debug!(
                    "[autoctx] captured source=command_output turn_index={}",
                    self.for_turn_index
                );
                self.emit_context_snapshot(content);
                self.captured = true;
            }
            BusEvent::MessageComplete { text, .. } if !text.is_empty() && !self.captured => {
                log::debug!(
                    "[autoctx] captured source=message_complete turn_index={}",
                    self.for_turn_index
                );
                self.emit_context_snapshot(text);
                self.captured = true;
            }
            _ => {}
        }
    }

    fn finalize(&mut self, timed_out: bool) {
        if timed_out && !self.captured {
            log::warn!(
                "[autoctx] timed out without data for turn_index={}",
                self.for_turn_index
            );
        }
    }
}

impl ContextExtractor {
    fn emit_context_snapshot(&self, content: &str) {
        let _ = self.app.emit(
            "context-snapshot",
            serde_json::json!({
                "runId": self.run_id,
                "content": content,
                "turnIndex": self.for_turn_index,
                "ts": chrono::Utc::now().to_rfc3339(),
            }),
        );
    }
}

// ── Gate functions ──

/// Check if auto-context should trigger for this auto_ctx_id (dedup).
pub fn should_trigger_auto_context(auto_ctx_id: u32, last: Option<u32>) -> bool {
    last != Some(auto_ctx_id)
}

// ── Default timeouts ──
// Re-exported from `super::constants` for backward compatibility.
// New code should import from `crate::agent::constants` directly.

pub use super::constants::{
    ACCEPTED_CLIENT_MESSAGE_IDS_CAP, INTERNAL_HARD_TIMEOUT, INTERNAL_SOFT_TIMEOUT,
    PROTOCOL_DESYNC_THRESHOLD, PROTOCOL_DESYNC_WINDOW_SECS, QUARANTINE_DEADLINE, TICK_INTERVAL,
    USER_HARD_TIMEOUT, USER_SOFT_TIMEOUT,
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
    if matches!(turn.origin, TurnOrigin::Internal(_)) {
        return false;
    }
    turn.hard_deadline = Instant::now() + USER_HARD_TIMEOUT;
    true
}

// ── Unit tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn auto_ctx_skip_duplicate() {
        assert!(!should_trigger_auto_context(1, Some(1)));
    }

    #[test]
    fn auto_ctx_trigger_new() {
        assert!(should_trigger_auto_context(1, None));
    }

    #[test]
    fn auto_ctx_trigger_next() {
        assert!(should_trigger_auto_context(2, Some(1)));
    }

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
        let mut turn = Some(make_turn(TurnOrigin::User(UserTurnKind::Normal {
            auto_ctx_id: 1,
        })));
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
    fn activity_reset_internal_turn_unchanged() {
        let mut turn = Some(make_turn(TurnOrigin::Internal(
            InternalJobKind::AutoContext,
        )));
        let before = turn.as_ref().unwrap().hard_deadline;
        assert!(!apply_activity_reset(false, &mut turn));
        assert_eq!(turn.as_ref().unwrap().hard_deadline, before);
    }

    #[test]
    fn activity_reset_quarantine_skips() {
        let mut turn = Some(make_turn(TurnOrigin::User(UserTurnKind::Normal {
            auto_ctx_id: 1,
        })));
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
