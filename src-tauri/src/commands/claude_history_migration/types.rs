//! Claude Code native history session migration commands.
//!
//! Exports Claude Code history sessions from `~/.claude/projects/**/*.jsonl` as a portable
//! zip archive, and imports such archives into MiWarp without writing back to `~/.claude/projects/`.

use crate::models::protocol_state::{validate_bus_event, ProtocolState};
use crate::models::{
    BusEvent, ConversationRef, ExecutionPath, ImportWatermark, RunMeta, RunSource, RunStatus,
};
use crate::storage::cli_sessions::normalize_transcript_line;
use crate::storage::events::{is_replayable, EventWriter};
use crate::storage::shared;
use crate::storage::{ensure_dir, run_dir, runs_dir};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

const ARCHIVE_VERSION: &str = "1.0";
const MANIFEST_NAME: &str = "manifest.json";

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
struct ArchiveManifest {
    version: String,
    created_at: String,
    cli_version: Option<String>,
    sessions: Vec<ManifestSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestSession {
    session_id: String,
    cwd: String,
    relative_path: String,
    file_size: u64,
    first_prompt: Option<String>,
    started_at: Option<String>,
    last_activity_at: Option<String>,
    message_count: u32,
    model: Option<String>,
}

// ── Export ────────────────────────────────────────────────────────────────────

#[tauri::command]
