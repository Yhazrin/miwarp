use crate::models::{BusEvent, ModelUsageSummary, RawRunUsage};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};

use super::core::{events_path, REPLAY_TYPES};
use super::writer::EventWriter;

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
    let dst_dir = super::super::run_dir(to_run_id);
    super::super::ensure_dir(&dst_dir).map_err(|e| format!("ensure_dir failed: {}", e))?;
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
        let meta_path = super::super::run_dir(run_id).join("meta.json");
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
pub(super) const USAGE_CACHE_VERSION: u32 = 1;

#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct UsageCacheFile {
    pub(super) version: u32,
    pub(super) events_mtime_ns: u128,
    pub(super) events_size: u64,
    pub(super) usage: crate::models::RawRunUsage,
}

pub(super) fn file_mtime_and_size(path: &std::path::Path) -> Option<(u128, u64)> {
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
    super::super::usage_cache_dir().join(format!("{run_id}.json"))
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
    let dir = super::super::usage_cache_dir();
    super::super::ensure_dir(&dir).map_err(|e| format!("ensure cache dir: {e}"))?;
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
    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return vec![],
    };

    let min_seq = since_seq.unwrap_or(0);
    let reader = BufReader::with_capacity(64 * 1024, file);
    let mut result = Vec::new();

    // Stream line-by-line: BufReader reads in 64KB chunks, so RSS stays bounded
    // regardless of file size. Pre-filter with substring check before parsing JSON.
    for line_result in reader.lines() {
        let line = match line_result {
            Ok(l) => l,
            Err(_) => continue,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() || !trimmed.contains("\"_bus\"") {
            continue;
        }
        let Some(v) = serde_json::from_str::<serde_json::Value>(trimmed).ok() else {
            continue;
        };
        let Some(true) = v.get("_bus").and_then(|b| b.as_bool()) else {
            continue;
        };
        let Some(seq) = v.get("seq").and_then(|s| s.as_u64()) else {
            continue;
        };
        if seq <= min_seq {
            continue;
        }
        let Some(event) = v.get("event") else {
            continue;
        };
        let Some(etype) = event.get("type").and_then(|t| t.as_str()) else {
            continue;
        };
        if !REPLAY_TYPES.contains(&etype) {
            continue;
        }
        let mut event = event.clone();
        if let Some(obj) = event.as_object_mut() {
            if let Some(ts) = v.get("ts") {
                obj.insert("ts".to_string(), ts.clone());
            }
            obj.insert("_seq".to_string(), serde_json::Value::Number(seq.into()));
        }
        result.push(event);
    }

    result
}
