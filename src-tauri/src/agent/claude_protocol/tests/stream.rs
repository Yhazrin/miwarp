use super::super::*;
use crate::models::BusEvent;
use serde_json::{json, Value};

const RUN: &str = "run-test";

// ══════════════════════════════════════════════════════════════════
//  Group A + Group B: Stream/content event tests
// ══════════════════════════════════════════════════════════════════

#[test]
fn test_content_block_start_tool() {
    let mut ps = ProtocolState::new(false);
    let raw = json!({
        "type": "content_block_start",
        "content_block": {"type": "tool_use", "id": "tu-1", "name": "Bash"}
    });
    let events = ps.map_event(RUN, &raw);
    assert_eq!(events.len(), 1);
    match &events[0] {
        BusEvent::ToolStart {
            tool_use_id,
            tool_name,
            input,
            parent_tool_use_id,
            ..
        } => {
            assert_eq!(tool_use_id, "tu-1");
            assert_eq!(tool_name, "Bash");
            assert_eq!(*input, Value::Null);
            assert!(parent_tool_use_id.is_none());
        }
        other => panic!("expected ToolStart, got {:?}", other),
    }
    // Verify accumulator state
    assert!(ps.emitted_tool_ids.contains_key("tu-1"));
}
#[test]
fn test_content_block_start_thinking() {
    let mut ps = ProtocolState::new(false);
    let raw = json!({
        "type": "content_block_start",
        "content_block": {"type": "thinking", "thinking": "hmm let me think"}
    });
    let events = ps.map_event(RUN, &raw);
    assert_eq!(events.len(), 1);
    match &events[0] {
        BusEvent::ThinkingDelta { text, .. } => assert_eq!(text, "hmm let me think"),
        other => panic!("expected ThinkingDelta, got {:?}", other),
    }
}

#[test]
fn test_content_block_start_thinking_empty() {
    let mut ps = ProtocolState::new(false);
    let raw = json!({
        "type": "content_block_start",
        "content_block": {"type": "thinking", "thinking": ""}
    });
    let events = ps.map_event(RUN, &raw);
    assert!(events.is_empty(), "empty thinking text: no event emitted");
}

#[test]
fn test_content_block_delta_text() {
    let mut ps = ProtocolState::new(false);
    let raw = json!({
        "type": "content_block_delta",
        "delta": {"type": "text_delta", "text": "hello world"}
    });
    let events = ps.map_event(RUN, &raw);
    assert_eq!(events.len(), 1);
    match &events[0] {
        BusEvent::MessageDelta { text, .. } => assert_eq!(text, "hello world"),
        other => panic!("expected MessageDelta, got {:?}", other),
    }
}

#[test]
fn test_content_block_delta_thinking() {
    let mut ps = ProtocolState::new(false);
    let raw = json!({
        "type": "content_block_delta",
        "delta": {"type": "thinking_delta", "thinking": "reasoning step"}
    });
    let events = ps.map_event(RUN, &raw);
    assert_eq!(events.len(), 1);
    match &events[0] {
        BusEvent::ThinkingDelta { text, .. } => assert_eq!(text, "reasoning step"),
        other => panic!("expected ThinkingDelta, got {:?}", other),
    }
}

#[test]
fn test_content_block_delta_input_json() {
    let mut ps = ProtocolState::new(false);
    // First: start a tool so last_tool_use_id is set
    let start = json!({
        "type": "content_block_start",
        "content_block": {"type": "tool_use", "id": "tu-1", "name": "Bash"}
    });
    ps.map_event(RUN, &start);
    // Then: input_json_delta
    let raw = json!({
        "type": "content_block_delta",
        "delta": {"type": "input_json_delta", "partial_json": "{\"cmd\":"}
    });
    let events = ps.map_event(RUN, &raw);
    assert_eq!(events.len(), 1);
    match &events[0] {
        BusEvent::ToolInputDelta {
            tool_use_id,
            partial_json,
            ..
        } => {
            assert_eq!(tool_use_id, "tu-1");
            assert_eq!(partial_json, "{\"cmd\":");
        }
        other => panic!("expected ToolInputDelta, got {:?}", other),
    }
}

#[test]
fn test_assistant_message_text_only() {
    let mut ps = ProtocolState::new(false);
    let raw = json!({
        "type": "assistant",
        "message": {
            "id": "m1",
            "model": "opus-4",
            "stop_reason": "end_turn",
            "content": [{"type": "text", "text": "Hello there!"}]
        }
    });
    let events = ps.map_event(RUN, &raw);
    assert_eq!(events.len(), 1);
    match &events[0] {
        BusEvent::MessageComplete {
            message_id,
            text,
            model,
            stop_reason,
            ..
        } => {
            assert_eq!(message_id, "m1");
            assert_eq!(text, "Hello there!");
            assert_eq!(model.as_deref(), Some("opus-4"));
            assert_eq!(stop_reason.as_deref(), Some("end_turn"));
        }
        other => panic!("expected MessageComplete, got {:?}", other),
    }
}

#[test]
fn test_assistant_message_with_tool() {
    let mut ps = ProtocolState::new(false);
    let raw = json!({
        "type": "assistant",
        "message": {
            "id": "m1",
            "content": [
                {"type": "text", "text": "Let me read that."},
                {"type": "tool_use", "id": "tu-1", "name": "Read", "input": {"path": "/x"}}
            ]
        }
    });
    let events = ps.map_event(RUN, &raw);
    assert_eq!(
        events.len(),
        2,
        "ToolStart (during loop) + MessageComplete (after loop)"
    );
    // Note: ToolStart is emitted during content iteration, MessageComplete after
    match &events[0] {
        BusEvent::ToolStart {
            tool_use_id,
            tool_name,
            input,
            ..
        } => {
            assert_eq!(tool_use_id, "tu-1");
            assert_eq!(tool_name, "Read");
            assert_eq!(input.get("path").unwrap().as_str().unwrap(), "/x");
        }
        other => panic!("expected ToolStart, got {:?}", other),
    }
    match &events[1] {
        BusEvent::MessageComplete {
            message_id, text, ..
        } => {
            assert_eq!(message_id, "m1");
            assert_eq!(text, "Let me read that.");
        }
        other => panic!("expected MessageComplete, got {:?}", other),
    }
}

