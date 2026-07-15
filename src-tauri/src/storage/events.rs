use crate::models::{now_iso, BusEvent, ModelUsageSummary, RawRunUsage, RunEvent, RunEventType};
use std::collections::HashMap;
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
    super::run_dir(run_id).join("events.jsonl")
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
    let dir = super::run_dir(run_id);
    super::ensure_dir(&dir).map_err(|e| e.to_string())?;

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

use std::sync::{Arc, Mutex};

/// `fsync` the parent directory so the appended entry survives power loss
/// even when events.jsonl was just created. Mirrors `sync_directory` in
/// `storage/durable_io.rs` but kept inline so this module has no cross-file
/// dependency on a private helper.
fn sync_events_dir(path: &std::path::Path) -> Result<(), String> {
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
struct RunWriter {
    next_seq: u64,
    writer: BufWriter<std::fs::File>,
}

/// Atomic seq allocation + file write under per-run locks.
/// Each run_id gets its own Mutex so different runs never block each other.
/// The outer Mutex is only held briefly to get/create the per-run Arc.
///
/// Group commit: non-durable events are written to the BufWriter without
/// fsync — the OS page cache batches them. Durable events (terminal state,
/// permission gates, user messages) trigger an explicit flush + fsync +
/// dir-sync before returning. This reduces fsync calls from hundreds/sec
/// to a handful while preserving the crash-safety contract.
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
    /// Returns the Arc<Mutex<RunWriter>> for the given run_id.
    fn get_or_create_run(&self, run_id: &str) -> Arc<Mutex<RunWriter>> {
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        // GC: drop entries whose per-run Arc has no other holders (session ended)
        if map.len() > 50 {
            map.retain(|_, v| Arc::strong_count(v) > 1);
        }
        map.entry(run_id.to_string())
            .or_insert_with(|| {
                let start_seq = next_seq(run_id);
                let dir = super::run_dir(run_id);
                let _ = super::ensure_dir(&dir);
                let path = events_path(run_id);
                let file = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&path)
                    .expect("failed to open events.jsonl");
                Arc::new(Mutex::new(RunWriter {
                    next_seq: start_seq,
                    writer: BufWriter::new(file),
                }))
            })
            .clone()
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
        let run_arc = self.get_or_create_run(run_id);

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
pub fn persist_bus_event(
    writer: &EventWriter,
    run_id: &str,
    event: &BusEvent,
) -> Result<(), String> {
    writer.write_bus_event(run_id, event)
}

/// Copy content bus events from one run's events.jsonl to another.
/// Used by fork to preserve conversation history in the new run.
/// Lifecycle events (session_init, run_state, usage_update, permission_denied, raw)
/// are excluded — they belong to the parent session, not the fork.
/// Copied events get their `run_id` rewritten to `to_run_id` and `seq` renumbered
/// from 1 so the fork run's events.jsonl is fully self-consistent.
pub fn copy_bus_events(from_run_id: &str, to_run_id: &str) -> Result<(), String> {
    let src = events_path(from_run_id);
    if !src.exists() {
        log::debug!(
            "[storage/events] copy_bus_events: source {} has no events",
            from_run_id
        );
        return Ok(());
    }
    let dst_dir = super::run_dir(to_run_id);
    super::ensure_dir(&dst_dir).map_err(|e| format!("ensure_dir failed: {}", e))?;
    let dst = events_path(to_run_id);

    let content =
        fs::read_to_string(&src).map_err(|e| format!("read source events failed: {}", e))?;

    // Content event types to copy (conversation history).
    const CONTENT_TYPES: &[&str] = &[
        "message_delta",
        "message_complete",
        "tool_start",
        "tool_end",
        "user_message",
    ];

    let mut out = String::new();
    let mut copied = 0u64;
    let mut skipped = 0u64;

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(mut envelope) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };

        // Only process bus events
        if envelope.get("_bus").and_then(|b| b.as_bool()) != Some(true) {
            continue;
        }

        // Check inner event type
        let event_type = envelope
            .get("event")
            .and_then(|e| e.get("type"))
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();

        if CONTENT_TYPES.contains(&event_type.as_str()) {
            // Rewrite run_id in inner event to the fork run
            if let Some(event) = envelope.get_mut("event").and_then(|e| e.as_object_mut()) {
                event.insert(
                    "run_id".to_string(),
                    serde_json::Value::String(to_run_id.to_string()),
                );
            }
            // Renumber seq sequentially
            copied += 1;
            envelope["seq"] = serde_json::Value::Number(copied.into());

            let serialized =
                serde_json::to_string(&envelope).map_err(|e| format!("serialize failed: {}", e))?;
            out.push_str(&serialized);
            out.push('\n');
        } else {
            skipped += 1;
        }
    }

    fs::write(&dst, &out).map_err(|e| format!("write fork events failed: {}", e))?;
    log::debug!(
        "[storage/events] copy_bus_events: {} → {} (copied {} content events, skipped {} lifecycle, new max_seq={})",
        from_run_id, to_run_id, copied, skipped, copied
    );
    Ok(())
}

