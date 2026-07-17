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


pub fn read_global_usage(days: Option<u32>) -> Result<UsageOverview, String> {
    let _compute_guard = COMPUTE_LOCK
        .lock()
        .map_err(|e| format!("Compute lock: {e}"))?;

    let home = super::dirs_next().ok_or("Could not determine home directory")?;
    let claude_dir = home.join(".claude");

    // Check in-memory cache
    {
        let lock = CACHE.lock().map_err(|e| format!("Cache lock: {e}"))?;
        if let Some(ref cached) = *lock {
            if cached.computed_at.elapsed().as_secs() < CACHE_TTL_SECS {
                log::debug!(
                    "[claude_usage] memory cache hit (age {}s)",
                    cached.computed_at.elapsed().as_secs()
                );
                let mut overview = build_overview(cached, days);
                overview.scan_mode = Some("memory".to_string());
                return Ok(overview);
            }
        }
    }

    let start = Instant::now();

    // List all JSONL files with metadata (no content reading yet)
    let current_files = list_jsonl_files(&claude_dir);
    let current_manifest: HashMap<String, (u128, u64)> = current_files
        .iter()
        .map(|(p, mtime, size)| (p.to_string_lossy().to_string(), (*mtime, *size)))
        .collect();

    // Load disk cache
    let disk_cache = read_disk_cache();

    // Compare manifests: determine which files are clean vs dirty
    let mut per_file: HashMap<String, FileData> = HashMap::new();
    let mut dirty_count = 0u32;
    let mut clean_count = 0u32;
    let has_disk_cache = disk_cache.is_some();

    let old_manifest = disk_cache
        .as_ref()
        .map(|dc| &dc.manifest)
        .cloned()
        .unwrap_or_default();
    let old_per_file = disk_cache.map(|dc| dc.per_file).unwrap_or_default();

    for (path_str, &(mtime, size)) in &current_manifest {
        if let Some(&(old_mtime, old_size)) = old_manifest.get(path_str) {
            if mtime == old_mtime && size == old_size {
                // Unchanged — reuse cached data
                if let Some(cached_data) = old_per_file.get(path_str) {
                    per_file.insert(path_str.clone(), cached_data.clone());
                    clean_count += 1;
                    continue;
                }
            }
        }
        // New or changed — scan this file
        let path = Path::new(path_str);
        let file_data = scan_single_jsonl_standalone(path);
        per_file.insert(path_str.clone(), file_data);
        dirty_count += 1;
    }
    // Deleted files are simply not in current_manifest, so they are dropped

    let scan_mode = if !has_disk_cache {
        "full"
    } else if dirty_count > 0 {
        "incremental"
    } else {
        "disk"
    };

    log::debug!(
        "[claude_usage] scan_mode={}, {} clean, {} dirty, {} total files",
        scan_mode,
        clean_count,
        dirty_count,
        current_manifest.len(),
    );

    // Merge all per-file data into aggregate structures
    let (daily_model, scan_activity) = merge_all_file_data(&per_file);

    // Write updated disk cache (atomic)
    let new_disk_cache = DiskCache {
        version: DISK_CACHE_VERSION,
        manifest: current_manifest,
        per_file,
    };
    write_disk_cache(&new_disk_cache);

    // Read stats-cache for activity data (messages, sessions, tool calls)
    let (daily_activity, total_sessions) = read_activity_data(&claude_dir);

    let scan_secs = start.elapsed().as_secs_f64();
    log::debug!(
        "[claude_usage] done in {:.2}s ({}): {} days token, {} days activity, {} sessions",
        scan_secs,
        scan_mode,
        daily_model.len(),
        daily_activity.len(),
        total_sessions,
    );

    let cached = CachedData {
        computed_at: Instant::now(),
        daily_model,
        daily_activity,
        scan_activity,
        total_sessions,
    };

    let mut overview = build_overview(&cached, days);
    overview.scan_mode = Some(scan_mode.to_string());

    // Store in memory cache
    if let Ok(mut lock) = CACHE.lock() {
        *lock = Some(cached);
    }

    Ok(overview)
}

// ── File listing (metadata only) ──

