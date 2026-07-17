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

pub fn source_file_mtime_ns(path: &str) -> Option<u128> {
    fs::metadata(path)
        .ok()
        .map(|meta| file_mtime_ns_from_metadata(&meta))
}

/// Pure watermark vs file-metadata check: true when `sync_session` may do work
/// (append, reconcile, or error). False only when identity is OK and size unchanged.
pub fn watermark_indicates_pending_sync(
    watermark: &ImportWatermark,
    current_size: u64,
    current_mtime_ns: u128,
) -> bool {
    let file_identity_ok =
        current_size >= watermark.offset && current_mtime_ns >= watermark.mtime_ns;
    if !file_identity_ok {
        return true;
    }
    current_size > watermark.offset
}

/// Lightweight pre-check before `sync_session`: reads RunMeta + file stat only.
pub fn session_has_pending_sync(run_id: &str) -> Result<bool, String> {
    let meta = super::runs::get_run(run_id).ok_or_else(|| format!("run {} not found", run_id))?;
    let watermark = meta
        .cli_import_watermark
        .ok_or("no cli_import_watermark in RunMeta")?;
    let cli_path_str = meta
        .cli_session_path
        .ok_or("no cli_session_path in RunMeta")?;
    let cli_path = PathBuf::from(&cli_path_str);
    let file_meta = fs::metadata(&cli_path).map_err(|e| format!("stat: {}", e))?;
    let current_size = file_meta.len();
    let current_mtime_ns = file_mtime_ns_from_metadata(&file_meta);
    Ok(watermark_indicates_pending_sync(
        &watermark,
        current_size,
        current_mtime_ns,
    ))
}

// ── Sync ──────────────────────────────────────────────────────────

/// Incremental sync — import new events since last watermark.
pub fn sync_session(
    run_id: &str,
    event_writer: std::sync::Arc<EventWriter>,
) -> Result<SyncResult, String> {
    let start = std::time::Instant::now();
    log::debug!("[cli_sessions] sync: run_id={}", run_id);

    // 1. Read RunMeta
    let meta = super::runs::get_run(run_id).ok_or_else(|| format!("run {} not found", run_id))?;
    let watermark = meta
        .cli_import_watermark
        .ok_or("no cli_import_watermark in RunMeta")?;
    let cli_path_str = meta
        .cli_session_path
        .ok_or("no cli_session_path in RunMeta")?;
    let cli_path = PathBuf::from(&cli_path_str);
    validate_cli_path(&cli_path)?;

    // Verify stem matches session_id
    if let Some(ref sid) = meta.session_id {
        let stem = cli_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        if stem != sid {
            return Err(format!(
                "file stem {:?} doesn't match session_id {:?}",
                stem, sid
            ));
        }
    }

    let file_meta = fs::metadata(&cli_path).map_err(|e| format!("stat: {}", e))?;
    let current_size = file_meta.len();
    let current_mtime_ns = file_mtime_ns_from_metadata(&file_meta);

    // 2. Determine sync strategy
    let file_identity_ok =
        current_size >= watermark.offset && current_mtime_ns >= watermark.mtime_ns;

    if !file_identity_ok {
        // Check if import-index exists for reconcile
        let index_path = import_index_path(run_id);
        if index_path.exists() {
            // Branch B: Reconcile
            log::debug!("[cli_sessions] sync: reconcile mode (file identity mismatch)");
            return sync_reconcile(run_id, &cli_path, event_writer);
        } else {
            // Branch C: Cannot reconcile
            log::debug!("[cli_sessions] sync: cannot reconcile (no import-index, file mismatch)");
            return Err("reconcile_index_missing".to_string());
        }
    }

    // Branch A: Normal append
    log::debug!(
        "[cli_sessions] sync: append mode, offset={}, file_size={}",
        watermark.offset,
        current_size
    );

    if current_size == watermark.offset {
        // No new data
        return Ok(SyncResult {
            new_events: 0,
            new_watermark: ImportWatermark {
                offset: current_size,
                mtime_ns: current_mtime_ns,
                file_size: current_size,
                last_uuid: watermark.last_uuid,
            },
            usage_incomplete: meta.cli_usage_incomplete.unwrap_or(false),
        });
    }

    let mut importer = TranscriptImporter::new(run_id.to_string(), event_writer.clone());
    importer.known_usage_turns = load_known_usage_turns(run_id);

    // Warmup: scan from beginning to watermark.offset
    let file = File::open(&cli_path).map_err(|e| format!("open: {}", e))?;
    let mut reader = BufReader::new(file);
    let mut byte_offset: u64 = 0;
    let mut warmup_lines = 0u64;

    while byte_offset < watermark.offset {
        let mut line = String::new();
        let bytes_read = reader
            .read_line(&mut line)
            .map_err(|e| format!("read: {}", e))?;
        if bytes_read == 0 {
            break;
        }
        byte_offset += bytes_read as u64;

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Ok(json_val) = serde_json::from_str::<Value>(trimmed) {
            importer.warmup_line(&json_val)?;
            warmup_lines += 1;
        }
    }

    log::debug!(
        "[cli_sessions] sync: warmup done, {} lines, turn_counter={}",
        warmup_lines,
        importer.turn_counter
    );

    // Load existing import-index for dedup (guards against watermark drift
    // caused by CLI context compaction rewriting the JSONL file)
    let index_path = import_index_path(run_id);
    let skip_set = load_import_skip_set(&index_path);
    log::debug!(
        "[cli_sessions] sync: loaded {} existing keys for dedup",
        skip_set.len()
    );

    let index_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&index_path)
        .map_err(|e| format!("open index: {}", e))?;
    let mut index_writer = BufWriter::new(index_file);

    let mut last_ts = String::new();

    loop {
        let mut line = String::new();
        let bytes_read = reader
            .read_line(&mut line)
            .map_err(|e| format!("read: {}", e))?;
        if bytes_read == 0 {
            break;
        }
        let current_offset = byte_offset;
        byte_offset += bytes_read as u64;

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Ok(json_val) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };

        if let Some(ts) = shared::extract_timestamp(&json_val) {
            last_ts = ts;
        }

        importer.process_line(
            &line,
            &json_val,
            current_offset,
            &mut index_writer,
            Some(&skip_set),
        )?;
    }

    // Finalize
    importer.finalize(&last_ts, &mut index_writer, Some(&skip_set))?;
    index_writer
        .flush()
        .map_err(|e| format!("flush index: {}", e))?;

    // Update watermark
    let new_watermark = ImportWatermark {
        offset: byte_offset,
        mtime_ns: current_mtime_ns,
        file_size: current_size,
        last_uuid: None,
    };

    // Update RunMeta
    let usage_incomplete = importer.usage_incomplete;
    super::runs::with_meta(run_id, |meta| {
        meta.cli_import_watermark = Some(new_watermark.clone());
        meta.cli_usage_incomplete = if usage_incomplete { Some(true) } else { None };
        Ok(())
    })?;

    let elapsed = start.elapsed();
    log::debug!(
        "[cli_sessions] sync: done in {:?}, new_events={}",
        elapsed,
        importer.events_imported
    );

    Ok(SyncResult {
        new_events: importer.events_imported,
        new_watermark,
        usage_incomplete: importer.usage_incomplete,
    })
}

