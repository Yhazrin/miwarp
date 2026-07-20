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
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;
use std::sync::Arc;

use super::types::{ImportDetail, ManifestSession};

// ── Types ────────────────────────────────────────────────────────────────────

pub(crate) fn build_imported_index() -> HashMap<(String, String), String> {
    // Map (session_id, cwd) → run_id
    let mut index = HashMap::new();
    let runs = runs_dir();
    if let Ok(entries) = fs::read_dir(&runs) {
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

pub(super) fn import_single_session(
    session: &ManifestSession,
    temp_path: &Path,
    existing_index: &mut HashMap<(String, String), String>,
    event_writer: Arc<EventWriter>,
) -> ImportDetail {
    let session_id = &session.session_id;
    let cwd = &session.cwd;

    // P0-I4: surface "missing_cwd" as a real status. The manifest is
    // sourced from `~/.claude/projects/**/*.jsonl` and most files
    // expose cwd via the first user/assistant line, but a corrupted
    // or empty jsonl could yield an empty cwd. Skipping silently would
    // hide data-quality problems; the i18n key
    // `settings_data_missing_cwd` already exists in both locales.
    if cwd.is_empty() {
        log::warn!(
            "[migration] import: session {} has empty cwd, marking as missing_cwd",
            session_id
        );
        return ImportDetail {
            session_id: session_id.clone(),
            cwd: cwd.clone(),
            run_id: None,
            status: "missing_cwd".to_string(),
            error: Some("cwd missing in session jsonl".to_string()),
        };
    }

    // Check for duplicates (against the in-batch mutable index so two
    // sessions in the same archive with the same key get deduped —
    // not just against the on-disk state captured at the start).
    let key = (session_id.clone(), cwd.clone());
    if existing_index.contains_key(&key) {
        log::debug!(
            "[migration] import: duplicate session {} in {}",
            session_id,
            cwd
        );
        return ImportDetail {
            session_id: session_id.clone(),
            cwd: cwd.clone(),
            run_id: None,
            status: "duplicate".to_string(),
            error: None,
        };
    }

    // Find the jsonl file in temp directory
    let jsonl_path = temp_path.join(&session.relative_path);
    if !jsonl_path.exists() {
        return ImportDetail {
            session_id: session_id.clone(),
            cwd: cwd.clone(),
            run_id: None,
            status: "failed".to_string(),
            error: Some(format!(
                "jsonl file not found in archive: {}",
                session.relative_path
            )),
        };
    }

    // Run the import pipeline
    match run_import_pipeline(
        &jsonl_path,
        session_id,
        cwd,
        &session.relative_path,
        event_writer,
    ) {
        Ok(run_id) => {
            // P0-I3: register the just-imported session in the index
            // so subsequent sessions in the same batch with the same
            // (session_id, cwd) are flagged as duplicates instead of
            // creating a second run_dir.
            existing_index.insert(key, run_id.clone());

            ImportDetail {
                session_id: session_id.clone(),
                cwd: cwd.clone(),
                run_id: Some(run_id),
                status: "imported".to_string(),
                error: None,
            }
        }
        Err(e) => ImportDetail {
            session_id: session_id.clone(),
            cwd: cwd.clone(),
            run_id: None,
            status: "failed".to_string(),
            error: Some(e),
        },
    }
}

pub(super) fn run_import_pipeline(
    jsonl_path: &Path,
    session_id: &str,
    cwd: &str,
    relative_path: &str,
    event_writer: Arc<EventWriter>,
) -> Result<String, String> {
    let start = std::time::Instant::now();

    // First pass: extract metadata
    let file = File::open(jsonl_path).map_err(|e| format!("open: {}", e))?;
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

        if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(trimmed) {
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

            if model.is_none() && etype == "progress" {
                if let Some(data) = json_val.get("data") {
                    if data.get("type").and_then(|v| v.as_str()) == Some("init") {
                        model = data.get("model").and_then(|v| v.as_str()).map(String::from);
                    }
                }
            }
        }
    }

    let file_meta = fs::metadata(jsonl_path).map_err(|e| format!("stat: {}", e))?;
    let file_size = file_meta.len();

    // Create run
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
        cli_session_path: Some(relative_path.to_string()), // Store relative path from archive
        cli_usage_incomplete: None,
        deleted_at: None,
        archived_at: None,
        no_session_persistence: false,
        execution_path: Some(ExecutionPath::SessionActor),
        conversation_ref: Some(ConversationRef::ClaudeSession(session_id.to_string())),
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

    let run_dir = run_dir(&run_id);
    ensure_dir(&run_dir).map_err(|e| format!("ensure_dir: {}", e))?;

    // P0-I2: Wrap the event-conversion + index-writing body in a
    // closure so any `?` failure cleans up `run_dir` before
    // propagating. Without this, a partial failure (corrupted jsonl,
    // disk full, permission denied) leaves an empty run_dir on disk
    // and the next discover/scan reports a half-imported run that
    // can't be resumed or deleted cleanly.
    //
    // Mirrors the pattern in `storage::cli_sessions::import_session`
    // (see cli_sessions.rs:1250-1301).
    let pipeline_result = (|| -> Result<(), String> {
        // Process the jsonl file
        let mut protocol = ProtocolState::new(false);
        let mut turn_counter: u32 = 0;
        let mut pending_usage: Option<serde_json::Value> = None;
        let mut _has_usage_update_this_turn = false;
        let mut pending_model: Option<String> = None;
        let mut last_user_is_command = false;
        let _known_usage_turns: HashSet<u64> = HashSet::new();

        let index_path = run_dir.join("import-index.jsonl");
        let index_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&index_path)
            .map_err(|e| format!("open index: {}", e))?;
        let mut index_writer = BufWriter::new(index_file);

        let file2 = File::open(jsonl_path).map_err(|e| format!("open: {}", e))?;
        let reader2 = BufReader::new(file2);
        let mut byte_offset: u64 = 0;
        let mut events_imported: u64 = 0;
        let mut events_skipped: u64 = 0;
        let mut usage_incomplete = false;
        let mut skipped_subtypes: HashMap<String, u64> = HashMap::new();

        for line_result in reader2.lines() {
            let line = line_result.map_err(|e| format!("read: {}", e))?;
            let current_offset = byte_offset;
            byte_offset += (line.len() as u64) + 1;

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let Ok(json_val) = serde_json::from_str::<serde_json::Value>(trimmed) else {
                continue;
            };

            // Process using the same logic as TranscriptImporter
            let raw_trim = trimmed;
            let lk = shared::line_key(&json_val, current_offset, raw_trim);

            let normalized = match normalize_transcript_line(&json_val) {
                Some(n) => n,
                None => {
                    continue;
                }
            };

            let norm_type = normalized
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let ts = shared::extract_timestamp(&json_val)
                .or_else(|| shared::extract_timestamp(&normalized))
                .unwrap_or_default();

            let mut candidates: Vec<BusEvent> = Vec::new();

            // Handle user messages
            if norm_type == "user" {
                last_user_is_command = false;

                if is_real_user_prompt(&normalized) {
                    if turn_counter > 0 {
                        if let Some(usage_ev) = flush_turn_usage(
                            &run_id,
                            turn_counter,
                            &pending_usage,
                            &pending_model,
                            &mut usage_incomplete,
                        ) {
                            candidates.push(usage_ev);
                        }
                    }
                    turn_counter += 1;
                    pending_usage = None;
                    _has_usage_update_this_turn = false;
                    pending_model = None;

                    let message = normalized.get("message").unwrap_or(&normalized);
                    if let Some(text) = message.get("content").and_then(|v| v.as_str()) {
                        candidates.push(BusEvent::UserMessage {
                            run_id: run_id.clone(),
                            text: text.to_string(),
                            uuid: normalized
                                .get("uuid")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                        });
                    }
                } else {
                    let message = normalized.get("message").unwrap_or(&normalized);
                    if let Some(text) = message.get("content").and_then(|v| v.as_str()) {
                        last_user_is_command = text.contains("<command-name>");
                    }
                }
            }

            // Track assistant usage
            if norm_type == "assistant" {
                let message = normalized.get("message").unwrap_or(&normalized);
                if let Some(usage) = message.get("usage") {
                    pending_usage = Some(usage.clone());
                }
                if let Some(m) = message.get("model").and_then(|v| v.as_str()) {
                    pending_model = Some(m.to_string());
                }
            }

            // Run through map_event
            let mapped = protocol.map_event(&run_id, &normalized);

            for ev in mapped {
                if matches!(&ev, BusEvent::UsageUpdate { .. }) {
                    _has_usage_update_this_turn = true;
                }
                if let Some(warn) = validate_bus_event(&ev) {
                    log::debug!(
                        "[migration] invalid event dropped: {}.{}: {}",
                        warn.event_type,
                        warn.field,
                        warn.detail
                    );
                    protocol.stats.invalid_tool_count += 1;
                    continue;
                }
                candidates.push(ev);
            }

            // Write events
            let mut event_counts: HashMap<String, usize> = HashMap::new();

            for event in candidates {
                let tag = shared::bus_event_tag(&event);

                // Replayable filter
                if !is_replayable(&event) {
                    events_skipped += 1;
                    *skipped_subtypes.entry(tag.clone()).or_insert(0) += 1;
                    continue;
                }

                // command_output content filter
                if let BusEvent::CommandOutput { ref content, .. } = event {
                    if content.contains("## Context Usage")
                        || content.contains("## Session Cost")
                        || last_user_is_command
                    {
                        events_skipped += 1;
                        *skipped_subtypes
                            .entry("command_output_filtered".to_string())
                            .or_insert(0) += 1;
                        continue;
                    }
                }

                let n = event_counts.entry(tag.clone()).or_insert(0);
                let ek = shared::event_key(&lk, &tag, *n);
                *n += 1;

                let seq = event_writer.write_bus_event_with_ts(&run_id, &event, &ts)?;

                writeln!(
                    index_writer,
                    "{}",
                    serde_json::json!({"source_key": ek, "imported_seq": seq})
                )
                .map_err(|e| format!("write index: {}", e))?;

                events_imported += 1;
            }
        }

        // Finalize
        if turn_counter > 0 {
            if let Some(event) = flush_turn_usage(
                &run_id,
                turn_counter,
                &pending_usage,
                &pending_model,
                &mut usage_incomplete,
            ) {
                let lk = format!("v1:finalize:{}", turn_counter);
                let tag = shared::bus_event_tag(&event);
                let ek = shared::event_key(&lk, &tag, 0);
                let seq = event_writer.write_bus_event_with_ts(
                    &run_id,
                    &event,
                    &last_ts.unwrap_or_default(),
                )?;
                writeln!(
                    index_writer,
                    "{}",
                    serde_json::json!({"source_key": ek, "imported_seq": seq})
                )
                .map_err(|e| format!("write index: {}", e))?;
                events_imported += 1;
            }
        }

        index_writer
            .flush()
            .map_err(|e| format!("flush index: {}", e))?;

        // Save meta atomically — only on success.
        let mut meta = meta;
        meta.cli_usage_incomplete = if usage_incomplete { Some(true) } else { None };
        meta.cli_import_watermark = Some(ImportWatermark {
            offset: file_size,
            mtime_ns,
            file_size,
            last_uuid: None,
        });
        crate::storage::runs::save_meta(&meta)?;

        log::debug!(
            "[migration] import: run {} done in {:?}, events_imported={}, events_skipped={}",
            run_id,
            start.elapsed(),
            events_imported,
            events_skipped
        );

        Ok(())
    })();

    // On failure: clean up the run_dir we just created and propagate.
    if let Err(e) = pipeline_result {
        log::error!(
            "[migration] import: pipeline failed for run {}, cleaning up run_dir: {}",
            run_id,
            e
        );
        let _ = fs::remove_dir_all(&run_dir);
        return Err(e);
    }

    Ok(run_id)
}

