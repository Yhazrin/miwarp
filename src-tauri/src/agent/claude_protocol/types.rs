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
use super::state::ProtocolState;


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
