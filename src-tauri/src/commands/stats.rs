use crate::models::{DailyAggregate, ModelAggregate, RunUsageSummary, UsageOverview};
use crate::storage;
use crate::storage::changelog::ChangelogEntry;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// P1-3：app-scope 用量数据无内置缓存，每次请求都要扫描 events.jsonl。
/// 这里加一个简单的内存 TTL 缓存（key = scope, days, project_id），
/// 命中 5 分钟内的请求直接复用，避免列表页反复刷新时反复做磁盘 IO。
const APP_OVERVIEW_CACHE_TTL: Duration = Duration::from_secs(300);
const APP_OVERVIEW_CACHE_MAX_ENTRIES: usize = 32;

/// 用 `OnceLock<Mutex<...>>` 让进程里只有一份缓存表，避免污染全局状态。
fn app_overview_cache() -> &'static Mutex<HashMap<AppOverviewCacheKey, AppOverviewCacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<AppOverviewCacheKey, AppOverviewCacheEntry>>> =
        OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
struct AppOverviewCacheKey {
    scope: String,
    days: Option<u32>,
    project_id: Option<String>,
    /// P1-6：缓存 key 必须包含时区，否则同一份数据按 user TZ 与 UTC 各算一遍
    /// 时会拿到不同结果，但缓存命中的还是上一份 → 串数据。
    tz: Option<String>,
}

#[derive(Clone)]
struct AppOverviewCacheEntry {
    inserted_at: Instant,
    value: UsageOverview,
}

/// 按 (scope, days, project_id) 读 / 写缓存，过期或超容量都视为 miss。
fn cache_get(key: &AppOverviewCacheKey) -> Option<UsageOverview> {
    let cache = app_overview_cache().lock().ok()?;
    let entry = cache.get(key)?;
    if entry.inserted_at.elapsed() > APP_OVERVIEW_CACHE_TTL {
        return None;
    }
    Some(entry.value.clone())
}

fn cache_put(key: AppOverviewCacheKey, value: UsageOverview) {
    if let Ok(mut cache) = app_overview_cache().lock() {
        // 满了就按插入顺序淘汰最旧的，避免无限增长。
        if cache.len() >= APP_OVERVIEW_CACHE_MAX_ENTRIES {
            if let Some(oldest_key) = cache
                .iter()
                .min_by_key(|(_, e)| e.inserted_at)
                .map(|(k, _)| k.clone())
            {
                cache.remove(&oldest_key);
            }
        }
        cache.insert(
            key,
            AppOverviewCacheEntry {
                inserted_at: Instant::now(),
                value,
            },
        );
    }
}

/// Parse a started_at timestamp to a UTC NaiveDate.
/// Handles RFC 3339 with timezone, or legacy "YYYY-MM-DD" (no time).
fn parse_started_date_utc(started_at: &str) -> Option<chrono::NaiveDate> {
    chrono::DateTime::parse_from_rfc3339(started_at)
        .ok()
        .map(|dt| dt.with_timezone(&chrono::Utc).date_naive())
        .or_else(|| {
            started_at
                .get(..10)
                .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        })
}

#[tauri::command]
pub fn get_global_usage_overview(days: Option<u32>) -> Result<UsageOverview, String> {
    log::debug!("[stats] get_global_usage_overview: days={:?}", days);
    storage::claude_usage::read_global_usage(days)
}

/// Per-model aggregate builder (internal, not serialized).
#[derive(Default)]
struct ModelAggBuilder {
    runs: u32,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    cost_usd: f64,
}

/// Daily aggregate builder (internal, not serialized).
#[derive(Default)]
struct DailyBuilder {
    cost_usd: f64,
    runs: u32,
    input_tokens: u64,
    output_tokens: u64,
    /// P0-2：按 model 聚合的 token 桶，最后 30 天的 day 会填充 model_breakdown。
    /// model → (input, output, cache_read, cache_write)
    model_tokens: HashMap<String, (u64, u64, u64, u64)>,
}