#[test]
fn test_assistant_tool_dedup() {
    let mut ps = ProtocolState::new(false);
    // Step 1: tool already emitted via streaming content_block_start
    let start = json!({
        "type": "content_block_start",
        "content_block": {"type": "tool_use", "id": "tu-1", "name": "Bash"}
    });
    ps.map_event(RUN, &start);
    // Step 2: assistant message arrives with same tool
    let raw = json!({
        "type": "assistant",
        "message": {
            "id": "m1",
            "content": [
                {"type": "text", "text": "Running."},
                {"type": "tool_use", "id": "tu-1", "name": "Bash", "input": {"cmd": "ls"}}
            ]
        }
    });
    let events = ps.map_event(RUN, &raw);
    // Only MessageComplete emitted, ToolStart is deduped
    assert_eq!(events.len(), 1);
    assert!(matches!(&events[0], BusEvent::MessageComplete { .. }));
}

#[test]
fn test_user_tool_result() {
    let mut ps = ProtocolState::new(false);
    // Pre-register tool id→name
    ps.emitted_tool_ids
        .insert("tu-1".to_string(), "Bash".to_string());
    let raw = json!({
        "type": "user",
        "message": {
            "content": [
                {"type": "tool_result", "tool_use_id": "tu-1", "content": "files listed ok"}
            ]
        }
    });
    let events = ps.map_event(RUN, &raw);
    assert_eq!(events.len(), 1);
    match &events[0] {
        BusEvent::ToolEnd {
            tool_use_id,
            tool_name,
            status,
            ..
        } => {
            assert_eq!(tool_use_id, "tu-1");
            assert_eq!(tool_name, "Bash");
            assert_eq!(status, "success");
        }
        other => panic!("expected ToolEnd, got {:?}", other),
    }
}

#[test]
fn test_user_tool_result_error() {
    let mut ps = ProtocolState::new(false);
    ps.emitted_tool_ids
        .insert("tu-1".to_string(), "Bash".to_string());
    let raw = json!({
        "type": "user",
        "message": {
            "content": [
                {"type": "tool_result", "tool_use_id": "tu-1", "content": "command failed", "is_error": true}
            ]
        }
    });
    let events = ps.map_event(RUN, &raw);
    assert_eq!(events.len(), 1);
    match &events[0] {
        BusEvent::ToolEnd { status, .. } => assert_eq!(status, "error"),
        other => panic!("expected ToolEnd, got {:?}", other),
    }
}

#[test]
fn test_user_command_output() {
    let mut ps = ProtocolState::new(false);
    let raw = json!({
        "type": "user",
        "message": {
            "content": "<local-command-stdout>cost info here</local-command-stdout>"
        }
    });
    let events = ps.map_event(RUN, &raw);
    assert_eq!(events.len(), 1);
    match &events[0] {
        BusEvent::CommandOutput { content, .. } => assert_eq!(content, "cost info here"),
        other => panic!("expected CommandOutput, got {:?}", other),
    }
}

#[test]
fn test_content_block_start_missing_id() {
    // content_block_start path has `if !tool_use_id.is_empty()` guard → safe
    let mut ps = ProtocolState::new(false);
    let raw = json!({
        "type": "content_block_start",
        "content_block": {"type": "tool_use", "name": "Bash"}
    });
    let events = ps.map_event(RUN, &raw);
    assert!(
        events.is_empty(),
        "content_block_start with missing id: guarded, no output"
    );
}

#[test]
fn test_content_block_start_no_content_block() {
    let mut ps = ProtocolState::new(false);
    let raw = json!({"type": "content_block_start"});
    let events = ps.map_event(RUN, &raw);
    assert!(events.is_empty(), "no content_block field: no output");
}

#[test]
fn test_assistant_tool_missing_id() {
    // assistant path has NO guard on tool_use_id — empty id leaks out
    // This test locks the CURRENT (defective) behavior
    let mut ps = ProtocolState::new(false);
    let raw = json!({
        "type": "assistant",
        "message": {
            "id": "m1",
            "content": [{"type": "tool_use", "name": "Bash", "input": {}}]
        }
    });
    let events = ps.map_event(RUN, &raw);
    // ⚠️ Current behavior: ToolStart with empty tool_use_id leaks out (L584 has no guard)
    let tool_starts: Vec<_> = events
        .iter()
        .filter(|e| matches!(e, BusEvent::ToolStart { .. }))
        .collect();
    assert_eq!(
        tool_starts.len(),
        1,
        "empty id tool_use leaks through assistant path"
    );
    match &tool_starts[0] {
        BusEvent::ToolStart { tool_use_id, .. } => {
            assert_eq!(
                tool_use_id, "",
                "tool_use_id is empty string (known defect)"
            );
        }
        _ => unreachable!(),
    }
}

#[test]
fn test_assistant_no_content() {
    let mut ps = ProtocolState::new(false);
    let raw = json!({"type": "assistant", "message": {}});
    let events = ps.map_event(RUN, &raw);
    assert!(
        events.is_empty(),
        "assistant with no content array: no output"
    );
}
