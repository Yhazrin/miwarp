//! CLI session discovery, normalization, import, and incremental sync.
//!
//! Reads Claude CLI transcript files (~/.claude/projects/*/*.jsonl) and converts
//! them into MiWarp run format (~/.miwarp/runs/{run-id}/).

use crate::models::{RunMeta, RunSource};
use crate::storage::shared;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use super::types::{CliSessionSummary, DiscoverResult};
use super::util::{build_imported_index_cached, encode_cwd, invalidate_imported_cache_inner};
use std::time::Duration;

// ── Types ────────────────────────────────────────────────────────────

pub fn invalidate_imported_cache() {
    log::debug!("[cli_sessions] imported-index cache invalidated");
    invalidate_imported_cache_inner();
}

// ── Discovery ────────────────────────────────────────────────────────

const MAX_DISCOVER_CANDIDATES: usize = 500;

/// Discover CLI sessions for a given working directory.
pub fn discover_sessions(target_cwd: &str) -> Result<DiscoverResult, String> {
    let start = std::time::Instant::now();
    let projects_dir = shared::claude_projects_dir().ok_or("cannot determine home dir")?;

    if !projects_dir.exists() {
        log::debug!("[cli_sessions] discover: ~/.claude/projects/ does not exist");
        return Ok(DiscoverResult {
            sessions: vec![],
            total: 0,
            truncated: false,
        });
    }

    // Collect all JSONL files with metadata
    let mut candidates: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
    let show_all = target_cwd.is_empty() || target_cwd == "/";

    // Quick path: try encoded cwd directory first (skip when showing all)
    if !show_all {
        let encoded = encode_cwd(target_cwd);
        let quick_dir = projects_dir.join(&encoded);
        if quick_dir.is_dir() {
            collect_jsonl_files(&quick_dir, &mut candidates);
        }
    }

    // Fallback (or show-all): scan all project directories
    if candidates.is_empty() {
        if let Ok(entries) = fs::read_dir(&projects_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    collect_jsonl_files(&path, &mut candidates);
                }
            }
        }
    }

    // Sort by mtime descending
    candidates.sort_by_key(|x| std::cmp::Reverse(x.2));
    let total_candidates = candidates.len();

    // Truncate to upper limit (prevent extreme cases)
    let truncated = candidates.len() > MAX_DISCOVER_CANDIDATES;
    if truncated {
        log::debug!(
            "[cli_sessions] discover: truncating {} candidates to {}",
            total_candidates,
            MAX_DISCOVER_CANDIDATES
        );
        candidates.truncate(MAX_DISCOVER_CANDIDATES);
    }

    log::debug!(
        "[cli_sessions] discover: {} candidate files for cwd={} (total={})",
        candidates.len(),
        target_cwd,
        total_candidates
    );

    // Cross-reference existing imports (cached, 30s TTL)
    let imported_sessions = build_imported_index_cached(Duration::from_secs(30));

    // Extract summaries in parallel
    use rayon::prelude::*;
    let mut results: Vec<CliSessionSummary> = candidates
        .par_iter()
        .filter_map(|(path, size, _mtime)| {
            match extract_summary(path, *size, target_cwd, &imported_sessions) {
                Ok(Some(summary)) => Some(summary),
                Ok(None) => {
                    log::trace!("[cli_sessions] discover: skipped {:?} (cwd mismatch)", path);
                    None
                }
                Err(e) => {
                    log::trace!("[cli_sessions] discover: error reading {:?}: {}", path, e);
                    None
                }
            }
        })
        .collect();

    // Sort by last_activity_at descending
    results.sort_by(|a, b| b.last_activity_at.cmp(&a.last_activity_at));

    log::debug!(
        "[cli_sessions] discover: {} sessions found in {:?} (total_candidates={})",
        results.len(),
        start.elapsed(),
        total_candidates
    );

    Ok(DiscoverResult {
        // When not truncated, total = exact valid session count.
        // When truncated, total = total candidate files (upper bound estimate,
        // actual valid count may be lower due to cwd mismatch / read errors).
        total: if truncated {
            total_candidates
        } else {
            results.len()
        },
        truncated,
        sessions: results,
    })
}