/// Recursively list all `.jsonl` files under `~/.claude/projects/`.
/// Returns `(path, mtime_ns, size_bytes)` tuples — no file content is read.
fn list_jsonl_files(claude_dir: &Path) -> Vec<(PathBuf, u128, u64)> {
    let projects_dir = claude_dir.join("projects");
    if !projects_dir.is_dir() {
        log::debug!("[claude_usage] no projects directory at {:?}", projects_dir);
        return Vec::new();
    }

    let mut result = Vec::new();
    let mut dirs_to_visit: Vec<PathBuf> = vec![projects_dir];

    while let Some(dir) = dirs_to_visit.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if path.file_name().map(|n| n == "memory").unwrap_or(false) {
                    continue;
                }
                dirs_to_visit.push(path);
            } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                let meta = match std::fs::metadata(&path) {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let mtime_ns = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_nanos())
                    .unwrap_or(0);
                let size = meta.len();
                result.push((path, mtime_ns, size));
            }
        }
    }

    result
}

// ── Disk cache I/O ──

fn disk_cache_path() -> PathBuf {
    super::data_dir().join("usage-scan-cache.json")
}

/// Read the disk cache file. Returns `None` on any error or version mismatch.
fn read_disk_cache() -> Option<DiskCache> {
    let path = disk_cache_path();
    let raw = match std::fs::read_to_string(&path) {
        Ok(r) => r,
        Err(_) => {
            log::debug!("[claude_usage] no disk cache at {:?}", path);
            return None;
        }
    };

    let cache: DiskCache = match serde_json::from_str(&raw) {
        Ok(c) => c,
        Err(e) => {
            log::debug!("[claude_usage] disk cache parse error: {e}");
            return None;
        }
    };

    if cache.version != DISK_CACHE_VERSION {
        log::debug!(
            "[claude_usage] disk cache version mismatch: {} != {}",
            cache.version,
            DISK_CACHE_VERSION
        );
        return None;
    }

    log::debug!(
        "[claude_usage] loaded disk cache: {} files",
        cache.manifest.len()
    );
    Some(cache)
}

/// Atomically write disk cache: write to .tmp file, then rename.
fn write_disk_cache(cache: &DiskCache) {
    let path = disk_cache_path();
    let tmp_path = path.with_extension("json.tmp");

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        let _ = super::ensure_dir(parent);
    }

    let json = match serde_json::to_string(cache) {
        Ok(j) => j,
        Err(e) => {
            log::error!("[claude_usage] failed to serialize disk cache: {e}");
            return;
        }
    };

    if let Err(e) = std::fs::write(&tmp_path, &json) {
        log::error!("[claude_usage] failed to write disk cache tmp: {e}");
        return;
    }

    if let Err(e) = std::fs::rename(&tmp_path, &path) {
        log::error!("[claude_usage] failed to rename disk cache: {e}");
        let _ = std::fs::remove_file(&tmp_path);
        return;
    }

    log::debug!(
        "[claude_usage] wrote disk cache: {} files, {} bytes",
        cache.manifest.len(),
        json.len(),
    );
}

// ── Standalone single-file scanner (returns FileData, no side-effects) ──

