//! CLI session discovery, normalization, import, and incremental sync.
//!
//! Reads Claude CLI transcript files (~/.claude/projects/*/*.jsonl) and converts
//! them into MiWarp run format (~/.miwarp/runs/{run-id}/).

use crate::agent::claude_protocol::{validate_bus_event, ProtocolState};
use crate::models::{BusEvent, ImportWatermark, RunMeta, RunSource, RunStatus};
use crate::storage::events::{is_replayable, EventWriter};
use crate::storage::shared;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

// ── Types ────────────────────────────────────────────────────────────

/// CLI session summary (discovery phase output).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]

pub struct CliSessionSummary {
    pub session_id: String,
    pub cwd: String,
    pub first_prompt: String,
    pub started_at: String,
    pub last_activity_at: String,
    pub message_count: u32,
    pub model: Option<String>,
    pub cli_version: Option<String>,
    pub file_size: u64,
    pub file_path: String,
    pub has_subagents: bool,
    pub already_imported: bool,
    pub existing_run_id: Option<String>,
}

/// Import result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub run_id: String,
    pub session_id: String,
    pub events_imported: u64,
    pub events_skipped: u64,
    pub usage_incomplete: bool,
    pub skipped_subtypes: HashMap<String, u64>,
}

/// Discovery result with truncation metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverResult {
    pub sessions: Vec<CliSessionSummary>,
    pub total: usize,
    pub truncated: bool,
}

/// Incremental sync result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub new_events: u64,
    pub new_watermark: ImportWatermark,
    pub usage_incomplete: bool,
}

// ── Helpers ──────────────────────────────────────────────────────────

/// Encode cwd for Claude CLI directory naming: '/' and '\' → '-'.
