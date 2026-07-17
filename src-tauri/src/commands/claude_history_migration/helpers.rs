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

pub(super) fn collect_jsonl_recursive(dir: &Path) -> std::io::Result<Vec<(PathBuf, u64)>> {
    let mut results = Vec::new();
    if dir.is_dir() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                results.extend(collect_jsonl_recursive(&path)?);
            } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                if let Ok(meta) = path.metadata() {
                    results.push((path, meta.len()));
                }
            }
        }
    }
    Ok(results)
}

fn should_exclude_path(rel_path: &str) -> bool {
    // Exclude ~/.claude.json and settings files
    rel_path.contains(".claude.json")
        || rel_path.contains("/settings.json")
        || rel_path.contains("settings.jsonl")
        // Exclude token/API key files
        || rel_path.contains(".token")
        || rel_path.contains(".api_key")
        || rel_path.contains("/.claude/")
}

fn export_single_session(
    zip: &mut ZipWriter<File>,
    options: SimpleFileOptions,
    jsonl_path: &Path,
    rel_path: &str,
    file_size: &u64,
) -> Result<(ManifestSession, u64), String> {
    // Read and parse the file to extract metadata
    let file = File::open(jsonl_path).map_err(|e| format!("open: {}", e))?;
    let reader = BufReader::new(file);

    let session_id = jsonl_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    let mut cwd: Option<String> = None;
    let mut first_prompt: Option<String> = None;
    let mut started_at: Option<String> = None;
    let mut last_ts: Option<String> = None;
    let mut message_count: u32 = 0;
    let mut model: Option<String> = None;

    for line_result in reader.lines() {
        let line = line_result.map_err(|e| format!("read: {}", e))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if trimmed.contains("\"type\":\"user\"") || trimmed.contains("\"type\":\"assistant\"") {
            message_count += 1;
        }

        if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if cwd.is_none() {
                if let Some(c) = json_val.get("cwd").and_then(|v| v.as_str()) {
                    cwd = Some(c.to_string());
                }
            }
            if let Some(ts) = json_val.get("timestamp").and_then(|v| v.as_str()) {
                if started_at.is_none() {
                    started_at = Some(ts.to_string());
                }
                last_ts = Some(ts.to_string());
            }
            if first_prompt.is_none()
                && json_val.get("type").and_then(|v| v.as_str()) == Some("user")
            {
                let message = json_val.get("message").unwrap_or(&json_val);
                if let Some(text) = message.get("content").and_then(|v| v.as_str()) {
                    if shared::is_first_prompt_text(text) {
                        first_prompt = Some(if text.len() > 200 {
                            let end = text.floor_char_boundary(200);
                            format!("{}...", &text[..end])
                        } else {
                            text.to_string()
                        });
                    }
                }
            }
            if model.is_none() {
                let etype = json_val.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if etype == "progress" {
                    if let Some(data) = json_val.get("data") {
                        if data.get("type").and_then(|v| v.as_str()) == Some("init") {
                            model = data.get("model").and_then(|v| v.as_str()).map(String::from);
                        }
                    }
                }
            }
        }
    }

    // Read file content for zipping
    let mut content = Vec::new();
    File::open(jsonl_path)
        .map_err(|e| format!("open for content: {}", e))?
        .read_to_end(&mut content)
        .map_err(|e| format!("read content: {}", e))?;

    let written = content.len() as u64;
    zip.start_file(rel_path, options)
        .map_err(|e| format!("start file in zip: {}", e))?;
    zip.write_all(&content)
        .map_err(|e| format!("write to zip: {}", e))?;

    Ok((
        ManifestSession {
            session_id,
            cwd: cwd.unwrap_or_default(),
            relative_path: rel_path.to_string(),
            file_size: *file_size,
            first_prompt,
            started_at,
            last_activity_at: last_ts,
            message_count,
            model,
        },
        written,
    ))
}

// ── Import ────────────────────────────────────────────────────────────────────

#[tauri::command]
