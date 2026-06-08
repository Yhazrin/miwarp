//! Shared utility functions for CLI session import/sync/migration.
//!
//! Previously duplicated between `cli_sessions.rs` and `claude_history_migration.rs`.

use sha2::{Digest, Sha256};
use std::path::PathBuf;

/// Tools that must never be auto-approved regardless of permission mode.
pub const NEVER_ALLOW_TOOLS: &[&str] = &["ExitPlanMode", "EnterPlanMode"];

/// Path to `~/.claude/projects/`.
pub fn claude_projects_dir() -> Option<PathBuf> {
    super::dirs_next().map(|h| h.join(".claude").join("projects"))
}

/// SHA-256 hash of a string, returning first 12 hex chars.
pub fn sha256_short(s: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    let result = hasher.finalize();
    result[..6]
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>()
}

/// Generate a source_key for a transcript line.
pub fn line_key(raw: &serde_json::Value, byte_offset: u64, raw_trim: &str) -> String {
    let hash = sha256_short(raw_trim);
    let etype = raw
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    if let Some(uuid) = raw.get("uuid").and_then(|v| v.as_str()) {
        return uuid.to_string();
    }
    if let Some(ts) = raw.get("timestamp").and_then(|v| v.as_str()) {
        return format!("v1:{}:{}:{}", ts, etype, hash);
    }
    format!("v1:{}:{}:{}", byte_offset, etype, hash)
}

/// Generate an event-level key from line_key + event type + index.
pub fn event_key(lk: &str, event_type: &str, n: usize) -> String {
    format!("v1:{}#{}#{}", lk, event_type, n)
}

/// Get the serde tag ("type" field) of a BusEvent.
pub fn bus_event_tag(event: &crate::models::BusEvent) -> String {
    if let Ok(v) = serde_json::to_value(event) {
        if let Some(t) = v.get("type").and_then(|v| v.as_str()) {
            return t.to_string();
        }
    }
    "unknown".to_string()
}

/// Extract timestamp from a raw JSON value (CLI transcript line).
pub fn extract_timestamp(raw: &serde_json::Value) -> Option<String> {
    raw.get("timestamp")
        .and_then(|v| v.as_str())
        .map(String::from)
}

/// Check if text looks like a real user prompt (not a command/notification).
pub fn is_first_prompt_text(text: &str) -> bool {
    !(text.starts_with("<local-command-stdout>")
        || text.contains("<command-name>")
        || text.contains("<task-notification>") && text.contains("</task-notification>"))
}

/// Truncate a string to at most `max` bytes, snapping to a char boundary.
pub fn truncate_str(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}
