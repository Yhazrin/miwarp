//! Claude CLI stream-json protocol parser.
//!
//! Pure-function protocol mapping: raw JSON events → `Vec<BusEvent>`.
//! Encapsulates all accumulator state (tool tracking, JSON accumulation)
//! so callers only need `ProtocolState::new()` + `state.map_event(...)`.
//!
//! Also supports MiMo-Code JSON protocol via runtime_kind dispatch.

use crate::models::protocol_state::{ParserStats, ProtocolState};
use crate::models::{AgentRuntimeKind, BusEvent};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

/// Extract text content between simple XML tags: `<tag>content</tag>`.
/// Returns `None` if tag not found or content is empty — callers use
/// `None` → JSON `null` so frontend `??` correctly falls back to existing values.
pub(super) fn extract_xml_tag<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
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
    pub(super) fn emit_message_complete(
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

    pub(super) fn flush_pending_message_complete(
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
}
