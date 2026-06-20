//! MiMo-Code protocol parser.
//!
//! Maps MiMo-Code `mimo run --format json` NDJSON events to MiWarp BusEvents.
//!
//! MiMo-Code event types:
//!   - step_start: new agent step begins
//!   - tool_use: tool call with input/output (status: running/completed/error)
//!   - step_finish: step completed (reason: "tool-calls" | "stop")
//!   - text: assistant text output
//!   - reasoning: thinking blocks (with --thinking)
//!   - error: error event

use super::{ParseResult, ParserStats, ProtocolParser};
use crate::models::BusEvent;
use serde_json::Value;
use std::collections::HashMap;

/// MiMo-Code protocol parser.
pub struct MimoProtocolParser {
    conversation_id: Option<String>,
    detected_model: Option<String>,
    /// Track tool calls by callID for dedup / duration calc.
    tool_starts: HashMap<String, ToolStartInfo>,
    /// Buffer for accumulating text across events.
    text_buffer: String,
    stats: ParserStats,
}

#[allow(dead_code)]
struct ToolStartInfo {
    tool_name: String,
    start_time_ms: u64,
}

impl Default for MimoProtocolParser {
    fn default() -> Self {
        Self::new()
    }
}

impl MimoProtocolParser {
    pub fn new() -> Self {
        Self {
            conversation_id: None,
            detected_model: None,
            tool_starts: HashMap::new(),
            text_buffer: String::new(),
            stats: ParserStats::default(),
        }
    }

    /// Parse a tool_use event into BusEvent(s).
    fn parse_tool_use(&mut self, run_id: &str, payload: &Value) -> ParseResult {
        let part = match payload.get("part") {
            Some(p) => p,
            None => return ParseResult::Error("tool_use missing part".into()),
        };

        let tool_name = part
            .get("tool")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        let call_id = part
            .get("callID")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let state = match part.get("state") {
            Some(s) => s,
            None => return ParseResult::Error("tool_use missing state".into()),
        };

        let status = state
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        let timestamp = payload
            .get("timestamp")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        let time_info = state.get("time");
        let start_ms = time_info
            .and_then(|t| t.get("start"))
            .and_then(|v| v.as_u64())
            .unwrap_or(timestamp);
        let end_ms = time_info
            .and_then(|t| t.get("end"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        match status.as_str() {
            "running" => {
                // Tool start
                self.tool_starts.insert(
                    call_id.clone(),
                    ToolStartInfo {
                        tool_name: tool_name.clone(),
                        start_time_ms: start_ms,
                    },
                );

                let input = state
                    .get("input")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);

                ParseResult::Events(vec![BusEvent::ToolStart {
                    run_id: run_id.to_string(),
                    tool_use_id: call_id,
                    tool_name,
                    input,
                    parent_tool_use_id: None,
                }])
            }
            "completed" | "error" => {
                // Tool end
                let output = state
                    .get("output")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);

                let duration_ms = if end_ms > start_ms {
                    Some(end_ms - start_ms)
                } else {
                    None
                };

                let tool_name_for_end = self
                    .tool_starts
                    .remove(&call_id)
                    .map(|i| i.tool_name)
                    .unwrap_or_else(|| tool_name.clone());

                ParseResult::Events(vec![BusEvent::ToolEnd {
                    run_id: run_id.to_string(),
                    tool_use_id: call_id,
                    tool_name: tool_name_for_end,
                    output,
                    status,
                    duration_ms,
                    parent_tool_use_id: None,
                    tool_use_result: None,
                }])
            }
            _ => ParseResult::Skip,
        }
    }

