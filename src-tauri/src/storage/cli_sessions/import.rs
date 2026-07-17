//! CLI session discovery, normalization, import, and incremental sync.
//!
//! Reads Claude CLI transcript files (~/.claude/projects/*/*.jsonl) and converts
//! them into MiWarp run format (~/.miwarp/runs/{run-id}/).

use crate::models::protocol_state::{validate_bus_event, ProtocolState};
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

pub fn import_session(
    session_id: &str,
    cwd: &str,
    event_writer: std::sync::Arc<EventWriter>,
) -> Result<ImportResult, String> {
    let start = std::time::Instant::now();
    log::debug!(
        "[cli_sessions] import: session_id={}, cwd={}",
        session_id,
        cwd
    );

    // 1. Dedup check
    let imported = build_imported_index();
    let key = (session_id.to_string(), cwd.to_string());
    if let Some(existing_run_id) = imported.get(&key) {
        return Err(format!(
            "session already imported as run {}",
            existing_run_id
        ));
    }

    // 2. Locate CLI JSONL file
    let cli_path = find_cli_session_path(session_id, cwd)?;
    validate_cli_path(&cli_path)?;

    // Verify file stem matches session_id
    let stem = cli_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    if stem != session_id {
        return Err(format!(
            "file stem {:?} doesn't match session_id {:?}",
            stem, session_id
        ));
    }

    let file_meta = fs::metadata(&cli_path).map_err(|e| format!("stat: {}", e))?;
    let file_size = file_meta.len();

    // 3. First pass — raw scan for metadata
    let file = File::open(&cli_path).map_err(|e| format!("open: {}", e))?;
    let reader = BufReader::new(file);

    let mut first_ts: Option<String> = None;
    let mut last_ts: Option<String> = None;
    let mut has_result = false;
    let mut result_is_error = false;
    let mut first_prompt = String::new();
    let mut model: Option<String> = None;

    for line_result in reader.lines() {
        let line = line_result.map_err(|e| format!("read: {}", e))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Ok(json_val) = serde_json::from_str::<Value>(trimmed) {
            if let Some(ts) = json_val.get("timestamp").and_then(|v| v.as_str()) {
                if first_ts.is_none() {
                    first_ts = Some(ts.to_string());
                }
                last_ts = Some(ts.to_string());
            }

            let etype = json_val.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if etype == "result" {
                has_result = true;
                if let Some(sub) = json_val.get("subtype").and_then(|v| v.as_str()) {
                    if sub.starts_with("error") {
                        result_is_error = true;
                    }
                }
            }

            // Extract first prompt
            if first_prompt.is_empty() && etype == "user" {
                let message = json_val.get("message").unwrap_or(&json_val);
                if let Some(text) = message.get("content").and_then(|v| v.as_str()) {
                    if shared::is_first_prompt_text(text) {
                        first_prompt = if text.len() > 200 {
                            let end = text.floor_char_boundary(200);
                            format!("{}...", &text[..end])
                        } else {
                            text.to_string()
                        };
                    }
                }
            }

            // Extract model
            if model.is_none() {
                if etype == "progress" {
                    if let Some(data) = json_val.get("data") {
                        if data.get("type").and_then(|v| v.as_str()) == Some("init") {
                            model = data.get("model").and_then(|v| v.as_str()).map(String::from);
                        }
                    }
                } else if etype == "system"
                    && json_val.get("subtype").and_then(|v| v.as_str()) == Some("init")
                {
                    model = json_val
                        .get("model")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                }
            }
        }
    }

    // 4. Create run
    let run_id = uuid::Uuid::new_v4().to_string();
    let status = if has_result && result_is_error {
        RunStatus::Failed
    } else {
        RunStatus::Stopped
    };

    let started_at = first_ts.clone().unwrap_or_else(crate::models::now_iso);
    let ended_at = last_ts.clone();

    #[cfg(unix)]
    let mtime_ns = {
        use std::os::unix::fs::MetadataExt;
        (file_meta.mtime() as u128) * 1_000_000_000 + (file_meta.mtime_nsec() as u128)
    };
    #[cfg(not(unix))]
    let mtime_ns = file_meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    let meta = RunMeta {
        id: run_id.clone(),
        prompt: first_prompt,
        cwd: cwd.to_string(),
        agent: "claude".to_string(),
        auth_mode: "cli".to_string(),
        status,
        started_at,
        ended_at,
        exit_code: None,
        error_message: None,
        session_id: Some(session_id.to_string()),
        result_subtype: None,
        model,
        parent_run_id: None,
        name: None,
        remote_host_name: None,
        remote_cwd: None,
        remote_host_snapshot: None,
        platform_id: None,
        platform_base_url: None,
        source: Some(RunSource::CliImport),
        cli_import_watermark: Some(ImportWatermark {
            offset: file_size,
            mtime_ns,
            file_size,
            last_uuid: None,
        }),
        cli_session_path: Some(cli_path.to_string_lossy().to_string()),
        cli_usage_incomplete: None, // Set after import
        deleted_at: None,
        archived_at: None,
        no_session_persistence: false, // CLI import = normal persistent session
        execution_path: Some(crate::models::ExecutionPath::SessionActor), // CLI import = Claude session
        conversation_ref: Some(crate::models::ConversationRef::ClaudeSession(
            session_id.to_string(),
        )),
        run_surface: None,
        project_desk_context: None,
        folder_id: None,
        creation_mode: None,
        worktree_path: None,
        worktree_branch: None,
        parent_cwd: None,
        scheduled_task_id: None,
        scheduled_task_run_id: None,
        runtime_kind: Some(crate::models::AgentRuntimeKind::ClaudeCode),
        protocol_kind: None,
    };

    let run_dir = super::run_dir(&run_id);
    super::ensure_dir(&run_dir).map_err(|e| format!("ensure_dir: {}", e))?;

    // 5. Second pass — event conversion + index writing
    // Wrapped in closure so any `?` failure triggers cleanup in the match below.
    let import_result = (|| -> Result<TranscriptImporter, String> {
        let mut importer = TranscriptImporter::new(run_id.clone(), event_writer.clone());

        let index_path = import_index_path(&run_id);
        let index_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&index_path)
            .map_err(|e| format!("open index: {}", e))?;
        let mut index_writer = BufWriter::new(index_file);

        let file2 = File::open(&cli_path).map_err(|e| format!("open: {}", e))?;
        let reader2 = BufReader::new(file2);
        let mut byte_offset: u64 = 0;

        for line_result in reader2.lines() {
            let line = line_result.map_err(|e| format!("read: {}", e))?;
            let current_offset = byte_offset;
            byte_offset += (line.len() as u64) + 1;

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let Ok(json_val) = serde_json::from_str::<Value>(trimmed) else {
                continue;
            };

            importer.process_line(&line, &json_val, current_offset, &mut index_writer, None)?;
        }

        // Finalize (flush last turn usage)
        let final_ts = last_ts.clone().unwrap_or_default();
        importer.finalize(&final_ts, &mut index_writer, None)?;
        index_writer
            .flush()
            .map_err(|e| format!("flush index: {}", e))?;

        Ok(importer)
    })();

    // On failure: clean up run_dir and propagate error
    let importer = match import_result {
        Ok(v) => v,
        Err(e) => {
            log::error!("[cli_sessions] import failed, cleaning up run_dir: {}", e);
            let _ = fs::remove_dir_all(&run_dir);
            return Err(e);
        }
    };

    // 6. Save meta atomically (only on success)
    let mut meta = meta;
    meta.cli_usage_incomplete = if importer.usage_incomplete {
        Some(true)
    } else {
        None
    };
    meta.cli_import_watermark = Some(ImportWatermark {
        offset: file_size,
        mtime_ns,
        file_size,
        last_uuid: None,
    });
    super::runs::save_meta(&meta)?;

    let elapsed = start.elapsed();
    log::debug!(
        "[cli_sessions] import: done in {:?}, events_imported={}, events_skipped={}, usage_incomplete={}",
        elapsed,
        importer.events_imported,
        importer.events_skipped,
        importer.usage_incomplete
    );

    // Invalidate imported-index cache so next discover reflects this import
    invalidate_imported_cache();

    Ok(ImportResult {
        run_id,
        session_id: session_id.to_string(),
        events_imported: importer.events_imported,
        events_skipped: importer.events_skipped,
        usage_incomplete: importer.usage_incomplete,
        skipped_subtypes: importer.skipped_subtypes,
    })
}

fn find_cli_session_path(session_id: &str, cwd: &str) -> Result<PathBuf, String> {
    let projects_dir = shared::claude_projects_dir().ok_or("cannot determine home dir")?;
    let filename = format!("{}.jsonl", session_id);

    // Quick path: encoded cwd directory
    let encoded = encode_cwd(cwd);
    let quick_path = projects_dir.join(&encoded).join(&filename);
    if quick_path.exists() {
        return Ok(quick_path);
    }

    // Fallback: scan all project directories
    if let Ok(entries) = fs::read_dir(&projects_dir) {
        for entry in entries.flatten() {
            let candidate = entry.path().join(&filename);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    Err(format!("CLI session file not found: {}", filename))
}

// ── Sync pre-check ────────────────────────────────────────────────

fn file_mtime_ns_from_metadata(meta: &fs::Metadata) -> u128 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        (meta.mtime() as u128) * 1_000_000_000 + (meta.mtime_nsec() as u128)
    }
    #[cfg(not(unix))]
    {
        meta.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    }
}

/// Source JSONL mtime in nanoseconds (for auto-sync prioritization).
