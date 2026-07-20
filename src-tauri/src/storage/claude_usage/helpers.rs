use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

use super::usage::clear_memory_cache;

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

/// Extract date ("YYYY-MM-DD") from a JSONL line by finding the "timestamp" field.
/// RFC 3339 timestamps are normalized to UTC before extracting the date.
pub(crate) fn extract_date_fast(line: &str) -> Option<String> {
    let marker = "\"timestamp\":\"";
    let idx = line.find(marker)?;
    let start = idx + marker.len();
    if start > line.len() {
        return None;
    }
    let rest = &line[start..];
    let end = rest.find('"')?;
    let ts = &rest[..end];

    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
        return Some(dt.with_timezone(&chrono::Utc).date_naive().to_string());
    }
    if ts.len() >= 19 {
        let date_part = &ts[..10];
        if date_part.as_bytes()[4] == b'-' && date_part.as_bytes()[7] == b'-' {
            return Some(date_part.to_string());
        }
    }
    None
}

pub(super) fn read_activity_data(claude_dir: &Path) -> (HashMap<String, (u32, u32, u32)>, u32) {
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

    let activity = cache
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

/// Compute (active_days, current_streak, longest_streak) from daily aggregates.
pub(crate) fn compute_streaks(
    daily: &[crate::models::DailyAggregate],
    anchor: chrono::NaiveDate,
) -> (u32, u32, u32) {
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

    let mut current_streak = 0u32;
    let mut day = anchor;
    loop {
        if active_dates.contains(&day) {
            current_streak += 1;
            day -= chrono::Duration::days(1);
        } else if day == anchor {
            day -= chrono::Duration::days(1);
            continue;
        } else {
            break;
        }
    }

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
    clear_memory_cache();

    let path = super::super::data_dir().join("usage-scan-cache.json");
    if path.exists() {
        if let Err(e) = std::fs::remove_file(&path) {
            log::error!("[claude_usage] failed to remove disk cache: {e}");
        } else {
            log::debug!("[claude_usage] disk cache deleted: {:?}", path);
        }
    }
}
