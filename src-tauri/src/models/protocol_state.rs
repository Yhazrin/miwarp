//! Claude protocol shared types — canonical location.
//!
//! `ProtocolState`, `validate_bus_event`, and supporting types live here so
//! both `agent::claude_protocol` (higher layer) and `storage::cli_sessions`
//! (leaf layer) can depend on them without a storage→agent reverse edge.
//!
//! The heavy `impl ProtocolState` methods (map_event, etc.) remain in
//! `agent::claude_protocol` — Rust allows inherent impl blocks in any
//! module of the same crate.

use crate::models::{AgentRuntimeKind, BusEvent};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

// ─── MimoToolStartInfo ───────────────────────────────────────────────

/// MiMo: track tool call start info for duration calculation.
#[allow(dead_code)]
pub(crate) struct MimoToolStartInfo {
    pub(crate) tool_name: String,
    pub(crate) start_time_ms: u64,
}

// ─── ParserStats ─────────────────────────────────────────────────────

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

// ─── ValidationWarn ──────────────────────────────────────────────────

/// Validation outcome — None means valid, Some means invalid with reason.
pub struct ValidationWarn {
    pub event_type: &'static str,
    pub field: &'static str,
    pub detail: String,
}

// ─── validate_bus_event ──────────────────────────────────────────────

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

// ─── ProtocolState ───────────────────────────────────────────────────

/// Accumulator state for a single CLI session.
///
/// Fields are `pub(crate)` so the `impl ProtocolState` blocks that live in
/// `agent::claude_protocol::{state,map_event,map_event_other}` can access
/// them without going through getters.
pub struct ProtocolState {
    /// Map tool_use_id → tool_name for reliable ToolEnd association
    pub(crate) emitted_tool_ids: HashMap<String, String>,
    /// Accumulate partial JSON input per tool_use_id
    pub(crate) input_json_accum: HashMap<String, String>,
    /// Track the most recently started tool_use_id (HashMap has no iteration order)
    pub(crate) last_tool_use_id: Option<String>,
    /// Whether a `result` event already emitted a terminal RunState
    pub got_result_event: bool,
    /// The `subtype` from the last `result` event (e.g. "error_max_turns", "error_input_too_long")
    pub result_subtype: Option<String>,
    /// Resume/continue/fork session — first system/init should emit RunState(idle)
    /// because the CLI is waiting for stdin input, not processing a prompt.
    pub(crate) is_resume: bool,
    /// Whether we've seen the first system/init. After the first one, subsequent
    /// system/init events (in multi-turn sessions) should NOT emit RunState at all —
    /// send_session_message already emits running, and result emits idle.
    pub(crate) seen_first_init: bool,
    /// Pending slash command (e.g. "/cost", "/context") — set by session_actor.
    /// If CLI doesn't emit `<local-command-stdout>` (cf6 bug), a friendly hint
    /// is emitted as CommandOutput on `result`.
    pub(crate) pending_slash_command: Option<String>,
    /// Parsing statistics — accumulated per-session, never reset.
    pub stats: ParserStats,
    /// Log the first stream_event unwrap only (avoid log spam).
    pub(crate) seen_stream_event_envelope: bool,
    /// Current streaming assistant message id (from message_start).
    pub(crate) current_message_id: Option<String>,
    /// Accumulated text for the current assistant message (from text_delta).
    pub(crate) current_message_text: String,
    /// Model for the current assistant message.
    pub(crate) current_message_model: Option<String>,
    /// message_ids that already emitted MessageComplete this turn.
    pub(crate) emitted_message_ids: HashSet<String>,
    /// When true, map_event panics on unknown/invalid events instead of degrading gracefully.
    /// Only available in test builds — production always degrades.
    #[cfg(test)]
    pub(crate) strict_mode: bool,
    /// Which runtime backend this protocol state is for.
    /// Determines event dispatch in map_event.
    pub(crate) runtime_kind: AgentRuntimeKind,
    /// MiMo: track tool calls by callID for duration calc.
    pub(crate) mimo_tool_starts: HashMap<String, MimoToolStartInfo>,
    /// MiMo: extracted session ID from events.
    pub(crate) mimo_session_id: Option<String>,
    /// Cursor Agent CLI stream-json parser.
    pub(crate) cursor_parser: crate::agent::protocol::cursor::CursorProtocolParser,
}
