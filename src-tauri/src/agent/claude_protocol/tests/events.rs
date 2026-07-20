use super::super::*;
use crate::models::BusEvent;
use serde_json::{json, Value};

const RUN: &str = "run-test";

// ══════════════════════════════════════════════════════════════════
//  Phase 2 + Group D: Validation and strict mode tests
// ══════════════════════════════════════════════════════════════════

#[test]
fn test_validate_never_drops_run_state() {
    // RunState must ALWAYS pass through validate, even with empty state.
    // Quarantine/turn state machine depends on these events.
    let ev = BusEvent::RunState {
        run_id: "r1".to_string(),
        state: "".to_string(),
        exit_code: None,
        error: None,
    };
    assert!(
        validate_bus_event(&ev).is_none(),
        "validate must NEVER drop RunState (even with empty state)"
    );

    // Normal states too
    for state in &["idle", "running", "failed", "completed"] {
        let ev = BusEvent::RunState {
            run_id: "r1".to_string(),
            state: state.to_string(),
            exit_code: None,
            error: None,
        };
        assert!(
            validate_bus_event(&ev).is_none(),
            "RunState({}) must pass",
            state
        );
    }
}

#[test]
fn test_validate_drops_empty_tool_id() {
    // ToolStart with empty id should be flagged as invalid
    let ev = BusEvent::ToolStart {
        run_id: "r1".to_string(),
        tool_use_id: "".to_string(),
        tool_name: "Bash".to_string(),
        input: Value::Null,
        parent_tool_use_id: None,
    };
    let warn = validate_bus_event(&ev);
    assert!(
        warn.is_some(),
        "empty tool_use_id in ToolStart should be invalid"
    );
    assert_eq!(warn.unwrap().field, "tool_use_id");

    // ToolEnd with empty id
    let ev = BusEvent::ToolEnd {
        run_id: "r1".to_string(),
        tool_use_id: "".to_string(),
        tool_name: "Bash".to_string(),
        output: Value::Null,
        status: "success".to_string(),
        duration_ms: None,
        parent_tool_use_id: None,
        tool_use_result: None,
    };
    assert!(
        validate_bus_event(&ev).is_some(),
        "empty tool_use_id in ToolEnd should be invalid"
    );

    // Valid tool passes
    let ev = BusEvent::ToolStart {
        run_id: "r1".to_string(),
        tool_use_id: "tu-1".to_string(),
        tool_name: "Bash".to_string(),
        input: Value::Null,
        parent_tool_use_id: None,
    };
    assert!(
        validate_bus_event(&ev).is_none(),
        "valid ToolStart should pass"
    );
}

#[test]
fn test_unknown_system_subtype_emits_raw() {
    // Phase 2: system unknown subtype now emits Raw + increments unknown_event_count
    let mut ps = ProtocolState::new(false);
    let raw = json!({"type": "system", "subtype": "brand_new"});
    let events = ps.map_event(RUN, &raw);
    assert_eq!(events.len(), 1);
    match &events[0] {
        BusEvent::Raw { source, .. } => {
            assert_eq!(source, "claude_system_brand_new");
        }
        other => panic!("expected Raw, got {:?}", other),
    }
    assert_eq!(
        ps.stats.unknown_event_count, 1,
        "unknown system subtype increments counter"
    );
}

#[test]
fn test_strict_standard_session() {
    // A complete session_init → tool → result sequence through strict parser.
    // validate_strict panics if any emitted event has invalid fields.
    let mut ps = ProtocolState::new_strict(false);

    // 1. system/init
    let events = ps.map_event(
        RUN,
        &json!({
            "type": "system", "subtype": "init",
            "model": "opus-4", "tools": [{"name": "Bash"}], "cwd": "/test"
        }),
    );
    assert!(!events.is_empty());
    for ev in &events {
        validate_strict(ev);
    }

    // 2. content_block_start (tool_use)
    let events = ps.map_event(
        RUN,
        &json!({
            "type": "content_block_start",
            "content_block": { "type": "tool_use", "id": "tu-1", "name": "Read" }
        }),
    );
    for ev in &events {
        validate_strict(ev);
    }

    // 3. content_block_delta (input_json)
    let events = ps.map_event(
        RUN,
        &json!({
            "type": "content_block_delta",
            "delta": { "type": "input_json_delta", "partial_json": "{\"path\":\"/a\"}" }
        }),
    );
    for ev in &events {
        validate_strict(ev);
    }

    // 4. assistant (message_complete + tool dedup)
    let events = ps.map_event(
        RUN,
        &json!({
            "type": "assistant",
            "message": {
                "id": "msg-1",
                "content": [
                    { "type": "text", "text": "Let me read." },
                    { "type": "tool_use", "id": "tu-1", "name": "Read",
                      "input": { "path": "/a" } }
                ]
            }
        }),
    );
    for ev in &events {
        validate_strict(ev);
    }

    // 5. user (tool_result)
    let events = ps.map_event(
        RUN,
        &json!({
            "type": "user",
            "message": {
                "content": [
                    { "type": "tool_result", "tool_use_id": "tu-1",
                      "content": "file contents" }
                ]
            }
        }),
    );
    for ev in &events {
        validate_strict(ev);
    }

    // 6. result (success)
    let events = ps.map_event(
        RUN,
        &json!({
            "type": "result", "subtype": "success",
            "cost_usd": 0.01, "duration_ms": 1000,
            "usage": { "input_tokens": 100, "output_tokens": 20 }
        }),
    );
    for ev in &events {
        validate_strict(ev);
    }

    // Post-conditions: strict session has 0 unknown/invalid/dropped
    assert_eq!(ps.stats.unknown_event_count, 0);
    assert_eq!(ps.stats.invalid_tool_count, 0);
    assert_eq!(ps.stats.dropped_count, 0);
}