/// 同步的纯计算逻辑：扫描所有 run + 读 events.jsonl + 聚合。设计为可被
/// `spawn_blocking` 调用以避免阻塞 Tauri 主线程 / webview 主线程。
fn compute_usage_overview(days: Option<u32>) -> Result<UsageOverview, String> {
    let metas = storage::runs::list_all_run_metas();
    let cutoff_date = days.map(|d| {
        chrono::Utc::now().date_naive() - chrono::Duration::days(d.saturating_sub(1) as i64)
    });

    let mut run_summaries: Vec<RunUsageSummary> = Vec::new();
    let mut total_cost = 0.0f64;
    let mut total_tokens = 0u64;
    let mut model_map: HashMap<String, ModelAggBuilder> = HashMap::new();
    let mut daily_map: BTreeMap<String, DailyBuilder> = BTreeMap::new();

    for meta in &metas {
        let Some(started_date) = parse_started_date_utc(&meta.started_at) else {
            log::debug!(
                "[stats] skip run {}: bad started_at {:?}",
                meta.id,
                meta.started_at
            );
            continue;
        };

        if let Some(cutoff) = cutoff_date {
            if started_date < cutoff {
                continue;
            }
        }

        // Extract usage from events.jsonl
        let usage = storage::events::extract_run_usage(&meta.id);

        let cost = usage.as_ref().map(|u| u.total_cost_usd).unwrap_or(0.0);
        // total_tokens = input + output (billable tokens only, not cache)
        let tokens = usage
            .as_ref()
            .map(|u| u.input_tokens + u.output_tokens)
            .unwrap_or(0);

        total_cost += cost;
        total_tokens += tokens;

        // Build per-model aggregates
        if let Some(ref u) = usage {
            for (model, mu) in &u.model_usage {
                let agg = model_map.entry(model.clone()).or_default();
                agg.runs += 1;
                agg.input_tokens += mu.input_tokens;
                agg.output_tokens += mu.output_tokens;
                agg.cache_read_tokens += mu.cache_read_tokens;
                agg.cache_write_tokens += mu.cache_write_tokens;
                agg.cost_usd += mu.cost_usd;
            }
        }

        // Build daily aggregates
        let date = started_date.format("%Y-%m-%d").to_string();
        let day = daily_map.entry(date).or_default();
        day.cost_usd += cost;
        day.runs += 1;
        day.input_tokens += usage.as_ref().map(|u| u.input_tokens).unwrap_or(0);
        day.output_tokens += usage.as_ref().map(|u| u.output_tokens).unwrap_or(0);

        // P0-2：把 per-run model_usage 摊到 day.model_tokens。
        if let Some(ref u) = usage {
            for (model, mu) in &u.model_usage {
                let entry = day.model_tokens.entry(model.clone()).or_default();
                entry.0 += mu.input_tokens;
                entry.1 += mu.output_tokens;
                entry.2 += mu.cache_read_tokens;
                entry.3 += mu.cache_write_tokens;
            }
        }

        // Build run summary (merge RunMeta + RawRunUsage)
        let name = meta.name.clone().unwrap_or_else(|| {
            if meta.prompt.chars().count() > 80 {
                meta.prompt.chars().take(80).collect::<String>() + "..."
            } else {
                meta.prompt.clone()
            }
        });

        run_summaries.push(RunUsageSummary {
            run_id: meta.id.clone(),
            name,
            agent: meta.agent.clone(),
            model: meta.model.clone(),
            status: meta.status.clone(),
            started_at: meta.started_at.clone(),
            ended_at: meta.ended_at.clone(),
            total_cost_usd: cost,
            input_tokens: usage.as_ref().map(|u| u.input_tokens).unwrap_or(0),
            output_tokens: usage.as_ref().map(|u| u.output_tokens).unwrap_or(0),
            cache_read_tokens: usage.as_ref().map(|u| u.cache_read_tokens).unwrap_or(0),
            cache_write_tokens: usage.as_ref().map(|u| u.cache_write_tokens).unwrap_or(0),
            duration_ms: usage.as_ref().map(|u| u.duration_ms).unwrap_or(0),
            num_turns: usage.as_ref().map(|u| u.num_turns).unwrap_or(0),
            model_usage: usage
                .as_ref()
                .map(|u| u.model_usage.clone())
                .unwrap_or_default(),
        });
    }

    // Sort runs by date descending
    run_summaries.sort_by(|a, b| b.started_at.cmp(&a.started_at));

    let total_runs = run_summaries.len() as u32;
    let avg_cost = if total_runs > 0 {
        total_cost / total_runs as f64
    } else {
        0.0
    };

    // Build per-model aggregates with percentages, sorted by cost descending
    let mut by_model: Vec<ModelAggregate> = model_map
        .into_iter()
        .map(|(model, agg)| {
            let pct = if total_cost > 0.0 {
                agg.cost_usd / total_cost * 100.0
            } else {
                0.0
            };
            ModelAggregate {
                model,
                runs: agg.runs,
                input_tokens: agg.input_tokens,
                output_tokens: agg.output_tokens,
                cache_read_tokens: agg.cache_read_tokens,
                cache_write_tokens: agg.cache_write_tokens,
                cost_usd: agg.cost_usd,
                pct,
            }
        })
        .collect();
    by_model.sort_by(|a, b| {
        b.cost_usd
            .partial_cmp(&a.cost_usd)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Build daily aggregates (BTreeMap → sorted by date ascending)
    let daily_entries: Vec<(String, DailyBuilder)> = daily_map.into_iter().collect();
    let breakdown_start = daily_entries.len().saturating_sub(30);
    let daily: Vec<DailyAggregate> = daily_entries
        .into_iter()
        .enumerate()
        .map(|(idx, (date, d))| {
            let model_breakdown = if idx >= breakdown_start && !d.model_tokens.is_empty() {
                Some(
                    d.model_tokens
                        .into_iter()
                        .map(|(model, (i, o, cr, cw))| {
                            (
                                model,
                                crate::models::ModelTokens {
                                    input_tokens: i,
                                    output_tokens: o,
                                    cache_read_tokens: cr,
                                    cache_write_tokens: cw,
                                },
                            )
                        })
                        .collect(),
                )
            } else {
                None
            };
            DailyAggregate {
                date,
                cost_usd: d.cost_usd,
                runs: d.runs,
                input_tokens: d.input_tokens,
                output_tokens: d.output_tokens,
                message_count: None,
                session_count: None,
                tool_call_count: None,
                model_breakdown,
            }
        })
        .collect();

    log::debug!(
        "[stats] get_usage_overview: {} runs, ${:.4} total, {} models, {} days",
        total_runs,
        total_cost,
        by_model.len(),
        daily.len()
    );

    let (active_days, current_streak, longest_streak) =
        compute_streaks(&daily, chrono::Utc::now().date_naive());

    Ok(UsageOverview {
        total_cost_usd: total_cost,
        total_tokens,
        total_runs,
        avg_cost_per_run: avg_cost,
        by_model,
        daily,
        runs: run_summaries,
        scan_mode: None,
        active_days,
        current_streak,
        longest_streak,
    })
}

/// Compute usage streaks for the command-owned aggregate.
///
/// This preserves the pre-split `claude_usage::compute_streaks` behavior while
/// keeping `storage::claude_usage::helpers` private to its module boundary.
fn compute_streaks(daily: &[DailyAggregate], anchor: chrono::NaiveDate) -> (u32, u32, u32) {
    let active_dates: std::collections::HashSet<chrono::NaiveDate> = daily
        .iter()
        .filter(|day| {
            day.input_tokens + day.output_tokens > 0
                || day.message_count.unwrap_or(0) > 0
                || day.runs > 0
        })
        .filter_map(|day| chrono::NaiveDate::parse_from_str(&day.date, "%Y-%m-%d").ok())
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
        } else {
            break;
        }
    }

    let mut sorted: Vec<chrono::NaiveDate> = active_dates.into_iter().collect();
    sorted.sort();
    let mut longest_streak = 0u32;
    let mut streak = 0u32;
    let mut previous: Option<chrono::NaiveDate> = None;
    for day in sorted {
        if previous.is_some_and(|previous| day == previous + chrono::Duration::days(1)) {
            streak += 1;
        } else {
            longest_streak = longest_streak.max(streak);
            streak = 1;
        }
        previous = Some(day);
    }
    longest_streak = longest_streak.max(streak);

    (active_days, current_streak, longest_streak)
}

