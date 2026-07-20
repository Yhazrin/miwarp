use super::import::{extract_zip, reject_unsafe_zip_entry_name};
use super::index::{import_single_session, run_import_pipeline};
use super::types::ArchiveManifest;
use super::*;
use crate::storage::events::EventWriter;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Cursor, Write};
use std::path::Path;
use std::sync::Arc;
use tauri::AppHandle;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

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

// ── P0-I1 — async + AppHandle + ImportProgressEvent ─────────────────

/// P0-I1: `ImportProgressEvent` serializes to the camelCase payload
/// the UI expects, with the field names documented in the frontend
/// progress subscription.
#[test]
fn import_progress_event_serializes_camel_case() {
    let ev = ImportProgressEvent {
        done: 3,
        total: 12,
        last_session_id: "sess-abc".to_string(),
        last_status: "imported".to_string(),
    };
    let json = serde_json::to_value(&ev).expect("serialize");
    assert_eq!(json["done"], 3);
    assert_eq!(json["total"], 12);
    assert_eq!(json["lastSessionId"], "sess-abc");
    assert_eq!(json["lastStatus"], "imported");
}

/// P0-I1: Pin the async signature so any future drift becomes a
/// compile error in this test. The function must be a free
/// function callable as `fn(AppHandle, String) -> Future<...>`.
#[test]
#[allow(clippy::type_complexity)]
fn import_command_signature_uses_app_handle_and_async() {
    let _f: fn(
        AppHandle,
        String,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<ImportReport, String>> + Send>,
    > = |app, path| Box::pin(import_claude_code_history_archive(app, path));
}

// ── P0-I2 — partial-failure cleanup ──────────────────────────────────

/// P0-I2: when `run_import_pipeline` fails pre-`ensure_dir` (the
/// most common failure mode: missing or unreadable source jsonl),
/// no `run_dir` is created and the failure propagates cleanly.
/// This pins the "no leftover state on failure" invariant.
#[test]
fn run_import_pipeline_leaves_no_run_dir_on_failure() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let prev_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", tmp.path());

    // Force a pre-`ensure_dir` failure by making the jsonl path
    // a directory. `File::open` on a directory fails on every
    // platform.
    let bad_jsonl = tmp.path().join("not-a-file");
    std::fs::create_dir_all(&bad_jsonl).expect("create dir-as-jsonl");

    let writer = Arc::new(EventWriter::new());
    let result = run_import_pipeline(
        &bad_jsonl,
        "sess-fail",
        "/tmp/no-cwd-yet",
        "not-a-file",
        writer,
    );
    assert!(result.is_err(), "expected Err for directory-as-jsonl");

    // The `runs_dir` may not even exist (lazy), but if it does it
    // must not contain any entry for our test session.
    let runs = crate::storage::runs_dir();
    let leaked = runs.exists()
        && std::fs::read_dir(&runs)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .any(|e| e.file_name().to_string_lossy().contains("sess-fail"))
            })
            .unwrap_or(false);
    assert!(
        !leaked,
        "no run_dir should be created when pipeline fails pre-ensure_dir"
    );

    // Restore HOME
    match prev_home {
        Some(v) => std::env::set_var("HOME", v),
        None => std::env::remove_var("HOME"),
    }
}

/// P0-I2 (positive case): a successful import keeps the run_dir.
/// Pins the invariant that the cleanup branch only fires on
/// failure, not on success.
#[test]
fn run_import_pipeline_succeeds_keeps_run_dir() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let prev_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", tmp.path());

    // Minimal valid jsonl: a user message, an assistant message
    // with usage, and a result line.
    let jsonl = tmp.path().join("happy.jsonl");
    std::fs::write(
            &jsonl,
            br#"{"type":"user","message":{"content":"hi"},"cwd":"/tmp/x","timestamp":"2026-01-01T00:00:00Z","uuid":"u1"}
{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"hello"}],"model":"claude-opus-4-6","usage":{"input_tokens":1,"output_tokens":2}},"timestamp":"2026-01-01T00:00:01Z","uuid":"u2"}
{"type":"result","subtype":"success","timestamp":"2026-01-01T00:00:02Z","uuid":"u3"}
"#,
        )
        .expect("write jsonl");

    let writer = Arc::new(EventWriter::new());
    let run_id = run_import_pipeline(
        &jsonl,
        "sess-happy",
        "/tmp/happy-cwd",
        "happy.jsonl",
        writer,
    )
    .expect("pipeline should succeed");

    let run_path = crate::storage::run_dir(&run_id);
    assert!(
        run_path.is_dir(),
        "successful import must keep run_dir at {}",
        run_path.display()
    );

    // Restore HOME
    match prev_home {
        Some(v) => std::env::set_var("HOME", v),
        None => std::env::remove_var("HOME"),
    }

    // Cleanup
    let _ = std::fs::remove_dir_all(&run_path);
}

