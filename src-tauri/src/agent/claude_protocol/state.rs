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
use super::types::ParserStats;

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
