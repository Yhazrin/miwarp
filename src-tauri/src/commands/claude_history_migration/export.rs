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

pub fn export_claude_code_history_archive(output_path: String) -> Result<ExportReport, String> {
    log::debug!("[migration] export: output_path={}", output_path);

    let projects_dir = shared::claude_projects_dir()
        .ok_or_else(|| "cannot determine ~/.claude/projects".to_string())?;

    if !projects_dir.exists() {
        return Err("~/.claude/projects/ does not exist".to_string());
    }

    // Collect all .jsonl files
    let jsonl_files: Vec<(PathBuf, u64)> = collect_jsonl_recursive(&projects_dir)
        .map_err(|e| format!("failed to walk projects dir: {}", e))?;

    if jsonl_files.is_empty() {
        return Ok(ExportReport {
            session_count: 0,
            total_bytes: 0,
            failures: vec![],
        });
    }

    let _total_input_bytes: u64 = jsonl_files.iter().map(|(_, s)| *s).sum();

    // Create zip archive
    let file = File::create(&output_path).map_err(|e| format!("create zip: {}", e))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    let mut failures = Vec::new();
    let mut manifest_sessions: Vec<ManifestSession> = Vec::new();
    let mut total_written: u64 = 0;

    for (jsonl_path, file_size) in &jsonl_files {
        let rel_path = jsonl_path
            .strip_prefix(&projects_dir)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();

        // Skip excluded paths
        if should_exclude_path(&rel_path) {
            log::debug!("[migration] export: skipping excluded path {:?}", rel_path);
            continue;
        }

        match export_single_session(&mut zip, options, jsonl_path, &rel_path, file_size) {
            Ok(session) => {
                manifest_sessions.push(session.0);
                total_written += session.1;
            }
            Err(e) => {
                failures.push(format!("{}: {}", rel_path, e));
            }
        }
    }

    // Write manifest
    let manifest = ArchiveManifest {
        version: ARCHIVE_VERSION.to_string(),
        created_at: crate::models::now_iso(),
        cli_version: None,
        sessions: manifest_sessions,
    };
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("serialize manifest: {}", e))?;
    zip.start_file(MANIFEST_NAME, options)
        .map_err(|e| format!("start manifest file: {}", e))?;
    zip.write_all(manifest_json.as_bytes())
        .map_err(|e| format!("write manifest: {}", e))?;

    zip.finish().map_err(|e| format!("finish zip: {}", e))?;

    let session_count = manifest.sessions.len();
    log::info!(
        "[migration] export: {} sessions, {} bytes written, {} failures",
        session_count,
        total_written,
        failures.len()
    );

    Ok(ExportReport {
        session_count,
        total_bytes: total_written,
        failures,
    })
}

