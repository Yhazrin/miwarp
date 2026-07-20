//! Claude CLI stream-json protocol parser.
//!
//! Pure-function protocol mapping: raw JSON events → `Vec<BusEvent>`.
//! Encapsulates all accumulator state (tool tracking, JSON accumulation)
//! so callers only need `ProtocolState::new()` + `state.map_event(...)`.
//!
//! Also supports MiMo-Code JSON protocol via runtime_kind dispatch.

use crate::models::protocol_state::{MimoToolStartInfo, ProtocolState};
use crate::models::BusEvent;
use serde_json::Value;

impl ProtocolState {
    /// Map a single MiMo-Code JSON event into zero or more `BusEvent`s.
    ///
    /// MiMo-Code event types (from `mimo run --format json`):
    ///   - step_start: new agent step begins (skip)
    ///   - tool_use: tool call with input/output (status: running/completed/error)
    ///   - step_finish: step completed (reason: "tool-calls" | "stop")
    ///   - text: assistant text output (complete, not delta)
    ///   - reasoning: thinking blocks
    ///   - error: error event
    pub(super) fn map_event_mimo(&mut self, run_id: &str, raw: &Value) -> Vec<BusEvent> {
        let mut events = Vec::new();

        // Extract session ID from any event
        if self.mimo_session_id.is_none() {
            if let Some(sid) = raw.get("sessionID").and_then(|v| v.as_str()) {
                self.mimo_session_id = Some(sid.to_string());
                // Emit synthetic SessionInit on first session_id detection
                // MiMo doesn't emit a system/init event like Claude,
                // so we synthesize one to populate session store fields.
                events.push(BusEvent::SessionInit {
                    run_id: run_id.to_string(),
                    session_id: Some(sid.to_string()),
                    model: Some("mimo".to_string()),
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
                });
            }
        }

        let event_type = raw.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match event_type {
            "step_start" => {
                // Skip — no BusEvent needed
            }
            "tool_result" => {
                // P1-4：CLI 单独发 tool_result 事件时（不在 user 消息里时）也要
                // 记一条 ToolEnd，否则 tool_use 永远停在 running。
                let part = match raw.get("part") {
                    Some(p) => p,
                    None => return events,
                };
                let call_id = part
                    .get("callID")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if call_id.is_empty() {
                    return events;
                }
                let output = part.get("output").cloned().unwrap_or(Value::Null);
                let status = part
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("completed")
                    .to_string();
                let tool_name = self
                    .mimo_tool_starts
                    .remove(&call_id)
                    .map(|i| i.tool_name)
                    .unwrap_or_else(|| "tool".to_string());
                events.push(BusEvent::ToolEnd {
                    run_id: run_id.to_string(),
                    tool_use_id: call_id,
                    tool_name,
                    output,
                    status,
                    duration_ms: None,
                    parent_tool_use_id: None,
                    tool_use_result: None,
                });
            }
            "usage" => {
                // P1-4：部分 provider（MiMo / openrouter 等）会发单独的 usage 事件
                // 而不是把它塞到 step_finish.part.tokens 里。
                let part = match raw.get("part") {
                    Some(p) => p,
                    None => return events,
                };
                let input = part.get("input").and_then(|v| v.as_u64()).unwrap_or(0);
                let output = part.get("output").and_then(|v| v.as_u64()).unwrap_or(0);
                let cache_read = part.get("cache_read").and_then(|v| v.as_u64());
                let cache_write = part.get("cache_write").and_then(|v| v.as_u64());
                let cost = part.get("cost").and_then(|v| v.as_f64()).unwrap_or(0.0);
                events.push(BusEvent::UsageUpdate {
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
                });
            }
            "progress" => {
                // P1-4：长任务 progress 事件，不影响用量统计但要分类记入。
                let msg = raw
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if msg.is_empty() {
                    return events;
                }
                events.push(BusEvent::MessageDelta {
                    run_id: run_id.to_string(),
                    text: format!("[progress] {msg}"),
                    parent_tool_use_id: None,
                });
            }
            "retry" => {
                // P1-4：CLI 报告一次重试，计入 unknown 之外的明确分类。
                let attempt = raw.get("attempt").and_then(|v| v.as_u64()).unwrap_or(0);
                let msg = raw
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("retry");
                log::debug!(
                    "[mimo] run {} retry attempt={} msg={}",
                    run_id,
                    attempt,
                    msg
                );
            }
            "init" => {
                // P1-4：旧版 provider 单独发 init 而不是 system/subtype=init。
                // 兼容用：把 init 转发为 Raw，避免被计入 unknown 桶。
                events.push(BusEvent::Raw {
                    run_id: run_id.to_string(),
                    source: "mimo_stdout".to_string(),
                    data: raw.clone(),
                });
            }
            "tool_use" => {
                let part = match raw.get("part") {
                    Some(p) => p,
                    None => return events,
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
                    None => return events,
                };

                let status = state
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();

                let timestamp = raw.get("timestamp").and_then(|v| v.as_u64()).unwrap_or(0);

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
                        self.mimo_tool_starts.insert(
                            call_id.clone(),
                            MimoToolStartInfo {
                                tool_name: tool_name.clone(),
                                start_time_ms: start_ms,
                            },
                        );

                        let input = state.get("input").cloned().unwrap_or(Value::Null);

                        events.push(BusEvent::ToolStart {
                            run_id: run_id.to_string(),
                            tool_use_id: call_id,
                            tool_name,
                            input,
                            parent_tool_use_id: None,
                        });
                    }
                    "completed" | "error" => {
                        let output = state.get("output").cloned().unwrap_or(Value::Null);

                        let duration_ms = if end_ms > start_ms {
                            Some(end_ms - start_ms)
                        } else {
                            None
                        };

                        let tool_name_for_end = self
                            .mimo_tool_starts
                            .remove(&call_id)
                            .map(|i| i.tool_name)
                            .unwrap_or_else(|| tool_name.clone());

                        events.push(BusEvent::ToolEnd {
                            run_id: run_id.to_string(),
                            tool_use_id: call_id,
                            tool_name: tool_name_for_end,
                            output,
                            status,
                            duration_ms,
                            parent_tool_use_id: None,
                            tool_use_result: None,
                        });
                    }
                    _ => {}
                }
            }
            "step_finish" => {
                let part = match raw.get("part") {
                    Some(p) => p,
                    None => return events,
                };

                let reason = part
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");

                // Extract token usage
                if let Some(tokens) = part.get("tokens") {
                    let _total = tokens.get("total").and_then(|v| v.as_u64()).unwrap_or(0);
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

                    events.push(BusEvent::UsageUpdate {
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
                    });
                }

                // Emit RunState based on reason
                let state = match reason {
                    "stop" => "completed",
                    "tool-calls" => "running",
                    _ => "running",
                };

                events.push(BusEvent::RunState {
                    run_id: run_id.to_string(),
                    state: state.to_string(),
                    exit_code: None,
                    error: None,
                });

                // Mark result event for terminal states
                if reason == "stop" {
                    self.got_result_event = true;
                }
            }
            "text" => {
                let part = match raw.get("part") {
                    Some(p) => p,
                    None => return events,
                };

                let text = part
                    .get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                if text.is_empty() {
                    return events;
                }

                let message_id = part
                    .get("messageID")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                // Avoid duplicate MessageComplete for same message_id
                if !self.emitted_message_ids.contains(&message_id) {
                    self.emitted_message_ids.insert(message_id.clone());
                    events.push(BusEvent::MessageComplete {
                        run_id: run_id.to_string(),
                        message_id,
                        text,
                        parent_tool_use_id: None,
                        model: None,
                        stop_reason: None,
                        message_usage: None,
                    });
                }
            }
            "reasoning" => {
                let part = match raw.get("part") {
                    Some(p) => p,
                    None => return events,
                };

                let text = part
                    .get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                if !text.is_empty() {
                    events.push(BusEvent::MessageDelta {
                        run_id: run_id.to_string(),
                        text: format!("[thinking] {text}"),
                        parent_tool_use_id: None,
                    });
                }
            }
            "error" => {
                let error_msg = raw
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

                events.push(BusEvent::RunState {
                    run_id: run_id.to_string(),
                    state: "failed".to_string(),
                    exit_code: None,
                    error: Some(error_msg),
                });
            }
            // SSE events from MiMo server mode
            "server.connected" | "server.heartbeat" => {
                // Skip
            }
            _ => {
                // Unknown event — emit as Raw for protocol inspection
                self.stats.unknown_event_count += 1;
                events.push(BusEvent::Raw {
                    run_id: run_id.to_string(),
                    source: "mimo_stdout".to_string(),
                    data: raw.clone(),
                });
            }
        }

        events
    }

    pub(super) fn map_event_cursor(&mut self, run_id: &str, raw: &Value) -> Vec<BusEvent> {
        use crate::agent::protocol::{ParseResult, ProtocolParser};
        let line = raw.to_string();
        match self.cursor_parser.parse_line(run_id, &line) {
            ParseResult::Events(events) => events,
            ParseResult::Skip => vec![],
            ParseResult::Raw(_) => vec![BusEvent::Raw {
                run_id: run_id.to_string(),
                source: "cursor_stdout".to_string(),
                data: raw.clone(),
            }],
            ParseResult::Error(message) => vec![BusEvent::RunState {
                run_id: run_id.to_string(),
                state: "failed".to_string(),
                exit_code: None,
                error: Some(message),
            }],
        }
    }
}
