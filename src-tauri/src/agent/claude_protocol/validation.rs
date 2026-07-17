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
use super::types::ValidationWarn;

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

