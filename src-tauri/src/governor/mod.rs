//! 110-S5 Resource Governor — best-effort budget enforcement for live runs.
//!
//! Two budgets are tracked:
//! - **concurrent_runs**: hard cap on simultaneous active CLI sessions. Default 4.
//! - **memory_bytes**: per-run memory ceiling. Best-effort via `ps -o rss` on
//!   macOS / Linux. Default 4 GiB; set to 0 to disable.
//!
//! When a budget is tripped the governor emits `BusEvent::GovernorBudgetExceeded`
//! via the shared `BroadcastEmitter` so the frontend can surface a toast and
//! offer to retry / queue. The decision whether to actually deny a new run
//! is the caller's (the governor returns an `Admission` verdict; the IPC
//! layer translates it into an error).

use crate::models::{now_iso, BusEvent};
use crate::web_server::broadcaster::BroadcastEmitter;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

pub const DEFAULT_MAX_CONCURRENT_RUNS: u32 = 4;
pub const DEFAULT_MAX_MEMORY_BYTES: u64 = 4 * 1024 * 1024 * 1024; // 4 GiB
pub const DEFAULT_PROBE_INTERVAL_SECS: u64 = 15;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BudgetKind {
    ConcurrentRuns,
    MemoryBytes,
}

impl BudgetKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ConcurrentRuns => "concurrent_runs",
            Self::MemoryBytes => "memory_bytes",
        }
    }
}

/// Snapshot of a single run currently held by the governor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveRun {
    pub run_id: String,
    /// Best-effort PID reported by the spawn layer; `None` if we couldn't
    /// resolve one (e.g. remote runs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    /// Started-at timestamp (ISO).
    pub started_at: String,
    /// Last measured resident memory in bytes; `None` until the first probe.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rss_bytes: Option<u64>,
    /// Last time we measured this run's memory.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_measured_at: Option<String>,
}

/// User-tunable budget configuration. All fields are optional so partial
/// updates from the frontend merge cleanly with the current values.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GovernorConfig {
    /// Hard cap on concurrent active runs. 0 means unlimited.
    pub max_concurrent_runs: u32,
    /// Per-run memory ceiling in bytes. 0 means unlimited.
    pub max_memory_bytes: u64,
    /// How often the memory probe loop runs (seconds).
    pub probe_interval_secs: u64,
}

impl Default for GovernorConfig {
    fn default() -> Self {
        Self {
            max_concurrent_runs: DEFAULT_MAX_CONCURRENT_RUNS,
            max_memory_bytes: DEFAULT_MAX_MEMORY_BYTES,
            probe_interval_secs: DEFAULT_PROBE_INTERVAL_SECS,
        }
    }
}

impl GovernorConfig {
    pub fn merge(&self, update: &GovernorConfigUpdate) -> Self {
        Self {
            max_concurrent_runs: update
                .max_concurrent_runs
                .unwrap_or(self.max_concurrent_runs),
            max_memory_bytes: update.max_memory_bytes.unwrap_or(self.max_memory_bytes),
            probe_interval_secs: update
                .probe_interval_secs
                .unwrap_or(self.probe_interval_secs),
        }
    }
}

/// Partial update payload from the frontend. `None` fields are preserved.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GovernorConfigUpdate {
    pub max_concurrent_runs: Option<u32>,
    pub max_memory_bytes: Option<u64>,
    pub probe_interval_secs: Option<u64>,
}

/// Verdict returned by `try_admit`. `Allow` means proceed; `Deny` carries
/// the budget kind, current value, configured limit, and a free-form reason
/// for the frontend to surface in a toast.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Admission {
    Allow,
    Deny {
        kind: BudgetKind,
        current: u64,
        limit: u64,
        reason: String,
    },
}

impl Admission {
    pub fn is_allowed(&self) -> bool {
        matches!(self, Admission::Allow)
    }
    pub fn deny_reason(&self) -> Option<String> {
        match self {
            Admission::Allow => None,
            Admission::Deny { reason, .. } => Some(reason.clone()),
        }
    }
}

/// Snapshot exposed to IPC for the runtime governor dashboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernorSnapshot {
    pub config: GovernorConfig,
    pub active_runs: Vec<ActiveRun>,
    pub last_evaluated_at: String,
}

