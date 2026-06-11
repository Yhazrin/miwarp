//! Claude Code protocol parser — wraps existing claude_protocol.rs logic.
//!
//! Maps Claude CLI stream-json events to MiWarp BusEvents.

use super::{ParseResult, ParserStats, ProtocolParser};
use crate::agent::claude_protocol::ProtocolState;

/// Claude Code protocol parser.
/// Wraps the existing `ProtocolState` from claude_protocol.rs.
pub struct ClaudeProtocolParser {
    state: ProtocolState,
    conversation_id: Option<String>,
    detected_model: Option<String>,
    stats: ParserStats,
}

impl ClaudeProtocolParser {
    pub fn new(is_resume: bool) -> Self {
        Self {
            state: ProtocolState::new(is_resume),
            conversation_id: None,
            detected_model: None,
            stats: ParserStats::default(),
        }
    }
}

impl ProtocolParser for ClaudeProtocolParser {
    fn parse_line(&mut self, run_id: &str, line: &str) -> ParseResult {
        self.stats.lines_parsed += 1;

        // Try to parse as JSON
        let payload: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                self.stats.parse_errors += 1;
                return ParseResult::Error(format!("JSON parse error: {e}"));
            }
        };

        // Map through existing claude_protocol logic
        let events = self.state.map_event(run_id, &payload);

        // Extract session ID from system/init events
        if self.conversation_id.is_none() {
            if let Some(sid) = extract_session_id(&payload) {
                self.conversation_id = Some(sid);
            }
        }

        // Extract model from events
        if self.detected_model.is_none() {
            if let Some(model) = extract_model(&payload) {
                self.detected_model = Some(model);
            }
        }

        if events.is_empty() {
            self.stats.events_skipped += 1;
            ParseResult::Skip
        } else {
            self.stats.events_emitted += events.len() as u64;
            ParseResult::Events(events)
        }
    }

    fn conversation_id(&self) -> Option<String> {
        self.conversation_id.clone()
    }

    fn detected_model(&self) -> Option<String> {
        self.detected_model.clone()
    }

    fn reset(&mut self) {
        let is_resume = self.state.is_resume();
        self.state = ProtocolState::new(is_resume);
        self.conversation_id = None;
        self.detected_model = None;
    }

    fn stats(&self) -> ParserStats {
        self.stats.clone()
    }
}

/// Extract session_id from Claude system/init event.
fn extract_session_id(payload: &serde_json::Value) -> Option<String> {
    let type_str = payload.get("type").and_then(|v| v.as_str())?;
    if type_str == "system" {
        let subtype = payload.get("subtype").and_then(|v| v.as_str())?;
        if subtype == "init" {
            return payload
                .get("session_id")
                .and_then(|v| v.as_str())
                .map(String::from);
        }
    }
    None
}

/// Extract model name from Claude events.
fn extract_model(payload: &serde_json::Value) -> Option<String> {
    // Check for model in various event types
    if let Some(model) = payload.get("model").and_then(|v| v.as_str()) {
        return Some(model.to_string());
    }
    if let Some(info) = payload.get("message") {
        if let Some(model) = info.get("model").and_then(|v| v.as_str()) {
            return Some(model.to_string());
        }
    }
    None
}