fn scan_single_jsonl_standalone(path: &Path) -> FileData {
    let mut daily_tokens: HashMap<String, HashMap<String, TokenCounts>> = HashMap::new();
    let mut daily_messages: HashMap<String, u32> = HashMap::new();

    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => {
            return FileData {
                daily_tokens,
                daily_messages,
            };
        }
    };
    let mut reader = std::io::BufReader::new(file);

    // P0-1 修复：之前用 BufReader::lines() 会丢失末尾 partial 行
    // （典型场景：CLI 进程被 kill 或磁盘满时，最后一行没有换行）。
    // 改用 read_until(b'\n')：行内允许包含多字节 UTF-8 字符。
    let mut buf = Vec::with_capacity(64 * 1024);
    loop {
        buf.clear();
        let n = match std::io::BufRead::read_until(&mut reader, b'\n', &mut buf) {
            Ok(n) => n,
            Err(_) => break,
        };
        if n == 0 {
            break;
        }

        // 去掉末尾的 '\n' 与 '\r'
        let mut line_bytes: &[u8] = &buf;
        while let Some(last) = line_bytes.last() {
            if *last == b'\n' || *last == b'\r' {
                line_bytes = &line_bytes[..line_bytes.len() - 1];
            } else {
                break;
            }
        }
        if line_bytes.is_empty() {
            continue;
        }

        // 转成 &str 用于后续 contains 检查
        let line_str = match std::str::from_utf8(line_bytes) {
            Ok(s) => s,
            Err(_) => continue, // UTF-8 错误行（多半是真实 partial）跳过
        };

        // Count messages: lines with "role":"user" or "role":"assistant"
        let is_message =
            line_str.contains("\"role\":\"user\"") || line_str.contains("\"role\":\"assistant\"");
        if is_message {
            if let Some(date) = extract_date_fast(line_str) {
                *daily_messages.entry(date).or_default() += 1;
            }
        }

        // P0-1 修复：之前的 fast filter `line.contains("\"cache_read_input_tokens\"")`
        // 会漏掉只含纯 input/output 而无 cache 字段的早期 turn。
        // 改为只对包含 `"usage":` 的行做 JSON 解析——绝大多数 line 不会进入解析。
        if !line_str.contains("\"usage\":") {
            continue;
        }

        let parsed: SessionLine = match serde_json::from_str(line_str) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let message = match parsed.message {
            Some(m) => m,
            None => continue,
        };
        let usage = match message.usage {
            Some(u) => u,
            None => continue,
        };
        let model = match message.model {
            Some(m) if !m.is_empty() => m,
            _ => continue,
        };

        if parsed.timestamp.len() < 10 {
            continue;
        }
        let date = &parsed.timestamp[..10];

        let day_entry = daily_tokens.entry(date.to_string()).or_default();
        let tc = day_entry.entry(model).or_default();
        tc.input += usage.input_tokens;
        tc.output += usage.output_tokens;
        tc.cache_read += usage.cache_read_input_tokens;
        tc.cache_create += usage.cache_creation_input_tokens;
    }

    FileData {
        daily_tokens,
        daily_messages,
    }
}

// ── Merge all per-file data into aggregate structures ──

fn merge_all_file_data(per_file: &HashMap<String, FileData>) -> (DailyModelMap, ScanActivityMap) {
    let mut daily_model: DailyModelMap = BTreeMap::new();
    // date → set of file path strings (for counting unique sessions per day)
    let mut daily_sessions: HashMap<String, HashSet<&str>> = HashMap::new();
    let mut daily_messages_agg: HashMap<String, u32> = HashMap::new();

    for (file_path, file_data) in per_file {
        // Merge token data
        for (date, models) in &file_data.daily_tokens {
            let day_entry = daily_model.entry(date.clone()).or_default();
            for (model, tc) in models {
                let entry = day_entry.entry(model.clone()).or_default();
                entry.input += tc.input;
                entry.output += tc.output;
                entry.cache_read += tc.cache_read;
                entry.cache_create += tc.cache_create;
            }
        }

        // Merge message counts + session tracking
        for (date, &msg_count) in &file_data.daily_messages {
            *daily_messages_agg.entry(date.clone()).or_default() += msg_count;
            daily_sessions
                .entry(date.clone())
                .or_default()
                .insert(file_path.as_str());
        }
    }

    // Build scan_activity: date → (messages, sessions)
    let scan_activity: ScanActivityMap = daily_messages_agg
        .into_iter()
        .map(|(date, msgs)| {
            let sessions = daily_sessions
                .get(&date)
                .map(|s| s.len() as u32)
                .unwrap_or(0);
            (date, (msgs, sessions))
        })
        .collect();

    (daily_model, scan_activity)
}

// ── Build UsageOverview from cached data with date filter ──

/// P2-5：把日聚合序列里的"日期断层"补成连续序列，避免 trend / heatmap 显示
/// 不连续柱体让用户误以为当天 cost = 0。
///
/// 输入应当按 date 升序排列。空日期的位置插入一个全 0（无 token、无 cost、
/// 无 session）的 DailyAggregate，占位条仍会被 streak 判定为 inactive。
fn fill_daily_gaps(daily: &mut Vec<DailyAggregate>) {
    if daily.len() < 2 {
        return;
    }
    let mut out: Vec<DailyAggregate> = Vec::with_capacity(daily.len());
    for window in daily.windows(2) {
        out.push(window[0].clone());
        let prev_date = chrono::NaiveDate::parse_from_str(&window[0].date, "%Y-%m-%d").ok();
        let next_date = chrono::NaiveDate::parse_from_str(&window[1].date, "%Y-%m-%d").ok();
        if let (Some(p), Some(n)) = (prev_date, next_date) {
            let mut cursor = p + chrono::Duration::days(1);
            while cursor < n {
                out.push(DailyAggregate {
                    date: cursor.format("%Y-%m-%d").to_string(),
                    cost_usd: 0.0,
                    runs: 0,
                    input_tokens: 0,
                    output_tokens: 0,
                    message_count: Some(0),
                    session_count: Some(0),
                    tool_call_count: None,
                    model_breakdown: None,
                });
                cursor += chrono::Duration::days(1);
            }
        }
    }
    if let Some(last) = daily.last() {
        out.push(last.clone());
    }
    *daily = out;
}

