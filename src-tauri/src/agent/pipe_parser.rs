use crate::agent::codex_parser::extract_codex_delta;
use crate::models::BusEvent;
use serde_json::Value;
use std::collections::{HashSet, VecDeque};

/// Hard cap on how many tool IDs we remember for dedup. Long sessions
/// emit tens of thousands of tool_use events; an unbounded HashSet would
/// grow without limit. 1024 covers the deepest multi-agent fan-out while
/// keeping memory predictable.
const MAX_TRACKED_TOOLS: usize = 1024;

/// Insert `id` into `set` / `order` LRU pair. If the cap is exceeded,
/// evict the oldest entry from both structures. Returns true if `id` was
/// newly inserted (i.e. not already tracked).
fn bounded_insert(set: &mut HashSet<String>, order: &mut VecDeque<String>, id: &str) -> bool {
    if set.contains(id) {
        return false;
    }
    if set.len() >= MAX_TRACKED_TOOLS {
        if let Some(oldest) = order.pop_front() {
            set.remove(&oldest);
        }
    }
    set.insert(id.to_string());
    order.push_back(id.to_string());
    true
}

/// Trait for parsing structured stdout in pipe-exec mode.
/// NOT a general protocol parser — session_actor has its own protocol handling.
/// Implementations parse agent-specific NDJSON into normalized BusEvents.
pub trait PipeStdoutParser: Send {
    /// Parse one NDJSON line into zero or more BusEvents.
    fn parse_line(&mut self, run_id: &str, raw: &Value) -> Vec<BusEvent>;
}

/// Codex NDJSON parser.
pub struct CodexStdoutParser;

impl PipeStdoutParser for CodexStdoutParser {
    fn parse_line(&mut self, run_id: &str, raw: &Value) -> Vec<BusEvent> {
        if let Some(text) = extract_codex_delta(raw) {
            vec![BusEvent::MessageDelta {
                run_id: run_id.to_string(),
                text,
                parent_tool_use_id: None,
            }]
        } else {
            vec![]
        }
    }
}

/// OpenCode `opencode run --format json` NDJSON parser.
///
/// OpenCode intentionally emits a compact envelope with `type`, `sessionID`,
/// and either `part` or `error`. Keeping the parser here lets the pipe executor
/// remain runtime-neutral while still surfacing tools and reasoning to MiWarp.
#[derive(Default)]
pub struct OpenCodeStdoutParser {
    started_tools: HashSet<String>,
    started_order: VecDeque<String>,
    finished_tools: HashSet<String>,
    finished_order: VecDeque<String>,
}

impl OpenCodeStdoutParser {
    pub fn session_id(raw: &Value) -> Option<&str> {
        raw.get("sessionID").and_then(Value::as_str)
    }

    fn part_text(raw: &Value) -> Option<String> {
        raw.get("part")
            .and_then(|part| part.get("text"))
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(ToOwned::to_owned)
    }

    fn tool_id(part: &Value) -> String {
        part.get("callID")
            .or_else(|| part.get("id"))
            .and_then(Value::as_str)
            .unwrap_or("opencode-tool")
            .to_string()
    }
}

