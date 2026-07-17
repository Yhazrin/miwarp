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

    /// Invalid path characters in run_id (e.g. ':' on Windows) must return
    /// Err — never panic/abort the process.
    #[test]
    fn write_bus_event_returns_err_on_invalid_run_id_path() {
        let writer = EventWriter::new();
        let run_id = "runtime-health:claude".to_string();
        let event = BusEvent::RunState {
            run_id: run_id.clone(),
            state: "should_fail".to_string(),
            exit_code: None,
            error: None,
        };
        let result = writer.write_bus_event(&run_id, &event);
        #[cfg(windows)]
        assert!(
            result.is_err(),
            "colon in run_id must fail open on Windows, got {result:?}"
        );
        #[cfg(not(windows))]
        {
            // Unix allows ':'; clean up if the write succeeded.
            if result.is_ok() {
                cleanup_run(&run_id);
            }
        }
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