#[test]
fn test_strict_resume_session() {
    // Resume session — init emits SessionInit only (session_actor emits synthetic idle)
    let mut ps = ProtocolState::new_strict(true);
    let events = ps.map_event(
        RUN,
        &json!({
            "type": "system", "subtype": "init",
            "model": "opus-4", "tools": [], "cwd": "/",
            "session_id": "sess-resume"
        }),
    );
    assert_eq!(events.len(), 1, "resume: SessionInit only");
    for ev in &events {
        validate_strict(ev);
    }
    assert!(matches!(&events[0], BusEvent::SessionInit { .. }));
    assert_eq!(ps.stats.unknown_event_count, 0);
}

#[test]
fn test_strict_tool_progress_and_summary() {
    // tool_progress and tool_use_summary with valid ids pass strict
    let mut ps = ProtocolState::new_strict(false);
    let events = ps.map_event(
        RUN,
        &json!({
            "type": "tool_progress",
            "tool_use_id": "tu-1",
            "elapsed_time_seconds": 1.5
        }),
    );
    assert_eq!(events.len(), 1);
    for ev in &events {
        validate_strict(ev);
    }

    let events = ps.map_event(
        RUN,
        &json!({
            "type": "tool_use_summary",
            "tool_use_id": "tu-1",
            "summary": "Done"
        }),
    );
    assert_eq!(events.len(), 1);
    for ev in &events {
        validate_strict(ev);
    }
    assert_eq!(ps.stats.invalid_tool_count, 0);
}

#[test]
fn thinking_delta_inside_stream_event() {
    let mut ps = ProtocolState::new(false);
    let raw = json!({
        "type": "stream_event",
        "event": {
            "type": "content_block_delta",
            "index": 0,
            "delta": { "type": "thinking_delta", "thinking": "Let me think..." }
        }
    });
    let events = ps.map_event(RUN, &raw);
    assert_eq!(events.len(), 1);
    assert!(
        matches!(&events[0], BusEvent::ThinkingDelta { text, .. } if text == "Let me think...")
    );
}

#[test]
fn message_delta_inside_stream_event() {
    let mut ps = ProtocolState::new(false);
    let raw = json!({
        "type": "stream_event",
        "event": {
            "type": "content_block_delta",
            "index": 0,
            "delta": { "type": "text_delta", "text": "Hello" }
        }
    });
    let events = ps.map_event(RUN, &raw);
    assert_eq!(events.len(), 1);
    assert!(matches!(&events[0], BusEvent::MessageDelta { text, .. } if text == "Hello"));
}

#[test]
fn message_delta_metadata_is_classified_without_raw_fallback() {
    let mut ps = ProtocolState::new_strict(false);
    let raw = json!({
        "type": "stream_event",
        "event": {
            "type": "message_delta",
            "delta": { "stop_reason": "end_turn" },
            "usage": { "input_tokens": 128, "output_tokens": 42 }
        }
    });

    let events = ps.map_event(RUN, &raw);

    assert!(events.is_empty());
    assert_eq!(ps.stats.unknown_event_count, 0);
}

#[test]
fn thinking_token_estimates_are_classified_without_raw_fallback() {
    let mut ps = ProtocolState::new_strict(false);
    let raw = json!({
        "type": "system",
        "subtype": "thinking_tokens",
        "estimated_tokens": 85,
        "estimated_tokens_delta": 5
    });

    let events = ps.map_event(RUN, &raw);

    assert!(events.is_empty());
    assert_eq!(ps.stats.unknown_event_count, 0);
}

#[test]
fn stream_event_preserves_parent_tool_use_id() {
    let mut ps = ProtocolState::new(false);
    let raw = json!({
        "type": "stream_event",
        "event": {
            "type": "content_block_delta",
            "index": 0,
            "delta": { "type": "text_delta", "text": "sub" },
            "parent_tool_use_id": "tu-parent"
        }
    });
    let events = ps.map_event(RUN, &raw);
    assert_eq!(events.len(), 1);
    match &events[0] {
        BusEvent::MessageDelta {
            parent_tool_use_id, ..
        } => {
            assert_eq!(parent_tool_use_id.as_deref(), Some("tu-parent"));
        }
        other => panic!("expected MessageDelta, got {:?}", other),
    }
}

#[test]
fn malformed_stream_event_falls_to_raw() {
    let mut ps = ProtocolState::new(false);
    let raw = json!({
        "type": "stream_event",
        "event": { "no_type_field": true }
    });
    let events = ps.map_event(RUN, &raw);
    // The outer stream_event has no matching branch → falls to Raw
    // (the malformed inner doesn't unwrap, so outer type "stream_event" is unknown)
    assert_eq!(events.len(), 1);
    assert!(matches!(&events[0], BusEvent::Raw { .. }));
}
