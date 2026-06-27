//! Claude Code native history session migration commands.
//!
//! Exports Claude Code history sessions from `~/.claude/projects/**/*.jsonl` as a portable
//! zip archive, and imports such archives into MiWarp without writing back to `~/.claude/projects/`.

use crate::agent::claude_protocol::{validate_bus_event, ProtocolState};
use crate::models::{
    BusEvent, ConversationRef, ExecutionPath, ImportWatermark, RunMeta, RunSource, RunStatus,
};
use crate::storage::cli_sessions::normalize_transcript_line;
use crate::storage::events::{is_replayable, EventWriter};
use crate::storage::shared;
use crate::storage::{ensure_dir, run_dir, runs_dir};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
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

fn collect_jsonl_recursive(dir: &Path) -> std::io::Result<Vec<(PathBuf, u64)>> {
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
pub fn import_claude_code_history_archive(archive_path: String) -> Result<ImportReport, String> {
    log::debug!("[migration] import: archive_path={}", archive_path);

    let archive_path = PathBuf::from(&archive_path);
    if !archive_path.exists() {
        return Err(format!("archive not found: {}", archive_path.display()));
    }

    // Extract to temp directory
    let temp_dir = tempfile_tempdir()?;
    let temp_path = temp_dir.path().to_path_buf();

    // Extract zip with zip-slip protection
    extract_zip(&archive_path, &temp_path)?;

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

    // Build existing import index for dedup
    let existing_index = build_imported_index();

    let event_writer = Arc::new(EventWriter::new());
    let mut imported = 0;
    let mut skipped = 0;
    let mut duplicates = 0;
    let mut failed = 0;
    let mut missing_cwd = 0;
    let mut details: Vec<ImportDetail> = Vec::new();

    for session in manifest.sessions {
        let detail =
            import_single_session(&session, &temp_path, &existing_index, event_writer.clone());

        match detail.status.as_str() {
            "imported" => imported += 1,
            "skipped" => skipped += 1,
            "duplicate" => duplicates += 1,
            "missing_cwd" => missing_cwd += 1,
            "failed" => failed += 1,
            _ => {}
        }
        details.push(detail);
    }

    log::info!(
        "[migration] import: done - imported={}, skipped={}, duplicates={}, failed={}, missing_cwd={}",
        imported, skipped, duplicates, failed, missing_cwd
    );

    // Invalidate imported cache so next discover reflects new imports
    crate::storage::cli_sessions::invalidate_imported_cache();

    Ok(ImportReport {
        imported,
        skipped,
        duplicates,
        failed,
        missing_cwd,
        details,
    })
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

fn build_imported_index() -> HashMap<(String, String), String> {
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

fn import_single_session(
    session: &ManifestSession,
    temp_path: &Path,
    existing_index: &HashMap<(String, String), String>,
    event_writer: Arc<EventWriter>,
) -> ImportDetail {
    let session_id = &session.session_id;
    let cwd = &session.cwd;

    // Check for duplicates
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
        Ok(run_id) => ImportDetail {
            session_id: session_id.clone(),
            cwd: cwd.clone(),
            run_id: Some(run_id),
            status: "imported".to_string(),
            error: None,
        },
        Err(e) => ImportDetail {
            session_id: session_id.clone(),
            cwd: cwd.clone(),
            run_id: None,
            status: "failed".to_string(),
            error: Some(e),
        },
    }
}

fn run_import_pipeline(
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

    // Save meta
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

    Ok(run_id)
}

fn is_real_user_prompt(normalized: &serde_json::Value) -> bool {
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

fn flush_turn_usage(
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

// ── Scan ─────────────────────────────────────────────────────────────────────

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn write_test_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = File::create(path).expect("create zip");
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        for (name, data) in entries {
            zip.start_file(*name, options).expect("start file");
            zip.write_all(data).expect("write file");
        }
        zip.finish().expect("finish zip");
    }

    fn write_test_zip_in_memory(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut buf);
            let options = SimpleFileOptions::default();
            for (name, data) in entries {
                zip.start_file(*name, options).expect("start file");
                zip.write_all(data).expect("write file");
            }
            zip.finish().expect("finish zip");
        }
        buf.into_inner()
    }

    #[test]
    fn extract_zip_writes_manifest_and_session() {
        let dest = tempfile::tempdir().expect("tempdir");
        let archive = dest.path().join("archive.zip");
        write_test_zip(
            &archive,
            &[
                ("manifest.json", br#"{"version":"1.0"}"#),
                ("project-a/session-1.jsonl", br#"{"type":"user"}"#),
            ],
        );

        extract_zip(&archive, dest.path()).expect("extract");

        assert!(dest.path().join("manifest.json").is_file());
        assert!(dest.path().join("project-a/session-1.jsonl").is_file());
    }

    #[test]
    fn extract_zip_rejects_path_traversal_entries() {
        let dest = tempfile::tempdir().expect("tempdir");
        for entry in ["../evil.jsonl", "/tmp/evil.jsonl", "C:\\evil.jsonl"] {
            let archive = dest
                .path()
                .join(format!("bad-{}.zip", entry.replace('/', "_")));
            write_test_zip(&archive, &[(entry, b"{}")]);
            let err = extract_zip(&archive, dest.path()).unwrap_err();
            assert!(
                err.contains("path traversal")
                    || err.contains("absolute path")
                    || err.contains("windows drive")
                    || err.contains("unsafe or invalid"),
                "unexpected error for {entry}: {err}"
            );
        }
    }

    #[test]
    fn reject_unsafe_zip_entry_name_blocks_dotdot() {
        assert!(reject_unsafe_zip_entry_name("../evil.jsonl").is_err());
        assert!(reject_unsafe_zip_entry_name("/tmp/evil.jsonl").is_err());
        assert!(reject_unsafe_zip_entry_name("C:\\evil.jsonl").is_err());
        assert!(reject_unsafe_zip_entry_name("project-a/session.jsonl").is_ok());
    }

    #[test]
    fn enclosed_name_rejects_traversal_in_memory_zip() {
        let bytes = write_test_zip_in_memory(&[("../evil.jsonl", b"{}")]);
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("parse in-memory zip");
        let entry = archive.by_index(0).expect("entry");
        assert!(entry.enclosed_name().is_none());
    }
}