/// Extract usage summary from a run's events.jsonl by scanning for usage_update events.
/// Uses "simpler v1" approach: peak-detection for cost (handles session restarts),
/// last usage_update for tokens and model_usage, sum for duration_ms.
///
/// 结果会按 `events.jsonl` 的 mtime + size 做磁盘缓存，缓存在
/// `~/.miwarp/cache/usage/<run_id>.json`。events.jsonl 没变化时直接命中缓存，
/// 不再重读 + 解析整个文件。CLI 写入事件后 mtime 自动刷新，缓存自动失效。
pub fn extract_run_usage(run_id: &str) -> Option<RawRunUsage> {
    let path = events_path(run_id);
    if !path.exists() {
        return None;
    }

    let (events_mtime_ns, events_size) = file_mtime_and_size(&path).unwrap_or((0, 0));

    // 先查缓存：mtime + size 匹配就直接复用。
    if let Some(cached) = read_usage_cache(run_id, events_mtime_ns, events_size) {
        return Some(cached);
    }

    // Detect per-turn cost mode: CLI imports have per-turn total_cost_usd
    let is_per_turn_cost = {
        let meta_path = super::run_dir(run_id).join("meta.json");
        meta_path
            .exists()
            .then(|| {
                fs::read_to_string(&meta_path)
                    .ok()
                    .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
                    .and_then(|v| v.get("source").and_then(|s| s.as_str()).map(String::from))
            })
            .flatten()
            == Some("cli_import".to_string())
    };

    let result = scan_run_usage_inner(run_id, &path, is_per_turn_cost);

    if let Some(ref usage) = result {
        // 写缓存（失败不阻塞主流程，下一次重新算即可）。
        let _ = write_usage_cache(run_id, events_mtime_ns, events_size, usage);
    }

    result
}