    /// Parse a step_finish event into BusEvent(s).
    fn parse_step_finish(&self, run_id: &str, payload: &Value) -> ParseResult {
        let part = match payload.get("part") {
            Some(p) => p,
            None => return ParseResult::Error("step_finish missing part".into()),
        };

        let reason = part
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");

        // Extract token usage from step_finish
        let usage_event = part.get("tokens").map(|tokens| {
            let input = tokens.get("input").and_then(|v| v.as_u64()).unwrap_or(0);
            let output = tokens.get("output").and_then(|v| v.as_u64()).unwrap_or(0);
            let cache_read = tokens
                .get("cache")
                .and_then(|c| c.get("read"))
                .and_then(|v| v.as_u64());
            let cache_write = tokens
                .get("cache")
                .and_then(|c| c.get("write"))
                .and_then(|v| v.as_u64());
            let cost = part.get("cost").and_then(|v| v.as_f64()).unwrap_or(0.0);

            BusEvent::UsageUpdate {
                run_id: run_id.to_string(),
                input_tokens: input,
                output_tokens: output,
                cache_read_tokens: cache_read,
                cache_write_tokens: cache_write,
                total_cost_usd: cost,
                turn_index: None,
                model_usage: None,
                context_window_used_percentage: None,
                context_window_remaining_percentage: None,
                duration_api_ms: None,
                duration_ms: None,
                num_turns: None,
                stop_reason: None,
                service_tier: None,
                speed: None,
                web_fetch_requests: None,
                cache_creation_5m: None,
                cache_creation_1h: None,
            }
        });

        // Emit RunState based on reason
        let state = match reason {
            "stop" => "completed",
            "tool-calls" => "running", // more steps coming
            _ => "running",
        };

        let mut events = vec![BusEvent::RunState {
            run_id: run_id.to_string(),
            state: state.to_string(),
            exit_code: None,
            error: None,
        }];

        if let Some(usage) = usage_event {
            events.push(usage);
        }

        ParseResult::Events(events)
    }

    /// Parse a text event into BusEvent(s).
    fn parse_text(&self, run_id: &str, payload: &Value) -> ParseResult {
        let part = match payload.get("part") {
            Some(p) => p,
            None => return ParseResult::Error("text missing part".into()),
        };

        let text = part
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if text.is_empty() {
            return ParseResult::Skip;
        }

        // MiMo emits complete text (not deltas), so emit MessageComplete
        let message_id = part
            .get("messageID")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        ParseResult::Events(vec![BusEvent::MessageComplete {
            run_id: run_id.to_string(),
            message_id,
            text,
            parent_tool_use_id: None,
            model: None,
            stop_reason: None,
            message_usage: None,
        }])
    }

    /// Parse a reasoning event into BusEvent(s).
    fn parse_reasoning(&self, run_id: &str, payload: &Value) -> ParseResult {
        let part = match payload.get("part") {
            Some(p) => p,
            None => return ParseResult::Error("reasoning missing part".into()),
        };

        let text = part
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if text.is_empty() {
            return ParseResult::Skip;
        }

        // Emit as a special MessageDelta with a marker
        ParseResult::Events(vec![BusEvent::MessageDelta {
            run_id: run_id.to_string(),
            text: format!("[thinking] {text}"),
            parent_tool_use_id: None,
        }])
    }

    /// Parse an error event into BusEvent(s).
    fn parse_error(&self, run_id: &str, payload: &Value) -> ParseResult {
        let error_msg = payload
            .get("error")
            .map(|v| {
                if let Some(s) = v.as_str() {
                    s.to_string()
                } else if let Some(msg) = v.get("message").and_then(|m| m.as_str()) {
                    msg.to_string()
                } else {
                    serde_json::to_string(v).unwrap_or_default()
                }
            })
            .unwrap_or_else(|| "Unknown error".to_string());

        ParseResult::Events(vec![BusEvent::RunState {
            run_id: run_id.to_string(),
            state: "failed".to_string(),
            exit_code: None,
            error: Some(error_msg),
        }])
    }
}

