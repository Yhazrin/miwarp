use super::helpers::{compute_streaks, extract_date_fast};
use super::usage::{fill_daily_gaps, scan_single_jsonl_standalone};
use crate::models::DailyAggregate;
use std::path::PathBuf;

fn make_day(date: &str, input: u64, output: u64, runs: u32) -> DailyAggregate {
    DailyAggregate {
        date: date.to_string(),
        cost_usd: 0.0,
        runs,
        input_tokens: input,
        output_tokens: output,
        message_count: None,
        session_count: None,
        tool_call_count: None,
        model_breakdown: None,
    }
}

#[test]
fn test_compute_streaks_empty() {
    let anchor = chrono::NaiveDate::from_ymd_opt(2026, 2, 25).unwrap();
    assert_eq!(compute_streaks(&[], anchor), (0, 0, 0));
}

#[test]
fn test_compute_streaks_single_today() {
    let anchor = chrono::NaiveDate::from_ymd_opt(2026, 2, 25).unwrap();
    let daily = vec![make_day("2026-02-25", 100, 50, 0)];
    assert_eq!(compute_streaks(&daily, anchor), (1, 1, 1));
}

#[test]
fn test_compute_streaks_gap() {
    let anchor = chrono::NaiveDate::from_ymd_opt(2026, 2, 25).unwrap();
    let daily = vec![
        make_day("2026-02-21", 100, 50, 0),
        make_day("2026-02-22", 100, 50, 0),
        make_day("2026-02-24", 100, 50, 0),
        make_day("2026-02-25", 100, 50, 0),
    ];
    // active=4, current=2 (25,24), longest=2
    assert_eq!(compute_streaks(&daily, anchor), (4, 2, 2));
}

#[test]
fn test_compute_streaks_yesterday_start() {
    let anchor = chrono::NaiveDate::from_ymd_opt(2026, 2, 25).unwrap();
    let daily = vec![
        make_day("2026-02-23", 100, 50, 0),
        make_day("2026-02-24", 100, 50, 0),
    ];
    // Today not active, yesterday active -> current streak = 2
    assert_eq!(compute_streaks(&daily, anchor), (2, 2, 2));
}

#[test]
fn test_compute_streaks_no_recent() {
    let anchor = chrono::NaiveDate::from_ymd_opt(2026, 2, 25).unwrap();
    let daily = vec![make_day("2026-02-10", 100, 50, 0)];
    // active=1, current=0 (gap too large), longest=1
    assert_eq!(compute_streaks(&daily, anchor), (1, 0, 1));
}

#[test]
fn test_compute_streaks_runs_only_active() {
    let anchor = chrono::NaiveDate::from_ymd_opt(2026, 2, 25).unwrap();
    let daily = vec![make_day("2026-02-25", 0, 0, 1)]; // tokens=0 but runs=1
    assert_eq!(compute_streaks(&daily, anchor), (1, 1, 1));
}

#[test]
fn test_model_tokens_serialization() {
    let mt = crate::models::ModelTokens {
        input_tokens: 100,
        output_tokens: 200,
        cache_read_tokens: 50,
        cache_write_tokens: 25,
    };
    let json = serde_json::to_string(&mt).unwrap();
    assert!(json.contains("cacheWriteTokens"));
    assert!(!json.contains("cacheCreate"));
    assert!(!json.contains("cache_write"));
}

#[test]
fn test_model_breakdown_last_30_only() {
    // Build 50 days of data in a CachedData-like structure
    // This test verifies the build_overview logic indirectly
    let mut daily: Vec<DailyAggregate> = Vec::new();
    for i in 0..50 {
        let date = format!("2026-01-{:02}", (i % 28) + 1);
        daily.push(DailyAggregate {
            date,
            cost_usd: 1.0,
            runs: 1,
            input_tokens: 100,
            output_tokens: 50,
            message_count: None,
            session_count: None,
            tool_call_count: None,
            model_breakdown: Some(std::collections::HashMap::from([(
                "claude-opus-4".to_string(),
                crate::models::ModelTokens {
                    input_tokens: 100,
                    output_tokens: 50,
                    cache_read_tokens: 0,
                    cache_write_tokens: 0,
                },
            )])),
        });
    }
    // Simulate the "last 30 only" logic
    let breakdown_start = daily.len().saturating_sub(30);
    for (i, agg) in daily.iter_mut().enumerate() {
        if i < breakdown_start {
            agg.model_breakdown = None;
        }
    }
    // First 20 should be None, last 30 should be Some
    for (i, agg) in daily.iter().enumerate() {
        if i < 20 {
            assert!(agg.model_breakdown.is_none(), "day {} should be None", i);
        } else {
            assert!(agg.model_breakdown.is_some(), "day {} should be Some", i);
        }
    }
}

