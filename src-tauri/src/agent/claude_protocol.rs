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

/// Extract a string field from a JSON Value, returning "" if missing/non-string.
#[inline]
fn str_field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(|v| v.as_str()).unwrap_or("")
}

/// Extract an optional owned string field from a JSON Value.
#[inline]
fn opt_str(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|v| v.as_str()).map(String::from)
}

/// Extract official context window percentages from Claude CLI payloads.
///
/// Claude CLI 2.1.6+ exposes status-line input as:
///   context_window.used_percentage / remaining_percentage
/// Keep the parser tolerant so result/status payloads with camelCase variants also work.
#[inline]
fn context_window_percentages(v: &Value) -> (Option<f64>, Option<f64>) {
    let Some(ctx) = v.get("context_window").or_else(|| v.get("contextWindow")) else {
        return (None, None);
    };
    let used = ctx
        .get("used_percentage")
        .or_else(|| ctx.get("usedPercentage"))
        .and_then(|v| v.as_f64());
    let remaining = ctx
        .get("remaining_percentage")
        .or_else(|| ctx.get("remainingPercentage"))
        .and_then(|v| v.as_f64());
    (used, remaining)
}

/// Parsing statistics for Claude protocol — accumulated per-session, never reset.
/// Codex stats are NOT included here; Codex path only logs, no counters
/// (codex_parser lives in a separate stream.rs path, not ProtocolState).
#[derive(Debug, Clone, Default)]
pub struct ParserStats {
    /// Events with unknown type (→ Raw fallback)
    pub unknown_event_count: u32,
    /// Events with known type but malformed/missing fields (logged but emitted)
    pub parse_warn_count: u32,
    /// Events that failed output validation and were dropped
    pub invalid_tool_count: u32,
    /// Events explicitly dropped (empty type field)
    pub dropped_count: u32,
}

/// Validation outcome — None means valid, Some means invalid with reason.
pub struct ValidationWarn {
    pub event_type: &'static str,
    pub field: &'static str,
    pub detail: String,
}

/// Validate a BusEvent before emission. Returns Some(warn) if the event
/// should be dropped (invalid), None if it should be emitted (valid).
///
/// IMPORTANT: Only TOOL-class events can return Some (drop).
/// STATE-class events (RunState, SessionInit, UsageUpdate) NEVER return Some
/// because session_actor's quarantine/turn state machine depends on them.
pub fn validate_bus_event(ev: &BusEvent) -> Option<ValidationWarn> {
    match ev {
        // Tool-class: tool_use_id must be non-empty
        BusEvent::ToolStart { tool_use_id, .. }
        | BusEvent::ToolEnd { tool_use_id, .. }
        | BusEvent::ToolInputDelta { tool_use_id, .. } => {
            if tool_use_id.is_empty() {
                return Some(ValidationWarn {
                    event_type: "tool",
                    field: "tool_use_id",
                    detail: format!("empty tool_use_id in {:?}", std::mem::discriminant(ev)),
                });
            }
            None
        }
        BusEvent::ToolProgress { tool_use_id, .. }
        | BusEvent::ToolUseSummary { tool_use_id, .. } => {
            if tool_use_id.is_empty() {
                return Some(ValidationWarn {
                    event_type: "tool",
                    field: "tool_use_id",
                    detail: format!("empty tool_use_id in {:?}", std::mem::discriminant(ev)),
                });
            }
            None
        }
        // State-class: warn but NEVER drop
        BusEvent::RunState { state, .. } => {
            if state.is_empty() {
                log::warn!("[validate] RunState with empty state — passing through");
            }
            None // ALWAYS pass through
        }
        BusEvent::SessionInit { model, .. } => {
            if model.is_none() {
                log::debug!("[validate] SessionInit with no model — passing through");
            }
            None // ALWAYS pass through
        }
        // Everything else: pass through
        _ => None,
    }
}

/// Strict wrapper — panics if validate returns Some. Only exists in test binary.
#[cfg(test)]
pub fn validate_strict(ev: &BusEvent) {
    if let Some(warn) = validate_bus_event(ev) {
        panic!(
            "[STRICT] invalid event: {}.{}: {}",
            warn.event_type, warn.field, warn.detail
        );
    }
}

/// Accumulator state for a single Claude CLI session.
/// MiMo: track tool call start info for duration calculation.
#[allow(dead_code)]
struct MimoToolStartInfo {
    tool_name: String,
    start_time_ms: u64,
}

