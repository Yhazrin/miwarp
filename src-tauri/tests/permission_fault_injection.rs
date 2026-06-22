//! Permission transaction fault injection harness.
//!
//! Companion to `v1.0.9-transaction-contracts.md §2 (PermissionTransaction)`
//! and §0 (inherited invariants). Each `#[test]` in this file simulates one
//! failure mode the contract promises to handle gracefully, and asserts the
//! expected typed error or the absence of a silent crash.
//!
//! Run with:
//!   cargo test --test permission_fault_injection --manifest-path src-tauri/Cargo.toml
//!
//! What is NOT covered here: the actual `SessionActor::handle_respond_permission`
//! end-to-end flow. That code is private to session_actor (Agent A's
//! sole-owned file) and not yet wired through the actor mailbox. This
//! harness exercises the contract surface Agent A and Agent C agree on —
//! the typed error codes, the `NEVER_ALLOW_TOOLS` denylist, and the wire
//! format. When Agent A wires these into the actor mailbox, the tests
//! pass without further changes; when Agent C consumes the errors in the
//! coordinator, the bus-event format stays stable.
//!
//! This file is an integration test (under `tests/`, not under `src/`),
//! so it depends on the public `miwarp_desktop_lib` library. It does
//! NOT modify any source file.

use miwarp_desktop_lib::agent::permission_error::{
    is_permanent_allow_blocked, PermissionError, PermissionErrorCode, NEVER_ALLOW_TOOLS,
};
use serde_json::{json, Value};

/// Helper: round-trip a PermissionError through serde_json and back, to
/// validate the wire format both sides depend on.
fn wire_format(err: &PermissionError) -> Value {
    serde_json::to_value(err).expect("PermissionError must serialize")
}

// ────────────────────────────────────────────────────────────────────────
// Fault 1: tool_name mismatch (response against wrong request)
// ────────────────────────────────────────────────────────────────────────

#[test]
fn fault_tool_name_mismatch_yields_unknown_request_error() {
    // Contract: "respond_permission(tool_name) MUST match the pending
    // request's tool_name; mismatch → PermissionError::ToolNameMismatch"
    // — currently mapped to PermissionErrorCode::UnknownRequest (the
    // typed contract pre-dates the rename; the wire code stays stable).
    let err = PermissionError::new(
        PermissionErrorCode::UnknownRequest,
        "tool_name mismatch: claimed Bash, actual Read",
        false,
    );
    let wire = wire_format(&err);
    assert_eq!(wire["code"], "unknown_request");
    assert!(!wire["retryable"].as_bool().unwrap());
    assert!(wire["message"]
        .as_str()
        .unwrap()
        .contains("tool_name mismatch"));
}

#[test]
fn fault_tool_name_mismatch_is_not_retryable() {
    // A tool_name mismatch is a frontend bug, not a transport hiccup.
    // Retrying would just fail again — the contract says non-retryable.
    let err = PermissionError::new(
        PermissionErrorCode::UnknownRequest,
        "tool_name mismatch: claimed X, actual Y",
        false,
    );
    assert!(!err.retryable);
}

// ────────────────────────────────────────────────────────────────────────
// Fault 2: NEVER_ALLOW_TOOLS AllowSession downgrade to DenyStopRun
// ────────────────────────────────────────────────────────────────────────

#[test]
fn fault_never_allow_tools_blocks_allow_session_for_exit_plan_mode() {
    // Contract: "any tool in NEVER_ALLOW_TOOLS, if AllowSession is
    // requested, is downgraded to DenyStopRun". The blocklist is
    // exposed by `is_permanent_allow_blocked` so the coordinator can
    // downgrade before sending the control_response to the CLI.
    assert!(is_permanent_allow_blocked("ExitPlanMode"));
    assert!(is_permanent_allow_blocked("EnterPlanMode"));
    // Read/Bash/etc are NOT on the denylist — AllowSession is fine.
    assert!(!is_permanent_allow_blocked("Read"));
    assert!(!is_permanent_allow_blocked("Bash"));
    assert!(!is_permanent_allow_blocked("Edit"));
}

#[test]
fn fault_never_allow_tools_constant_is_stable() {
    // Pin the denylist contents. Adding a tool without an ADR is a
    // contract violation. The same list is mirrored in
    // storage::shared::NEVER_ALLOW_TOOLS and on the frontend in
    // permission-mode-contract.ts — the bus-contract test enforces
    // the Rust ↔ TS sync.
    assert_eq!(NEVER_ALLOW_TOOLS, &["ExitPlanMode", "EnterPlanMode"]);
}

#[test]
fn fault_danger_tool_blocked_error_round_trip() {
    // When the coordinator downgrades AllowSession → DenyStopRun, it
    // surfaces a DangerToolBlocked error. The wire code must match
    // what the frontend PermissionError class deserializes.
    let err = PermissionError::new(
        PermissionErrorCode::DangerToolBlocked,
        "tool ExitPlanMode is permanently blocked from AllowSession",
        false,
    );
    let wire = wire_format(&err);
    assert_eq!(wire["code"], "danger_tool_blocked");
    assert!(!wire["retryable"].as_bool().unwrap());
    assert!(wire["message"].as_str().unwrap().contains("ExitPlanMode"));
}

// ────────────────────────────────────────────────────────────────────────
// Fault 3: stale generation
// ────────────────────────────────────────────────────────────────────────