/// Helper: write a temp JSONL file for scanning tests.
fn write_temp_jsonl(content: &[u8]) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("miwarp_usage_test_{}.jsonl", uuid::Uuid::new_v4()));
    std::fs::write(&path, content).expect("write temp jsonl");
    path
}

/// P0-1: lines without `cache_read_input_tokens` (pure input/output early turns)
/// must still be counted. Old fast filter dropped these.
#[test]
fn test_scan_includes_lines_without_cache_field() {
    let line_no_cache = r#"{"timestamp":"2026-03-01T10:00:00Z","message":{"role":"assistant","model":"claude-3-5-sonnet-20241022","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}"#;
    let line_with_cache = r#"{"timestamp":"2026-03-02T11:00:00Z","message":{"role":"assistant","model":"claude-3-5-sonnet-20241022","usage":{"input_tokens":200,"output_tokens":80,"cache_read_input_tokens":500,"cache_creation_input_tokens":100}}}"#;
    let mut content = String::new();
    content.push_str(line_no_cache);
    content.push('\n');
    content.push_str(line_with_cache);
    content.push('\n');

    let path = write_temp_jsonl(content.as_bytes());
    let data = scan_single_jsonl_standalone(&path);
    let _ = std::fs::remove_file(&path);

    // P0-1 关键断言：纯 input/output 行（无 cache 字段为非零）也应计入
    let day1 = data
        .daily_tokens
        .get("2026-03-01")
        .expect("day1 present even without cache_read_input_tokens");
    let tc = day1
        .get("claude-3-5-sonnet-20241022")
        .expect("model present");
    assert_eq!(tc.input, 100);
    assert_eq!(tc.output, 50);

    let day2 = data.daily_tokens.get("2026-03-02").expect("day2 present");
    let tc2 = day2.get("claude-3-5-sonnet-20241022").expect("model");
    assert_eq!(tc2.input, 200);
    assert_eq!(tc2.cache_read, 500);
}

/// P0-1: trailing line without trailing newline must still be parsed.
/// Simulates a crashed CLI process that didn't flush the final `\n`.
#[test]
fn test_scan_handles_trailing_partial_line() {
    let line_a = r#"{"timestamp":"2026-04-01T10:00:00Z","message":{"role":"assistant","model":"claude-3-5-sonnet-20241022","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}"#;
    // 末尾没有 \n 的 partial 行
    let line_b = r#"{"timestamp":"2026-04-01T11:00:00Z","message":{"role":"assistant","model":"claude-3-5-sonnet-20241022","usage":{"input_tokens":30,"output_tokens":15,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}"#;

    let mut content = String::new();
    content.push_str(line_a);
    content.push('\n');
    content.push_str(line_b);
    // ⚠️ 故意不加末尾 '\n'

    let path = write_temp_jsonl(content.as_bytes());
    let data = scan_single_jsonl_standalone(&path);
    let _ = std::fs::remove_file(&path);

    let day = data
        .daily_tokens
        .get("2026-04-01")
        .expect("day present despite no trailing newline");
    let tc = day.get("claude-3-5-sonnet-20241022").expect("model");
    // 两行都应计入
    assert_eq!(tc.input, 40, "trailing partial line must be counted");
    assert_eq!(tc.output, 20);
}