fn collect_jsonl_files(dir: &Path, out: &mut Vec<(PathBuf, u64, std::time::SystemTime)>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                if let Ok(meta) = path.metadata() {
                    out.push((
                        path,
                        meta.len(),
                        meta.modified().unwrap_or(std::time::UNIX_EPOCH),
                    ));
                }
            }
        }
    }
}

pub(super) fn build_imported_index() -> HashMap<(String, String), String> {
    // Map (session_id, cwd) → run_id
    let mut index = HashMap::new();
    let runs_dir = super::super::runs_dir();
    if let Ok(entries) = fs::read_dir(&runs_dir) {
        for entry in entries.flatten() {
            let meta_path = entry.path().join("meta.json");
            if let Ok(content) = fs::read_to_string(&meta_path) {
                if let Ok(meta) = serde_json::from_str::<RunMeta>(&content) {
                    if meta.source == Some(RunSource::CliImport) {
                        if let Some(ref sid) = meta.session_id {
                            index.insert((sid.clone(), meta.cwd.clone()), meta.id.clone());
                        }
                    }
                }
            }
        }
    }
    index
}

fn extract_summary(
    path: &Path,
    size: u64,
    target_cwd: &str,
    imported: &HashMap<(String, String), String>,
) -> Result<Option<CliSessionSummary>, String> {
    let file = File::open(path).map_err(|e| format!("open: {}", e))?;
    let reader = BufReader::new(&file);

    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    let mut cwd: Option<String> = None;
    let mut first_prompt: Option<String> = None;
    let mut started_at: Option<String> = None;
    let mut model: Option<String> = None;
    let mut cli_version: Option<String> = None;
    let mut has_subagents = false;
    let mut message_count: u32 = 0;
    let mut last_ts: Option<String> = None;

    // Read first 20 lines for summary extraction
    let mut head_lines = 0;
    let mut head_bytes: u64 = 0; // Track bytes consumed by head for tail overlap check
    for line_result in reader.lines() {
        let line = line_result.map_err(|e| format!("read: {}", e))?;
        head_lines += 1;
        if head_lines > 20 {
            break;
        }
        head_bytes += (line.len() as u64) + 1; // +1 for newline

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Cheap substring matching for message_count
        if trimmed.contains("\"type\":\"user\"") || trimmed.contains("\"type\":\"assistant\"") {
            message_count += 1;
        }

        // Check for subagents
        if trimmed.contains("\"parentToolUseID\"") || trimmed.contains("\"parent_tool_use_id\"") {
            has_subagents = true;
        }

        let Ok(json_val) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };

        // Extract cwd from any line that has it
        if cwd.is_none() {
            if let Some(c) = json_val.get("cwd").and_then(|v| v.as_str()) {
                cwd = Some(c.to_string());
            }
        }

        // Extract timestamp
        if let Some(ts) = json_val.get("timestamp").and_then(|v| v.as_str()) {
            if started_at.is_none() {
                started_at = Some(ts.to_string());
            }
            last_ts = Some(ts.to_string());
        }

        // Extract first user prompt
        if first_prompt.is_none() && json_val.get("type").and_then(|v| v.as_str()) == Some("user") {
            let message = json_val.get("message").unwrap_or(&json_val);
            if let Some(text) = message.get("content").and_then(|v| v.as_str()) {
                if shared::is_first_prompt_text(text) {
                    let truncated = if text.len() > 200 {
                        let end = text.floor_char_boundary(200);
                        format!("{}...", &text[..end])
                    } else {
                        text.to_string()
                    };
                    first_prompt = Some(truncated);
                }
            }
        }

        // Extract model from system/init progress events
        if json_val.get("type").and_then(|v| v.as_str()) == Some("progress") {
            if let Some(data) = json_val.get("data") {
                if data.get("type").and_then(|v| v.as_str()) == Some("init") {
                    if let Some(m) = data.get("model").and_then(|v| v.as_str()) {
                        model = Some(m.to_string());
                    }
                    if let Some(ver) = data.get("claude_code_version").and_then(|v| v.as_str()) {
                        cli_version = Some(ver.to_string());
                    }
                }
            }
        }

        // Also check direct system/init
        if json_val.get("type").and_then(|v| v.as_str()) == Some("system")
            && json_val.get("subtype").and_then(|v| v.as_str()) == Some("init")
        {
            if model.is_none() {
                if let Some(m) = json_val.get("model").and_then(|v| v.as_str()) {
                    model = Some(m.to_string());
                }
            }
            if cli_version.is_none() {
                if let Some(ver) = json_val.get("claude_code_version").and_then(|v| v.as_str()) {
                    cli_version = Some(ver.to_string());
                }
            }
            if cwd.is_none() {
                if let Some(c) = json_val.get("cwd").and_then(|v| v.as_str()) {
                    cwd = Some(c.to_string());
                }
            }
        }
    }

    // Fallback: if no cwd found in first 20 lines, check if file is in exact encoded dir
    if cwd.is_none() {
        let encoded = encode_cwd(target_cwd);
        if let Some(parent) = path.parent() {
            if parent.file_name().and_then(|s| s.to_str()) == Some(&encoded) {
                // File is in the exact encoded dir — scan deeper for cwd
                let file2 = File::open(path).map_err(|e| format!("open: {}", e))?;
                let reader2 = BufReader::new(file2);
                for (i, line_result) in reader2.lines().enumerate() {
                    if i >= 100 {
                        break;
                    }
                    if i < 20 {
                        continue; // Already scanned
                    }
                    let line = line_result.map_err(|e| format!("read: {}", e))?;
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    if let Ok(json_val) = serde_json::from_str::<Value>(trimmed) {
                        if let Some(c) = json_val.get("cwd").and_then(|v| v.as_str()) {
                            cwd = Some(c.to_string());
                            break;
                        }
                    }
                }
            }
        }
    }

    // Read tail for last timestamp (and remaining message count for large files)
    let file_for_tail = File::open(path).map_err(|e| format!("open: {}", e))?;
    let mut tail_reader = BufReader::new(file_for_tail);
    let tail_offset = size.saturating_sub(8192);
    // Only count messages from tail if tail starts beyond what head already scanned
    let count_messages_in_tail = tail_offset >= head_bytes;
    if tail_offset > 0 {
        tail_reader
            .seek(SeekFrom::Start(tail_offset))
            .map_err(|e| format!("seek: {}", e))?;
        // Skip partial first line
        let mut skip = String::new();
        let _ = tail_reader.read_line(&mut skip);
    }
    for line_result in tail_reader.lines() {
        let line = line_result.map_err(|e| format!("read: {}", e))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if count_messages_in_tail
            && (trimmed.contains("\"type\":\"user\"") || trimmed.contains("\"type\":\"assistant\""))
        {
            message_count += 1;
        }
        if let Ok(json_val) = serde_json::from_str::<Value>(trimmed) {
            if let Some(ts) = json_val.get("timestamp").and_then(|v| v.as_str()) {
                last_ts = Some(ts.to_string());
            }
        }
    }

    // If cwd doesn't match target, skip (empty or "/" means show all)
    let show_all = target_cwd.is_empty() || target_cwd == "/";
    let matched_cwd = match &cwd {
        Some(c) if show_all || c == target_cwd => c.clone(),
        _ => return Ok(None),
    };

    let key = (session_id.clone(), matched_cwd.clone());
    let (already_imported, existing_run_id) = if let Some(rid) = imported.get(&key) {
        (true, Some(rid.clone()))
    } else {
        (false, None)
    };

    Ok(Some(CliSessionSummary {
        session_id,
        cwd: matched_cwd,
        first_prompt: first_prompt.unwrap_or_default(),
        started_at: started_at.unwrap_or_default(),
        last_activity_at: last_ts.unwrap_or_default(),
        message_count,
        model,
        cli_version,
        file_size: size,
        file_path: path.to_string_lossy().to_string(),
        has_subagents,
        already_imported,
        existing_run_id,
    }))
}

// ── Import ──────────────────────────────────────────────────────────