// ── P0-I3 — in-batch dedup ──────────────────────────────────────────

/// P0-I3: two sessions with the same (session_id, cwd) in the same
/// batch must result in 1 imported + 1 duplicate, with the in-batch
/// `existing_index` updated after the first successful import.
/// Before the fix, both calls returned "imported" and the second
/// call created a second run_dir.
#[test]
fn import_single_session_dedupes_within_batch() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let prev_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", tmp.path());

    // Build a jsonl file that is valid for `run_import_pipeline`.
    let jsonl = tmp.path().join("dup.jsonl");
    std::fs::write(
            &jsonl,
            br#"{"type":"user","message":{"content":"hi"},"cwd":"/tmp/dup","timestamp":"2026-01-01T00:00:00Z","uuid":"u1"}
{"type":"result","subtype":"success","timestamp":"2026-01-01T00:00:02Z","uuid":"u2"}
"#,
        )
        .expect("write jsonl");

    // ManifestSession is private; build it via JSON round-trip.
    let manifest_json = r#"{
            "version": "1.0",
            "createdAt": "2026-01-01T00:00:00Z",
            "cliVersion": null,
            "sessions": [
                {
                    "sessionId": "sess-dup",
                    "cwd": "/tmp/dup-cwd",
                    "relativePath": "dup.jsonl",
                    "fileSize": 100,
                    "firstPrompt": null,
                    "startedAt": "2026-01-01T00:00:00Z",
                    "lastActivityAt": "2026-01-01T00:00:02Z",
                    "messageCount": 1,
                    "model": null
                }
            ]
        }"#;
    let manifest: ArchiveManifest = serde_json::from_str(manifest_json).expect("parse manifest");
    let session = manifest.sessions.first().expect("one session");

    let mut index: HashMap<(String, String), String> = HashMap::new();
    let writer = Arc::new(EventWriter::new());

    let first = import_single_session(session, tmp.path(), &mut index, writer.clone());
    let second = import_single_session(session, tmp.path(), &mut index, writer.clone());

    // Cleanup any run_dirs we may have created.
    if let Some(rid) = first.run_id.clone() {
        let _ = std::fs::remove_dir_all(crate::storage::run_dir(&rid));
    }

    match prev_home {
        Some(v) => std::env::set_var("HOME", v),
        None => std::env::remove_var("HOME"),
    }

    assert_eq!(first.status, "imported", "first call should import");
    assert_eq!(second.status, "duplicate", "second call should dedup");
    assert_eq!(index.len(), 1, "in-batch index should be updated");
}

// ── P0-I4 — missing_cwd emits real status ──────────────────────────

/// P0-I4: when the manifest entry has an empty cwd,
/// `import_single_session` must return `status: "missing_cwd"` so
/// the report's `missing_cwd` counter reflects the actual data
/// quality issue. Before the fix, this branch never fired because
/// the function only ever returned "duplicate" | "imported" |
/// "failed".
#[test]
fn import_single_session_returns_missing_cwd_when_cwd_empty() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let prev_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", tmp.path());

    let manifest_json = r#"{
            "version": "1.0",
            "createdAt": "2026-01-01T00:00:00Z",
            "cliVersion": null,
            "sessions": [
                {
                    "sessionId": "sess-nocwd",
                    "cwd": "",
                    "relativePath": "x.jsonl",
                    "fileSize": 0,
                    "firstPrompt": null,
                    "startedAt": null,
                    "lastActivityAt": null,
                    "messageCount": 0,
                    "model": null
                }
            ]
        }"#;
    let manifest: ArchiveManifest = serde_json::from_str(manifest_json).expect("parse manifest");
    let session = manifest.sessions.first().expect("one session");

    let mut index: HashMap<(String, String), String> = HashMap::new();
    let writer = Arc::new(EventWriter::new());

    let detail = import_single_session(session, tmp.path(), &mut index, writer);

    match prev_home {
        Some(v) => std::env::set_var("HOME", v),
        None => std::env::remove_var("HOME"),
    }

    assert_eq!(detail.status, "missing_cwd");
    assert!(detail.run_id.is_none());
    assert!(detail.error.is_some());
    // The session must NOT have been added to the in-batch index.
    assert!(
        index.is_empty(),
        "missing_cwd session should not enter the dedup index"
    );
}
