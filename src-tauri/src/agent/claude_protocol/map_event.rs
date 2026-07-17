//! Claude CLI stream-json protocol parser.
//!
//! Pure-function protocol mapping: raw JSON events → `Vec<BusEvent>`.
//! Encapsulates all accumulator state (tool tracking, JSON accumulation)
//! so callers only need `ProtocolState::new()` + `state.map_event(...)`.
//!
//! Also supports MiMo-Code JSON protocol via runtime_kind dispatch.

use crate::models::{AgentRuntimeKind, BusEvent};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use crate::models::protocol_state::ProtocolState;

    pub fn map_event(&mut self, run_id: &str, raw: &Value) -> Vec<BusEvent> {
        // Dispatch to MiMo protocol if runtime_kind is MiMoCode
        if self.runtime_kind == AgentRuntimeKind::MiMoCode {
            return self.map_event_mimo(run_id, raw);
        }
        if self.runtime_kind == AgentRuntimeKind::Cursor {
            return self.map_event_cursor(run_id, raw);
        }

        let mut events = Vec::new();

        // Unwrap stream_event envelope: CLI wraps API streaming events as
        // {type: "stream_event", event: {type: "content_block_delta", ...}}
        let (raw, parent_tool_use_id) = if str_field(raw, "type") == "stream_event" {
            let inner = raw.get("event");
            if let Some(inner_val) = inner.filter(|v| {
                v.get("type")
                    .and_then(|t| t.as_str())
                    .is_some_and(|s| !s.is_empty())
            }) {
                if !self.seen_stream_event_envelope {
                    log::debug!("[protocol] unwrapping stream_event envelope (first occurrence)");
                    self.seen_stream_event_envelope = true;
                }
                let ptui = inner_val
                    .get("parent_tool_use_id")
                    .or_else(|| raw.get("parent_tool_use_id"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                (inner_val, ptui)
            } else {
                // Malformed stream_event: keep outer → falls through to BusEvent::Raw
                let ptui = raw
                    .get("parent_tool_use_id")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                (raw, ptui)
            }
        } else {
            let ptui = raw
                .get("parent_tool_use_id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            (raw, ptui)
        };

        let event_type = str_field(raw, "type");

        match event_type {
            // ── system init ──
            "system" => {
                let subtype = str_field(raw, "subtype");
                if subtype == "init" {
                    let session_id = raw
                        .get("session_id")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let model = raw
                        .get("model")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let tools = raw
                        .get("tools")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| {
                                    v.get("name")
                                        .and_then(|n| n.as_str())
                                        .or_else(|| v.as_str())
                                        .map(|s| s.to_string())
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    let cwd = raw
                        .get("cwd")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    // Parse CLI slash commands (raw JSON pass-through)
                    let slash_commands = raw
                        .get("slash_commands")
                        .and_then(|v| v.as_array())
                        .cloned()
                        .unwrap_or_default();

                    // Parse MCP server info
                    let mcp_raw_count = raw
                        .get("mcp_servers")
                        .and_then(|v| v.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0);
                    let mcp_servers: Vec<crate::models::McpServerInfo> = raw
                        .get("mcp_servers")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|s| {
                                    let name = s.get("name").and_then(|v| v.as_str())?.to_string();
                                    let status = s
                                        .get("status")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("pending")
                                        .to_string();
                                    let server_type = opt_str(s, "type");
                                    let error = opt_str(s, "error");
                                    Some(crate::models::McpServerInfo {
                                        name,
                                        status,
                                        server_type,
                                        error,
                                    })
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    let mcp_dropped = mcp_raw_count.saturating_sub(mcp_servers.len());
                    if mcp_dropped > 0 {
                        log::debug!(
                            "[protocol] {} MCP server(s) dropped: missing name",
                            mcp_dropped
                        );
                        self.stats.parse_warn_count += mcp_dropped as u32;
                    }

                    // Extract verbose fields from system/init
                    let permission_mode = raw
                        .get("permissionMode")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let api_key_source = raw
                        .get("apiKeySource")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let claude_code_version = raw
                        .get("claude_code_version")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let output_style = raw
                        .get("output_style")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let agents: Vec<String> = raw
                        .get("agents")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    let skills: Vec<String> = raw
                        .get("skills")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    let plugins = raw
                        .get("plugins")
                        .and_then(|v| v.as_array())
                        .cloned()
                        .unwrap_or_default();
                    let fast_mode_state = raw
                        .get("fast_mode_state")
                        .and_then(|v| v.as_str())
                        .map(String::from);

                    log::debug!(
                        "[protocol] session_init: version={:?}, permission_mode={:?}, fast_mode={:?}, agents={}, skills={}",
                        claude_code_version,
                        permission_mode,
                        fast_mode_state,
                        agents.len(),
                        skills.len()
                    );

                    let plugin_errors: Vec<Value> = raw
                        .get("plugin_errors")
                        .and_then(|v| v.as_array())
                        .cloned()
                        .unwrap_or_default();

                    events.push(BusEvent::SessionInit {
                        run_id: run_id.to_string(),
                        session_id,
                        model,
                        tools,
                        cwd,
                        slash_commands,
                        mcp_servers,
                        permission_mode,
                        api_key_source,
                        claude_code_version,
                        output_style,
                        agents,
                        skills,
                        plugins,
                        plugin_errors,
                        fast_mode_state,
                    });
                    // Only emit RunState on the FIRST system/init:
                    // - New session: CLI is processing the initial prompt → "running"
                    // - Resume/continue: CLI loaded context, waiting for stdin → "idle"
                    // Subsequent system/init events (multi-turn) should NOT emit RunState:
                    // send_session_message already emits "running" and result emits "idle".
                    // Only emit RunState on the FIRST system/init, and only for NEW sessions.
                    // Resume/continue/fork: start_session already emits synthetic RunState(idle),
                    // so emitting another idle here would race with send_session_message's "running".
                    if !self.seen_first_init && !self.is_resume {
                        events.push(BusEvent::RunState {
                            run_id: run_id.to_string(),
                            state: "running".to_string(),
                            exit_code: None,
                            error: None,
                        });
                    }
                    self.seen_first_init = true;
                } else if subtype == "compact_boundary" {
                    let metadata = raw.get("compact_metadata");
                    let trigger = metadata
                        .and_then(|m| m.get("trigger"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("auto")
                        .to_string();
                    let pre_tokens = metadata
                        .and_then(|m| m.get("pre_tokens"))
                        .and_then(|v| v.as_u64());
                    log::debug!(
                        "[protocol] compact_boundary: trigger={}, pre_tokens={:?}",
                        trigger,
                        pre_tokens
                    );
                    events.push(BusEvent::CompactBoundary {
                        run_id: run_id.to_string(),
                        trigger,
                        pre_tokens,
                    });
                } else if subtype == "microcompact_boundary" {
                    log::debug!("[protocol] microcompact_boundary");
                    events.push(BusEvent::CompactBoundary {
                        run_id: run_id.to_string(),
                        trigger: "micro_auto".to_string(),
                        pre_tokens: None,
                    });
                } else if subtype == "status" {
                    let status = opt_str(raw, "status");
                    log::debug!("[protocol] system/status: {:?}", status);
                    events.push(BusEvent::SystemStatus {
                        run_id: run_id.to_string(),
                        status,
                        data: raw.clone(),
                    });
                    let (context_window_used_percentage, context_window_remaining_percentage) =
                        context_window_percentages(raw);
                    if context_window_used_percentage.is_some()
                        || context_window_remaining_percentage.is_some()
                    {
                        events.push(BusEvent::UsageUpdate {
                            run_id: run_id.to_string(),
                            input_tokens: 0,
                            output_tokens: 0,
                            cache_read_tokens: None,
                            cache_write_tokens: None,
                            total_cost_usd: 0.0,
                            turn_index: None,
                            model_usage: None,
                            context_window_used_percentage,
                            context_window_remaining_percentage,
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
                } else if subtype == "hook_started" {
                    let hook_event = raw
                        .get("hook_event")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let hook_id = raw
                        .get("hook_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let hook_name = raw
                        .get("hook_name")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    log::debug!(
                        "[protocol] hook_started: event={}, id={}, name={:?}",
                        hook_event,
                        hook_id,
                        hook_name
                    );
                    events.push(BusEvent::HookStarted {
                        run_id: run_id.to_string(),
                        hook_event,
                        hook_id,
                        data: raw.clone(),
                        hook_name,
                    });
                } else if subtype == "hook_progress" {
                    let hook_id = raw
                        .get("hook_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    log::trace!("[protocol] hook_progress: id={}", hook_id);
                    events.push(BusEvent::HookProgress {
                        run_id: run_id.to_string(),
                        hook_id,
                        data: raw.clone(),
                    });
                } else if subtype == "hook_response" {
                    let hook_id = raw
                        .get("hook_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let hook_event = raw
                        .get("hook_event")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let outcome = raw
                        .get("outcome")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let hook_name = raw
                        .get("hook_name")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let hook_stdout = opt_str(raw, "stdout");
                    let hook_stderr = opt_str(raw, "stderr");
                    let hook_exit_code = raw
                        .get("exit_code")
                        .and_then(|v| v.as_i64())
                        .map(|v| v as i32);
                    log::debug!(
                        "[protocol] hook_response: id={}, event={}, outcome={}, name={:?}, exit_code={:?}",
                        hook_id,
                        hook_event,
                        outcome,
                        hook_name,
                        hook_exit_code
                    );
                    events.push(BusEvent::HookResponse {
                        run_id: run_id.to_string(),
                        hook_id,
                        hook_event,
                        outcome,
                        data: raw.clone(),
                        hook_name,
                        stdout: hook_stdout,
                        stderr: hook_stderr,
                        exit_code: hook_exit_code,
                    });
                } else if subtype == "task_notification" {
                    let task_id = raw
                        .get("task_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let status = raw
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    log::debug!(
                        "[protocol] task_notification: task_id={}, status={}",
                        task_id,
                        status
                    );
                    events.push(BusEvent::TaskNotification {
                        run_id: run_id.to_string(),
                        task_id,
                        status,
                        data: raw.clone(),
                    });
                } else if subtype == "files_persisted" {
                    let files = raw.get("files").cloned().unwrap_or(Value::Array(vec![]));
                    log::debug!(
                        "[protocol] files_persisted: {} files",
                        files.as_array().map(|a| a.len()).unwrap_or(0)
                    );
                    events.push(BusEvent::FilesPersisted {
                        run_id: run_id.to_string(),
                        files,
                        data: raw.clone(),
                    });
                } else if subtype == "auth_status" {
                    let is_authenticating = raw
                        .get("isAuthenticating")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    let output = raw
                        .get("output")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    log::debug!(
                        "[protocol] auth_status: authenticating={}",
                        is_authenticating
                    );
                    events.push(BusEvent::AuthStatus {
                        run_id: run_id.to_string(),
                        is_authenticating,
                        output,
                        data: raw.clone(),
                    });
                } else if subtype == "local_command_output" {
                    // Slash command output via system event (newer CLI path).
                    // Always clear pending — even if content is empty, the CLI
                    // has acknowledged the command, so no fallback hint is needed.
                    self.pending_slash_command = None;
                    let content = raw
                        .get("content")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if !content.is_empty() {
                        log::debug!(
                            "[protocol] system/local_command_output ({} chars)",
                            content.len()
                        );
                        events.push(BusEvent::CommandOutput {
                            run_id: run_id.to_string(),
                            content,
                        });
                    }
                } else if !subtype.is_empty() {
                    // Unknown system subtype — wrap as Raw for forward compatibility
                    log::debug!("[protocol] unknown system subtype: {}", subtype);
                    self.stats.unknown_event_count += 1;
                    #[cfg(test)]
                    if self.strict_mode {
                        panic!("[STRICT] unknown system subtype: {}", subtype);
                    }
                    events.push(BusEvent::Raw {
                        run_id: run_id.to_string(),
                        source: format!("claude_system_{}", subtype),
                        data: raw.clone(),
                    });
                }
            }

            // ── streaming events (partial messages) ──
            "message_start" => {
                let message = raw.get("message").unwrap_or(raw);
                let mid = message
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let model = message
                    .get("model")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                if !mid.is_empty() {
                    self.current_message_id = Some(mid);
                }
                self.current_message_model = model;
                self.current_message_text.clear();
            }

            "content_block_start" => {
                // From --include-partial-messages: content block starting
                if let Some(content_block) = raw.get("content_block") {
                    let block_type = content_block
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    match block_type {
                        "tool_use" => {
                            let tool_use_id = content_block
                                .get("id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let tool_name = content_block
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            if !tool_use_id.is_empty() {
                                self.emitted_tool_ids
                                    .insert(tool_use_id.clone(), tool_name.clone());
                                self.input_json_accum
                                    .insert(tool_use_id.clone(), String::new());
                                self.last_tool_use_id = Some(tool_use_id.clone());
                                events.push(BusEvent::ToolStart {
                                    run_id: run_id.to_string(),
                                    tool_use_id,
                                    tool_name,
                                    input: Value::Null,
                                    parent_tool_use_id: parent_tool_use_id.clone(),
                                });
                            }
                        }
                        "thinking" => {
                            // Extended thinking block starting — initial thinking text (usually empty)
                            let text = content_block
                                .get("thinking")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            if !text.is_empty() {
                                events.push(BusEvent::ThinkingDelta {
                                    run_id: run_id.to_string(),
                                    text: text.to_string(),
                                    parent_tool_use_id: parent_tool_use_id.clone(),
                                });
                            }
                        }
                        _ => {}
                    }
                }
            }

            "content_block_delta" => {
                if let Some(delta) = raw.get("delta") {
                    let delta_type = str_field(delta, "type");
                    match delta_type {
                        "text_delta" => {
                            if let Some(text) = delta.get("text").and_then(|v| v.as_str()) {
                                if !text.is_empty() {
                                    self.current_message_text.push_str(text);
                                    events.push(BusEvent::MessageDelta {
                                        run_id: run_id.to_string(),
                                        text: text.to_string(),
                                        parent_tool_use_id: parent_tool_use_id.clone(),
                                    });
                                }
                            }
                        }
                        "thinking_delta" | "thinking" => {
                            // Extended thinking: stream reasoning text
                            let text = str_field(delta, "thinking");
                            if !text.is_empty() {
                                events.push(BusEvent::ThinkingDelta {
                                    run_id: run_id.to_string(),
                                    text: text.to_string(),
                                    parent_tool_use_id: parent_tool_use_id.clone(),
                                });
                            }
                        }
                        "input_json_delta" => {
                            // Accumulate partial JSON for tool input
                            if let Some(partial) =
                                delta.get("partial_json").and_then(|v| v.as_str())
                            {
                                // Route to the most recently started tool_use_id
                                if let Some(ref id) = self.last_tool_use_id {
                                    if let Some(accum) = self.input_json_accum.get_mut(id.as_str())
                                    {
                                        accum.push_str(partial);
                                    }
                                    // Emit delta event for real-time UI preview
                                    if !partial.is_empty() {
                                        events.push(BusEvent::ToolInputDelta {
                                            run_id: run_id.to_string(),
                                            tool_use_id: id.clone(),
                                            partial_json: partial.to_string(),
                                            parent_tool_use_id: parent_tool_use_id.clone(),
                                        });
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }

            "content_block_stop" => {
                // Content block finished — clean up the accumulated partial JSON
                // for the tool that just completed. The full input is available in
                // the subsequent `assistant` message, so the accumulator is no longer
                // needed. Keeping it would leak memory proportional to tool input size.
                if let Some(ref tool_id) = self.last_tool_use_id {
                    self.input_json_accum.remove(tool_id);
                }
            }

            "message_stop" => {
                self.flush_pending_message_complete(run_id, &parent_tool_use_id, &mut events);
            }

            // ── complete assistant message ──
            "assistant" => {
                let message = raw.get("message").unwrap_or(raw);
                let message_id = message
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_else(|| str_field(raw, "id"))
                    .to_string();

                // Extract per-message metadata from message object
                let msg_model = message
                    .get("model")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let msg_stop_reason = message
                    .get("stop_reason")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let msg_usage = message.get("usage").cloned();

                if msg_model.is_some() {
                    log::debug!(
                        "[protocol] assistant message: model={:?}, stop_reason={:?}",
                        msg_model,
                        msg_stop_reason
                    );
                }

                if let Some(content) = message.get("content").and_then(|v| v.as_array()) {
                    let mut text_parts: Vec<String> = Vec::new();

                    for block in content {
                        let block_type = str_field(block, "type");
                        match block_type {
                            "text" => {
                                if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                                    text_parts.push(t.to_string());
                                }
                            }
                            "tool_use" => {
                                let tool_use_id = block
                                    .get("id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                let tool_name = block
                                    .get("name")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                // Check if already emitted via streaming content_block_start
                                let already_emitted =
                                    self.emitted_tool_ids.contains_key(&tool_use_id);
                                // Always record id→name for ToolEnd lookup
                                self.emitted_tool_ids
                                    .entry(tool_use_id.clone())
                                    .or_insert_with(|| tool_name.clone());
                                // Only emit ToolStart if not already emitted from streaming
                                if !already_emitted {
                                    let input = block.get("input").cloned().unwrap_or(Value::Null);
                                    events.push(BusEvent::ToolStart {
                                        run_id: run_id.to_string(),
                                        tool_use_id,
                                        tool_name,
                                        input,
                                        parent_tool_use_id: parent_tool_use_id.clone(),
                                    });
                                }
                            }
                            _ => {}
                        }
                    }

                    let full_text = if !text_parts.is_empty() {
                        text_parts.join("")
                    } else {
                        self.current_message_text.clone()
                    };

                    if !full_text.is_empty() {
                        let mid = if message_id.is_empty() {
                            self.current_message_id
                                .clone()
                                .filter(|s| !s.is_empty())
                                .unwrap_or_else(|| {
                                    uuid::Uuid::new_v4().to_string()[..12].to_string()
                                })
                        } else {
                            message_id
                        };
                        self.emit_message_complete(
                            run_id,
                            &mut events,
                            mid,
                            full_text,
                            &parent_tool_use_id,
                            msg_model.clone(),
                            msg_stop_reason.clone(),
                            msg_usage.clone(),
                        );
                    }
                }
            }

            // ── user message (tool_result / command output) ──
            "user" => {
                // Extract tool_use_result (top-level on raw event, structured metadata)
                let tool_use_result = raw.get("tool_use_result").cloned();
                if tool_use_result.is_some() {
                    log::debug!(
                        "[protocol] tool_use_result present on user event: {}",
                        tool_use_result
                            .as_ref()
                            .and_then(|v| v.get("type"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown")
                    );
                }

                let message = raw.get("message").unwrap_or(raw);

                // Check for slash command output: content is a string wrapped in
                // <local-command-stdout>...</local-command-stdout> tags.
                if let Some(text) = message.get("content").and_then(|v| v.as_str()) {
                    if text.starts_with("<local-command-stdout>") {
                        let inner = text.strip_prefix("<local-command-stdout>").unwrap_or(text);
                        let inner = inner
                            .strip_suffix("</local-command-stdout>")
                            .unwrap_or(inner)
                            .trim()
                            .to_string();
                        log::debug!("[protocol] command output detected ({} chars)", inner.len());
                        // Normal path succeeded — clear pending so hint won't fire
                        self.pending_slash_command = None;
                        events.push(BusEvent::CommandOutput {
                            run_id: run_id.to_string(),
                            content: inner,
                        });
                        return events;
                    }
                }

                // Background agent task notification (e.g., /batch worker completion).
                // Format: <task-notification><task-id>...</task-id>...</task-notification>
                // Require both open and close tags to avoid false positives from
                // user-pasted XML tutorial text.
                // TODO: CLI currently sends as content string. If it changes to
                // content array with text blocks, also check array items.
                if let Some(text) = message.get("content").and_then(|v| v.as_str()) {
                    if text.contains("<task-notification>") && text.contains("</task-notification>")
                    {
                        let task_id = extract_xml_tag(text, "task-id");
                        let status = extract_xml_tag(text, "status");

                        // task_id and status are required — skip event if missing
                        // to avoid empty-key pollution in frontend taskNotifications Map
                        if let (Some(tid), Some(st)) = (task_id, status) {
                            let tool_use_id = extract_xml_tag(text, "tool-use-id");
                            let summary = extract_xml_tag(text, "summary");
                            let result_text = extract_xml_tag(text, "result");
                            let output_file = extract_xml_tag(text, "output-file");

                            // Build data object — Option<&str> serializes to null when
                            // None, ensuring frontend ?? falls back to existing values
                            let data = serde_json::json!({
                                "task_id": tid,
                                "tool_use_id": tool_use_id,
                                "status": st,
                                "summary": summary,
                                "result": result_text,
                                "output_file": output_file,
                            });

                            log::debug!(
                                "[protocol] task_notification (XML): task_id={}, status={}, tool_use_id={}",
                                tid,
                                st,
                                tool_use_id.unwrap_or("none")
                            );

                            events.push(BusEvent::TaskNotification {
                                run_id: run_id.to_string(),
                                task_id: tid.to_string(),
                                status: st.to_string(),
                                data,
                            });
                        } else {
                            log::warn!(
                                "[protocol] task_notification XML missing required fields: task_id={:?}, status={:?}",
                                task_id,
                                status
                            );
                        }
                        return events;
                    }
                }

                if let Some(content) = message.get("content").and_then(|v| v.as_array()) {
                    for block in content {
                        let block_type = str_field(block, "type");
                        if block_type == "tool_result" {
                            let tool_use_id = block
                                .get("tool_use_id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();

                            // Look up tool_name from id→name map, then evict —
                            // after ToolEnd the entry is dead and would leak forever.
                            let tool_name = self
                                .emitted_tool_ids
                                .remove(&tool_use_id)
                                .unwrap_or_default();
                            let output = block.get("content").cloned().unwrap_or(Value::Null);
                            let is_error = block
                                .get("is_error")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            let status = if is_error {
                                "error".to_string()
                            } else {
                                "success".to_string()
                            };

                            events.push(BusEvent::ToolEnd {
                                run_id: run_id.to_string(),
                                tool_use_id,
                                tool_name,
                                output,
                                status,
                                duration_ms: None,
                                parent_tool_use_id: parent_tool_use_id.clone(),
                                tool_use_result: tool_use_result.clone(),
                            });
                        }
                    }
                }
            }

            // ── result (turn complete) ──
            "result" => {
                self.flush_pending_message_complete(run_id, &parent_tool_use_id, &mut events);
                // Turn boundary — evict dedup sets that are only valid within a single turn.
                // Next turn gets fresh message_ids and tool_ids from the CLI.
                self.emitted_message_ids.clear();
                self.emitted_tool_ids.clear();
                self.input_json_accum.clear();
                let subtype = str_field(raw, "subtype");

                // Extract usage
                if let Some(usage) = raw.get("usage") {
                    let input_tokens = usage
                        .get("input_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let output_tokens = usage
                        .get("output_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let cache_read = usage
                        .get("cache_read_input_tokens")
                        .and_then(|v| v.as_u64());
                    let cache_write = usage
                        .get("cache_creation_input_tokens")
                        .and_then(|v| v.as_u64());
                    let cost = raw
                        .get("cost_usd")
                        .and_then(|v| v.as_f64())
                        .or_else(|| raw.get("total_cost_usd").and_then(|v| v.as_f64()))
                        .unwrap_or(0.0);

                    // Parse per-model usage breakdown (camelCase keys from CLI)
                    let model_usage =
                        raw.get("modelUsage")
                            .and_then(|v| v.as_object())
                            .map(|obj| {
                                obj.iter()
                                    .map(|(model_name, entry)| {
                                        let mu = crate::models::ModelUsageEntry {
                                            input_tokens: entry
                                                .get("inputTokens")
                                                .and_then(|v| v.as_u64())
                                                .unwrap_or(0),
                                            output_tokens: entry
                                                .get("outputTokens")
                                                .and_then(|v| v.as_u64())
                                                .unwrap_or(0),
                                            cache_read_tokens: entry
                                                .get("cacheReadInputTokens")
                                                .and_then(|v| v.as_u64())
                                                .unwrap_or(0),
                                            cache_write_tokens: entry
                                                .get("cacheCreationInputTokens")
                                                .and_then(|v| v.as_u64())
                                                .unwrap_or(0),
                                            web_search_requests: entry
                                                .get("webSearchRequests")
                                                .and_then(|v| v.as_u64())
                                                .unwrap_or(0),
                                            cost_usd: entry
                                                .get("costUSD")
                                                .and_then(|v| v.as_f64())
                                                .unwrap_or(0.0),
                                            context_window: entry
                                                .get("contextWindow")
                                                .and_then(|v| v.as_u64()),
                                            max_output_tokens: entry
                                                .get("maxOutputTokens")
                                                .and_then(|v| v.as_u64()),
                                        };
                                        (model_name.clone(), mu)
                                    })
                                    .collect::<HashMap<_, _>>()
                            });

                    // Recalculate cost using our pricing table for accurate third-party model costs.
                    // CLI uses its own (often Claude-based) pricing, which is wrong for providers
                    // like DeepSeek, MiniMax, etc.
                    let (cost, model_usage) = if let Some(mut mu) = model_usage {
                        let mut total = 0.0_f64;
                        let mut rebuilt: std::collections::HashMap<
                            String,
                            crate::models::ModelUsageEntry,
                        > = std::collections::HashMap::with_capacity(mu.len());
                        for (model_name, entry) in mu.iter_mut() {
                            let recalculated = crate::pricing::estimate_cost(
                                model_name,
                                entry.input_tokens,
                                entry.output_tokens,
                                entry.cache_read_tokens,
                                entry.cache_write_tokens,
                            );
                            entry.cost_usd = recalculated;
                            total += recalculated;
                            // P1-2：归一化 model ID 再写回 map，避免不同 provider 风格
                            // 的同名模型被拆成两条聚合记录。
                            let key = crate::pricing::normalize_model_id(model_name);
                            rebuilt
                                .entry(key)
                                .and_modify(|e| {
                                    e.input_tokens += entry.input_tokens;
                                    e.output_tokens += entry.output_tokens;
                                    e.cache_read_tokens += entry.cache_read_tokens;
                                    e.cache_write_tokens += entry.cache_write_tokens;
                                    e.cost_usd += entry.cost_usd;
                                })
                                .or_insert_with(|| entry.clone());
                        }
                        (total, Some(rebuilt))
                    } else {
                        (cost, None)
                    };

                    let duration_api_ms = raw.get("duration_api_ms").and_then(|v| v.as_u64());

                    // Extract new result-level fields
                    let duration_ms = raw.get("duration_ms").and_then(|v| v.as_u64());
                    let num_turns = raw.get("num_turns").and_then(|v| v.as_u64());
                    let result_stop_reason = raw
                        .get("stop_reason")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let (context_window_used_percentage, context_window_remaining_percentage) =
                        context_window_percentages(raw);

                    // Extract from usage sub-fields
                    let service_tier = usage
                        .get("service_tier")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let speed = usage
                        .get("speed")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let web_fetch_requests = usage
                        .get("server_tool_use")
                        .and_then(|v| v.get("web_fetch_requests"))
                        .and_then(|v| v.as_u64());
                    let cache_creation = usage.get("cache_creation");
                    let cache_creation_5m = cache_creation
                        .and_then(|c| c.get("ephemeral_5m_input_tokens"))
                        .and_then(|v| v.as_u64());
                    let cache_creation_1h = cache_creation
                        .and_then(|c| c.get("ephemeral_1h_input_tokens"))
                        .and_then(|v| v.as_u64());

                    if duration_ms.is_some() || num_turns.is_some() {
                        log::debug!(
                            "[protocol] result: duration_ms={:?}, num_turns={:?}, service_tier={:?}, speed={:?}",
                            duration_ms,
                            num_turns,
                            service_tier,
                            speed
                        );
                    }

                    events.push(BusEvent::UsageUpdate {
                        run_id: run_id.to_string(),
                        input_tokens,
                        output_tokens,
                        cache_read_tokens: cache_read,
                        cache_write_tokens: cache_write,
                        total_cost_usd: cost,
                        turn_index: None, // Injected by session_actor for user turns
                        model_usage,
                        context_window_used_percentage,
                        context_window_remaining_percentage,
                        duration_api_ms,
                        duration_ms,
                        num_turns,
                        stop_reason: result_stop_reason,
                        service_tier,
                        speed,
                        web_fetch_requests,
                        cache_creation_5m,
                        cache_creation_1h,
                    });

                    // Hint: if CLI didn't emit <local-command-stdout> for a pending
                    // slash command, show a friendly message instead of silent failure.
                    if let Some(cmd) = self.pending_slash_command.take() {
                        let hint = match cmd.as_str() {
                            "/cost" => "The /cost output is not available in the current CLI version. Cumulative cost is shown in the status bar.",
                            "/context" => "The /context output is not available in the current CLI version. Run /context in a terminal session instead.",
                            _ => "",
                        };
                        if !hint.is_empty() {
                            log::debug!("[protocol] slash command hint for {}", cmd);
                            events.push(BusEvent::CommandOutput {
                                run_id: run_id.to_string(),
                                content: hint.to_string(),
                            });
                        }
                    }
                }

                // Parse permission_denials from result event
                if let Some(denials) = raw.get("permission_denials").and_then(|v| v.as_array()) {
                    for denial in denials {
                        let tool_name = denial
                            .get("tool_name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let tool_use_id = denial
                            .get("tool_use_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let tool_input = denial.get("tool_input").cloned().unwrap_or(Value::Null);
                        if !tool_name.is_empty() {
                            log::debug!(
                                "[protocol] permission_denied: tool={}, id={}",
                                tool_name,
                                tool_use_id
                            );
                            events.push(BusEvent::PermissionDenied {
                                run_id: run_id.to_string(),
                                tool_name,
                                tool_use_id,
                                tool_input,
                            });
                        }
                    }
                }

                if subtype.starts_with("error") {
                    // Read both `error` (singular string) and `errors` (plural array)
                    let error_msg = raw
                        .get("error")
                        .and_then(|v| v.as_str())
                        .map(String::from)
                        .or_else(|| {
                            raw.get("errors").and_then(|v| v.as_array()).map(|arr| {
                                arr.iter()
                                    .filter_map(|v| v.as_str())
                                    .collect::<Vec<_>>()
                                    .join("; ")
                            })
                        })
                        .unwrap_or_else(|| "Unknown error".to_string());
                    self.got_result_event = true;
                    self.result_subtype = Some(subtype.to_string());
                    log::debug!(
                        "[protocol] result error: subtype={}, msg={}",
                        subtype,
                        &error_msg[..error_msg.len().min(200)]
                    );
                    events.push(BusEvent::RunState {
                        run_id: run_id.to_string(),
                        state: "failed".to_string(),
                        exit_code: None,
                        error: Some(error_msg),
                    });
                } else {
                    // "idle" = turn complete, waiting for next user input.
                    // The actual "completed" state is emitted on process EOF (read_stdout cleanup).
                    events.push(BusEvent::RunState {
                        run_id: run_id.to_string(),
                        state: "idle".to_string(),
                        exit_code: None,
                        error: None,
                    });
                }
            }

            // ── tool progress (top-level event type) ──
            "tool_progress" => {
                let tool_use_id = raw
                    .get("tool_use_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let elapsed_time_seconds = raw.get("elapsed_time_seconds").and_then(|v| v.as_f64());
                log::trace!(
                    "[protocol] tool_progress: tool={}, elapsed={:?}s",
                    tool_use_id,
                    elapsed_time_seconds
                );
                events.push(BusEvent::ToolProgress {
                    run_id: run_id.to_string(),
                    tool_use_id,
                    elapsed_time_seconds,
                    data: raw.clone(),
                    parent_tool_use_id: parent_tool_use_id.clone(),
                });
            }

            // ── tool use summary (top-level event type) ──
            "tool_use_summary" => {
                let tool_use_id = raw
                    .get("tool_use_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let summary = raw
                    .get("summary")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let preceding = raw
                    .get("preceding_tool_use_ids")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                log::debug!(
                    "[protocol] tool_use_summary: tool={}, summary_len={}",
                    tool_use_id,
                    summary.len()
                );
                events.push(BusEvent::ToolUseSummary {
                    run_id: run_id.to_string(),
                    tool_use_id,
                    summary,
                    preceding_tool_use_ids: preceding,
                    data: raw.clone(),
                    parent_tool_use_id: parent_tool_use_id.clone(),
                });
            }

            // ── rate limit event (top-level) ──
            "rate_limit_event" => {
                let info = raw.get("rate_limit_info");
                let status = info
                    .and_then(|v| v.get("status"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("allowed")
                    .to_string();
                let resets_at = info
                    .and_then(|v| v.get("resetsAt"))
                    .and_then(|v| v.as_f64());
                let rate_limit_type = info
                    .and_then(|v| v.get("rateLimitType"))
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let utilization = info
                    .and_then(|v| v.get("utilization"))
                    .and_then(|v| v.as_f64());
                log::debug!(
                    "[protocol] rate_limit_event: status={}, type={:?}, utilization={:?}",
                    status,
                    rate_limit_type,
                    utilization
                );
                events.push(BusEvent::RateLimitEvent {
                    run_id: run_id.to_string(),
                    status,
                    resets_at,
                    rate_limit_type,
                    utilization,
                    data: raw.clone(),
                });
            }

            // ── fallback: raw ──
            _ => {
                if !event_type.is_empty() {
                    log::debug!("[protocol] unknown event type: {}", event_type);
                    self.stats.unknown_event_count += 1;
                    #[cfg(test)]
                    if self.strict_mode {
                        panic!("[STRICT] unknown event type: {}", event_type);
                    }
                    events.push(BusEvent::Raw {
                        run_id: run_id.to_string(),
                        source: format!("claude_{}", event_type),
                        data: raw.clone(),
                    });
                } else {
                    self.stats.dropped_count += 1;
                    #[cfg(test)]
                    if self.strict_mode {
                        panic!("[STRICT] empty event type (dropped)");
                    }
                }
            }
        }

        events
    }

    /// Map a single MiMo-Code JSON event into zero or more `BusEvent`s.
    ///
    /// MiMo-Code event types (from `mimo run --format json`):
    ///   - step_start: new agent step begins (skip)
    ///   - tool_use: tool call with input/output (status: running/completed/error)
    ///   - step_finish: step completed (reason: "tool-calls" | "stop")
    ///   - text: assistant text output (complete, not delta)
    ///   - reasoning: thinking blocks
    ///   - error: error event
