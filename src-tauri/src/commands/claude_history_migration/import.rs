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

pub async fn import_claude_code_history_archive(
    app: AppHandle,
    archive_path: String,
) -> Result<ImportReport, String> {
    log::debug!("[migration] import: archive_path={}", archive_path);

    let archive_path_buf = PathBuf::from(&archive_path);
    if !archive_path_buf.exists() {
        return Err(format!("archive not found: {}", archive_path_buf.display()));
    }

    // Extract to temp directory (synchronous — small amount of IO)
    let temp_dir = tempfile_tempdir()?;
    let temp_path = temp_dir.path().to_path_buf();

    // Extract zip with zip-slip protection
    extract_zip(&archive_path_buf, &temp_path)?;

    // Read and validate manifest
    let manifest: ArchiveManifest = {
        let manifest_path = temp_path.join(MANIFEST_NAME);
        if !manifest_path.exists() {
            return Err("invalid archive: manifest.json not found".to_string());
        }
        let content =
            fs::read_to_string(&manifest_path).map_err(|e| format!("read manifest: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("parse manifest: {}", e))?
    };

    log::info!(
        "[migration] import: manifest version={}, {} sessions",
        manifest.version,
        manifest.sessions.len()
    );

    // Build existing import index for dedup (mutable so we update it
    // in-batch as each session is successfully imported — otherwise
    // two sessions in the same archive with the same (session_id, cwd)
    // would both be marked "imported" instead of the second being
    // detected as a duplicate).
    let mut existing_index = build_imported_index();
    let total = manifest.sessions.len();

    let event_writer = Arc::new(EventWriter::new());
    let app_for_blocking = app.clone();

    // Run the import loop on a blocking thread so the long sync work
    // (file IO, JSONL parsing, event writing) does not stall the
    // async runtime. Progress events are emitted back to the UI after
    // each session is processed.
    let (report, app_after_blocking) = tokio::task::spawn_blocking(move || {
        let mut imported = 0;
        let mut skipped = 0;
        let mut duplicates = 0;
        let mut failed = 0;
        let mut missing_cwd = 0;
        let mut details: Vec<ImportDetail> = Vec::new();

        for (idx, session) in manifest.sessions.into_iter().enumerate() {
            let detail = import_single_session(
                &session,
                &temp_path,
                &mut existing_index,
                event_writer.clone(),
            );

            match detail.status.as_str() {
                "imported" => imported += 1,
                "skipped" => skipped += 1,
                "duplicate" => duplicates += 1,
                "missing_cwd" => missing_cwd += 1,
                "failed" => failed += 1,
                _ => {}
            }

            // Emit a progress event after each session so the UI can
            // surface "3/12 imported" without polling.
            let _ = app_for_blocking.emit(
                "import:progress",
                ImportProgressEvent {
                    done: idx + 1,
                    total,
                    last_session_id: detail.session_id.clone(),
                    last_status: detail.status.clone(),
                },
            );

            details.push(detail);
        }

        let report = ImportReport {
            imported,
            skipped,
            duplicates,
            failed,
            missing_cwd,
            details,
        };
        (report, app_for_blocking)
    })
    .await
    .map_err(|e| format!("import task join error: {}", e))?;

    // `app_after_blocking` is moved into the closure; we no longer
    // need it here, but reference it to keep the closure signature
    // honest (returns the same AppHandle for any future post-loop work).
    let _ = app_after_blocking;

    log::info!(
        "[migration] import: done - imported={}, skipped={}, duplicates={}, failed={}, missing_cwd={}",
        report.imported, report.skipped, report.duplicates, report.failed, report.missing_cwd
    );

    // Invalidate imported cache so next discover reflects new imports
    crate::storage::cli_sessions::invalidate_imported_cache();

    Ok(report)
}

fn tempfile_tempdir() -> Result<tempfile::TempDir, String> {
    tempfile::tempdir().map_err(|e| format!("create temp dir: {}", e))
}

fn reject_unsafe_zip_entry_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.contains('\0') {
        return Err(format!("invalid zip entry name: {:?}", name));
    }

    let normalized = name.replace('\\', "/");
    if normalized.starts_with('/') {
        return Err(format!("absolute path in zip: {}", name));
    }
    if normalized.split('/').any(|part| part == "..") {
        return Err(format!("path traversal in zip: {}", name));
    }
    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Err(format!("windows drive path in zip: {}", name));
    }

    Ok(())
}

/// Ensure a zip `relative` path stays inside `canonical_base` (lexical; target need not exist).
fn ensure_within_dir(canonical_base: &Path, relative: &Path) -> Result<(), String> {
    let mut joined = canonical_base.to_path_buf();
    for component in relative.components() {
        match component {
            std::path::Component::ParentDir => {
                return Err(format!(
                    "zip-slip attempt detected: parent segment in {}",
                    relative.display()
                ));
            }
            std::path::Component::RootDir | std::path::Component::Prefix(_) => {
                return Err(format!(
                    "zip-slip attempt detected: absolute segment in {}",
                    relative.display()
                ));
            }
            std::path::Component::Normal(part) => {
                joined.push(part);
            }
            std::path::Component::CurDir => {}
        }
    }

    if !joined.starts_with(canonical_base) {
        return Err(format!(
            "zip-slip attempt detected: {} resolves outside {}",
            relative.display(),
            canonical_base.display()
        ));
    }

    Ok(())
}

fn extract_zip(archive_path: &Path, dest_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dest_dir)
        .map_err(|e| format!("create dest dir {}: {}", dest_dir.display(), e))?;

    let canonical_dest = dest_dir
        .canonicalize()
        .map_err(|e| format!("canonicalize dest: {}", e))?;

    let file = File::open(archive_path).map_err(|e| format!("open archive: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("parse zip: {}", e))?;

    for i in 0..archive.len() {
        let mut zip_file = archive
            .by_index(i)
            .map_err(|e| format!("read zip entry {}: {}", i, e))?;

        let entry_name = zip_file.name().to_string();
        reject_unsafe_zip_entry_name(&entry_name)?;

        let relative = zip_file
            .enclosed_name()
            .ok_or_else(|| format!("unsafe or invalid zip entry: {}", entry_name))?;
        ensure_within_dir(&canonical_dest, &relative)?;
        let outpath = canonical_dest.join(&relative);

        if entry_name.ends_with('/') {
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("create dir {}: {}", outpath.display(), e))?;
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("create parent dir {}: {}", parent.display(), e))?;
            }
            let mut outfile = File::create(&outpath)
                .map_err(|e| format!("create file {}: {}", outpath.display(), e))?;
            std::io::copy(&mut zip_file, &mut outfile)
                .map_err(|e| format!("copy to {}: {}", outpath.display(), e))?;
        }
    }

    Ok(())
}