pub(super) fn is_real_user_prompt(normalized: &serde_json::Value) -> bool {
    let message = normalized.get("message").unwrap_or(normalized);
    if let Some(is_meta) = normalized.get("isMeta").and_then(|v| v.as_bool()) {
        if is_meta {
            return false;
        }
    }
    if let Some(text) = message.get("content").and_then(|v| v.as_str()) {
        if text.starts_with("<local-command-stdout>") {
            return false;
        }
        if text.contains("<local-command-caveat>") {
            return false;
        }
        if text.contains("<command-name>") {
            return false;
        }
        if text.contains("<task-notification>") && text.contains("</task-notification>") {
            return false;
        }
        return true;
    }
    false
}

pub(super) fn flush_turn_usage(
    run_id: &str,
    turn_counter: u32,
    pending_usage: &Option<serde_json::Value>,
    pending_model: &Option<String>,
    usage_incomplete: &mut bool,
) -> Option<BusEvent> {
    if let Some(ref usage) = pending_usage {
        let input_tokens = usage
            .get("input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let output_tokens = usage
            .get("output_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let cache_read = usage
            .get("cache_read_input_tokens")
            .and_then(|v| v.as_u64());
        let cache_write = usage
            .get("cache_creation_input_tokens")
            .and_then(|v| v.as_u64());

        let model = pending_model.as_deref().unwrap_or("unknown");
        let cost = crate::pricing::estimate_cost(
            model,
            input_tokens,
            output_tokens,
            cache_read.unwrap_or(0),
            cache_write.unwrap_or(0),
        );

        Some(BusEvent::UsageUpdate {
            run_id: run_id.to_string(),
            input_tokens,
            output_tokens,
            cache_read_tokens: cache_read,
            cache_write_tokens: cache_write,
            total_cost_usd: cost,
            turn_index: Some(turn_counter),
            model_usage: None,
            context_window_used_percentage: None,
            context_window_remaining_percentage: None,
            duration_api_ms: None,
            duration_ms: None,
            num_turns: None,
            stop_reason: None,
            service_tier: None,
            speed: None,
            web_fetch_requests: None,
            cache_creation_5m: None,
            cache_creation_1h: None,
        })
    } else {
        *usage_incomplete = true;
        None
    }
}