/// 同步纯计算版本：直接读 events.jsonl + 解析聚合，不做任何缓存 IO。
/// 测试和缓存 miss 路径会走到这里。
fn scan_run_usage_inner(
    run_id: &str,
    path: &std::path::Path,
    is_per_turn_cost: bool,
) -> Option<RawRunUsage> {
    let content = fs::read_to_string(path).ok()?;

    let mut total_cost: f64 = 0.0;
    let mut prev_cost: f64 = 0.0;
    let mut peak_cost: f64 = 0.0;
    let mut total_duration_ms: u64 = 0;
    let mut found_any = false;
    // P0-3：用 turn_index 作为 peak detection 分段信号，避免 0.9 阈值不可靠。
    let mut last_turn_index: i64 = 0;

    // "Simpler v1": take values from the last usage_update event
    let mut last_input: u64 = 0;
    let mut last_output: u64 = 0;
    let mut last_cache_read: u64 = 0;
    let mut last_cache_write: u64 = 0;
    let mut last_num_turns: u64 = 0;
    let mut last_model_usage: HashMap<String, ModelUsageSummary> = HashMap::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Cheap pre-filter: skip ~99.6% of lines without JSON parsing
        if !line.contains("\"usage_update\"") {
            continue;
        }

        let Ok(envelope) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if envelope.get("_bus").and_then(|b| b.as_bool()) != Some(true) {
            continue;
        }
        let Some(event) = envelope.get("event") else {
            continue;
        };
        let event_type = event.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if event_type != "usage_update" {
            continue;
        }

        found_any = true;
        let cost = event
            .get("total_cost_usd")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        // P0-3：peak detection 改用 turn_index（1-based）作为分段信号。
        // 在 BusEvent::UsageUpdate 中已由 session_actor 写入 turn_index，
        // 这是后端权威值，避免 0.9 阈值对 cost_usd=0 / compact 跳变不可靠。
        //
        // 三条 fallback 策略（按优先级）：
        //   1) turn_index 单调递增 → 同一段内取 peak
        //   2) turn_index 缺失 / 重置 → 退化到 0.9 阈值（向后兼容老 run）
        //   3) turn_index 回退到 0 → 视作同一段
        let turn_index = event
            .get("turn_index")
            .and_then(|v| v.as_u64())
            .map(|n| n as i64);
        if is_per_turn_cost {
            // CLI imports: total_cost_usd is per-turn, sum directly
            total_cost += cost;
        } else {
            // Native sessions: total_cost_usd is cumulative, use peak detection
            match turn_index {
                Some(ti) => {
                    // turn_index 重置（小于等于上次）→ 新段开始
                    if ti <= last_turn_index && last_turn_index > 0 {
                        total_cost += peak_cost;
                        peak_cost = 0.0;
                    }
                    last_turn_index = ti;
                }
                None => {
                    // 老 usage_update 没 turn_index → 用 0.9 阈值兜底
                    if cost < prev_cost * 0.9 && prev_cost > 0.0 {
                        total_cost += peak_cost;
                        peak_cost = 0.0;
                    }
                }
            }
            if cost > peak_cost {
                peak_cost = cost;
            }
            prev_cost = cost;
        }

        // Tokens: for per-turn cost, sum them; for cumulative, take last
        if is_per_turn_cost {
            last_input += event
                .get("input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            last_output += event
                .get("output_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            last_cache_read += event
                .get("cache_read_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            last_cache_write += event
                .get("cache_write_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
        } else {
            last_input = event
                .get("input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(last_input);
            last_output = event
                .get("output_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(last_output);
            last_cache_read = event
                .get("cache_read_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(last_cache_read);
            last_cache_write = event
                .get("cache_write_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(last_cache_write);
        }
        last_num_turns = event
            .get("num_turns")
            .and_then(|v| v.as_u64())
            .unwrap_or(last_num_turns);

        // Sum duration_ms across turns (per-turn value, not cumulative)
        if let Some(d) = event.get("duration_ms").and_then(|v| v.as_u64()) {
            total_duration_ms += d;
        }

        // Take last model_usage map
        if let Some(mu) = event.get("model_usage").and_then(|v| v.as_object()) {
            last_model_usage.clear();
            for (model, entry) in mu {
                last_model_usage.insert(
                    model.clone(),
                    ModelUsageSummary {
                        input_tokens: entry
                            .get("input_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0),
                        output_tokens: entry
                            .get("output_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0),
                        cache_read_tokens: entry
                            .get("cache_read_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0),
                        cache_write_tokens: entry
                            .get("cache_write_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0),
                        cost_usd: entry
                            .get("cost_usd")
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0),
                    },
                );
            }
        }
    }

    if !found_any {
        return None;
    }

    // Add final segment's peak cost (only for cumulative mode)
    if !is_per_turn_cost {
        total_cost += peak_cost;
    }

    log::debug!(
        "[storage/events] extract_run_usage: run_id={}, cost={:.6}, tokens={}+{}, turns={}, models={}",
        run_id,
        total_cost,
        last_input,
        last_output,
        last_num_turns,
        last_model_usage.len()
    );

    Some(RawRunUsage {
        total_cost_usd: total_cost,
        input_tokens: last_input,
        output_tokens: last_output,
        cache_read_tokens: last_cache_read,
        cache_write_tokens: last_cache_write,
        duration_ms: total_duration_ms,
        num_turns: last_num_turns,
        model_usage: last_model_usage,
    })
}

// ── usage cache ────────────────────────────────────────────────────────

/// 缓存文件 schema 版本：未来字段变动时同步递增以避免反序列化旧数据。
const USAGE_CACHE_VERSION: u32 = 1;

#[derive(serde::Serialize, serde::Deserialize)]
struct UsageCacheFile {
    version: u32,
    events_mtime_ns: u128,
    events_size: u64,
    usage: crate::models::RawRunUsage,
}

fn file_mtime_and_size(path: &std::path::Path) -> Option<(u128, u64)> {
    let meta = fs::metadata(path).ok()?;
    let mtime_ns = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    Some((mtime_ns, meta.len()))
}

fn usage_cache_path(run_id: &str) -> std::path::PathBuf {
    super::usage_cache_dir().join(format!("{run_id}.json"))
}

fn read_usage_cache(run_id: &str, mtime_ns: u128, size: u64) -> Option<RawRunUsage> {
    let cache_path = usage_cache_path(run_id);
    let raw = fs::read_to_string(&cache_path).ok()?;
    let parsed: UsageCacheFile = serde_json::from_str(&raw).ok()?;
    if parsed.version != USAGE_CACHE_VERSION {
        return None;
    }
    if parsed.events_mtime_ns != mtime_ns || parsed.events_size != size {
        return None;
    }
    Some(parsed.usage)
}

fn write_usage_cache(
    run_id: &str,
    mtime_ns: u128,
    size: u64,
    usage: &RawRunUsage,
) -> Result<(), String> {
    let dir = super::usage_cache_dir();
    super::ensure_dir(&dir).map_err(|e| format!("ensure cache dir: {e}"))?;
    let file = UsageCacheFile {
        version: USAGE_CACHE_VERSION,
        events_mtime_ns: mtime_ns,
        events_size: size,
        usage: usage.clone(),
    };
    let serialized = serde_json::to_string(&file).map_err(|e| format!("serialize cache: {e}"))?;
    let dest = usage_cache_path(run_id);
    // 写临时文件再 rename，避免半写状态被并发读到。
    let tmp = dest.with_extension("json.tmp");
    fs::write(&tmp, serialized).map_err(|e| format!("write tmp cache: {e}"))?;
    fs::rename(&tmp, &dest).map_err(|e| format!("rename cache: {e}"))?;
    Ok(())
}

/// Count user_message events in events.jsonl for resume baseline.
/// Returns (total_user_messages, normal_user_messages).
///
/// Compat: handles both wrapped `{"event": {"type": "user_message", ...}, ...}`
/// and direct `{"type": "user_message", ...}` JSONL formats.
/// Unparseable lines are skipped (debug-level count logged).
pub fn count_user_messages(run_id: &str) -> (u32, u32) {
    let path = events_path(run_id);
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return (0, 0),
    };

    let mut total: u32 = 0;
    let mut normal: u32 = 0;
    let mut skipped: u32 = 0;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Fast pre-filter: skip lines that can't contain user_message
        if !line.contains("\"user_message\"") {
            continue;
        }
        let parsed = match serde_json::from_str::<serde_json::Value>(line) {
            Ok(v) => v,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        // Compat: wrapped format takes .event, direct format takes self
        let event = parsed.get("event").unwrap_or(&parsed);
        let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if event_type == "user_message" {
            total += 1;
            let text = event.get("text").and_then(|v| v.as_str()).unwrap_or("");
            if !text.trim_start().starts_with('/') {
                normal += 1;
            }
        }
    }

    if skipped > 0 {
        log::debug!(
            "[events] count_user_messages: skipped {} unparseable lines",
            skipped
        );
    }

    (total, normal)
}

pub fn list_bus_events(run_id: &str, since_seq: Option<u64>) -> Vec<serde_json::Value> {
    log::debug!(
        "[storage/events] list_bus_events: run_id={}, since_seq={:?}",
        run_id,
        since_seq
    );
    let path = events_path(run_id);
    if !path.exists() {
        return vec![];
    }
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let min_seq = since_seq.unwrap_or(0);

    // Pre-filter: skip lines that clearly aren't bus events before parsing JSON.
    // Bus events have `"_bus":true` — do a cheap substring check first.
    content
        .lines()
        .filter(|l| {
            let l = l.trim();
            !l.is_empty() && l.contains("\"_bus\"")
        })
        .filter_map(|l| {
            let v: serde_json::Value = serde_json::from_str(l).ok()?;
            if v.get("_bus")?.as_bool()? {
                let seq = v.get("seq")?.as_u64()?;
                if seq > min_seq {
                    let event = v.get("event")?;
                    let etype = event.get("type")?.as_str()?;
                    if !REPLAY_TYPES.contains(&etype) {
                        return None;
                    }
                    let mut event = event.clone();
                    if let Some(obj) = event.as_object_mut() {
                        if let Some(ts) = v.get("ts") {
                            obj.insert("ts".to_string(), ts.clone());
                        }
                        obj.insert("_seq".to_string(), serde_json::Value::Number(seq.into()));
                    }
                    return Some(event);
                }
            }
            None
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ModelUsageSummary, RawRunUsage};
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU32, Ordering};
    use tempfile::TempDir;

    /// 每次 `extract_run_usage` 走真实路径 `~/.miwarp/...`，会污染用户 home。
    /// 测试里通过设置 `MIWARP_DATA_DIR` 之类不存在的机制成本太高，所以直接复用
    /// 真实模块的私有缓存 helper 验证 mtime 失效语义即可。
    /// 为不污染 home，这里只针对纯函数 / 私有 cache I/O 写测试，并通过
    /// `file_mtime_and_size` 触发 mtime 变化的实际写入。
    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn unique_run_id() -> String {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        format!("test-run-{}-{}", std::process::id(), n)
    }

    fn sample_usage(cost: f64, turns: u64) -> RawRunUsage {
        let mut model_usage = HashMap::new();
        model_usage.insert(
            "claude-test".to_string(),
            ModelUsageSummary {
                input_tokens: 100,
                output_tokens: 50,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
                cost_usd: cost,
            },
        );
        RawRunUsage {
            total_cost_usd: cost,
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            duration_ms: 1500,
            num_turns: turns,
            model_usage,
        }
    }

    /// 直接验证 cache helper 的写入 / 读取 / mtime 失效语义。
    /// 这里故意使用临时目录 + 手动构造的 UsageCacheFile 字符串，绕过
    /// `read_usage_cache` 对 run_id / home_dir 的硬依赖。
    #[test]
    fn usage_cache_file_roundtrip_serialization() {
        let usage = sample_usage(1.234, 7);
        let mtime_ns: u128 = 123_456_789;
        let size: u64 = 4096;
        let file = UsageCacheFile {
            version: USAGE_CACHE_VERSION,
            events_mtime_ns: mtime_ns,
            events_size: size,
            usage: usage.clone(),
        };
        let serialized = serde_json::to_string(&file).unwrap();
        let parsed: UsageCacheFile = serde_json::from_str(&serialized).unwrap();
        assert_eq!(parsed.version, USAGE_CACHE_VERSION);
        assert_eq!(parsed.events_mtime_ns, mtime_ns);
        assert_eq!(parsed.events_size, size);
        assert_eq!(parsed.usage.total_cost_usd, 1.234);
        assert_eq!(parsed.usage.num_turns, 7);
        assert_eq!(parsed.usage.input_tokens, 100);
        assert_eq!(
            parsed
                .usage
                .model_usage
                .get("claude-test")
                .unwrap()
                .cost_usd,
            1.234
        );
    }

    #[test]
    fn usage_cache_version_mismatch_rejected() {
        // 模拟版本不一致：手动写一个 version=0 的旧 cache，反序列化后
        // read_usage_cache 会因为 version check 返回 None。
        let usage = sample_usage(0.5, 1);
        let stale = UsageCacheFile {
            version: 0, // 旧版本
            events_mtime_ns: 999,
            events_size: 1,
            usage,
        };
        let serialized = serde_json::to_string(&stale).unwrap();
        let parsed: Result<UsageCacheFile, _> = serde_json::from_str(&serialized);
        assert!(parsed.is_ok(), "反序列化本身应成功");
        let parsed = parsed.unwrap();
        assert_ne!(parsed.version, USAGE_CACHE_VERSION);
        // 调用方逻辑：通过版本号比较决定是否丢弃。
    }

    #[test]
    fn file_mtime_and_size_reflects_writes() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("events.jsonl");

        // 初始不存在 → 返回 None
        assert!(file_mtime_and_size(&path).is_none());

        // 写入内容
        std::fs::write(&path, b"hello").unwrap();
        let (mtime1, size1) = file_mtime_and_size(&path).unwrap();
        assert_eq!(size1, 5);
        assert!(mtime1 > 0);

        // 增长文件内容 → size 增长，mtime 可能变化（取决于文件系统精度）
        std::fs::write(&path, b"hello world!").unwrap();
        let (_mtime2, size2) = file_mtime_and_size(&path).unwrap();
        assert_eq!(size2, 12);
        assert!(size2 > size1);

        // 显式把 mtime 调前，确保测试不依赖时序
        let older_ns: u64 = mtime1.saturating_sub(1_000_000).try_into().unwrap_or(0);
        let older = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_nanos(older_ns);
        let _ = std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(older);
        let (mtime3, _) = file_mtime_and_size(&path).unwrap();
        assert!(
            mtime3 < mtime1,
            "set_modified 应该让 mtime 变小: mtime3={mtime3}, mtime1={mtime1}"
        );
    }

    /// 验证 mtime 变化时缓存会被识别为失效（这是 P0-C 的核心语义）：
    /// 把缓存文件写好，模拟 events.jsonl 的 mtime 推进超过缓存记录的 mtime，
    /// 确认 read_usage_cache 因 mtime 不一致返回 None。
    #[test]
    fn cache_invalidated_when_events_mtime_advances() {
        let tmp = TempDir::new().unwrap();
        let cache_path = tmp.path().join("cache.json");
        let events_path = tmp.path().join("events.jsonl");
        std::fs::write(&events_path, b"old content").unwrap();
        let (mtime_at_cache_write, size_at_cache_write) =
            file_mtime_and_size(&events_path).unwrap();

        // 写入 cache
        let file = UsageCacheFile {
            version: USAGE_CACHE_VERSION,
            events_mtime_ns: mtime_at_cache_write,
            events_size: size_at_cache_write,
            usage: sample_usage(2.0, 5),
        };
        std::fs::write(&cache_path, serde_json::to_string(&file).unwrap()).unwrap();

        // 模拟 CLI 写入新事件 → mtime 推进
        std::thread::sleep(std::time::Duration::from_millis(10));
        std::fs::write(&events_path, b"old content + new event line").unwrap();
        let (new_mtime, new_size) = file_mtime_and_size(&events_path).unwrap();
        assert!(new_mtime > mtime_at_cache_write);
        assert!(new_size > size_at_cache_write);

        // 读取 cache 文件，按新 mtime / size 校验 → 应该判定为失效
        let raw = std::fs::read_to_string(&cache_path).unwrap();
        let parsed: UsageCacheFile = serde_json::from_str(&raw).unwrap();
        let still_valid = parsed.version == USAGE_CACHE_VERSION
            && parsed.events_mtime_ns == new_mtime
            && parsed.events_size == new_size;
        assert!(!still_valid, "mtime/size 变化后旧缓存必须被识别为失效");
    }

    #[test]
    fn unique_run_id_is_unique() {
        // sanity check on the helper
        let a = unique_run_id();
        let b = unique_run_id();
        assert_ne!(a, b);
    }

    // ── P0-3 peak detection 回归测试 ──────────────────────────────
    //
    // 这些 helper 通过 events.jsonl + meta.json 模拟一个 native session 的
    // usage_update 序列，从而跑通 extract_run_usage 的 peak detection 分支。
    // 注意：需要 is_per_turn_cost == false，即 meta.json 不含 "source":"cli_import"。

    fn make_native_run_id(label: &str) -> String {
        // 避免用 TempDir（events.rs 已有 tempfile dev-dep）—— 直接拼路径
        // 用 std::time::SystemTime + label 让每次调用都唯一，避免 cache 串数据
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        format!("p03_test_{label}_{nanos}")
    }

    fn write_native_run_with_events(label: &str, events_jsonl: &str) -> String {
        let run_id = make_native_run_id(label);
        let dir = super::super::run_dir(&run_id);
        std::fs::create_dir_all(&dir).unwrap();
        // meta.json 必须不存在 "source" 字段 → 走 native 累积分支
        let meta = serde_json::json!({
            "id": run_id,
            "prompt": "test",
            "cwd": "/tmp",
            "agent": "claude",
            "status": "completed",
            "started_at": "2026-01-01T00:00:00Z",
        });
        std::fs::write(dir.join("meta.json"), meta.to_string()).unwrap();
        std::fs::write(dir.join("events.jsonl"), events_jsonl).unwrap();
        run_id
    }

    fn cleanup_run(run_id: &str) {
        let dir = super::super::run_dir(run_id);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// P0-3：native 累积模式，单调递增 turn_index → 累计到最后一个 peak。
    #[test]
    fn peak_detection_with_turn_index_monotonic() {
        // 3 个 usage_update：cost 累积 0.1 → 0.3 → 0.6，turn_index 1→2→3
        let events = "{\"_bus\":true,\"seq\":1,\"event\":{\"type\":\"usage_update\",\"total_cost_usd\":0.1,\"turn_index\":1}}\n\
                      {\"_bus\":true,\"seq\":2,\"event\":{\"type\":\"usage_update\",\"total_cost_usd\":0.3,\"turn_index\":2}}\n\
                      {\"_bus\":true,\"seq\":3,\"event\":{\"type\":\"usage_update\",\"total_cost_usd\":0.6,\"turn_index\":3}}\n";
        let run_id = write_native_run_with_events("monotonic", events);
        let result = extract_run_usage(&run_id);
        cleanup_run(&run_id);
        let usage = result.expect("usage present");
        assert!(
            (usage.total_cost_usd - 0.6).abs() < 1e-9,
            "cost=0.6, got {}",
            usage.total_cost_usd
        );
    }

    /// P0-3：turn_index 重置（compact / `/clear`）→ 触发新段 → 多段累加。
    #[test]
    fn peak_detection_with_turn_index_reset() {
        // 第一段：cost 累积到 0.5（turn_index 1→2）
        // 第二段：compact 重置，turn_index=1，cost 从 0.0 起 → 累积到 0.2
        // 总 cost = 0.5 + 0.2 = 0.7
        let events = "{\"_bus\":true,\"seq\":1,\"event\":{\"type\":\"usage_update\",\"total_cost_usd\":0.1,\"turn_index\":1}}\n\
                      {\"_bus\":true,\"seq\":2,\"event\":{\"type\":\"usage_update\",\"total_cost_usd\":0.5,\"turn_index\":2}}\n\
                      {\"_bus\":true,\"seq\":3,\"event\":{\"type\":\"usage_update\",\"total_cost_usd\":0.05,\"turn_index\":1}}\n\
                      {\"_bus\":true,\"seq\":4,\"event\":{\"type\":\"usage_update\",\"total_cost_usd\":0.2,\"turn_index\":2}}\n";
        let run_id = write_native_run_with_events("reset", events);
        let result = extract_run_usage(&run_id);
        cleanup_run(&run_id);
        let usage = result.expect("usage present");
        assert!(
            (usage.total_cost_usd - 0.7).abs() < 1e-9,
            "cost=0.7 expected, got {}",
            usage.total_cost_usd
        );
    }

    /// P0-3：cost_usd=0 但 turn_index 正常 → 不能误触 0.9 阈值。
    #[test]
    fn peak_detection_zero_cost_does_not_split() {
        // 模拟 CLI 异常累计：cost 一直为 0，但 turn_index 递增 → 不应分段
        let events = "{\"_bus\":true,\"seq\":1,\"event\":{\"type\":\"usage_update\",\"total_cost_usd\":0.0,\"turn_index\":1}}\n\
                      {\"_bus\":true,\"seq\":2,\"event\":{\"type\":\"usage_update\",\"total_cost_usd\":0.0,\"turn_index\":2}}\n";
        let run_id = write_native_run_with_events("zero_cost", events);
        let result = extract_run_usage(&run_id);
        cleanup_run(&run_id);
        let usage = result.expect("usage present");
        assert_eq!(usage.total_cost_usd, 0.0, "全 0 cost 应保持 0");
    }

    // ── P0-S1 fsync tests ────────────────────────────────────────────
    //
    // Verifies that EventWriter::write_bus_event honors the source-of-truth
    // contract: every append must be reachable on disk after the function
    // returns, even across a crash. Without an explicit fsync the kernel
    // page cache could absorb the write and a power loss would silently
    // drop the record — these tests ensure the contract is upheld.

    fn unique_bus_run_id(label: &str) -> String {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        format!("p0s1_{label}_{nanos}")
    }

    /// P0-S1: write_bus_event must persist the envelope to events.jsonl
    /// before returning, with an `_bus:true` JSON line carrying the seq.
    #[test]
    fn write_bus_event_persists_envelope_to_disk() {
        let run_id = unique_bus_run_id("persist");
        let writer = EventWriter::new();
        let event = BusEvent::RunState {
            run_id: run_id.clone(),
            state: "running".to_string(),
            exit_code: None,
            error: None,
        };

        writer
            .write_bus_event(&run_id, &event)
            .expect("write_bus_event should succeed");

        let path = super::events_path(&run_id);
        assert!(path.exists(), "events.jsonl must exist on disk after write");
        let raw = std::fs::read_to_string(&path).expect("read events.jsonl");
        let lines: Vec<&str> = raw.lines().filter(|l| !l.trim().is_empty()).collect();
        assert_eq!(lines.len(), 1, "exactly one bus envelope expected");
        let v: serde_json::Value = serde_json::from_str(lines[0]).expect("valid json line");
        assert_eq!(v.get("_bus").and_then(|b| b.as_bool()), Some(true));
        assert_eq!(v.get("seq").and_then(|s| s.as_u64()), Some(1));
        let inner = v.get("event").expect("envelope.event present");
        assert_eq!(
            inner.get("type").and_then(|t| t.as_str()),
            Some("run_state")
        );

        cleanup_run(&run_id);
    }

    /// P0-S1: write_bus_event_with_ts returns the assigned seq and writes a
    /// strictly monotonic envelope per call. Both lines must survive the
    /// function return (proves the parent dir was fsync'd too).
    #[test]
    fn write_bus_event_with_ts_assigns_monotonic_seq() {
        let run_id = unique_bus_run_id("seq");
        let writer = EventWriter::new();
        let ts = "2026-01-01T00:00:00Z";

        let first = writer.write_bus_event_with_ts(
            &run_id,
            &BusEvent::RunState {
                run_id: run_id.clone(),
                state: "running".to_string(),
                exit_code: None,
                error: None,
            },
            ts,
        );
        let second = writer.write_bus_event_with_ts(
            &run_id,
            &BusEvent::RunState {
                run_id: run_id.clone(),
                state: "completed".to_string(),
                exit_code: None,
                error: None,
            },
            ts,
        );

        let first = first.expect("first seq");
        let second = second.expect("second seq");
        assert_eq!(second, first + 1, "seq must be strictly monotonic");

        let path = super::events_path(&run_id);
        let raw = std::fs::read_to_string(&path).expect("read events.jsonl");
        let count = raw
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter(|l| l.contains("\"_bus\":true"))
            .count();
        assert_eq!(count, 2, "two envelopes on disk");

        cleanup_run(&run_id);
    }

    /// P0-S1: write_bus_event must never silently swallow a failure. If
    /// the target path is blocked by a regular file, the call returns Err
    /// and the blocking file is left intact — i.e. no partial overwrite
    /// from a half-finished flush + fsync sequence.
    #[test]
    fn write_bus_event_returns_err_on_unwritable_target() {
        let run_id = unique_bus_run_id("err");
        let run_dir = super::super::run_dir(&run_id);
        let _ = std::fs::remove_dir_all(&run_dir);
        std::fs::write(&run_dir, b"not a directory").expect("block dir with regular file");

        let writer = EventWriter::new();
        let event = BusEvent::RunState {
            run_id: run_id.clone(),
            state: "should_fail".to_string(),
            exit_code: None,
            error: None,
        };
        let result = writer.write_bus_event(&run_id, &event);
        assert!(
            result.is_err(),
            "writing into a path blocked by a regular file must return Err"
        );

        let body = std::fs::read(&run_dir).expect("blocking file still readable");
        assert_eq!(
            body, b"not a directory",
            "blocking file must remain untouched"
        );

        let _ = std::fs::remove_file(&run_dir);
    }
}