impl PipeStdoutParser for OpenCodeStdoutParser {
    fn parse_line(&mut self, run_id: &str, raw: &Value) -> Vec<BusEvent> {
        match raw.get("type").and_then(Value::as_str).unwrap_or("") {
            "text" => Self::part_text(raw)
                .map(|text| {
                    vec![BusEvent::MessageDelta {
                        run_id: run_id.to_string(),
                        text,
                        parent_tool_use_id: None,
                    }]
                })
                .unwrap_or_default(),
            "reasoning" => Self::part_text(raw)
                .map(|text| {
                    vec![BusEvent::ThinkingDelta {
                        run_id: run_id.to_string(),
                        text,
                        parent_tool_use_id: None,
                    }]
                })
                .unwrap_or_default(),
            "tool_use" => {
                let Some(part) = raw.get("part") else {
                    return vec![];
                };
                let tool_name = part
                    .get("tool")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string();
                let tool_use_id = Self::tool_id(part);
                let state = part.get("state").unwrap_or(&Value::Null);
                let status = state
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("running");

                match status {
                    "pending" | "running" => {
                        if !bounded_insert(
                            &mut self.started_tools,
                            &mut self.started_order,
                            &tool_use_id,
                        ) {
                            return vec![];
                        }
                        vec![BusEvent::ToolStart {
                            run_id: run_id.to_string(),
                            tool_use_id,
                            tool_name,
                            input: state.get("input").cloned().unwrap_or(Value::Null),
                            parent_tool_use_id: None,
                        }]
                    }
                    "completed" | "error" => {
                        if !bounded_insert(
                            &mut self.finished_tools,
                            &mut self.finished_order,
                            &tool_use_id,
                        ) {
                            return vec![];
                        }
                        self.started_tools.remove(&tool_use_id);
                        self.started_order.retain(|id| id != &tool_use_id);
                        let output = state
                            .get("output")
                            .or_else(|| state.get("error"))
                            .cloned()
                            .unwrap_or(Value::Null);
                        let duration_ms = state
                            .get("time")
                            .and_then(|time| {
                                Some((time.get("start")?.as_u64()?, time.get("end")?.as_u64()?))
                            })
                            .and_then(|(start, end)| end.checked_sub(start));
                        vec![BusEvent::ToolEnd {
                            run_id: run_id.to_string(),
                            tool_use_id,
                            tool_name,
                            output,
                            status: status.to_string(),
                            duration_ms,
                            parent_tool_use_id: None,
                            tool_use_result: None,
                        }]
                    }
                    _ => vec![],
                }
            }
            "step_start" => vec![BusEvent::RunState {
                run_id: run_id.to_string(),
                state: "running".to_string(),
                exit_code: None,
                error: None,
            }],
            "step_finish" => {
                let reason = raw
                    .get("part")
                    .and_then(|part| part.get("reason"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if reason == "stop" {
                    vec![BusEvent::RunState {
                        run_id: run_id.to_string(),
                        state: "idle".to_string(),
                        exit_code: None,
                        error: None,
                    }]
                } else {
                    vec![]
                }
            }
            "error" => {
                let error = raw
                    .get("error")
                    .and_then(|value| {
                        value
                            .as_str()
                            .map(ToOwned::to_owned)
                            .or_else(|| value.get("message")?.as_str().map(ToOwned::to_owned))
                    })
                    .unwrap_or_else(|| "OpenCode reported an unknown error".to_string());
                vec![BusEvent::RunState {
                    run_id: run_id.to_string(),
                    state: "failed".to_string(),
                    exit_code: None,
                    error: Some(error),
                }]
            }
            _ => vec![],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn codex_agent_message_returns_delta() {
        let mut parser = CodexStdoutParser;
        let raw =
            json!({"type": "item.completed", "item": {"type": "agent_message", "text": "Hello"}});
        let events = parser.parse_line("run-1", &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::MessageDelta { text, .. } => assert_eq!(text, "Hello"),
            other => panic!("expected MessageDelta, got {:?}", other),
        }
    }

    #[test]
    fn codex_command_execution_returns_formatted_delta() {
        let mut parser = CodexStdoutParser;
        let raw = json!({"type": "item.completed", "item": {"type": "command_execution", "command": "ls", "output": "a.rs\nb.rs"}});
        let events = parser.parse_line("run-1", &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::MessageDelta { text, .. } => assert!(text.contains("$ ls")),
            other => panic!("expected MessageDelta, got {:?}", other),
        }
    }

    #[test]
    fn codex_thread_started_returns_empty() {
        let mut parser = CodexStdoutParser;
        let raw = json!({"type": "thread.started", "thread_id": "t1"});
        assert!(parser.parse_line("run-1", &raw).is_empty());
    }

    #[test]
    fn opencode_text_returns_delta_and_exposes_session() {
        let mut parser = OpenCodeStdoutParser::default();
        let raw = json!({
            "type": "text",
            "sessionID": "ses_123",
            "part": {"text": "Hello from OpenCode"}
        });
        assert_eq!(OpenCodeStdoutParser::session_id(&raw), Some("ses_123"));
        let events = parser.parse_line("run-1", &raw);
        assert!(matches!(
            &events[0],
            BusEvent::MessageDelta { text, .. } if text == "Hello from OpenCode"
        ));
    }

    #[test]
    fn opencode_reasoning_returns_thinking_delta() {
        let mut parser = OpenCodeStdoutParser::default();
        let events = parser.parse_line(
            "run-1",
            &json!({"type":"reasoning","part":{"text":"checking"}}),
        );
        assert!(matches!(
            &events[0],
            BusEvent::ThinkingDelta { text, .. } if text == "checking"
        ));
    }

    #[test]
    fn opencode_tool_lifecycle_maps_to_bus_events() {
        let mut parser = OpenCodeStdoutParser::default();
        let start = parser.parse_line(
            "run-1",
            &json!({"type":"tool_use","part":{"callID":"call-1","tool":"bash","state":{"status":"running","input":{"command":"pwd"}}}}),
        );
        assert!(matches!(
            &start[0],
            BusEvent::ToolStart { tool_name, tool_use_id, .. }
                if tool_name == "bash" && tool_use_id == "call-1"
        ));

        let end = parser.parse_line(
            "run-1",
            &json!({"type":"tool_use","part":{"callID":"call-1","tool":"bash","state":{"status":"completed","output":"ok","time":{"start":10,"end":25}}}}),
        );
        assert!(matches!(
            &end[0],
            BusEvent::ToolEnd { status, duration_ms, .. }
                if status == "completed" && *duration_ms == Some(15)
        ));
    }

    #[test]
    fn opencode_tool_updates_are_deduplicated() {
        let mut parser = OpenCodeStdoutParser::default();
        let running = json!({"type":"tool_use","part":{"callID":"call-1","tool":"bash","state":{"status":"running","input":{"command":"pwd"}}}});
        let completed = json!({"type":"tool_use","part":{"callID":"call-1","tool":"bash","state":{"status":"completed","output":"ok"}}});

        assert_eq!(parser.parse_line("run-1", &running).len(), 1);
        assert!(parser.parse_line("run-1", &running).is_empty());
        assert_eq!(parser.parse_line("run-1", &completed).len(), 1);
        assert!(parser.parse_line("run-1", &completed).is_empty());
    }

    #[test]
    fn opencode_started_tools_set_is_bounded() {
        // Feed MAX_TRACKED_TOOLS + 50 unique tool calls. After the cap, the
        // oldest IDs must be forgotten, so re-emitting the first IDs produces
        // a fresh ToolStart event (not a dedup hit).
        let mut parser = OpenCodeStdoutParser::default();
        let mut first_id = String::new();

        for i in 0..(MAX_TRACKED_TOOLS + 50) {
            let id = format!("call-{}", i);
            if i == 0 {
                first_id = id.clone();
            }
            let events = parser.parse_line(
                "run-1",
                &json!({
                    "type": "tool_use",
                    "part": {
                        "callID": id,
                        "tool": "bash",
                        "state": {"status": "running", "input": {"i": i}}
                    }
                }),
            );
            assert_eq!(events.len(), 1, "first emission of id={} dropped", i);
        }

        // Oldest ID was evicted; emitting it again should yield a fresh event.
        let events = parser.parse_line(
            "run-1",
            &json!({
                "type": "tool_use",
                "part": {
                    "callID": first_id,
                    "tool": "bash",
                    "state": {"status": "running", "input": {}}
                }
            }),
        );
        assert_eq!(
            events.len(),
            1,
            "oldest id should be re-emitted once evicted from bounded set"
        );
        assert!(parser.started_tools.len() <= MAX_TRACKED_TOOLS);
        assert!(parser.started_order.len() <= MAX_TRACKED_TOOLS);
    }

    #[test]
    fn opencode_finished_tools_set_is_bounded() {
        // Exercise the finished-tools cap: a run that completes far more
        // tools than the cap. Re-completing an old tool must yield a fresh
        // ToolEnd (not a dedup hit).
        let mut parser = OpenCodeStdoutParser::default();
        let mut first_id = String::new();

        for i in 0..(MAX_TRACKED_TOOLS + 50) {
            let id = format!("done-{}", i);
            if i == 0 {
                first_id = id.clone();
            }
            let events = parser.parse_line(
                "run-1",
                &json!({
                    "type": "tool_use",
                    "part": {
                        "callID": id,
                        "tool": "bash",
                        "state": {"status": "completed", "output": "ok"}
                    }
                }),
            );
            assert_eq!(events.len(), 1, "first completion of id={} dropped", i);
        }

        let events = parser.parse_line(
            "run-1",
            &json!({
                "type": "tool_use",
                "part": {
                    "callID": first_id,
                    "tool": "bash",
                    "state": {"status": "completed", "output": "ok"}
                }
            }),
        );
        assert_eq!(events.len(), 1, "oldest finished id should be re-emittable");
        assert!(parser.finished_tools.len() <= MAX_TRACKED_TOOLS);
        assert!(parser.finished_order.len() <= MAX_TRACKED_TOOLS);
    }

    #[test]
    fn opencode_completion_drops_started_entry() {
        // After completion, the started slot must be freed so the same id
        // can be re-used in a later turn without leaking.
        let mut parser = OpenCodeStdoutParser::default();
        let id = "call-reuse";
        let start = parser.parse_line(
            "run-1",
            &json!({
                "type": "tool_use",
                "part": {"callID": id, "tool": "bash", "state": {"status": "running"}}
            }),
        );
        assert_eq!(start.len(), 1);

        let end = parser.parse_line(
            "run-1",
            &json!({
                "type": "tool_use",
                "part": {"callID": id, "tool": "bash", "state": {"status": "completed"}}
            }),
        );
        assert_eq!(end.len(), 1);
        assert!(!parser.started_tools.contains(id));
        assert!(!parser.started_order.contains(&id.to_string()));
    }

    #[test]
    fn opencode_error_maps_to_failed_state() {
        let mut parser = OpenCodeStdoutParser::default();
        let events = parser.parse_line(
            "run-1",
            &json!({"type":"error","error":{"message":"provider unavailable"}}),
        );
        assert!(matches!(
            &events[0],
            BusEvent::RunState { state, error, .. }
                if state == "failed" && error.as_deref() == Some("provider unavailable")
        ));
    }
}
