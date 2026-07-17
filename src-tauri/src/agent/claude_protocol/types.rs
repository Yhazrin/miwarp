//! Claude CLI stream-json protocol parser.
//!
//! Pure-function protocol mapping: raw JSON events → `Vec<BusEvent>`.
//! Encapsulates all accumulator state (tool tracking, JSON accumulation)
//! so callers only need `ProtocolState::new()` + `state.map_event(...)`.
//!
//! Also supports MiMo-Code JSON protocol via runtime_kind dispatch.

use serde_json::Value;

/// Extract a string field from a JSON Value, returning "" if missing/non-string.
#[inline]
pub(crate) fn str_field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(|v| v.as_str()).unwrap_or("")
}

/// Extract an optional owned string field from a JSON Value.
#[inline]
pub(crate) fn opt_str(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|v| v.as_str()).map(String::from)
}

/// Extract official context window percentages from Claude CLI payloads.
///
/// Claude CLI 2.1.6+ exposes status-line input as:
///   context_window.used_percentage / remaining_percentage
/// Keep the parser tolerant so result/status payloads with camelCase variants also work.
#[inline]
pub(crate) fn context_window_percentages(v: &Value) -> (Option<f64>, Option<f64>) {
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