impl ProtocolParser for MimoProtocolParser {
    fn parse_line(&mut self, run_id: &str, line: &str) -> ParseResult {
        self.stats.lines_parsed += 1;

        // Try to parse as JSON
        let payload: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                self.stats.parse_errors += 1;
                return ParseResult::Error(format!("JSON parse error: {e}"));
            }
        };

        // Extract session ID from any event
        if self.conversation_id.is_none() {
            if let Some(sid) = payload.get("sessionID").and_then(|v| v.as_str()) {
                self.conversation_id = Some(sid.to_string());
            }
        }

        let event_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match event_type {
            "step_start" => {
                self.stats.events_skipped += 1;
                ParseResult::Skip
            }
            "tool_use" => self.parse_tool_use(run_id, &payload),
            "step_finish" => self.parse_step_finish(run_id, &payload),
            "text" => self.parse_text(run_id, &payload),
            "reasoning" => self.parse_reasoning(run_id, &payload),
            "error" => self.parse_error(run_id, &payload),
            // MiMo SSE events from server mode
            "server.connected" | "server.heartbeat" => {
                self.stats.events_skipped += 1;
                ParseResult::Skip
            }
            _ => {
                // Unknown event — log as raw for protocol inspection
                self.stats.raw_lines += 1;
                ParseResult::Raw(line.to_string())
            }
        }
    }

    fn conversation_id(&self) -> Option<String> {
        self.conversation_id.clone()
    }

    fn detected_model(&self) -> Option<String> {
        self.detected_model.clone()
    }

    fn reset(&mut self) {
        self.tool_starts.clear();
        self.text_buffer.clear();
        self.conversation_id = None;
        self.detected_model = None;
    }

    fn stats(&self) -> ParserStats {
        self.stats.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const RUN: &str = "run-test";

    #[test]
    fn test_step_start_is_skipped() {
        let mut parser = MimoProtocolParser::new();
        let raw = json!({
            "type": "step_start",
            "timestamp": 1,
            "sessionID": "ses_test123",
            "part": {"id": "prt_1", "type": "step-start"}
        });
        let result = parser.parse_line(RUN, &raw.to_string());
        assert!(matches!(result, ParseResult::Skip));
        assert_eq!(parser.conversation_id(), Some("ses_test123".into()));
    }

    #[test]
    fn test_tool_use_completed() {
        let mut parser = MimoProtocolParser::new();
        let raw = json!({
            "type": "tool_use",
            "timestamp": 2,
            "sessionID": "ses_test123",
            "part": {
                "type": "tool",
                "tool": "read",
                "callID": "call_abc123",
                "state": {
                    "status": "completed",
                    "input": {"filePath": "/tmp/test.md"},
                    "output": "file content here",
                    "time": {"start": 100, "end": 110}
                }
            }
        });
        let result = parser.parse_line(RUN, &raw.to_string());
        match result {
            ParseResult::Events(events) => {
                assert_eq!(events.len(), 1);
                if let BusEvent::ToolEnd {
                    tool_use_id,
                    tool_name,
                    status,
                    duration_ms,
                    ..
                } = &events[0]
                {
                    assert_eq!(tool_use_id, "call_abc123");
                    assert_eq!(tool_name, "read");
                    assert_eq!(status, "completed");
                    assert_eq!(duration_ms, &Some(110 - 100));
                } else {
                    panic!("Expected ToolEnd event");
                }
            }
            _ => panic!("Expected Events, got {:?}", result),
        }
    }

    #[test]
    fn test_text_event() {
        let mut parser = MimoProtocolParser::new();
        let raw = json!({
            "type": "text",
            "timestamp": 5,
            "sessionID": "ses_test123",
            "part": {
                "id": "prt_1",
                "messageID": "msg_1",
                "type": "text",
                "text": "Hello world"
            }
        });
        let result = parser.parse_line(RUN, &raw.to_string());
        match result {
            ParseResult::Events(events) => {
                assert_eq!(events.len(), 1);
                if let BusEvent::MessageComplete {
                    text, message_id, ..
                } = &events[0]
                {
                    assert_eq!(text, "Hello world");
                    assert_eq!(message_id, "msg_1");
                } else {
                    panic!("Expected MessageComplete event");
                }
            }
            _ => panic!("Expected Events, got {:?}", result),
        }
    }

    #[test]
    fn test_step_finish_stop() {
        let mut parser = MimoProtocolParser::new();
        let raw = json!({
            "type": "step_finish",
            "timestamp": 6,
            "sessionID": "ses_test123",
            "part": {
                "reason": "stop",
                "tokens": {"total": 34515, "input": 219, "output": 25, "cache": {"read": 34240}},
                "cost": 0.0
            }
        });
        let result = parser.parse_line(RUN, &raw.to_string());
        match result {
            ParseResult::Events(events) => {
                // Should have RunState + UsageUpdate
                assert!(!events.is_empty());
                let has_run_state = events
                    .iter()
                    .any(|e| matches!(e, BusEvent::RunState { state, .. } if state == "completed"));
                assert!(has_run_state, "Expected RunState(completed)");
            }
            _ => panic!("Expected Events, got {:?}", result),
        }
    }

    #[test]
    fn test_error_event() {
        let mut parser = MimoProtocolParser::new();
        let raw = json!({
            "type": "error",
            "sessionID": "ses_test123",
            "error": "Something went wrong"
        });
        let result = parser.parse_line(RUN, &raw.to_string());
        match result {
            ParseResult::Events(events) => {
                assert_eq!(events.len(), 1);
                if let BusEvent::RunState { state, error, .. } = &events[0] {
                    assert_eq!(state, "failed");
                    assert_eq!(error.as_deref(), Some("Something went wrong"));
                } else {
                    panic!("Expected RunState event");
                }
            }
            _ => panic!("Expected Events, got {:?}", result),
        }
    }

    #[test]
    fn test_unknown_event_becomes_raw() {
        let mut parser = MimoProtocolParser::new();
        let raw = json!({
            "type": "some_future_event",
            "sessionID": "ses_test123",
            "data": "test"
        });
        let result = parser.parse_line(RUN, &raw.to_string());
        assert!(matches!(result, ParseResult::Raw(_)));
    }

    #[test]
    fn test_server_heartbeat_skipped() {
        let mut parser = MimoProtocolParser::new();
        let raw = json!({"type": "server.heartbeat", "properties": {}});
        let result = parser.parse_line(RUN, &raw.to_string());
        assert!(matches!(result, ParseResult::Skip));
    }

    #[test]
    fn test_conversation_id_extracted() {
        let mut parser = MimoProtocolParser::new();
        let raw = json!({
            "type": "step_start",
            "sessionID": "ses_abc123",
            "part": {"id": "prt_1", "type": "step-start"}
        });
        parser.parse_line(RUN, &raw.to_string());
        assert_eq!(parser.conversation_id(), Some("ses_abc123".into()));
    }

    #[test]
    fn test_full_session_from_real_output() {
        // Real mimo output captured from actual run — simplified for test
        let lines = vec![
            json!({"type":"step_start","timestamp":1,"sessionID":"ses_test","part":{"id":"prt_1","messageID":"msg_1","sessionID":"ses_test","snapshot":"abc","type":"step-start"}}),
            json!({"type":"tool_use","timestamp":2,"sessionID":"ses_test","part":{"type":"tool","tool":"read","callID":"call_1","state":{"status":"completed","input":{"filePath":"/tmp/test.md"},"output":"content","metadata":{"preview":"test","truncated":false},"title":"test.md","time":{"start":100,"end":110}},"id":"prt_2","sessionID":"ses_test","messageID":"msg_1"}}),
            json!({"type":"step_finish","timestamp":3,"sessionID":"ses_test","part":{"id":"prt_3","reason":"tool-calls","snapshot":"abc","messageID":"msg_1","sessionID":"ses_test","type":"step-finish","tokens":{"total":34402,"input":32223,"output":33,"reasoning":98,"cache":{"write":0,"read":2048}},"cost":0}}),
            json!({"type":"step_start","timestamp":4,"sessionID":"ses_test","part":{"id":"prt_4","messageID":"msg_2","sessionID":"ses_test","snapshot":"abc","type":"step-start"}}),
            json!({"type":"text","timestamp":5,"sessionID":"ses_test","part":{"id":"prt_5","messageID":"msg_2","sessionID":"ses_test","type":"text","text":"Hello from MiMo","time":{"start":200,"end":210}}}),
            json!({"type":"step_finish","timestamp":6,"sessionID":"ses_test","part":{"id":"prt_6","reason":"stop","snapshot":"abc","messageID":"msg_2","sessionID":"ses_test","type":"step-finish","tokens":{"total":34515,"input":219,"output":25,"reasoning":31,"cache":{"write":0,"read":34240}},"cost":0}}),
        ];

        let mut parser = MimoProtocolParser::new();
        let mut all_events = Vec::new();

        for line in &lines {
            let result = parser.parse_line(RUN, &line.to_string());
            match result {
                ParseResult::Events(mut events) => all_events.append(&mut events),
                ParseResult::Skip => {}
                ParseResult::Raw(_) => {}
                ParseResult::Error(e) => panic!("Parse error: {}", e),
            }
        }

        // Verify conversation ID extracted
        assert_eq!(parser.conversation_id(), Some("ses_test".into()));

        // Verify events
        let tool_ends: Vec<_> = all_events
            .iter()
            .filter(|e| matches!(e, BusEvent::ToolEnd { .. }))
            .collect();
        assert_eq!(tool_ends.len(), 1, "Expected 1 ToolEnd");

        let message_completes: Vec<_> = all_events
            .iter()
            .filter(|e| matches!(e, BusEvent::MessageComplete { .. }))
            .collect();
        assert_eq!(message_completes.len(), 1, "Expected 1 MessageComplete");

        let run_states: Vec<_> = all_events
            .iter()
            .filter(|e| matches!(e, BusEvent::RunState { .. }))
            .collect();
        assert_eq!(
            run_states.len(),
            2,
            "Expected 2 RunStates (tool-calls + stop)"
        );

        let usage_updates: Vec<_> = all_events
            .iter()
            .filter(|e| matches!(e, BusEvent::UsageUpdate { .. }))
            .collect();
        assert_eq!(usage_updates.len(), 2, "Expected 2 UsageUpdates");
    }
}
