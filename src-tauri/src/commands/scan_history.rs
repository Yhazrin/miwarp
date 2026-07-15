//! Scan `~/.claude/projects/**/*.jsonl` for CLI session metadata.
//!
//! Lightweight read-only scan that returns `CliSessionInfo` for each JSONL
//! file found. Used by the import wizard to show available sessions before
//! the user commits to a full archive import.

use crate::storage::shared;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use super::claude_history_migration::{build_imported_index, collect_jsonl_recursive};

#[tauri::command]
pub fn scan_claude_code_history() -> Result<Vec<CliSessionInfo>, String> {
    log::debug!("[migration] scan_claude_code_history");

    let projects_dir = shared::claude_projects_dir()
        .ok_or_else(|| "cannot determine ~/.claude/projects".to_string())?;

    if !projects_dir.exists() {
        return Ok(vec![]);
    }

    let jsonl_files: Vec<PathBuf> = collect_jsonl_recursive(&projects_dir)
        .map_err(|e| format!("failed to walk projects dir: {}", e))?
        .into_iter()
        .map(|(p, _)| p)
        .collect();

    let results: Vec<CliSessionInfo> = jsonl_files
        .par_iter()
        .filter_map(|path| extract_session_info(path).ok())
        .collect();

    Ok(results)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliSessionInfo {
    pub session_id: String,
    pub cwd: String,
    pub relative_path: String,
    pub first_prompt: Option<String>,
    pub started_at: Option<String>,
    pub last_activity_at: Option<String>,
    pub message_count: u32,
    pub model: Option<String>,
    pub already_imported: bool,
    pub existing_run_id: Option<String>,
}

fn extract_session_info(path: &Path) -> Result<CliSessionInfo, String> {
    let file = File::open(path).map_err(|e| format!("open: {}", e))?;
    let reader = BufReader::new(file);

    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    let projects_dir = shared::claude_projects_dir().ok_or("cannot determine projects dir")?;
    let relative_path = path
        .strip_prefix(&projects_dir)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();

    let mut cwd: Option<String> = None;
    let mut first_prompt: Option<String> = None;
    let mut started_at: Option<String> = None;
    let mut last_ts: Option<String> = None;
    let mut message_count: u32 = 0;
    let mut model: Option<String> = None;

    let mut head_lines = 0;
    for line_result in reader.lines() {
        let line = line_result.map_err(|e| format!("read: {}", e))?;
        head_lines += 1;
        if head_lines > 20 {
            break;
        }
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

    // Check if already imported
    let existing_index = build_imported_index();
    let key = (session_id.clone(), cwd.clone().unwrap_or_default());
    let (already_imported, existing_run_id) = if let Some(rid) = existing_index.get(&key) {
        (true, Some(rid.clone()))
    } else {
        (false, None)
    };

    Ok(CliSessionInfo {
        session_id,
        cwd: cwd.unwrap_or_default(),
        relative_path: relative_path.to_string(),
        first_prompt,
        started_at,
        last_activity_at: last_ts,
        message_count,
        model,
        already_imported,
        existing_run_id,
    })
}
