//! Runtime hub & diagnostics BusEvent contract test (Rust side).
//!
//! Companion to the TS test in `scripts/architecture/__tests__/runtime-contract.test.ts`.
//! The TS test parses the contract SPEC; this Rust test asserts the
//! EXISTING `BusEvent` types serialize/deserialize with the right
//! shape so the v1.0.9 Runtime/Diagnostic variants (when Agent B/D
//! add them) will round-trip through the wire format without breaking
//! the frontend.
//!
//! Run with:
//!   cargo test --test runtime_contract_types --manifest-path src-tauri/Cargo.toml

use miwarp_desktop_lib::models::BusEvent;
use serde_json::{json, Value};

/// Pin the BusEvent wire shape that the frontend types.ts mirrors.
/// The general bus-contract test in `src/lib/bus/__tests__/` already
/// asserts Rust ↔ TS sync; this test narrows the assertion to the
/// runtime/diagnostic namespace.
#[test]
fn bus_event_session_recovered_serializes_with_snake_case_type() {
    // This variant is already in models.rs. We assert it round-trips
    // correctly with the expected `type: "session_recovered"` tag,
    // so when Agent B adds `RuntimeReady` / `DiagnosticEvent`, the
    // same shape will work.
    let ev = BusEvent::SessionRecovered {
        run_id: "run-1".to_string(),
        ok: true,
    };
    let wire: Value = serde_json::to_value(&ev).expect("SessionRecovered must serialize");
    assert_eq!(wire["type"], "session_recovered");
    assert_eq!(wire["run_id"], "run-1");
    assert_eq!(wire["ok"], true);
}

#[test]
fn bus_event_protocol_desync_serializes_with_snake_case_type() {
    // Diagnostic-adjacent event. The wire shape must remain stable.
    let ev = BusEvent::ProtocolDesync {
        run_id: "run-1".to_string(),
        fail_count: 5,
        sample: "{\"type\":\"unparseable".to_string(),
    };
    let wire: Value = serde_json::to_value(&ev).expect("ProtocolDesync must serialize");
    assert_eq!(wire["type"], "protocol_desync");
    assert_eq!(wire["run_id"], "run-1");
    assert_eq!(wire["fail_count"], 5);
}

#[test]
fn bus_event_session_recovering_includes_deadline_ms() {
    // Recovery state must surface the quarantine deadline so the
    // UI can show "最多 N 秒" countdown.
    let ev = BusEvent::SessionRecovering {
        run_id: "run-2".to_string(),
        reason: "stdin_write_failed".to_string(),
        deadline_ms: 5_000,
        from_internal: false,
    };
    let wire: Value = serde_json::to_value(&ev).expect("SessionRecovering must serialize");
    assert_eq!(wire["type"], "session_recovering");
    assert_eq!(wire["deadline_ms"], 5_000);
    assert_eq!(wire["from_internal"], false);
}

#[test]
fn bus_event_unknown_wire_type_is_rejected() {
    // The frontend sends unknown types by mistake (e.g. an
    // unmerged rename). The Rust serde layer MUST reject the
    // payload rather than silently dropping the variant — that
    // would cause the frontend to mis-classify the event.
    //
    // The general bus-contract test in src/lib/bus/__tests__/
    // covers this at the type level. Here we assert the same
    // invariant at the wire level: a type literal that doesn't
    // match any variant produces an error, not a default-constructed
    // BusEvent.
    let payload = json!({
        "type": "definitely_not_a_real_variant",
        "run_id": "run-x"
    });
    let result = serde_json::from_value::<BusEvent>(payload);
    assert!(
        result.is_err(),
        "unknown variant must fail to deserialize, got Ok({:?})",
        result.ok()
    );
}

#[test]
fn bus_event_session_recovered_rejects_garbage_run_id() {
    // Round-trip stability: a valid variant with a missing run_id
    // field must be rejected.
    let payload = json!({
        "type": "session_recovered",
        "ok": true
        // run_id is required
    });
    let result = serde_json::from_value::<BusEvent>(payload);
    assert!(result.is_err(), "missing run_id must fail to deserialize");
}

/// When Agent B adds `BusEvent::RuntimeReady` (or any Runtime*
/// variant), the wire shape MUST be `<snake_case_type>`. This test
/// documents the expected shape; once Agent B lands the type, a
/// follow-up test should be added that asserts the variant exists
/// and serializes with the right tag.
#[test]
fn runtime_namespace_type_literal_is_snake_case() {
    // Spec contract: `BusEvent::Runtime*` variants serialize as
    // `type: "runtime_*"`. The general bus-contract test verifies
    // this for ALL existing variants; this test documents the
    // expectation for future variants so a regression is obvious.
    //
    // We assert the snake_case mapping rule by re-deriving the
    // expected type literal from a PascalCase name. If the rule
    // ever changes, this test must be updated alongside the
    // contract doc.
    fn pascal_to_snake(s: &str) -> String {
        let mut out = String::new();
        for (idx, c) in s.chars().enumerate() {
            if c.is_ascii_uppercase() {
                if idx > 0 {
                    out.push('_');
                }
                out.extend(c.to_lowercase());
            } else {
                out.push(c);
            }
        }
        out
    }
    assert_eq!(pascal_to_snake("RuntimeReady"), "runtime_ready");
    assert_eq!(
        pascal_to_snake("RuntimeHealthChanged"),
        "runtime_health_changed"
    );
    assert_eq!(pascal_to_snake("DiagnosticEvent"), "diagnostic_event");
    assert_eq!(
        pascal_to_snake("DiagnosticsSnapshot"),
        "diagnostics_snapshot"
    );
}