#[tauri::command]
pub async fn get_usage_overview(
    days: Option<u32>,
    project_id: Option<String>,
    tz: Option<String>,
) -> Result<UsageOverview, String> {
    log::debug!(
        "[stats] get_usage_overview (async): days={:?} project_id={:?} tz={:?}",
        days,
        project_id,
        tz
    );
    // P1-3：app-scope 无内置缓存，重复请求会反复扫 events.jsonl。
    // 这里用内存 TTL 缓存抗一下重复刷新。
    let cache_key = AppOverviewCacheKey {
        scope: "app".to_string(),
        days,
        project_id: project_id.clone(),
        tz: tz.clone(),
    };
    if let Some(hit) = cache_get(&cache_key) {
        log::debug!("[stats] get_usage_overview cache hit");
        return Ok(hit);
    }
    let project_id_for_task = project_id.clone();
    let key_for_task = cache_key.clone();
    let value = tokio::task::spawn_blocking(move || compute_usage_overview(days))
        .await
        .map_err(|e| format!("usage overview task join failed: {e}"))??;
    let _ = project_id_for_task; // 预留给未来按 project_id 过滤
    let _ = tz; // 已纳入 cache key
    cache_put(key_for_task, value.clone());
    Ok(value)
}

#[tauri::command]
pub fn clear_usage_cache() -> Result<(), String> {
    log::debug!("[stats] clear_usage_cache");
    storage::claude_usage::clear_cache();
    Ok(())
}