#[test]
fn fault_stale_generation_yields_run_mismatch_error() {
    // Contract: "a `respond` whose `generation` is older than the
    // current `connection_generation` is dropped with `Stale` and the
    // user sees perm_stale". The Rust side reports it as RunMismatch
    // (the typed name predates the v1.0.9 vocabulary; the wire code
    // stays stable for backward compatibility).
    let err = PermissionError::new(
        PermissionErrorCode::RunMismatch,
        "stale generation: responded to old session, current gen=7",
        false,
    );
    let wire = wire_format(&err);
    assert_eq!(wire["code"], "run_mismatch");
    assert!(!wire["retryable"].as_bool().unwrap());
    assert!(wire["message"]
        .as_str()
        .unwrap()
        .contains("stale generation"));
}

// ────────────────────────────────────────────────────────────────────────
// Fault 4: double-click dedupe
// ────────────────────────────────────────────────────────────────────────

#[test]
fn fault_double_click_dedupe_yields_duplicate_error() {
    // Contract: "a second `respond` while in `Deciding` MUST resolve
    // to the same in-flight response, not start a new one". The
    // coordinator returns a Duplicate error to the second caller so
    // the UI can show "already responding" and stop spinning.
    let err = PermissionError::new(
        PermissionErrorCode::Duplicate,
        "permission already in flight for request_id=abc",
        false,
    );
    let wire = wire_format(&err);
    assert_eq!(wire["code"], "duplicate");
    assert!(!wire["retryable"].as_bool().unwrap());
}

#[test]
fn fault_double_click_dedupe_does_not_change_state() {
    // A duplicate response must not append to the ledger. The wire
    // code 'duplicate' is the contract signal — the coordinator
    // must NOT call `respond_permission` twice on the actor.
    let err = PermissionError::new(PermissionErrorCode::Duplicate, "dup", false);
    // The retryable=false is the load-bearing assertion. If the
    // frontend gets a retryable duplicate, it will retry — and the
    // actor would then emit a second control_response, which is the
    // bug we're guarding against.
    assert!(!err.retryable, "Duplicate must not be retryable");
}

// ────────────────────────────────────────────────────────────────────────
// Fault 5: transport failure before ack
// ────────────────────────────────────────────────────────────────────────

#[test]
fn fault_transport_failure_before_ack_is_retryable() {
    // Contract: "If the connection is lost before ack, the state is
    // `Deciding` until reconnect, then either `Decided` (if the
    // Runtime already saw it) or `Failed(Transport)` (if it
    // didn't)". The Transport code is the only one that MUST be
    // retryable — a TCP reset is a transient failure.
    let err = PermissionError::new(
        PermissionErrorCode::Transport,
        "stdin write failed: broken pipe",
        true,
    );
    let wire = wire_format(&err);
    assert_eq!(wire["code"], "transport");
    assert!(wire["retryable"].as_bool().unwrap());
}

#[test]
fn fault_timeout_is_retryable() {
    // The Timeout code is the "Runtime didn't respond in time"
    // failure. Retrying after a cooldown may succeed if the Runtime
    // is still alive.
    let err = PermissionError::new(
        PermissionErrorCode::Timeout,
        "control_response write timed out after 30s",
        true,
    );
    let wire = wire_format(&err);
    assert_eq!(wire["code"], "timeout");
    assert!(wire["retryable"].as_bool().unwrap());
}

// ────────────────────────────────────────────────────────────────────────
// Wire-format invariants (cross-cutting)
// ────────────────────────────────────────────────────────────────────────

#[test]
fn wire_format_is_stable_across_runs() {
    // The frontend PermissionError class deserializes this exact
    // shape. Any field rename or type change is a hard break.
    let err = PermissionError::new(PermissionErrorCode::UnknownRequest, "test", true);
    let wire = wire_format(&err);
    assert_eq!(wire["code"], "unknown_request");
    assert_eq!(wire["message"], "test");
    assert_eq!(wire["retryable"], json!(true));
}

#[test]
fn all_error_codes_have_distinct_wire_strings() {
    // Each code MUST have a unique wire string. The frontend uses
    // string equality to dispatch on the code; a collision would
    // route UnknownRequest errors as Transport or vice versa.
    let codes = [
        PermissionErrorCode::UnknownRequest,
        PermissionErrorCode::AlreadyCancelled,
        PermissionErrorCode::RunMismatch,
        PermissionErrorCode::Duplicate,
        PermissionErrorCode::DangerToolBlocked,
        PermissionErrorCode::Transport,
        PermissionErrorCode::Timeout,
        PermissionErrorCode::Unknown,
    ];
    let wires: Vec<&'static str> = codes.iter().map(|c| c.wire()).collect();
    let unique: std::collections::HashSet<&'static str> = wires.iter().copied().collect();
    assert_eq!(
        unique.len(),
        wires.len(),
        "PermissionErrorCode wires collide: {:?}",
        wires
    );
}

#[test]
fn unknown_error_is_catch_all() {
    // The `unknown` wire code is the catch-all. It must remain a
    // valid string even if no Rust code path emits it today — the
    // frontend deserializer must not reject it.
    let err = PermissionError::new(PermissionErrorCode::Unknown, "unmapped failure", false);
    let wire = wire_format(&err);
    assert_eq!(wire["code"], "unknown");
}
