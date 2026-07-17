//! Read Claude Code global usage by scanning session JSONL files.
//!
//! Scans `~/.claude/projects/*/*.jsonl` for per-turn token usage,
//! aggregates by date and model, computes cost via `pricing` module.
//! Activity metrics (messages, sessions, tool calls) come from
//! `~/.claude/stats-cache.json` which tracks those separately.
//!
//! Results are cached in memory (120s TTL) and on disk
//! (`~/.miwarp/usage-scan-cache.json`) to avoid rescanning
//! unchanged files across restarts.

use crate::models::{DailyAggregate, ModelAggregate, UsageOverview};
use crate::pricing;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Instant, UNIX_EPOCH};

// ── In-memory cache ──

static CACHE: std::sync::LazyLock<Mutex<Option<CachedData>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));

/// Separate mutex to prevent concurrent recomputation of the scan.
static COMPUTE_LOCK: std::sync::LazyLock<Mutex<()>> = std::sync::LazyLock::new(|| Mutex::new(()));

const CACHE_TTL_SECS: u64 = 120;

struct CachedData {
    computed_at: Instant,
    /// date → model → TokenCounts (from JSONL scan)
    daily_model: DailyModelMap,
    /// date → (messages, sessions, tool_calls) (from stats-cache.json)
    daily_activity: HashMap<String, (u32, u32, u32)>,
    /// date → (messages, sessions) derived from JSONL scan (fallback)
    scan_activity: ScanActivityMap,
    // P1-1 之后 `build_overview` 不再回退到全局 total_sessions，但字段先保留
    // 避免破坏 stats-cache 兼容层。后续真要下线再删。
    #[allow(dead_code)]
    total_sessions: u32,
}

#[derive(Default, Clone, Serialize, Deserialize)]
struct TokenCounts {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_create: u64,
}

// ── Disk cache types ──

const DISK_CACHE_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
struct DiskCache {
    version: u32,
    /// file path → (mtime_ns, size_bytes)
    manifest: HashMap<String, (u128, u64)>,
    /// file path → per-file aggregated data
    per_file: HashMap<String, FileData>,
}

#[derive(Serialize, Deserialize, Clone)]
struct FileData {
    /// date → model → TokenCounts
    daily_tokens: HashMap<String, HashMap<String, TokenCounts>>,
    /// date → message count
    daily_messages: HashMap<String, u32>,
}

// ── JSONL line schema (partial — unknown fields are skipped by serde) ──

#[derive(Deserialize)]
struct SessionLine {
    #[serde(default)]
    timestamp: String,
    #[serde(default)]
    message: Option<LineMessage>,
}

#[derive(Deserialize)]
struct LineMessage {
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    usage: Option<LineUsage>,
}

#[derive(Deserialize)]
struct LineUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
}

// ── stats-cache.json (activity data only) ──

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StatsCache {
    #[serde(default)]
    total_sessions: u32,
    #[serde(default)]
    daily_activity: Vec<DailyActivityEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DailyActivityEntry {
    date: String,
    #[serde(default)]
    message_count: u32,
    #[serde(default)]
    session_count: u32,
    #[serde(default)]
    tool_call_count: u32,
}

// ── Public API ──


pub(crate) fn extract_date_fast(line: &str) -> Option<String> {
    let marker = "\"timestamp\":\"";
    let idx = line.find(marker)?;
    let start = idx + marker.len();
    if start > line.len() {
        return None;
    }
    // 找 timestamp 字符串结尾的 '"'
    let rest = &line[start..];
    let end = rest.find('"')?;
    let ts = &rest[..end];

    // 1) 优先：完整 RFC 3339 解析（含时区）→ 统一转 UTC 取日期
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
        return Some(dt.with_timezone(&chrono::Utc).date_naive().to_string());
    }
    // 2) 兼容："2026-02-13T23:30:00"（无时区）→ 当作 UTC，避免与本地时区混淆
    if ts.len() >= 19 {
        let date_part = &ts[..10];
        if date_part.as_bytes()[4] == b'-' && date_part.as_bytes()[7] == b'-' {
            return Some(date_part.to_string());
        }
    }
    None
}