/// Lightweight daily builder for heatmap aggregation (app scope).
#[derive(Default)]
struct HeatmapDayBuilder {
    cost_usd: f64,
    runs: u32,
    input_tokens: u64,
    output_tokens: u64,
    /// 按 model 聚合的 token 桶（P0-2：用于堆叠图）
    /// model → (input, output, cache_read, cache_write)
    model_tokens: HashMap<String, (u64, u64, u64, u64)>,
}

/// Strip model_breakdown, sort by date ascending, truncate to at most 365 entries.
fn prepare_heatmap_daily(mut daily: Vec<DailyAggregate>) -> Vec<DailyAggregate> {
    for d in &mut daily {
        d.model_breakdown = None;
    }
    daily.sort_by(|a, b| a.date.cmp(&b.date));
    if daily.len() > 365 {
        daily = daily.split_off(daily.len() - 365);
    }
    daily
}

fn get_app_heatmap_daily() -> Result<Vec<DailyAggregate>, String> {
    let metas = storage::runs::list_all_run_metas();
    let cutoff_date = chrono::Utc::now().date_naive() - chrono::Duration::days(364);
    let mut daily_map: BTreeMap<String, HeatmapDayBuilder> = BTreeMap::new();

    for meta in &metas {
        let Some(d) = parse_started_date_utc(&meta.started_at) else {
            log::debug!(
                "[stats] heatmap skip run {} bad timestamp {:?}",
                meta.id,
                meta.started_at
            );
            continue;
        };
        if d < cutoff_date {
            continue;
        }

        let date = d.format("%Y-%m-%d").to_string();
        let day = daily_map.entry(date).or_default();
        let usage = storage::events::extract_run_usage(&meta.id);
        let Some(u) = usage.as_ref() else {
            // 没有 usage 数据 → 该 run 仍然计入 runs/cost（成本为 0），
            // 但跳过 token 累加，避免把空 run 误聚合。
            day.runs += 1;
            continue;
        };
        day.cost_usd += u.total_cost_usd;
        day.runs += 1;
        day.input_tokens += u.input_tokens;
        day.output_tokens += u.output_tokens;

        // P0-2：把 model_usage 按 model 摊到 day.model_tokens，
        // 供后续 build_overview / get_usage_overview 填充 model_breakdown。
        // 注意 model_id 在调用方先用 pricing::normalize_model_id 归一化（P1-2），
        // 但当前 app scope 直接使用原始 model_id，先保留以便后续统一。
        for (model, mu) in &u.model_usage {
            let entry = day.model_tokens.entry(model.clone()).or_default();
            entry.0 += mu.input_tokens;
            entry.1 += mu.output_tokens;
            entry.2 += mu.cache_read_tokens;
            entry.3 += mu.cache_write_tokens;
        }
    }

    // 全部日期收集完毕后，挑选最近 30 天填充 model_breakdown。
    let entries: Vec<(String, HeatmapDayBuilder)> = daily_map.into_iter().collect();
    let breakdown_start = entries.len().saturating_sub(30);

    Ok(entries
        .into_iter()
        .enumerate()
        .map(|(idx, (date, d))| {
            let model_breakdown = if idx >= breakdown_start && !d.model_tokens.is_empty() {
                Some(
                    d.model_tokens
                        .into_iter()
                        .map(|(model, (i, o, cr, cw))| {
                            (
                                model,
                                crate::models::ModelTokens {
                                    input_tokens: i,
                                    output_tokens: o,
                                    cache_read_tokens: cr,
                                    cache_write_tokens: cw,
                                },
                            )
                        })
                        .collect(),
                )
            } else {
                None
            };
            DailyAggregate {
                date,
                cost_usd: d.cost_usd,
                runs: d.runs,
                input_tokens: d.input_tokens,
                output_tokens: d.output_tokens,
                message_count: None,
                session_count: None,
                tool_call_count: None,
                model_breakdown,
            }
        })
        .collect())
}