#[derive(Default)]
struct Inner {
    config: GovernorConfig,
    active: HashSet<String>,
    /// Per-run metadata keyed by run_id.
    runs: std::collections::HashMap<String, ActiveRun>,
}

/// Process-wide governor. Stored as Tauri managed state via `Arc`.
#[derive(Clone)]
pub struct ResourceGovernor {
    inner: Arc<RwLock<Inner>>,
    emitter: Option<Arc<BroadcastEmitter>>,
}

impl ResourceGovernor {
    /// Production constructor — wires the broadcast emitter so budget
    /// exceeded events reach the frontend.
    pub fn new(emitter: Arc<BroadcastEmitter>) -> Self {
        Self::with_emitter(Some(emitter))
    }

    /// Test constructor — allows building a governor without a real
    /// BroadcastEmitter. Emission paths become no-ops.
    pub fn with_emitter(emitter: Option<Arc<BroadcastEmitter>>) -> Self {
        Self {
            inner: Arc::new(RwLock::new(Inner {
                config: GovernorConfig::default(),
                active: HashSet::new(),
                runs: std::collections::HashMap::new(),
            })),
            emitter,
        }
    }

    pub async fn config(&self) -> GovernorConfig {
        self.inner.read().await.config.clone()
    }

    pub async fn update_config(&self, update: GovernorConfigUpdate) -> GovernorConfig {
        let mut guard = self.inner.write().await;
        guard.config = guard.config.merge(&update);
        guard.config.clone()
    }

    /// Read the full snapshot for IPC.
    pub async fn snapshot(&self) -> GovernorSnapshot {
        let guard = self.inner.read().await;
        GovernorSnapshot {
            config: guard.config.clone(),
            active_runs: guard
                .runs
                .values()
                .filter(|r| guard.active.contains(&r.run_id))
                .cloned()
                .collect(),
            last_evaluated_at: now_iso(),
        }
    }

    /// Check whether a new run may be admitted. Does NOT register the run —
    /// callers that decide to proceed must follow up with `register_run`.
    pub async fn try_admit(&self) -> Admission {
        let guard = self.inner.read().await;
        let limit = guard.config.max_concurrent_runs;
        if limit > 0 {
            let current = guard.active.len() as u32;
            if current >= limit {
                return Admission::Deny {
                    kind: BudgetKind::ConcurrentRuns,
                    current: current as u64,
                    limit: limit as u64,
                    reason: format!(
                        "并发运行数已达上限 ({current}/{limit}); 请等待当前任务完成后再启动新的会话"
                    ),
                };
            }
        }
        Admission::Allow
    }

    /// Register a run as active. Caller is expected to call `release_run`
    /// exactly once when the run ends (success / failure / cancel).
    pub async fn register_run(&self, run_id: &str, pid: Option<u32>) -> ActiveRun {
        let run = ActiveRun {
            run_id: run_id.to_string(),
            pid,
            started_at: now_iso(),
            rss_bytes: None,
            last_measured_at: None,
        };
        let mut guard = self.inner.write().await;
        guard.active.insert(run_id.to_string());
        guard.runs.insert(run_id.to_string(), run.clone());
        run
    }

    /// Release a previously-registered run. Idempotent: releasing a run_id
    /// that wasn't registered is a no-op.
    pub async fn release_run(&self, run_id: &str) {
        let mut guard = self.inner.write().await;
        guard.active.remove(run_id);
        guard.runs.remove(run_id);
    }

    /// Apply a memory measurement for one run. Returns the budget verdict
    /// after the update so the caller can decide whether to cancel the run.
    pub async fn record_memory(&self, run_id: &str, rss_bytes: u64) -> Admission {
        let now = now_iso();
        let mut guard = self.inner.write().await;
        if let Some(run) = guard.runs.get_mut(run_id) {
            run.rss_bytes = Some(rss_bytes);
            run.last_measured_at = Some(now);
        }
        let limit = guard.config.max_memory_bytes;
        if limit > 0 && rss_bytes > limit {
            return Admission::Deny {
                kind: BudgetKind::MemoryBytes,
                current: rss_bytes,
                limit,
                reason: format!("Run {run_id} 占用内存 {rss_bytes} 字节超过上限 {limit} 字节"),
            };
        }
        Admission::Allow
    }

    /// Iterate over active run ids — used by the probe loop.
    pub async fn active_run_ids(&self) -> Vec<String> {
        let guard = self.inner.read().await;
        guard.active.iter().cloned().collect()
    }

