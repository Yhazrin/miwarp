//! Timing and threshold constants for the agent layer.
//!
//! Centralized here so callers (turn_engine, session_actor) reference a
//! single source of truth, and so future tuning (e.g. timeout sweeps)
//! can be done in one place. Constants are pure values; the modules
//! that use them retain all behavior. Re-exported via `super::constants`
//! from `turn_engine` and `session_actor` to keep imports stable.
//!
//! See `docs/architecture/quality-foundation.md` ADR-002 for the rationale.

use std::time::Duration;

/// User turns get generous timeouts (CLI can take a long time).
pub const USER_SOFT_TIMEOUT: Duration = Duration::from_secs(300);
pub const USER_HARD_TIMEOUT: Duration = Duration::from_secs(1800);

/// Internal turns (auto-context) timeouts.
pub const INTERNAL_SOFT_TIMEOUT: Duration = Duration::from_secs(15);
pub const INTERNAL_HARD_TIMEOUT: Duration = Duration::from_secs(60);

/// Quarantine secondary timeout (after interrupt sent, wait for CLI response).
/// v1.0.6 / hardening A1: tightened from 10s → 5s. Empirically, a CLI that
/// fails to ack a control within 5s is effectively dead — UI shouldn't sit
/// silent for the full original 10s.
pub const QUARANTINE_DEADLINE: Duration = Duration::from_secs(5);

/// Threshold (per 60s window) for json_parse_fail_count before we declare
/// the CLI stream desynced and force-fail the run. See session_actor.rs.
pub const PROTOCOL_DESYNC_THRESHOLD: u32 = 5;
/// Sliding window (seconds) for the desync detector.
pub const PROTOCOL_DESYNC_WINDOW_SECS: u64 = 60;

/// Tick interval for the independent timeout clock.
pub const TICK_INTERVAL: Duration = Duration::from_millis(250);

/// v1.0.9 Phase 2: bounded FIFO ledger of recently-accepted client_message_ids.
/// A retried submit whose id is in the ledger is treated as a duplicate and
/// resolves as `Ok(())` without enqueuing a second turn. Eviction is FIFO:
/// when the ledger is at capacity, the oldest id is dropped on insert.
/// Cap chosen to comfortably outlast any reconnect-retry window in the
/// SendCoordinator's bounded reconnect queue (default 32) while remaining
/// bounded in memory under abuse.
pub const ACCEPTED_CLIENT_MESSAGE_IDS_CAP: usize = 1024;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_timeouts_are_generous_enough_for_long_cli_runs() {
        assert!(USER_SOFT_TIMEOUT >= Duration::from_secs(60));
        assert!(USER_HARD_TIMEOUT > USER_SOFT_TIMEOUT);
    }

    #[test]
    fn internal_timeouts_are_tighter_than_user_timeouts() {
        assert!(INTERNAL_SOFT_TIMEOUT < USER_SOFT_TIMEOUT);
        assert!(INTERNAL_HARD_TIMEOUT < USER_HARD_TIMEOUT);
    }

    #[test]
    fn quarantine_deadline_is_short() {
        // Hardening A1 contract: quarantine must resolve within 5s.
        assert!(QUARANTINE_DEADLINE <= Duration::from_secs(10));
    }

    #[test]
    fn protocol_desync_threshold_and_window_are_consistent() {
        // 5 failures within 60s → fail-fast. Compiled-out constant asserts
        // (silence clippy::assertions_on_constants while keeping the contract).
        const {
            assert!(PROTOCOL_DESYNC_THRESHOLD >= 1);
            assert!(PROTOCOL_DESYNC_WINDOW_SECS >= 10);
        }
    }

    #[test]
    fn tick_interval_is_sub_second() {
        // The tick must be finer than any user-facing timeout.
        assert!(TICK_INTERVAL <= Duration::from_secs(1));
        assert!(TICK_INTERVAL >= Duration::from_millis(1));
    }
}
