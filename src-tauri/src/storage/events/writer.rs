use crate::models::{now_iso, BusEvent, ModelUsageSummary, RawRunUsage, RunEvent, RunEventType};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Read, Seek, SeekFrom, Write};

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

pub struct EventWriter {
    inner: Mutex<HashMap<String, Arc<Mutex<RunWriter>>>>,
}

impl Default for EventWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl EventWriter {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// Get or create the per-run RunWriter (seq + persistent BufWriter).
    /// Returns Err when the events file cannot be opened (invalid run_id path,
    /// permission, etc.) — never panics; callers must surface the error.
    fn get_or_create_run(&self, run_id: &str) -> Result<Arc<Mutex<RunWriter>>, String> {
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        // GC: drop entries whose per-run Arc has no other holders (session ended)
        if map.len() > 50 {
            map.retain(|_, v| Arc::strong_count(v) > 1);
        }
        if let Some(existing) = map.get(run_id) {
            return Ok(existing.clone());
        }
        let start_seq = next_seq(run_id);
        let dir = super::run_dir(run_id);
        let _ = super::ensure_dir(&dir);
        let path = events_path(run_id);
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| format!("failed to open events.jsonl for run_id={run_id}: {e}"))?;
        let writer = Arc::new(Mutex::new(RunWriter {
            next_seq: start_seq,
            writer: BufWriter::new(file),
        }));
        map.insert(run_id.to_string(), writer.clone());
        Ok(writer)
    }

    /// Write an event with a caller-supplied timestamp. If `durable` is true,
    /// the write is immediately flushed + fsync'd + dir-sync'd. Otherwise the
    /// data sits in the BufWriter and is group-committed on the next durable
    /// write or when the OS flushes dirty pages.
    ///
    /// Returns the assigned monotonic seq.
    fn write_inner(
        &self,
        run_id: &str,
        event: &BusEvent,
        ts: &str,
        durable: bool,
    ) -> Result<u64, String> {
        let run_arc = self.get_or_create_run(run_id)?;

        let mut run = run_arc.lock().unwrap_or_else(|e| e.into_inner());
        let current = run.next_seq;
        run.next_seq = current + 1;

        let envelope = serde_json::json!({
            "_bus": true,
            "seq": current,
            "ts": ts,
            "event": event,
        });
        let line =
            serde_json::to_string(&envelope).map_err(|e| format!("serialize failed: {}", e))?;
        writeln!(run.writer, "{}", line)
            .map_err(|e| format!("write events.jsonl failed: {}", e))?;

        if durable {
            // Source-of-truth contract: terminal state, permission gates, and
            // user messages must survive a crash. Flush + fdatasync + dir-sync.
            run.writer
                .flush()
                .map_err(|e| format!("flush events.jsonl failed: {}", e))?;
            run.writer
                .get_ref()
                .sync_data()
                .map_err(|e| format!("sync_data events.jsonl failed: {}", e))?;
            let dir = super::run_dir(run_id);
            sync_events_dir(dir.as_path())?;
        }

        Ok(current)
    }

    /// Atomically assign seq + write to events.jsonl (both under the same per-run lock).
    /// Returns `Err` if any step fails (dir creation, serialization, file I/O).
    /// Uses group commit: non-durable events are buffered, durable events fsync.
    pub fn write_bus_event(&self, run_id: &str, event: &BusEvent) -> Result<(), String> {
        log::trace!("[storage/events] write_bus_event: run_id={}", run_id);
        let durable = is_durable_event(event);
        let ts = now_iso();
        self.write_inner(run_id, event, &ts, durable).map(|_| ())
    }

    /// Like `write_bus_event` but uses a caller-supplied timestamp and returns the assigned seq.
    /// Uses group commit: non-durable events are buffered, durable events fsync.
    pub fn write_bus_event_with_ts(
        &self,
        run_id: &str,
        event: &BusEvent,
        ts: &str,
    ) -> Result<u64, String> {
        log::trace!(
            "[storage/events] write_bus_event_with_ts: run_id={}, ts={}",
            run_id,
            ts
        );
        let durable = is_durable_event(event);
        self.write_inner(run_id, event, ts, durable)
    }

    /// Force-flush all buffered data for a specific run to disk (fsync + dir-sync).
    /// Called on session end / run teardown to ensure no data stays in userspace buffers.
    pub fn flush_run(&self, run_id: &str) -> Result<(), String> {
        let run_arc = {
            let map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            map.get(run_id).cloned()
        };
        if let Some(run_arc) = run_arc {
            let mut run = run_arc.lock().unwrap_or_else(|e| e.into_inner());
            run.writer
                .flush()
                .map_err(|e| format!("flush events.jsonl failed: {}", e))?;
            run.writer
                .get_ref()
                .sync_data()
                .map_err(|e| format!("sync_data events.jsonl failed: {}", e))?;
            let dir = super::run_dir(run_id);
            sync_events_dir(dir.as_path())?;
        }
        Ok(())
    }
}

/// Thin wrapper for backward compatibility — delegates to EventWriter.
/// Returns `Err` if persistence failed.