pub struct ProtocolState {
    /// Map tool_use_id → tool_name for reliable ToolEnd association
    emitted_tool_ids: HashMap<String, String>,
    /// Accumulate partial JSON input per tool_use_id
    input_json_accum: HashMap<String, String>,
    /// Track the most recently started tool_use_id (HashMap has no iteration order)
    last_tool_use_id: Option<String>,
    /// Whether a `result` event already emitted a terminal RunState
    pub got_result_event: bool,
    /// The `subtype` from the last `result` event (e.g. "error_max_turns", "error_input_too_long")
    pub result_subtype: Option<String>,
    /// Resume/continue/fork session — first system/init should emit RunState(idle)
    /// because the CLI is waiting for stdin input, not processing a prompt.
    is_resume: bool,
    /// Whether we've seen the first system/init. After the first one, subsequent
    /// system/init events (in multi-turn sessions) should NOT emit RunState at all —
    /// send_session_message already emits running, and result emits idle.
    seen_first_init: bool,
    /// Pending slash command (e.g. "/cost", "/context") — set by session_actor.
    /// If CLI doesn't emit `<local-command-stdout>` (cf6 bug), a friendly hint
    /// is emitted as CommandOutput on `result`.
    pending_slash_command: Option<String>,
    /// Parsing statistics — accumulated per-session, never reset.
    pub stats: ParserStats,
    /// Log the first stream_event unwrap only (avoid log spam).
    seen_stream_event_envelope: bool,
    /// Current streaming assistant message id (from message_start).
    current_message_id: Option<String>,
    /// Accumulated text for the current assistant message (from text_delta).
    current_message_text: String,
    /// Model for the current assistant message.
    current_message_model: Option<String>,
    /// message_ids that already emitted MessageComplete this turn.
    emitted_message_ids: HashSet<String>,
    /// When true, map_event panics on unknown/invalid events instead of degrading gracefully.
    /// Only available in test builds — production always degrades.
    #[cfg(test)]
    strict_mode: bool,
    /// Which runtime backend this protocol state is for.
    /// Determines event dispatch in map_event.
    runtime_kind: AgentRuntimeKind,
    /// MiMo: track tool calls by callID for duration calc.
    mimo_tool_starts: HashMap<String, MimoToolStartInfo>,
    /// MiMo: extracted session ID from events.
    mimo_session_id: Option<String>,
    /// Cursor Agent CLI stream-json parser.
    cursor_parser: crate::agent::protocol::cursor::CursorProtocolParser,
}

/// Extract text content between simple XML tags: `<tag>content</tag>`.
/// Returns `None` if tag not found or content is empty — callers use
/// `None` → JSON `null` so frontend `??` correctly falls back to existing values.
fn extract_xml_tag<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let start = text.find(&open)?;
    let content_start = start + open.len();
    let end = text[content_start..].find(&close)?;
    let value = text[content_start..content_start + end].trim();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

impl ProtocolState {
    pub fn is_resume(&self) -> bool {
        self.is_resume
    }

    /// Set a pending slash command for friendly-hint fallback.
    pub fn set_pending_slash_command(&mut self, cmd: Option<String>) {
        log::debug!("[protocol] set_pending_slash_command: {:?}", cmd);
        self.pending_slash_command = cmd;
    }

    pub fn new(is_resume: bool) -> Self {
        Self::with_runtime(is_resume, AgentRuntimeKind::ClaudeCode)
    }

    pub fn with_runtime(is_resume: bool, runtime_kind: AgentRuntimeKind) -> Self {
        Self {
            emitted_tool_ids: HashMap::new(),
            input_json_accum: HashMap::new(),
            last_tool_use_id: None,
            got_result_event: false,
            result_subtype: None,
            is_resume,
            seen_first_init: false,
            pending_slash_command: None,
            stats: ParserStats::default(),
            seen_stream_event_envelope: false,
            current_message_id: None,
            current_message_text: String::new(),
            current_message_model: None,
            emitted_message_ids: HashSet::new(),
            #[cfg(test)]
            strict_mode: false,
            runtime_kind,
            mimo_tool_starts: HashMap::new(),
            mimo_session_id: None,
            cursor_parser: crate::agent::protocol::cursor::CursorProtocolParser::new(),
        }
    }

    /// Get the runtime kind for this protocol state.
    pub fn runtime_kind(&self) -> &AgentRuntimeKind {
        &self.runtime_kind
    }

    #[allow(clippy::too_many_arguments)]
    fn emit_message_complete(
        &mut self,
        run_id: &str,
        events: &mut Vec<BusEvent>,
        message_id: String,
        text: String,
        parent_tool_use_id: &Option<String>,
        model: Option<String>,
        stop_reason: Option<String>,
        message_usage: Option<Value>,
    ) {
        if text.is_empty() || self.emitted_message_ids.contains(&message_id) {
            return;
        }
        self.emitted_message_ids.insert(message_id.clone());
        log::debug!(
            "[protocol] MessageComplete: message_id={}, text.len={}",
            message_id,
            text.len()
        );
        events.push(BusEvent::MessageComplete {
            run_id: run_id.to_string(),
            message_id,
            text,
            parent_tool_use_id: parent_tool_use_id.clone(),
            model,
            stop_reason,
            message_usage,
        });
        self.current_message_text.clear();
    }