    /// Look up a single run's metadata (or None if not registered).
    pub async fn run(&self, run_id: &str) -> Option<ActiveRun> {
        let guard = self.inner.read().await;
        guard.runs.get(run_id).cloned()
    }

    /// Emit a `BusEvent::GovernorBudgetExceeded` for the given admission
    /// denial. Safe to call multiple times — frontend listeners decide
    /// whether to coalesce.
    pub fn emit_budget_exceeded(&self, run_id: &str, admission: &Admission) {
        let (kind, current, limit, reason) = match admission {
            Admission::Allow => return,
            Admission::Deny {
                kind,
                current,
                limit,
                reason,
            } => (*kind, *current, *limit, reason.clone()),
        };
        let bus = BusEvent::GovernorBudgetExceeded {
            run_id: run_id.to_string(),
            budget_kind: kind.as_str().to_string(),
            current_value: current,
            limit_value: limit,
            reason: Some(reason),
            timestamp_ms: crate::models::now_epoch_ms(),
        };
        if let Some(emitter) = &self.emitter {
            emitter.persist_and_emit(run_id, &bus);
        }
    }
}

/// Read the resident memory of a PID in bytes. Returns None when the
/// platform helper can't measure (e.g. PID exited, sandboxed).
pub fn read_memory_bytes(pid: u32) -> Option<u64> {
    #[cfg(unix)]
    {
        let output = std::process::Command::new("ps")
            .args(["-o", "rss=", "-p", &pid.to_string()])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let kib: u64 = stdout.trim().parse().ok()?;
        Some(kib.saturating_mul(1024))
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        None
    }
}

/// Probe all active runs and emit a `GovernorBudgetExceeded` event for any
/// whose RSS exceeded the configured memory ceiling. Returns the number of
/// runs that tripped the budget.
pub async fn probe_active_runs(governor: &ResourceGovernor) -> usize {
    let mut tripped = 0usize;
    for run_id in governor.active_run_ids().await {
        let pid = match governor.run(&run_id).await.and_then(|r| r.pid) {
            Some(p) => p,
            None => continue,
        };
        let bytes = match tokio::task::spawn_blocking(move || read_memory_bytes(pid)).await {
            Ok(Some(b)) => b,
            _ => continue,
        };
        let verdict = governor.record_memory(&run_id, bytes).await;
        if !verdict.is_allowed() {
            governor.emit_budget_exceeded(&run_id, &verdict);
            tripped += 1;
        }
    }
    tripped
}

/// Spawn the periodic memory probe loop. Returns immediately; the loop runs
/// until the cancellation token fires.
///
/// The ticker is rebuilt from the current `probe_interval_secs` config so
/// wake-ups match the configured cadence (default 15s) rather than firing
/// every 1s and discarding 14/15 ticks. When `probe_interval_secs == 0`
/// the probe is disabled and the loop sleeps for a long fallback interval.
pub fn spawn_probe_loop(governor: ResourceGovernor, cancel: tokio_util::sync::CancellationToken) {
    tauri::async_runtime::spawn(async move {
        let initial_cfg = governor.config().await;
        let initial_secs = effective_probe_secs(&initial_cfg);
        let mut ticker = tokio::time::interval(initial_secs);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut last_cfg = initial_cfg;
        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    log::debug!("[governor] probe loop cancelled");
                    return;
                }
                _ = ticker.tick() => {
                    let cfg = governor.config().await;
                    // Rebuild the interval if the configured cadence changed
                    // (or if it was previously disabled and is now enabled).
                    if cfg.probe_interval_secs != last_cfg.probe_interval_secs {
                        let new_secs = effective_probe_secs(&cfg);
                        ticker = tokio::time::interval(new_secs);
                        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                        last_cfg = cfg;
                        // Skip this tick — the next fire will be on the new cadence.
                        continue;
                    }
                    if cfg.probe_interval_secs == 0 {
                        continue;
                    }
                    let tripped = probe_active_runs(&governor).await;
                    if tripped > 0 {
                        log::warn!("[governor] memory probe tripped budget on {tripped} run(s)");
                    }
                }
            }
        }
    });
}