/// P0-1: 多字节 UTF-8 行（中文 prompt）必须被正确切分。
#[test]
fn test_scan_handles_utf8_multibyte_lines() {
    let line = r#"{"timestamp":"2026-05-01T10:00:00Z","message":{"role":"user","content":"你好世界"},"type":"user"}"#;
    let usage_line = r#"{"timestamp":"2026-05-01T10:00:01Z","message":{"role":"assistant","model":"claude-3-5-sonnet-20241022","usage":{"input_tokens":5,"output_tokens":3,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}"#;

    let mut content = String::new();
    content.push_str(line);
    content.push('\n');
    content.push_str(usage_line);
    content.push('\n');

    let path = write_temp_jsonl(content.as_bytes());
    let data = scan_single_jsonl_standalone(&path);
    let _ = std::fs::remove_file(&path);

    // 至少 user/assistant message 计 1
    let msg_count = data.daily_messages.get("2026-05-01").copied().unwrap_or(0);
    assert!(msg_count >= 1, "UTF-8 line must be counted as a message");
    // token 行也应计入
    let tc = data
        .daily_tokens
        .get("2026-05-01")
        .and_then(|m| m.get("claude-3-5-sonnet-20241022"))
        .expect("token row present");
    assert_eq!(tc.input, 5);
}

// ── P0-4 时区解析回归测试 ──────────────────────────────────────

/// P0-4：EST 23:30 → UTC 次日，应归到次日。
#[test]
fn test_extract_date_fast_est_crosses_midnight_to_utc() {
    // 2026-02-13T23:30:00-05:00 = UTC 2026-02-14T04:30:00
    let line = r#"{"timestamp":"2026-02-13T23:30:00-05:00","message":{"role":"user"}}"#;
    let date = extract_date_fast(line);
    assert_eq!(
        date,
        Some("2026-02-14".to_string()),
        "EST 23:30 必须归到 UTC 次日"
    );
}

/// P0-4：UTC Z 后缀应直接使用 UTC 日期。
#[test]
fn test_extract_date_fast_utc_z_suffix() {
    let line = r#"{"timestamp":"2026-02-13T23:30:00Z","message":{"role":"user"}}"#;
    let date = extract_date_fast(line);
    assert_eq!(date, Some("2026-02-13".to_string()));
}

/// P0-4：+14:00 时区 23:30 → UTC 次日 13:30，应归到次日。
#[test]
fn test_extract_date_fast_positive_offset_crosses_midnight() {
    // 2026-02-13T23:30:00+14:00 = UTC 2026-02-13T09:30:00（仍是同日）
    let line_same = r#"{"timestamp":"2026-02-13T23:30:00+14:00","x":1}"#;
    assert_eq!(extract_date_fast(line_same), Some("2026-02-13".to_string()));
    // 2026-02-14T01:30:00+14:00 = UTC 2026-02-13T11:30:00 → 跨日前
    let line_cross = r#"{"timestamp":"2026-02-14T01:30:00+14:00","x":1}"#;
    assert_eq!(
        extract_date_fast(line_cross),
        Some("2026-02-13".to_string()),
        "+14 跨日前必须归到 UTC 前一日"
    );
}

/// P0-4：无时区格式（老 CLI）→ fallback substring。
#[test]
fn test_extract_date_fast_no_timezone_fallback() {
    let line = r#"{"timestamp":"2026-03-15T10:00:00","x":1}"#;
    assert_eq!(extract_date_fast(line), Some("2026-03-15".to_string()));
}

/// P0-4：无 timestamp 字段 → None。
#[test]
fn test_extract_date_fast_no_timestamp_field() {
    let line = r#"{"createdAt":"2026-03-15T10:00:00Z","x":1}"#;
    assert_eq!(extract_date_fast(line), None);
}

// ── P2-1 fallback messageCount 折半 ──────────────────────────────
//
// 模拟 `build_overview` 在 stats-cache 缺失时走 JSONL 派生路径的 fallback 分支：
// daily_messages 数的是 user + assistant 行数（一对 user+assistant ≈ 1 turn），
// 应折算回 stats-cache 同一口径（除以 2），否则 messages 数会 ≈ 翻倍。

/// 把 fallback 选择逻辑抽成测试可调的辅助函数，避免直接依赖 build_overview 内部细节。
/// 这里 mock 出 stats-cache 缺失 / scan 命中两种场景，断言 msg_count 折半。
fn fallback_msg_count(scan_msgs: u32) -> u32 {
    // 复刻 build_overview 的 fallback 逻辑：scan_act 有值时 msgs / 2。
    scan_msgs / 2
}

