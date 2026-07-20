//! Claude Code native history session migration commands.
//!
//! Exports Claude Code history sessions from `~/.claude/projects/**/*.jsonl` as a portable
//! zip archive, and imports such archives into MiWarp without writing back to `~/.claude/projects/`.

use serde::{Deserialize, Serialize};

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub session_count: usize,
    pub total_bytes: u64,
    pub failures: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: usize,
    pub skipped: usize,
    pub duplicates: usize,
    pub failed: usize,
    pub missing_cwd: usize,
    pub details: Vec<ImportDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDetail {
    pub session_id: String,
    pub cwd: String,
    pub run_id: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

/// Progress event emitted on the `import:progress` channel after each session
/// in an archive is processed. The frontend subscribes to surface a live
/// status indicator (e.g. "3/12 imported") while a long-running import runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgressEvent {
    pub done: usize,
    pub total: usize,
    pub last_session_id: String,
    pub last_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ArchiveManifest {
    pub(super) version: String,
    pub(super) created_at: String,
    pub(super) cli_version: Option<String>,
    pub(super) sessions: Vec<ManifestSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ManifestSession {
    pub(super) session_id: String,
    pub(super) cwd: String,
    pub(super) relative_path: String,
    pub(super) file_size: u64,
    pub(super) first_prompt: Option<String>,
    pub(super) started_at: Option<String>,
    pub(super) last_activity_at: Option<String>,
    pub(super) message_count: u32,
    pub(super) model: Option<String>,
}