/// 同步版纯计算逻辑，便于 spawn_blocking。
fn compute_heatmap_daily(scope: String) -> Result<Vec<DailyAggregate>, String> {
    log::debug!("[stats] compute_heatmap_daily: scope={}", scope);
    let raw = match scope.as_str() {
        "global" => {
            let overview = storage::claude_usage::read_global_usage(Some(365))?;
            overview.daily
        }
        "app" => get_app_heatmap_daily()?,
        _ => return Err(format!("invalid scope: {}", scope)),
    };
    Ok(prepare_heatmap_daily(raw))
}

#[tauri::command]
pub async fn get_heatmap_daily(scope: String) -> Result<Vec<DailyAggregate>, String> {
    log::debug!("[stats] get_heatmap_daily (async): scope={}", scope);
    // 扫描 events.jsonl 属于重 IO，必须放线程池。
    tokio::task::spawn_blocking(move || compute_heatmap_daily(scope))
        .await
        .map_err(|e| format!("heatmap daily task join failed: {e}"))?
}

#[tauri::command]
pub async fn get_changelog() -> Result<Vec<ChangelogEntry>, String> {
    log::debug!("[stats] get_changelog");
    storage::changelog::get_changelog().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_started_date_utc_rfc3339() {
        let d = parse_started_date_utc("2026-02-25T10:30:00+08:00");
        assert_eq!(
            d,
            Some(chrono::NaiveDate::from_ymd_opt(2026, 2, 25).unwrap())
        );
    }

    // ── P1-3 ────────────────────────────────────────────────────────────
    use crate::models::UsageOverview;

    fn empty_overview() -> UsageOverview {
        UsageOverview {
            total_cost_usd: 0.0,
            total_tokens: 0,
            total_runs: 0,
            avg_cost_per_run: 0.0,
            by_model: vec![],
            daily: vec![],
            runs: vec![],
            scan_mode: None,
            active_days: 0,
            current_streak: 0,
            longest_streak: 0,
        }
    }

    #[test]
    fn test_p1_3_cache_round_trip() {
        let key = AppOverviewCacheKey {
            scope: "app".to_string(),
            days: Some(7133),
            project_id: None,
            tz: None,
        };
        assert!(cache_get(&key).is_none(), "fresh cache should miss");

        let value = empty_overview();
        cache_put(key.clone(), value.clone());
        let hit = cache_get(&key).expect("should hit after put");
        assert_eq!(hit.total_runs, value.total_runs);
    }

    #[test]
    fn test_p1_3_cache_keys_isolated() {
        // 不同 (days, project_id) 不会串数据
        let key_a = AppOverviewCacheKey {
            scope: "app".to_string(),
            days: Some(7),
            project_id: None,
            tz: None,
        };
        let key_b = AppOverviewCacheKey {
            scope: "app".to_string(),
            days: Some(30),
            project_id: None,
            tz: None,
        };
        let mut a = empty_overview();
        a.total_runs = 5;
        let mut b = empty_overview();
        b.total_runs = 99;
        cache_put(key_a.clone(), a.clone());
        cache_put(key_b.clone(), b.clone());

        assert_eq!(cache_get(&key_a).unwrap().total_runs, 5);
        assert_eq!(cache_get(&key_b).unwrap().total_runs, 99);
    }

    #[test]
    fn test_p1_6_tz_isolates_cache() {
        // P1-6：同一份 (scope, days, project_id) 但 tz 不同不能互相覆盖，
        // 否则 user TZ 与 UTC 算出来的 daily 会混。
        let key_a = AppOverviewCacheKey {
            scope: "app".to_string(),
            days: Some(7),
            project_id: None,
            tz: Some("Asia/Shanghai".to_string()),
        };
        let key_b = AppOverviewCacheKey {
            scope: "app".to_string(),
            days: Some(7),
            project_id: None,
            tz: Some("UTC".to_string()),
        };
        let mut a = empty_overview();
        a.total_runs = 11;
        let mut b = empty_overview();
        b.total_runs = 22;
        cache_put(key_a.clone(), a.clone());
        cache_put(key_b.clone(), b.clone());
        assert_eq!(cache_get(&key_a).unwrap().total_runs, 11);
        assert_eq!(cache_get(&key_b).unwrap().total_runs, 22);
    }

    #[test]
    fn test_p1_6_scope_isolates_cache() {
        // P1-6：scope 不同也不能串
        let key_app = AppOverviewCacheKey {
            scope: "app".to_string(),
            days: Some(7),
            project_id: None,
            tz: None,
        };
        let key_global = AppOverviewCacheKey {
            scope: "global".to_string(),
            days: Some(7),
            project_id: None,
            tz: None,
        };
        let mut a = empty_overview();
        a.total_runs = 7;
        let mut g = empty_overview();
        g.total_runs = 70;
        cache_put(key_app.clone(), a.clone());
        cache_put(key_global.clone(), g.clone());
        assert_eq!(cache_get(&key_app).unwrap().total_runs, 7);
        assert_eq!(cache_get(&key_global).unwrap().total_runs, 70);
    }

    #[test]
    fn test_parse_started_date_utc_cross_day_forward() {
        // +14:00 timezone, 00:30 local -> 2026-02-24 in UTC
        let d = parse_started_date_utc("2026-02-25T00:30:00+14:00");
        assert_eq!(
            d,
            Some(chrono::NaiveDate::from_ymd_opt(2026, 2, 24).unwrap())
        );
    }

    #[test]
    fn test_parse_started_date_utc_cross_day_negative() {
        // -12:00 timezone, 23:30 local -> 2026-02-26 in UTC
        let d = parse_started_date_utc("2026-02-25T23:30:00-12:00");
        assert_eq!(
            d,
            Some(chrono::NaiveDate::from_ymd_opt(2026, 2, 26).unwrap())
        );
    }

    #[test]
    fn test_parse_started_date_utc_legacy() {
        let d = parse_started_date_utc("2026-02-25");
        assert_eq!(
            d,
            Some(chrono::NaiveDate::from_ymd_opt(2026, 2, 25).unwrap())
        );
    }

    #[test]
    fn test_parse_started_date_utc_invalid() {
        assert_eq!(parse_started_date_utc("bad"), None);
    }

    #[test]
    fn test_prepare_heatmap_max_365() {
        let mut daily = Vec::new();
        for i in 0..400 {
            daily.push(DailyAggregate {
                date: format!("2025-{:02}-{:02}", (i / 28) % 12 + 1, i % 28 + 1),
                cost_usd: 0.0,
                runs: 1,
                input_tokens: 0,
                output_tokens: 0,
                message_count: None,
                session_count: None,
                tool_call_count: None,
                model_breakdown: None,
            });
        }
        let result = prepare_heatmap_daily(daily);
        assert_eq!(result.len(), 365);
    }

    #[test]
    fn test_prepare_heatmap_unsorted_input() {
        let daily = vec![
            DailyAggregate {
                date: "2026-02-03".to_string(),
                cost_usd: 0.0,
                runs: 1,
                input_tokens: 0,
                output_tokens: 0,
                message_count: None,
                session_count: None,
                tool_call_count: None,
                model_breakdown: None,
            },
            DailyAggregate {
                date: "2026-02-01".to_string(),
                cost_usd: 0.0,
                runs: 1,
                input_tokens: 0,
                output_tokens: 0,
                message_count: None,
                session_count: None,
                tool_call_count: None,
                model_breakdown: None,
            },
            DailyAggregate {
                date: "2026-02-02".to_string(),
                cost_usd: 0.0,
                runs: 1,
                input_tokens: 0,
                output_tokens: 0,
                message_count: None,
                session_count: None,
                tool_call_count: None,
                model_breakdown: None,
            },
        ];
        let result = prepare_heatmap_daily(daily);
        assert_eq!(result[0].date, "2026-02-01");
        assert_eq!(result[1].date, "2026-02-02");
        assert_eq!(result[2].date, "2026-02-03");
    }

    #[test]
    fn test_prepare_heatmap_strips_breakdown() {
        let daily = vec![DailyAggregate {
            date: "2026-02-01".to_string(),
            cost_usd: 0.0,
            runs: 1,
            input_tokens: 0,
            output_tokens: 0,
            message_count: None,
            session_count: None,
            tool_call_count: None,
            model_breakdown: Some(std::collections::HashMap::from([(
                "test".to_string(),
                crate::models::ModelTokens::default(),
            )])),
        }];
        let result = prepare_heatmap_daily(daily);
        assert!(result[0].model_breakdown.is_none());
    }

    #[test]
    fn test_heatmap_daily_invalid_scope() {
        let result = compute_heatmap_daily("foo".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("invalid scope"));
    }

    /// P0-2 回归测试：DailyBuilder 在添加 model_usage 后，最近 30 天的
    /// DailyAggregate 必须有 model_breakdown。
    #[test]
    fn test_p0_2_daily_builder_populates_model_breakdown_for_last_30() {
        // 模拟 50 天数据（每天唯一日期），最后 30 天填 model_usage。
        let mut daily_map: BTreeMap<String, DailyBuilder> = BTreeMap::new();
        for i in 0..50 {
            let date = format!("2026-{:02}-{:02}", (i / 28) + 1, (i % 28) + 1);
            let entry = daily_map.entry(date).or_default();
            entry.runs = 1;
            entry.cost_usd = 1.0;
            entry.input_tokens = 100;
            entry.output_tokens = 50;
            if i >= 20 {
                // 后 30 天才有 model_tokens
                entry
                    .model_tokens
                    .insert("claude-opus-4".to_string(), (100, 50, 0, 0));
            }
        }
        let entries: Vec<(String, DailyBuilder)> = daily_map.into_iter().collect();
        assert_eq!(entries.len(), 50, "应得到 50 个唯一日期");
        let breakdown_start = entries.len().saturating_sub(30);
        let result: Vec<DailyAggregate> = entries
            .into_iter()
            .enumerate()
            .map(|(idx, (date, d))| {
                let model_breakdown = if idx >= breakdown_start && !d.model_tokens.is_empty() {
                    Some(
                        d.model_tokens
                            .into_iter()
                            .map(|(m, (i, o, cr, cw))| {
                                (
                                    m,
                                    crate::models::ModelTokens {
                                        input_tokens: i,
                                        output_tokens: o,
                                        cache_read_tokens: cr,
                                        cache_write_tokens: cw,
                                    },
                                )
                            })
                            .collect(),
                    )
                } else {
                    None
                };
                DailyAggregate {
                    date,
                    cost_usd: d.cost_usd,
                    runs: d.runs,
                    input_tokens: d.input_tokens,
                    output_tokens: d.output_tokens,
                    message_count: None,
                    session_count: None,
                    tool_call_count: None,
                    model_breakdown,
                }
            })
            .collect();
        // 前 20 天无 model_breakdown
        for (i, agg) in result.iter().enumerate() {
            if i < 20 {
                assert!(agg.model_breakdown.is_none(), "day {} should be None", i);
            } else {
                assert!(agg.model_breakdown.is_some(), "day {} should be Some", i);
                let mb = agg.model_breakdown.as_ref().unwrap();
                assert!(mb.contains_key("claude-opus-4"));
            }
        }
    }
}