// ── Activity data from stats-cache.json ──

fn read_activity_data(claude_dir: &Path) -> (HashMap<String, (u32, u32, u32)>, u32) {
    let path = claude_dir.join("stats-cache.json");
    if !path.exists() {
        return (HashMap::new(), 0);
    }

    let raw = match std::fs::read_to_string(&path) {
        Ok(r) => r,
        Err(e) => {
            log::error!("[claude_usage] failed to read stats-cache.json: {e}");
            return (HashMap::new(), 0);
        }
    };

    let cache: StatsCache = match serde_json::from_str(&raw) {
        Ok(c) => c,
        Err(e) => {
            log::error!("[claude_usage] failed to parse stats-cache.json: {e}");
            return (HashMap::new(), 0);
        }
    };

    let activity: HashMap<String, (u32, u32, u32)> = cache
        .daily_activity
        .into_iter()
        .map(|a| {
            (
                a.date,
                (a.message_count, a.session_count, a.tool_call_count),
            )
        })
        .collect();

    (activity, cache.total_sessions)
}

// ── Cache clearing ──

/// Compute (active_days, current_streak, longest_streak) from daily aggregates.
/// A day is active if input_tokens + output_tokens > 0 || message_count > 0 || runs > 0.
/// `anchor` is the reference "today" date (UTC).
pub(crate) fn compute_streaks(
    daily: &[crate::models::DailyAggregate],
    anchor: chrono::NaiveDate,
) -> (u32, u32, u32) {
    // Collect active dates into a HashSet
    let active_dates: std::collections::HashSet<chrono::NaiveDate> = daily
        .iter()
        .filter(|d| {
            d.input_tokens + d.output_tokens > 0 || d.message_count.unwrap_or(0) > 0 || d.runs > 0
        })
        .filter_map(|d| chrono::NaiveDate::parse_from_str(&d.date, "%Y-%m-%d").ok())
        .collect();

    let active_days = active_dates.len() as u32;
    if active_days == 0 {
        return (0, 0, 0);
    }

    // Current streak: count backward from anchor
    let mut current_streak = 0u32;
    let mut day = anchor;
    loop {
        if active_dates.contains(&day) {
            current_streak += 1;
            day -= chrono::Duration::days(1);
        } else if day == anchor {
            // Today not active, try yesterday
            day -= chrono::Duration::days(1);
            continue;
        } else {
            break;
        }
    }

    // Longest streak: sort dates, scan for consecutive runs
    let mut sorted: Vec<chrono::NaiveDate> = active_dates.into_iter().collect();
    sorted.sort();
    let mut longest_streak = 0u32;
    let mut streak = 0u32;
    let mut prev: Option<chrono::NaiveDate> = None;
    for d in &sorted {
        if let Some(p) = prev {
            if *d == p + chrono::Duration::days(1) {
                streak += 1;
            } else {
                longest_streak = longest_streak.max(streak);
                streak = 1;
            }
        } else {
            streak = 1;
        }
        prev = Some(*d);
    }
    longest_streak = longest_streak.max(streak);

    (active_days, current_streak, longest_streak)
}

/// Clear both in-memory and disk caches, forcing a full rescan on next request.
pub fn clear_cache() {
    // Clear in-memory cache
    if let Ok(mut lock) = CACHE.lock() {
        *lock = None;
        log::debug!("[claude_usage] in-memory cache cleared");
    }

    // Delete disk cache file
    let path = super::data_dir().join("usage-scan-cache.json");
    if path.exists() {
        if let Err(e) = std::fs::remove_file(&path) {
            log::error!("[claude_usage] failed to remove disk cache: {e}");
        } else {
            log::debug!("[claude_usage] disk cache deleted: {:?}", path);
        }
    }
}

#[cfg(test)]