    fn flush_pending_message_complete(
        &mut self,
        run_id: &str,
        parent_tool_use_id: &Option<String>,
        events: &mut Vec<BusEvent>,
    ) {
        if self.current_message_text.is_empty() {
            return;
        }
        let mid = self
            .current_message_id
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()[..12].to_string());
        let text = std::mem::take(&mut self.current_message_text);
        self.emit_message_complete(
            run_id,
            events,
            mid,
            text,
            parent_tool_use_id,
            self.current_message_model.clone(),
            None,
            None,
        );
    }

    /// Create a strict-mode parser that panics on unknown/invalid events.
    /// Only available in test builds for strict fixture replay.
    #[cfg(test)]
    pub fn new_strict(is_resume: bool) -> Self {
        let mut s = Self::new(is_resume);
        s.strict_mode = true;
        s
    }

    /// Map a single raw Claude CLI JSON event into zero or more `BusEvent`s.
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
    fn map_event_mimo(&mut self, run_id: &str, raw: &Value) -> Vec<BusEvent> {
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

    fn map_event_cursor(&mut self, run_id: &str, raw: &Value) -> Vec<BusEvent> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const RUN: &str = "run-test";

    // ══════════════════════════════════════════════════════════════════
    //  P1-4：覆盖 MiMo/CLI 已知事件类型，确保不被 unknown 分支吞掉
    // ══════════════════════════════════════════════════════════════════

    #[test]
    fn test_p1_4_tool_result_standalone_completes_tool() {
        let mut ps = ProtocolState::with_runtime(false, AgentRuntimeKind::MiMoCode);
        // 先发 tool_use running
        let running = json!({
            "type": "tool_use",
            "part": {
                "tool": "Read",
                "callID": "call-1",
                "state": {
                    "status": "running",
                    "time": {"start": 100},
                    "input": {"path": "/x"}
                }
            },
            "timestamp": 100
        });
        ps.map_event(RUN, &running);
        let standalone_result = json!({
            "type": "tool_result",
            "part": {
                "callID": "call-1",
                "status": "completed",
                "output": "file contents"
            }
        });
        let events = ps.map_event(RUN, &standalone_result);
        assert_eq!(events.len(), 1, "应该单独发 ToolEnd");
        match &events[0] {
            BusEvent::ToolEnd {
                tool_use_id,
                status,
                ..
            } => {
                assert_eq!(tool_use_id, "call-1");
                assert_eq!(status, "completed");
            }
            other => panic!("expected ToolEnd, got {:?}", other),
        }
    }

    #[test]
    fn test_p1_4_usage_event_emits_usage_update() {
        let mut ps = ProtocolState::with_runtime(false, AgentRuntimeKind::MiMoCode);
        let raw = json!({
            "type": "usage",
            "part": {
                "input": 100,
                "output": 50,
                "cache_read": 30,
                "cost": 0.0123
            }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::UsageUpdate {
                input_tokens,
                output_tokens,
                cache_read_tokens,
                total_cost_usd,
                ..
            } => {
                assert_eq!(*input_tokens, 100);
                assert_eq!(*output_tokens, 50);
                assert_eq!(*cache_read_tokens, Some(30));
                assert!((total_cost_usd - 0.0123).abs() < 1e-9);
            }
            other => panic!("expected UsageUpdate, got {:?}", other),
        }
    }

    #[test]
    fn test_p1_4_progress_event_classified() {
        let mut ps = ProtocolState::with_runtime(false, AgentRuntimeKind::MiMoCode);
        let raw = json!({
            "type": "progress",
            "message": "compacting context..."
        });
        let before = ps.stats.unknown_event_count;
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        assert_eq!(
            ps.stats.unknown_event_count, before,
            "progress 不应该进 unknown 分支"
        );
    }

    #[test]
    fn test_p1_4_retry_event_classified() {
        let mut ps = ProtocolState::with_runtime(false, AgentRuntimeKind::MiMoCode);
        let raw = json!({
            "type": "retry",
            "attempt": 2,
            "message": "rate limited"
        });
        let before = ps.stats.unknown_event_count;
        let _ = ps.map_event(RUN, &raw);
        assert_eq!(
            ps.stats.unknown_event_count, before,
            "retry 不应该进 unknown 分支"
        );
    }

    #[test]
    fn test_p1_4_init_event_emits_raw_without_unknown() {
        let mut ps = ProtocolState::with_runtime(false, AgentRuntimeKind::MiMoCode);
        let raw = json!({"type": "init", "model": "opus-4"});
        let before = ps.stats.unknown_event_count;
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        assert_eq!(ps.stats.unknown_event_count, before);
        assert!(matches!(&events[0], BusEvent::Raw { .. }));
    }

    // ══════════════════════════════════════════════════════════════════
    //  Group A: Golden tests — one per event type, locks current behavior
    // ══════════════════════════════════════════════════════════════════

    #[test]
    fn test_system_init_new_session() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "system",
            "subtype": "init",
            "model": "opus-4",
            "tools": [{"name": "Bash"}, {"name": "Read"}],
            "cwd": "/project",
            "session_id": "ses-1"
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 2, "SessionInit + RunState(running)");
        match &events[0] {
            BusEvent::SessionInit {
                model,
                tools,
                cwd,
                session_id,
                ..
            } => {
                assert_eq!(model.as_deref(), Some("opus-4"));
                assert_eq!(tools, &vec!["Bash".to_string(), "Read".to_string()]);
                assert_eq!(cwd, "/project");
                assert_eq!(session_id.as_deref(), Some("ses-1"));
            }
            other => panic!("expected SessionInit, got {:?}", other),
        }
        match &events[1] {
            BusEvent::RunState { state, .. } => assert_eq!(state, "running"),
            other => panic!("expected RunState, got {:?}", other),
        }
    }

    #[test]
    fn test_system_init_resume_session() {
        let mut ps = ProtocolState::new(true); // resume
        let raw = json!({
            "type": "system",
            "subtype": "init",
            "model": "opus-4",
            "tools": [],
            "cwd": "/project",
            "session_id": "ses-2"
        });
        let events = ps.map_event(RUN, &raw);
        // Resume: SessionInit only, no RunState (start_session emits synthetic idle)
        assert_eq!(events.len(), 1, "resume: SessionInit only");
        assert!(matches!(&events[0], BusEvent::SessionInit { .. }));
    }

    #[test]
    fn test_system_init_second_call() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "system", "subtype": "init", "model": "opus-4", "tools": [], "cwd": "/"});
        let _first = ps.map_event(RUN, &raw);
        // Second call: SessionInit emitted but NO RunState (seen_first_init=true)
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], BusEvent::SessionInit { .. }));
    }

    #[test]
    fn test_system_compact_boundary() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "system",
            "subtype": "compact_boundary",
            "compact_metadata": {"trigger": "manual", "pre_tokens": 50000}
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::CompactBoundary {
                trigger,
                pre_tokens,
                ..
            } => {
                assert_eq!(trigger, "manual");
                assert_eq!(*pre_tokens, Some(50000));
            }
            other => panic!("expected CompactBoundary, got {:?}", other),
        }
    }

    #[test]
    fn test_system_microcompact_boundary() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "system", "subtype": "microcompact_boundary"});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::CompactBoundary {
                trigger,
                pre_tokens,
                ..
            } => {
                assert_eq!(trigger, "micro_auto");
                assert_eq!(*pre_tokens, None);
            }
            other => panic!("expected CompactBoundary, got {:?}", other),
        }
    }

    #[test]
    fn test_system_status() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "system", "subtype": "status", "status": "compacting"});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::SystemStatus { status, .. } => {
                assert_eq!(status.as_deref(), Some("compacting"));
            }
            other => panic!("expected SystemStatus, got {:?}", other),
        }
    }

    #[test]
    fn test_system_status_with_context_window_percentages() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "system",
            "subtype": "status",
            "status": "running",
            "context_window": {
                "used_percentage": 42.5,
                "remaining_percentage": 57.5
            }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 2);
        assert!(matches!(events[0], BusEvent::SystemStatus { .. }));
        match &events[1] {
            BusEvent::UsageUpdate {
                input_tokens,
                output_tokens,
                context_window_used_percentage,
                context_window_remaining_percentage,
                ..
            } => {
                assert_eq!(*input_tokens, 0);
                assert_eq!(*output_tokens, 0);
                assert_eq!(*context_window_used_percentage, Some(42.5));
                assert_eq!(*context_window_remaining_percentage, Some(57.5));
            }
            other => panic!("expected UsageUpdate, got {:?}", other),
        }
    }

    #[test]
    fn test_system_hook_started() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "system",
            "subtype": "hook_started",
            "hook_event": "PreToolUse",
            "hook_id": "h1",
            "hook_name": "lint-check"
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::HookStarted {
                hook_event,
                hook_id,
                hook_name,
                ..
            } => {
                assert_eq!(hook_event, "PreToolUse");
                assert_eq!(hook_id, "h1");
                assert_eq!(hook_name.as_deref(), Some("lint-check"));
            }
            other => panic!("expected HookStarted, got {:?}", other),
        }
    }

    #[test]
    fn test_system_hook_progress() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "system", "subtype": "hook_progress", "hook_id": "h1"});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::HookProgress { hook_id, .. } => assert_eq!(hook_id, "h1"),
            other => panic!("expected HookProgress, got {:?}", other),
        }
    }

    #[test]
    fn test_user_task_notification_xml() {
        let mut ps = ProtocolState::new(false);
        let xml = concat!(
            "<task-notification>\n",
            "<task-id>a9bb95555169d1db3</task-id>\n",
            "<tool-use-id>toolu_01KEqmg7q9uc7ZWouxEvYeHM</tool-use-id>\n",
            "<output-file>/tmp/tasks/a9bb9.output</output-file>\n",
            "<status>completed</status>\n",
            "<summary>Agent \"JSDoc for src/a.ts\" completed</summary>\n",
            "<result>PR: none — permission denied</result>\n",
            "</task-notification>"
        );
        let raw = json!({
            "type": "user",
            "message": { "content": xml }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::TaskNotification {
                task_id,
                status,
                data,
                ..
            } => {
                assert_eq!(task_id, "a9bb95555169d1db3");
                assert_eq!(status, "completed");
                assert_eq!(data["tool_use_id"], "toolu_01KEqmg7q9uc7ZWouxEvYeHM");
                assert_eq!(data["summary"], "Agent \"JSDoc for src/a.ts\" completed");
                assert_eq!(data["output_file"], "/tmp/tasks/a9bb9.output");
                assert_eq!(data["result"], "PR: none — permission denied");
            }
            other => panic!("expected TaskNotification, got {:?}", other),
        }
    }

    #[test]
    fn test_user_task_notification_xml_missing_task_id() {
        let mut ps = ProtocolState::new(false);
        let xml = concat!(
            "<task-notification>\n",
            "<status>completed</status>\n",
            "<summary>Agent completed</summary>\n",
            "</task-notification>"
        );
        let raw = json!({
            "type": "user",
            "message": { "content": xml }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(
            events.len(),
            0,
            "should not emit event when task-id is missing"
        );
    }

    #[test]
    fn test_user_task_notification_xml_missing_status() {
        let mut ps = ProtocolState::new(false);
        let xml = concat!(
            "<task-notification>\n",
            "<task-id>t1</task-id>\n",
            "<summary>Agent completed</summary>\n",
            "</task-notification>"
        );
        let raw = json!({
            "type": "user",
            "message": { "content": xml }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(
            events.len(),
            0,
            "should not emit event when status is missing"
        );
    }

    #[test]
    fn test_user_task_notification_xml_missing_optional_fields() {
        let mut ps = ProtocolState::new(false);
        let xml = concat!(
            "<task-notification>\n",
            "<task-id>t42</task-id>\n",
            "<status>running</status>\n",
            "</task-notification>"
        );
        let raw = json!({
            "type": "user",
            "message": { "content": xml }
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::TaskNotification {
                task_id,
                status,
                data,
                ..
            } => {
                assert_eq!(task_id, "t42");
                assert_eq!(status, "running");
                assert!(
                    data["tool_use_id"].is_null(),
                    "missing optional field should be null, not empty string"
                );
                assert!(data["summary"].is_null());
                assert!(data["output_file"].is_null());
            }
            other => panic!("expected TaskNotification, got {:?}", other),
        }
    }

    #[test]
    fn test_system_hook_response() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "system",
            "subtype": "hook_response",
            "hook_id": "h1",
            "hook_event": "PreToolUse",
            "outcome": "approved",
            "hook_name": "lint-check",
            "stdout": "ok",
            "stderr": "",
            "exit_code": 0
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::HookResponse {
                hook_id,
                hook_event,
                outcome,
                hook_name,
                stdout,
                stderr,
                exit_code,
                ..
            } => {
                assert_eq!(hook_id, "h1");
                assert_eq!(hook_event, "PreToolUse");
                assert_eq!(outcome, "approved");
                assert_eq!(hook_name.as_deref(), Some("lint-check"));
                assert_eq!(stdout.as_deref(), Some("ok"));
                assert_eq!(stderr.as_deref(), Some(""));
                assert_eq!(*exit_code, Some(0));
            }
            other => panic!("expected HookResponse, got {:?}", other),
        }
    }

    #[test]
    fn test_system_task_notification() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "system", "subtype": "task_notification", "task_id": "t1", "status": "started"});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::TaskNotification {
                task_id, status, ..
            } => {
                assert_eq!(task_id, "t1");
                assert_eq!(status, "started");
            }
            other => panic!("expected TaskNotification, got {:?}", other),
        }
    }

    #[test]
    fn test_system_files_persisted() {
        let mut ps = ProtocolState::new(false);
        let raw =
            json!({"type": "system", "subtype": "files_persisted", "files": ["a.rs", "b.rs"]});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::FilesPersisted { files, .. } => {
                assert_eq!(files.as_array().unwrap().len(), 2);
            }
            other => panic!("expected FilesPersisted, got {:?}", other),
        }
    }

    #[test]
    fn test_system_auth_status() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "system",
            "subtype": "auth_status",
            "isAuthenticating": true,
            "output": ["Logging in...", "Success"]
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::AuthStatus {
                is_authenticating,
                output,
                ..
            } => {
                assert!(*is_authenticating);
                assert_eq!(output, &vec!["Logging in...", "Success"]);
            }
            other => panic!("expected AuthStatus, got {:?}", other),
        }
    }

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
    fn test_system_local_command_output() {
        let mut ps = ProtocolState::new(false);
        ps.set_pending_slash_command(Some("/context".to_string()));

        // CLI sends system/local_command_output with content
        let raw = json!({
            "type": "system",
            "subtype": "local_command_output",
            "content": "## Context Usage\n\n**Model:** opus"
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::CommandOutput { content, .. } => {
                assert!(content.contains("Context Usage"));
            }
            other => panic!("expected CommandOutput, got {:?}", other),
        }

        // Behavior assertion: subsequent result should NOT emit a fallback hint
        // because pending_slash_command was already cleared by local_command_output.
        let result = json!({
            "type": "result",
            "subtype": "success",
            "usage": {"input_tokens": 10, "output_tokens": 5},
            "cost_usd": 0.001
        });
        let result_events = ps.map_event(RUN, &result);
        // Should be UsageUpdate + RunState(idle), no extra CommandOutput hint
        assert!(
            !result_events
                .iter()
                .any(|e| matches!(e, BusEvent::CommandOutput { .. })),
            "result should not emit fallback hint after local_command_output"
        );
    }

    #[test]
    fn test_system_local_command_output_empty_content_still_clears_pending() {
        let mut ps = ProtocolState::new(false);
        ps.set_pending_slash_command(Some("/context".to_string()));

        // CLI sends system/local_command_output with empty content (edge case)
        let raw = json!({
            "type": "system",
            "subtype": "local_command_output",
            "content": ""
        });
        let events = ps.map_event(RUN, &raw);
        // No CommandOutput emitted for empty content
        assert_eq!(events.len(), 0);

        // But pending_slash_command IS cleared → no fallback hint on result
        let result = json!({
            "type": "result",
            "subtype": "success",
            "usage": {"input_tokens": 10, "output_tokens": 5},
            "cost_usd": 0.001
        });
        let result_events = ps.map_event(RUN, &result);
        assert!(
            !result_events
                .iter()
                .any(|e| matches!(e, BusEvent::CommandOutput { .. })),
            "empty local_command_output should still prevent fallback hint"
        );
    }

    #[test]
    fn test_result_success() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "result",
            "subtype": "success",
            "usage": {"input_tokens": 100, "output_tokens": 50},
            "cost_usd": 0.01
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 2, "UsageUpdate + RunState(idle)");
        match &events[0] {
            BusEvent::UsageUpdate {
                input_tokens,
                output_tokens,
                total_cost_usd,
                ..
            } => {
                assert_eq!(*input_tokens, 100);
                assert_eq!(*output_tokens, 50);
                assert!(*total_cost_usd > 0.0);
            }
            other => panic!("expected UsageUpdate, got {:?}", other),
        }
        match &events[1] {
            BusEvent::RunState { state, error, .. } => {
                assert_eq!(state, "idle");
                assert!(error.is_none());
            }
            other => panic!("expected RunState, got {:?}", other),
        }
        assert!(
            !ps.got_result_event,
            "success doesn't set got_result_event (only error does)"
        );
    }

    #[test]
    fn test_result_error() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "result",
            "subtype": "error_max_turns",
            "error": "Max turns reached",
            "usage": {"input_tokens": 100, "output_tokens": 50}
        });
        let events = ps.map_event(RUN, &raw);
        // UsageUpdate + RunState(failed)
        assert!(events.len() >= 2);
        let run_state = events
            .iter()
            .find(|e| matches!(e, BusEvent::RunState { .. }))
            .unwrap();
        match run_state {
            BusEvent::RunState { state, error, .. } => {
                assert_eq!(state, "failed");
                assert_eq!(error.as_deref(), Some("Max turns reached"));
            }
            _ => unreachable!(),
        }
        assert!(ps.got_result_event);
        assert_eq!(ps.result_subtype.as_deref(), Some("error_max_turns"));
    }

    #[test]
    fn test_result_with_model_usage() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "result",
            "subtype": "success",
            "usage": {"input_tokens": 100, "output_tokens": 50},
            "modelUsage": {
                "opus-4": {
                    "inputTokens": 80,
                    "outputTokens": 40,
                    "cacheReadInputTokens": 0,
                    "cacheCreationInputTokens": 0,
                    "webSearchRequests": 0,
                    "costUSD": 0.005
                }
            }
        });
        let events = ps.map_event(RUN, &raw);
        let usage = events
            .iter()
            .find(|e| matches!(e, BusEvent::UsageUpdate { .. }))
            .unwrap();
        match usage {
            BusEvent::UsageUpdate { model_usage, .. } => {
                let mu = model_usage.as_ref().expect("should have model_usage");
                assert!(mu.contains_key("opus-4"));
                let entry = &mu["opus-4"];
                assert_eq!(entry.input_tokens, 80);
                assert_eq!(entry.output_tokens, 40);
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn test_result_with_context_window_percentages() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "result",
            "subtype": "success",
            "usage": {"input_tokens": 100, "output_tokens": 50},
            "context_window": {
                "used_percentage": 42.5,
                "remaining_percentage": 57.5
            }
        });
        let events = ps.map_event(RUN, &raw);
        let usage = events
            .iter()
            .find(|e| matches!(e, BusEvent::UsageUpdate { .. }))
            .unwrap();
        match usage {
            BusEvent::UsageUpdate {
                context_window_used_percentage,
                context_window_remaining_percentage,
                ..
            } => {
                assert_eq!(*context_window_used_percentage, Some(42.5));
                assert_eq!(*context_window_remaining_percentage, Some(57.5));
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn test_result_permission_denials() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "result",
            "subtype": "success",
            "usage": {"input_tokens": 10, "output_tokens": 5},
            "permission_denials": [
                {"tool_name": "Bash", "tool_use_id": "tu-1", "tool_input": {"cmd": "rm -rf /"}}
            ]
        });
        let events = ps.map_event(RUN, &raw);
        let denials: Vec<_> = events
            .iter()
            .filter(|e| matches!(e, BusEvent::PermissionDenied { .. }))
            .collect();
        assert_eq!(denials.len(), 1);
        match &denials[0] {
            BusEvent::PermissionDenied {
                tool_name,
                tool_use_id,
                ..
            } => {
                assert_eq!(tool_name, "Bash");
                assert_eq!(tool_use_id, "tu-1");
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn test_tool_progress() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "tool_progress",
            "tool_use_id": "tu-1",
            "elapsed_time_seconds": 3.5
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::ToolProgress {
                tool_use_id,
                elapsed_time_seconds,
                ..
            } => {
                assert_eq!(tool_use_id, "tu-1");
                assert_eq!(*elapsed_time_seconds, Some(3.5));
            }
            other => panic!("expected ToolProgress, got {:?}", other),
        }
    }

    #[test]
    fn test_tool_use_summary() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "tool_use_summary",
            "tool_use_id": "tu-1",
            "summary": "Ran tests successfully",
            "preceding_tool_use_ids": ["tu-0"]
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::ToolUseSummary {
                tool_use_id,
                summary,
                preceding_tool_use_ids,
                ..
            } => {
                assert_eq!(tool_use_id, "tu-1");
                assert_eq!(summary, "Ran tests successfully");
                assert_eq!(preceding_tool_use_ids, &vec!["tu-0".to_string()]);
            }
            other => panic!("expected ToolUseSummary, got {:?}", other),
        }
    }

    #[test]
    fn test_rate_limit_event() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "rate_limit_event",
            "rate_limit_info": {
                "status": "allowed_warning",
                "resetsAt": 1711900000.0,
                "rateLimitType": "five_hour",
                "utilization": 0.85
            },
            "uuid": "abc123",
            "session_id": "sess1"
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::RateLimitEvent {
                status,
                resets_at,
                rate_limit_type,
                utilization,
                ..
            } => {
                assert_eq!(status, "allowed_warning");
                assert!((resets_at.unwrap() - 1711900000.0).abs() < 0.1);
                assert_eq!(rate_limit_type.as_deref(), Some("five_hour"));
                assert!((utilization.unwrap() - 0.85).abs() < 0.01);
            }
            other => panic!("expected RateLimitEvent, got {:?}", other),
        }
        assert_eq!(
            ps.stats.unknown_event_count, 0,
            "rate_limit_event should NOT increment unknown counter"
        );
    }

    #[test]
    fn test_unknown_type_raw_fallback() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "new_feature_xyz", "data": {"hello": "world"}});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::Raw { source, data, .. } => {
                assert_eq!(source, "claude_new_feature_xyz");
                assert_eq!(data["type"].as_str().unwrap(), "new_feature_xyz");
            }
            other => panic!("expected Raw, got {:?}", other),
        }
        assert_eq!(
            ps.stats.unknown_event_count, 1,
            "unknown type should increment counter"
        );
    }

    #[test]
    fn test_empty_type_no_output() {
        let mut ps = ProtocolState::new(false);
        // type="" → fallback, but empty string is filtered → dropped_count
        let raw = json!({"type": "", "data": {}});
        let events = ps.map_event(RUN, &raw);
        assert!(events.is_empty(), "empty type should produce no events");
        assert_eq!(
            ps.stats.dropped_count, 1,
            "empty type increments dropped_count"
        );
    }

    #[test]
    fn test_no_type_field_no_output() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"data": {"stuff": true}});
        let events = ps.map_event(RUN, &raw);
        assert!(
            events.is_empty(),
            "missing type field should produce no events"
        );
    }

    #[test]
    fn test_content_block_stop_no_op() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "content_block_stop", "index": 0});
        let events = ps.map_event(RUN, &raw);
        assert!(events.is_empty(), "content_block_stop is a no-op");
    }

    #[test]
    fn test_message_stop_no_op() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "message_stop"});
        let events = ps.map_event(RUN, &raw);
        assert!(events.is_empty(), "message_stop is a no-op");
    }

    #[test]
    fn test_parent_tool_use_id_propagation() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "content_block_start",
            "parent_tool_use_id": "parent-task-1",
            "content_block": {"type": "tool_use", "id": "tu-sub", "name": "Bash"}
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::ToolStart {
                parent_tool_use_id, ..
            } => {
                assert_eq!(parent_tool_use_id.as_deref(), Some("parent-task-1"));
            }
            other => panic!("expected ToolStart, got {:?}", other),
        }
    }

    // ══════════════════════════════════════════════════════════════════
    //  Group B: Malformed field tests — lock current behavior for known defects
    // ══════════════════════════════════════════════════════════════════

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

    #[test]
    fn test_result_no_usage() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "result", "subtype": "success"});
        let events = ps.map_event(RUN, &raw);
        // No usage → no UsageUpdate, just RunState(idle)
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::RunState { state, .. } => assert_eq!(state, "idle"),
            other => panic!("expected RunState, got {:?}", other),
        }
    }

    #[test]
    fn test_system_init_no_model() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "system", "subtype": "init", "tools": [], "cwd": "/"});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 2);
        match &events[0] {
            BusEvent::SessionInit { model, .. } => {
                assert!(model.is_none(), "model is None when missing")
            }
            other => panic!("expected SessionInit, got {:?}", other),
        }
    }

    #[test]
    fn test_mcp_server_missing_name() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({
            "type": "system",
            "subtype": "init",
            "tools": [],
            "cwd": "/",
            "mcp_servers": [{"status": "running"}]
        });
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 2);
        match &events[0] {
            BusEvent::SessionInit { mcp_servers, .. } => {
                assert!(
                    mcp_servers.is_empty(),
                    "MCP server without name is dropped by filter_map"
                );
            }
            other => panic!("expected SessionInit, got {:?}", other),
        }
        assert_eq!(
            ps.stats.parse_warn_count, 1,
            "dropped MCP server counted as parse_warn"
        );
    }

    #[test]
    fn test_system_unknown_subtype() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "system", "subtype": "brand_new_feature"});
        let events = ps.map_event(RUN, &raw);
        // Phase 2: unknown system subtype now emits Raw (forward compatibility)
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::Raw { source, .. } => {
                assert_eq!(source, "claude_system_brand_new_feature");
            }
            other => panic!("expected Raw, got {:?}", other),
        }
        assert_eq!(ps.stats.unknown_event_count, 1);
    }

    #[test]
    fn test_tool_progress_no_tool_id() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "tool_progress"});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::ToolProgress {
                tool_use_id,
                elapsed_time_seconds,
                ..
            } => {
                assert_eq!(tool_use_id, "", "⚠️ empty tool_use_id leaks through");
                assert_eq!(*elapsed_time_seconds, None);
            }
            other => panic!("expected ToolProgress, got {:?}", other),
        }
    }

    #[test]
    fn test_tool_use_summary_no_tool_id() {
        let mut ps = ProtocolState::new(false);
        let raw = json!({"type": "tool_use_summary"});
        let events = ps.map_event(RUN, &raw);
        assert_eq!(events.len(), 1);
        match &events[0] {
            BusEvent::ToolUseSummary {
                tool_use_id,
                summary,
                ..
            } => {
                assert_eq!(tool_use_id, "", "⚠️ empty tool_use_id leaks through");
                assert_eq!(summary, "");
            }
            other => panic!("expected ToolUseSummary, got {:?}", other),
        }
    }

    // ══════════════════════════════════════════════════════════════════
    //  Phase 2 regression tests — guard validate_bus_event invariants
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

    // ══════════════════════════════════════════════════════════════════
    //  Group D: Strict mode — standard parse sequence through new_strict()
    // ══════════════════════════════════════════════════════════════════

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

    // ── stream_event envelope unwrapping ──

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
}
