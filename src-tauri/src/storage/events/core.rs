use crate::models::{now_iso, BusEvent, RunEvent, RunEventType};
use std::fs::{self, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};

/// Event types the frontend reducer actually handles during replay.
/// "raw" events (CLI stream data) are 90%+ of the file but the frontend drops them,
/// so filtering here avoids serializing megabytes of unused data across IPC.
pub const REPLAY_TYPES: &[&str] = &[
    "session_init",
    "message_delta",
    "thinking_delta",
    "tool_input_delta",
    "message_complete",
    "user_message",
    "tool_start",
    "tool_end",
    "run_state",
    "usage_update",
    "permission_denied",
    "permission_prompt",
    "compact_boundary",
    "system_status",
    "auth_status",
    "hook_started",
    "hook_response",
    "control_cancelled",
    "task_notification",
    "tool_progress",
    "tool_use_summary",
    "command_output",
    "files_persisted",
    "hook_progress",
    "hook_callback",
    "elicitation_prompt",
    "rate_limit_event",
];

/// Check if a BusEvent's serde tag is in REPLAY_TYPES.
pub fn is_replayable(event: &BusEvent) -> bool {
    let Ok(v) = serde_json::to_value(event) else {
        return false;
    };
    let Some(tag) = v.get("type").and_then(|t| t.as_str()) else {
        return false;
    };
    REPLAY_TYPES.contains(&tag)
}

pub fn events_path(run_id: &str) -> std::path::PathBuf {
    super::super::run_dir(run_id).join("events.jsonl")
}

pub fn next_seq(run_id: &str) -> u64 {
    let path = events_path(run_id);
    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return 1,
    };
    let file_len = file.metadata().map(|m| m.len()).unwrap_or(0);
    if file_len == 0 {
        return 1;
    }

    let mut reader = BufReader::new(file);
    if file_len > 4096 {
        let _ = reader.seek(SeekFrom::End(-4096));
    }

    // Use read_to_end + from_utf8_lossy to handle potential mid-character seek
    let mut buf = Vec::new();
    if reader.read_to_end(&mut buf).is_err() {
        return 1;
    }
    let tail = String::from_utf8_lossy(&buf);

    // Skip first (potentially partial) line if we seeked into the middle
    let lines_str = if file_len > 4096 {
        tail.split_once('\n').map(|(_, rest)| rest).unwrap_or(&tail)
    } else {
        &tail
    };

    let max_seq = lines_str
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter_map(|v| v.get("seq").and_then(|s| s.as_u64()))
        .max()
        .unwrap_or(0);
    max_seq + 1
}

pub fn append_event(
    run_id: &str,
    event_type: RunEventType,
    payload: serde_json::Value,
) -> Result<RunEvent, String> {
    log::trace!(
        "[storage/events] append_event: run_id={}, type={:?}",
        run_id,
        event_type
    );
    let dir = super::super::run_dir(run_id);
    super::super::ensure_dir(&dir).map_err(|e| e.to_string())?;

    let event = RunEvent {
        id: uuid::Uuid::new_v4().to_string()[..12].to_string(),
        task_id: run_id.to_string(),
        seq: next_seq(run_id),
        event_type,
        payload,
        timestamp: now_iso(),
    };

    let path = events_path(run_id);
    let line = serde_json::to_string(&event).map_err(|e| e.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{}", line).map_err(|e| e.to_string())?;

    Ok(event)
}

pub fn list_events(run_id: &str, since_seq: u64) -> Vec<RunEvent> {
    let path = events_path(run_id);
    if !path.exists() {
        return vec![];
    }
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<RunEvent>(l).ok())
        .filter(|e| e.seq > since_seq)
        .collect()
}

// ── Bus event persistence ──

/// `fsync` the parent directory so the appended entry survives power loss
/// even when events.jsonl was just created. Mirrors `sync_directory` in
/// `storage/durable_io.rs` but kept inline so this module has no cross-file
/// dependency on a private helper.
pub(super) fn sync_events_dir(path: &std::path::Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        std::fs::File::open(path)
            .and_then(|dir| dir.sync_all())
            .map_err(|e| format!("sync directory {}: {}", path.display(), e))?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

/// Returns `true` for events that must survive a crash — terminal state,
/// permission gates, and user messages. These get an immediate fsync;
/// all other events are buffered and group-committed.
pub fn is_durable_event(event: &BusEvent) -> bool {
    matches!(
        event,
        BusEvent::RunState { .. }
            | BusEvent::PermissionPrompt { .. }
            | BusEvent::PermissionDenied { .. }
            | BusEvent::ElicitationPrompt { .. }
            | BusEvent::HookCallback { .. }
            | BusEvent::UserMessage { .. }
    )
}

/// Per-run writer state: monotonic seq counter + persistent BufWriter.
/// Held under a single Mutex per run_id so seq allocation and file write
/// are atomic without re-opening the file on every event.
pub(super) struct RunWriter {
    pub(super) next_seq: u64,
    pub(super) writer: BufWriter<std::fs::File>,
}