/// Reconcile sync — full re-scan with dedup via import-index.
fn sync_reconcile(
    run_id: &str,
    cli_path: &Path,
    event_writer: std::sync::Arc<EventWriter>,
) -> Result<SyncResult, String> {
    let start = std::time::Instant::now();
    log::debug!("[cli_sessions] reconcile: run_id={}", run_id);

    // Load existing import-index for dedup
    let index_path = import_index_path(run_id);
    let skip_set = load_import_skip_set(&index_path);
    log::debug!(
        "[cli_sessions] reconcile: loaded {} existing keys",
        skip_set.len()
    );

    let mut importer = TranscriptImporter::new(run_id.to_string(), event_writer.clone());
    importer.known_usage_turns = load_known_usage_turns(run_id);

    let index_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&index_path)
        .map_err(|e| format!("open index: {}", e))?;
    let mut index_writer = BufWriter::new(index_file);

    let file = File::open(cli_path).map_err(|e| format!("open: {}", e))?;
    let reader = BufReader::new(file);
    let mut byte_offset: u64 = 0;
    let mut last_ts = String::new();

    for line_result in reader.lines() {
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

        if let Some(ts) = shared::extract_timestamp(&json_val) {
            last_ts = ts;
        }

        importer.process_line(
            &line,
            &json_val,
            current_offset,
            &mut index_writer,
            Some(&skip_set),
        )?;
    }

    importer.finalize(&last_ts, &mut index_writer, Some(&skip_set))?;
    index_writer
        .flush()
        .map_err(|e| format!("flush index: {}", e))?;

    // Rebuild watermark
    let file_meta = fs::metadata(cli_path).map_err(|e| format!("stat: {}", e))?;
    let mtime_ns = file_mtime_ns_from_metadata(&file_meta);

    let new_watermark = ImportWatermark {
        offset: byte_offset,
        mtime_ns,
        file_size: file_meta.len(),
        last_uuid: None,
    };

    // Update RunMeta
    let usage_incomplete = importer.usage_incomplete;
    super::runs::with_meta(run_id, |meta| {
        meta.cli_import_watermark = Some(new_watermark.clone());
        meta.cli_usage_incomplete = if usage_incomplete { Some(true) } else { None };
        Ok(())
    })?;

    log::debug!(
        "[cli_sessions] reconcile: done in {:?}, new_events={}",
        start.elapsed(),
        importer.events_imported
    );

    Ok(SyncResult {
        new_events: importer.events_imported,
        new_watermark,
        usage_incomplete: importer.usage_incomplete,
    })
}

// ── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