fn build_overview(data: &CachedData, days: Option<u32>) -> UsageOverview {
    let cutoff_date = days.map(|d| {
        let now = chrono::Utc::now().date_naive();
        // "1d" = today only, "7d" = last 7 days including today
        now - chrono::Duration::days(d.saturating_sub(1) as i64)
    });

    let in_range = |date_str: &str| -> bool {
        match cutoff_date {
            Some(ref cutoff) => chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
                .map(|d| d >= *cutoff)
                .unwrap_or(true),
            None => true,
        }
    };

    // ── Per-model totals (filtered) + daily aggregates ──
    let mut model_totals: HashMap<String, TokenCounts> = HashMap::new();
    let mut daily_aggs: Vec<DailyAggregate> = Vec::new();
    let mut filtered_sessions: u32 = 0;

    // Collect all dates from both token data and activity data
    let mut all_dates: BTreeMap<&str, ()> = BTreeMap::new();
    for date in data.daily_model.keys() {
        all_dates.insert(date.as_str(), ());
    }
    for date in data.daily_activity.keys() {
        all_dates.insert(date.as_str(), ());
    }

    for date in all_dates.keys() {
        if !in_range(date) {
            continue;
        }

        let models = data.daily_model.get(*date);
        let activity = data.daily_activity.get(*date);
        let scan_act = data.scan_activity.get(*date);

        // Accumulate per-model totals
        let mut day_input = 0u64;
        let mut day_output = 0u64;
        let mut day_cost = 0.0f64;

        if let Some(models) = models {
            for (model, tc) in models {
                let entry = model_totals.entry(model.clone()).or_default();
                entry.input += tc.input;
                entry.output += tc.output;
                entry.cache_read += tc.cache_read;
                entry.cache_create += tc.cache_create;

                day_input += tc.input;
                day_output += tc.output;
                day_cost += pricing::estimate_cost(
                    model,
                    tc.input,
                    tc.output,
                    tc.cache_read,
                    tc.cache_create,
                );
            }
        }

        // Activity: prefer stats-cache, fall back to JSONL-derived counts
        let (msg_count, sess_count, tool_count) = if let Some(&(m, s, t)) = activity {
            (m, s, t)
        } else if let Some(&(msgs, sessions)) = scan_act {
            // P2-1：JSONL 派生路径下，`daily_messages` 数的是每条 user/assistant
            // 行（一对 user+assistant = 1 个 turn ≈ stats-cache 的 1 条 messageCount）。
            // 直接用 `msgs` 会得到约 2 倍 stats-cache 的真实 turn 数。
            // 这里除以 2 把它折算回 stats-cache 同一口径，避免回退路径下 messages
            // 数值跳变。`sess_count` 已经是按文件去重的 session 数，不用除。
            (msgs / 2, sessions, 0)
        } else {
            (0, 0, 0)
        };

        filtered_sessions += sess_count;

        daily_aggs.push(DailyAggregate {
            date: date.to_string(),
            cost_usd: day_cost,
            runs: sess_count,
            input_tokens: day_input,
            output_tokens: day_output,
            message_count: Some(msg_count),
            session_count: Some(sess_count),
            tool_call_count: if tool_count > 0 {
                Some(tool_count)
            } else {
                None
            },
            model_breakdown: None,
        });
    }

    // P2-5：填充日期断层，让 trend / heatmap 在中断日显示空柱而不是断开。
    // 注意 fill_daily_gaps 假设输入按日期升序——all_dates 来自 BTreeMap，遍历顺序即升序。
    fill_daily_gaps(&mut daily_aggs);

    // Populate model_breakdown for last 30 days only (stacked chart window)
    let breakdown_start = daily_aggs.len().saturating_sub(30);
    for agg in &mut daily_aggs[breakdown_start..] {
        if let Some(models) = data.daily_model.get(&agg.date) {
            agg.model_breakdown = Some(
                models
                    .iter()
                    .map(|(model, tc)| {
                        (
                            model.clone(),
                            crate::models::ModelTokens {
                                input_tokens: tc.input,
                                output_tokens: tc.output,
                                cache_read_tokens: tc.cache_read,
                                cache_write_tokens: tc.cache_create,
                            },
                        )
                    })
                    .collect(),
            );
        }
    }

    // ── By-model aggregates ──
    let mut total_cost = 0.0f64;
    let mut total_tokens = 0u64;
    let mut by_model: Vec<ModelAggregate> = Vec::new();

    for (model, tc) in &model_totals {
        let cost =
            pricing::estimate_cost(model, tc.input, tc.output, tc.cache_read, tc.cache_create);
        total_cost += cost;
        total_tokens += tc.input + tc.output;

        by_model.push(ModelAggregate {
            model: model.clone(),
            runs: 0,
            input_tokens: tc.input,
            output_tokens: tc.output,
            cache_read_tokens: tc.cache_read,
            cache_write_tokens: tc.cache_create,
            cost_usd: cost,
            pct: 0.0,
        });
    }

    // Fill pct and sort by cost descending
    for m in &mut by_model {
        m.pct = if total_cost > 0.0 {
            m.cost_usd / total_cost * 100.0
        } else {
            0.0
        };
    }
    by_model.sort_by(|a, b| {
        b.cost_usd
            .partial_cmp(&a.cost_usd)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // ── Summary ──
    //
    // P1-1 修复：之前 `total_sessions` 在 days=None 时回退到全局 stats-cache 的
    // totalSessions，跨过日期筛选——切到 "All" 时数字会跳变（从 filtered 变
    // 全局未筛选值）。改为**始终用 filtered_sessions**，无论 days 是否传入。
    // 这意味着 "All" 模式下 total_sessions 也是基于现有扫描数据聚合得到，
    // 可能略小于 stats-cache 的 totalSessions（stats-cache 还包含老用户未
    // 迁移的 session），但口径稳定，UI 上不会跳变。
    //
    // cancelled run 不计入（cancelled 是用户主动中断，没有完整 usage 数据）。
    let total_sessions = filtered_sessions;

    let avg_cost = if total_sessions > 0 {
        total_cost / total_sessions as f64
    } else {
        0.0
    };

    log::debug!(
        "[claude_usage] overview: days={:?}, ${:.2}, {} sessions, {} models, {} daily",
        days,
        total_cost,
        total_sessions,
        by_model.len(),
        daily_aggs.len(),
    );

    let (active_days, current_streak, longest_streak) =
        compute_streaks(&daily_aggs, chrono::Utc::now().date_naive());

    UsageOverview {
        total_cost_usd: total_cost,
        total_tokens,
        total_runs: total_sessions,
        avg_cost_per_run: avg_cost,
        by_model,
        daily: daily_aggs,
        runs: vec![],
        scan_mode: None,
        active_days,
        current_streak,
        longest_streak,
    }
}

// ── JSONL scanning (type aliases) ──

type DailyModelMap = BTreeMap<String, HashMap<String, TokenCounts>>;
type ScanActivityMap = HashMap<String, (u32, u32)>;

/// Extract date ("YYYY-MM-DD") from a JSONL line by finding the "timestamp" field.
///
/// P0-4 修复：之前用 substring 截前 10 字符当成日期，**不解析时区**。
/// JSONL timestamp 可能是：
///   - "2026-02-13T23:30:00-05:00"（EST 23:30 = UTC 次日 04:30）
///   - "2026-02-13T23:30:00.123Z"（UTC）
///   - "2026-02-13T23:30:00+14:00"（+14 时区 23:30 = UTC 次日 13:30）
///   - "2026-02-13T23:30:00"（无时区，本地时区）
///
/// 之前 buggy 的逻辑：substring[..10] = "2026-02-13"，把 EST 23:30 算成
/// 2026-02-13（实际 UTC 是 2026-02-14），与 server 端的 UTC cutoff 错位。
///
/// 修复策略：先尝试完整 RFC 3339 解析 → 转 UTC → 取日期；
/// 解析失败再 fallback substring（兼容老 CLI 无时区格式）。
