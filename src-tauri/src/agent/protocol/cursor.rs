//! Cursor Agent CLI stream-json protocol parser.

use crate::agent::protocol::{ParseResult, ParserStats, ProtocolParser};
use crate::models::BusEvent;
use serde::Deserialize;
use serde_json::Value;

pub struct CursorProtocolParser {
    stats: ParserStats,
    conversation_id: Option<String>,
    model: Option<String>,
}

impl Default for CursorProtocolParser {
    fn default() -> Self {
        Self::new()
    }
}

impl CursorProtocolParser {
    pub fn new() -> Self {
        Self {
            stats: ParserStats::default(),
            conversation_id: None,
            model: None,
        }
    }

    fn bump_parsed(&mut self) {
        self.stats.lines_parsed += 1;
    }
}

#[derive(Debug, Deserialize)]
struct CursorEnvelope {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    tool: Option<Value>,
    #[serde(default)]
    error: Option<Value>,
}

impl ProtocolParser for CursorProtocolParser {
    fn parse_line(&mut self, run_id: &str, line: &str) -> ParseResult {
        self.bump_parsed();
        let trimmed = line.trim();
        if trimmed.is_empty() {
            self.stats.events_skipped += 1;
            return ParseResult::Skip;
        }

        let envelope: CursorEnvelope = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(e) => {
                self.stats.parse_errors += 1;
                return ParseResult::Error(format!("cursor json: {}", e));
            }
        };

        if let Some(sid) = envelope.session_id.clone() {
            self.conversation_id = Some(sid);
        }
        if let Some(model) = envelope.model.clone() {
            self.model = Some(model);
        }

        let events = match envelope.event_type.as_str() {
            "session_start" | "system" => vec![BusEvent::SessionInit {
                run_id: run_id.to_string(),
                session_id: envelope.session_id.clone(),
                model: envelope.model.clone(),
                tools: vec![],
                cwd: String::new(),
                slash_commands: vec![],
                mcp_servers: vec![],
                permission_mode: None,
                api_key_source: None,
                claude_code_version: None,
                output_style: None,
                agents: vec![],
                skills: vec![],
                plugins: vec![],
                plugin_errors: vec![],
                fast_mode_state: None,
            }],
            "assistant" | "message" | "text" => {
                let text = envelope.text.unwrap_or_default();
                if text.is_empty() {
                    self.stats.events_skipped += 1;
                    return ParseResult::Skip;
                }
                vec![BusEvent::MessageComplete {
                    run_id: run_id.to_string(),
                    message_id: format!("cursor-{}", self.stats.events_emitted),
                    text,
                    parent_tool_use_id: None,
                    model: envelope.model.clone(),
                    stop_reason: None,
                    message_usage: None,
                }]
            }
            "tool_call" | "tool_use" => {
                let tool_val = envelope.tool.unwrap_or(Value::Null);
                let name = tool_val
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("tool")
                    .to_string();
                let input = tool_val.get("input").cloned().unwrap_or(Value::Null);
                vec![BusEvent::ToolStart {
                    run_id: run_id.to_string(),
                    tool_use_id: tool_val
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("cursor-tool")
                        .to_string(),
                    tool_name: name,
                    input,
                    parent_tool_use_id: None,
                }]
            }
            "tool_result" => {
                let tool_val = envelope.tool.unwrap_or(Value::Null);
                vec![BusEvent::ToolEnd {
                    run_id: run_id.to_string(),
                    tool_use_id: tool_val
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("cursor-tool")
                        .to_string(),
                    tool_name: tool_val
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("tool")
                        .to_string(),
                    output: tool_val.get("output").cloned().unwrap_or(Value::Null),
                    status: "completed".to_string(),
                    duration_ms: None,
                    parent_tool_use_id: None,
                    tool_use_result: None,
                }]
            }
            "error" => {
                let message = envelope
                    .error
                    .and_then(|e| {
                        e.get("message")
                            .and_then(|m| m.as_str())
                            .map(str::to_string)
                    })
                    .unwrap_or_else(|| "cursor agent error".to_string());
                vec![BusEvent::RunState {
                    run_id: run_id.to_string(),
                    state: "error".to_string(),
                    exit_code: Some(1),
                    error: Some(message),
                }]
            }
            "result" | "done" | "turn_complete" => vec![BusEvent::RunState {
                run_id: run_id.to_string(),
                state: "completed".to_string(),
                exit_code: Some(0),
                error: None,
            }],
            "heartbeat" | "ping" => {
                self.stats.events_skipped += 1;
                return ParseResult::Skip;
            }
            other => {
                self.stats.raw_lines += 1;
                return ParseResult::Raw(format!("cursor:unhandled:{}", other));
            }
        };

        self.stats.events_emitted += events.len() as u64;
        ParseResult::Events(events)
    }

    fn conversation_id(&self) -> Option<String> {
        self.conversation_id.clone()
    }

    fn detected_model(&self) -> Option<String> {
        self.model.clone()
    }

    fn reset(&mut self) {
        self.conversation_id = None;
        self.model = None;
    }

    fn stats(&self) -> ParserStats {
        self.stats.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_assistant_message() {
        let mut parser = CursorProtocolParser::new();
        let line = r#"{"type":"assistant","text":"hello","model":"gpt-4.1"}"#;
        match parser.parse_line("run-1", line) {
            ParseResult::Events(events) => {
                assert_eq!(events.len(), 1);
                assert!(matches!(events[0], BusEvent::MessageComplete { .. }));
            }
            other => panic!("expected events, got {:?}", other),
        }
    }

    #[test]
    fn malformed_json_is_error_not_skip() {
        let mut parser = CursorProtocolParser::new();
        match parser.parse_line("run-1", "{not-json") {
            ParseResult::Error(_) => {}
            other => panic!("expected error, got {:?}", other),
        }
    }

    #[test]
    fn resume_session_id_captured() {
        let mut parser = CursorProtocolParser::new();
        let line = r#"{"type":"session_start","session_id":"sess-abc"}"#;
        let _ = parser.parse_line("run-1", line);
        assert_eq!(parser.conversation_id(), Some("sess-abc".to_string()));
    }

    #[test]
    fn tool_call_event_mapped() {
        let mut parser = CursorProtocolParser::new();
        let line = r#"{"type":"tool_call","tool":{"id":"t1","name":"read","input":{}}}"#;
        match parser.parse_line("run-1", line) {
            ParseResult::Events(events) => {
                assert!(matches!(events[0], BusEvent::ToolStart { .. }));
            }
            other => panic!("expected tool call, got {:?}", other),
        }
    }
}