/// Resolve the probe interval honoring the `probe_interval_secs == 0`
/// "disabled" sentinel. Always returns at least 1 second so the tokio
/// interval cannot be zero.
fn effective_probe_secs(cfg: &GovernorConfig) -> Duration {
    if cfg.probe_interval_secs == 0 {
        // Disabled: use a long fallback so the loop still wakes on config
        // changes (via the rebuild path) without busy-waiting.
        Duration::from_secs(u64::MAX / 2)
    } else {
        Duration::from_secs(cfg.probe_interval_secs.max(1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_governor() -> ResourceGovernor {
        ResourceGovernor::with_emitter(None)
    }

    #[test]
    fn default_config_matches_constants() {
        let cfg = GovernorConfig::default();
        assert_eq!(cfg.max_concurrent_runs, DEFAULT_MAX_CONCURRENT_RUNS);
        assert_eq!(cfg.max_memory_bytes, DEFAULT_MAX_MEMORY_BYTES);
        assert_eq!(cfg.probe_interval_secs, DEFAULT_PROBE_INTERVAL_SECS);
    }

    #[test]
    fn merge_preserves_unspecified_fields() {
        let cfg = GovernorConfig::default();
        let update = GovernorConfigUpdate {
            max_concurrent_runs: Some(8),
            max_memory_bytes: None,
            probe_interval_secs: None,
        };
        let merged = cfg.merge(&update);
        assert_eq!(merged.max_concurrent_runs, 8);
        assert_eq!(merged.max_memory_bytes, DEFAULT_MAX_MEMORY_BYTES);
        assert_eq!(merged.probe_interval_secs, DEFAULT_PROBE_INTERVAL_SECS);
    }

    #[test]
    fn admission_helpers() {
        let allow = Admission::Allow;
        assert!(allow.is_allowed());
        assert!(allow.deny_reason().is_none());
        let deny = Admission::Deny {
            kind: BudgetKind::ConcurrentRuns,
            current: 4,
            limit: 4,
            reason: "test".into(),
        };
        assert!(!deny.is_allowed());
        assert_eq!(deny.deny_reason(), Some("test".to_string()));
    }

    #[test]
    fn budget_kind_serializes_snake_case() {
        let json = serde_json::to_string(&BudgetKind::ConcurrentRuns).unwrap();
        assert_eq!(json, "\"concurrent_runs\"");
        let json = serde_json::to_string(&BudgetKind::MemoryBytes).unwrap();
        assert_eq!(json, "\"memory_bytes\"");
    }

    #[test]
    fn read_memory_bytes_returns_none_for_invalid_pid() {
        assert!(read_memory_bytes(u32::MAX).is_none());
    }

    #[test]
    fn active_run_serializes_with_optional_fields() {
        let run = ActiveRun {
            run_id: "r1".into(),
            pid: Some(123),
            started_at: now_iso(),
            rss_bytes: None,
            last_measured_at: None,
        };
        let v = serde_json::to_value(&run).unwrap();
        assert_eq!(v["run_id"], "r1");
        assert_eq!(v["pid"], 123);
        assert!(v.get("rssBytes").is_none());
    }

    #[test]
    fn config_partial_update_default_is_empty() {
        let update = GovernorConfigUpdate::default();
        assert!(update.max_concurrent_runs.is_none());
        assert!(update.max_memory_bytes.is_none());
        assert!(update.probe_interval_secs.is_none());
    }

    #[tokio::test]
    async fn admit_allows_under_limit() {
        let g = test_governor();
        assert!(g.try_admit().await.is_allowed());
    }

    #[tokio::test]
    async fn admit_denies_at_concurrent_limit() {
        let g = test_governor();
        g.update_config(GovernorConfigUpdate {
            max_concurrent_runs: Some(2),
            max_memory_bytes: None,
            probe_interval_secs: None,
        })
        .await;
        g.register_run("r1", None).await;
        g.register_run("r2", None).await;
        let verdict = g.try_admit().await;
        assert!(!verdict.is_allowed());
        match verdict {
            Admission::Deny {
                kind,
                current,
                limit,
                ..
            } => {
                assert_eq!(kind, BudgetKind::ConcurrentRuns);
                assert_eq!(current, 2);
                assert_eq!(limit, 2);
            }
            Admission::Allow => panic!("expected deny"),
        }
    }

    #[tokio::test]
    async fn zero_concurrent_limit_means_unlimited() {
        let g = test_governor();
        g.update_config(GovernorConfigUpdate {
            max_concurrent_runs: Some(0),
            max_memory_bytes: None,
            probe_interval_secs: None,
        })
        .await;
        for i in 0..20 {
            g.register_run(&format!("r{i}"), None).await;
        }
        assert!(g.try_admit().await.is_allowed());
    }

    #[tokio::test]
    async fn register_and_release_round_trip() {
        let g = test_governor();
        g.update_config(GovernorConfigUpdate {
            max_concurrent_runs: Some(1),
            max_memory_bytes: None,
            probe_interval_secs: None,
        })
        .await;
        g.register_run("r1", Some(42)).await;
        assert!(!g.try_admit().await.is_allowed());
        g.release_run("r1").await;
        assert!(g.try_admit().await.is_allowed());
        // release_run on a never-registered id is a no-op
        g.release_run("ghost").await;
    }

    #[tokio::test]
    async fn record_memory_denies_over_limit() {
        let g = test_governor();
        g.update_config(GovernorConfigUpdate {
            max_concurrent_runs: None,
            max_memory_bytes: Some(1024),
            probe_interval_secs: None,
        })
        .await;
        g.register_run("r1", None).await;
        let verdict = g.record_memory("r1", 2048).await;
        assert!(!verdict.is_allowed());
        match verdict {
            Admission::Deny {
                kind,
                current,
                limit,
                ..
            } => {
                assert_eq!(kind, BudgetKind::MemoryBytes);
                assert_eq!(current, 2048);
                assert_eq!(limit, 1024);
            }
            Admission::Allow => panic!("expected deny"),
        }
    }

    #[tokio::test]
    async fn record_memory_updates_run_metadata() {
        let g = test_governor();
        g.register_run("r1", Some(123)).await;
        g.record_memory("r1", 4096).await;
        let run = g.run("r1").await.expect("run registered");
        assert_eq!(run.rss_bytes, Some(4096));
        assert!(run.last_measured_at.is_some());
    }

    #[tokio::test]
    async fn snapshot_lists_active_runs() {
        let g = test_governor();
        g.register_run("r1", Some(1)).await;
        g.register_run("r2", Some(2)).await;
        let snap = g.snapshot().await;
        assert_eq!(snap.active_runs.len(), 2);
        let ids: Vec<_> = snap.active_runs.iter().map(|r| r.run_id.clone()).collect();
        assert!(ids.contains(&"r1".to_string()));
        assert!(ids.contains(&"r2".to_string()));
    }

    #[tokio::test]
    async fn snapshot_excludes_released_runs() {
        let g = test_governor();
        g.register_run("r1", Some(1)).await;
        g.register_run("r2", Some(2)).await;
        g.release_run("r1").await;
        let snap = g.snapshot().await;
        assert_eq!(snap.active_runs.len(), 1);
        assert_eq!(snap.active_runs[0].run_id, "r2");
    }

    #[tokio::test]
    async fn update_config_returns_new_value() {
        let g = test_governor();
        let new_cfg = g
            .update_config(GovernorConfigUpdate {
                max_concurrent_runs: Some(16),
                max_memory_bytes: Some(1024 * 1024),
                probe_interval_secs: Some(5),
            })
            .await;
        assert_eq!(new_cfg.max_concurrent_runs, 16);
        assert_eq!(new_cfg.max_memory_bytes, 1024 * 1024);
        assert_eq!(new_cfg.probe_interval_secs, 5);
        let stored = g.config().await;
        assert_eq!(stored.max_concurrent_runs, 16);
    }

    #[tokio::test]
    async fn record_memory_for_unknown_run_is_no_op() {
        let g = test_governor();
        let verdict = g.record_memory("nonexistent", 999).await;
        assert!(verdict.is_allowed());
    }

    #[tokio::test]
    async fn emit_budget_exceeded_on_no_emitter_does_not_panic() {
        let g = test_governor();
        let deny = Admission::Deny {
            kind: BudgetKind::ConcurrentRuns,
            current: 4,
            limit: 4,
            reason: "test".into(),
        };
        // No emitter wired — should still complete without panicking.
        g.emit_budget_exceeded("r1", &deny);
    }

    #[tokio::test]
    async fn emit_budget_exceeded_with_allow_is_no_op() {
        let g = test_governor();
        g.emit_budget_exceeded("r1", &Admission::Allow);
    }
}