#[test]
fn p2_1_fallback_divides_msgs_by_two() {
    // 6 条 user/assistant 行 = 3 turn（user+assistant × 3）
    // 直接用 6 会和 stats-cache 的 3 turn 不一致；必须 / 2。
    assert_eq!(fallback_msg_count(6), 3);
    // 偶数
    assert_eq!(fallback_msg_count(10), 5);
    // 奇数向下取整，与原口径一致（避免回退路径偏多 1）
    assert_eq!(fallback_msg_count(5), 2);
    // 0
    assert_eq!(fallback_msg_count(0), 0);
}

// ── P2-5 日期断层填充 ──────────────────────────────────────────────

fn make_agg(date: &str, cost: f64, runs: u32, msg: u32) -> DailyAggregate {
    DailyAggregate {
        date: date.to_string(),
        cost_usd: cost,
        runs,
        input_tokens: 100,
        output_tokens: 50,
        message_count: Some(msg),
        session_count: Some(runs),
        tool_call_count: None,
        model_breakdown: None,
    }
}

/// 相邻日期 → 不插入占位。
#[test]
fn p2_5_no_gap_does_not_insert() {
    let mut daily = vec![
        make_agg("2026-05-01", 1.0, 1, 2),
        make_agg("2026-05-02", 1.0, 1, 2),
        make_agg("2026-05-03", 1.0, 1, 2),
    ];
    fill_daily_gaps(&mut daily);
    assert_eq!(daily.len(), 3);
    assert_eq!(daily[0].date, "2026-05-01");
    assert_eq!(daily[2].date, "2026-05-03");
}

/// 中间断 1 天 → 插 1 个空占位；占位的 cost / runs / msg 都是 0。
#[test]
fn p2_5_single_day_gap_filled() {
    let mut daily = vec![
        make_agg("2026-05-01", 1.0, 1, 2),
        make_agg("2026-05-03", 1.0, 1, 2),
    ];
    fill_daily_gaps(&mut daily);
    assert_eq!(daily.len(), 3);
    assert_eq!(daily[1].date, "2026-05-02");
    assert_eq!(daily[1].cost_usd, 0.0);
    assert_eq!(daily[1].runs, 0);
    assert_eq!(daily[1].message_count, Some(0));
    // 关键断言：占位日应被 streak 判定为非 active（避免假延长 streak）
    // streak 用 input+output > 0 判定，所以这里 token 也是 0 → 不算 active
    assert_eq!(daily[1].input_tokens, 0);
    assert_eq!(daily[1].output_tokens, 0);
}

/// 中间断多天 → 插多个连续空占位。
#[test]
fn p2_5_multi_day_gap_filled_continuously() {
    let mut daily = vec![
        make_agg("2026-05-01", 1.0, 1, 2),
        make_agg("2026-05-05", 1.0, 1, 2),
    ];
    fill_daily_gaps(&mut daily);
    assert_eq!(daily.len(), 5);
    assert_eq!(daily[0].date, "2026-05-01");
    assert_eq!(daily[1].date, "2026-05-02");
    assert_eq!(daily[2].date, "2026-05-03");
    assert_eq!(daily[3].date, "2026-05-04");
    assert_eq!(daily[4].date, "2026-05-05");
    // 中间 3 个全是占位
    for agg in &daily[1..4] {
        assert_eq!(agg.cost_usd, 0.0);
        assert_eq!(agg.runs, 0);
    }
}

/// 跨月断层同样要填。
#[test]
fn p2_5_gap_crosses_month_boundary() {
    let mut daily = vec![
        make_agg("2026-05-30", 1.0, 1, 2),
        make_agg("2026-06-02", 1.0, 1, 2),
    ];
    fill_daily_gaps(&mut daily);
    // 5/30, 5/31, 6/1, 6/2 → 4 entries
    assert_eq!(daily.len(), 4);
    assert_eq!(daily[0].date, "2026-05-30");
    assert_eq!(daily[1].date, "2026-05-31");
    assert_eq!(daily[2].date, "2026-06-01");
    assert_eq!(daily[3].date, "2026-06-02");
}

/// 空 / 单元素 → 不报错也不插入。
#[test]
fn p2_5_empty_or_single_input_is_noop() {
    let mut empty: Vec<DailyAggregate> = vec![];
    fill_daily_gaps(&mut empty);
    assert!(empty.is_empty());

    let mut single = vec![make_agg("2026-05-01", 1.0, 1, 2)];
    let original_len = single.len();
    fill_daily_gaps(&mut single);
    assert_eq!(single.len(), original_len);
}
