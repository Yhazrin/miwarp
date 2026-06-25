//! 110-A4 Capability Matrix — runtime health probe for CLI providers.
//!
//! Periodically checks the binary path, version, login state, and capability
//! negotiation for each known provider (claude / codex / mimo / opencode /
//! cursor). Results are cached in-process so the frontend capability matrix
//! and `runtime_health_get` IPC can read without paying the spawn cost on
//! every call. The probe loop runs as a Tokio task and emits
//! `BusEvent::RuntimeHealthChanged` whenever the snapshot differs from the
//! previous one for a given agent.

use crate::agent::claude_stream::{augmented_path, which_binary};
use crate::models::{now_iso, AgentRuntimeKind, BusEvent, CliAccount};
use crate::web_server::broadcaster::BroadcastEmitter;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

pub const DEFAULT_PROBE_INTERVAL_SECS: u64 = 600; // 10 minutes
pub const PROBE_TIMEOUT_SECS: u64 = 10;

pub const SUPPORTED_AGENTS: &[&str] = &["claude", "codex", "mimo", "opencode", "cursor"];

/// Return the list of agents the probe loop actively checks. Same as
/// `SUPPORTED_AGENTS` but exposed as a function so callers can iterate
/// without importing the slice.
pub fn supported_agents() -> Vec<&'static str> {
    SUPPORTED_AGENTS.to_vec()
}

/// Coarse-grained health bucket surfaced to the frontend.
/// `Healthy` means binary found + (login confirmed OR provider doesn't gate on login).
/// `Degraded` means binary found but capability negotiation is partial.
/// `Unhealthy` means binary not found OR provider explicitly rejected the probe.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HealthState {
    Healthy,
    Degraded,
    Unhealthy,
}

impl HealthState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Healthy => "healthy",
            Self::Degraded => "degraded",
            Self::Unhealthy => "unhealthy",
        }
    }
}

/// One row in the capability matrix. Always carries the last probed snapshot;
/// callers can read this without paying for a fresh probe.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeHealthReport {
    /// Provider key — matches `agent` field on RunMeta (e.g. "claude", "codex").
    pub agent: String,
    /// Resolved binary path on disk, when found.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binary_path: Option<String>,
    /// `--version` output, when the probe succeeded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Whether the user is currently authenticated to this provider.
    pub logged_in: bool,
    /// Coarse health bucket.
    pub health: HealthState,
    /// Optional reason string when health != Healthy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Negotiated capability flags. Keys are stable strings, values are
    /// provider-specific (mostly bools).
    pub capabilities: HashMap<String, serde_json::Value>,
    /// ISO timestamp of the last successful probe (None if probe never ran).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_successful_at: Option<String>,
    /// ISO timestamp of the most recent probe attempt, success or failure.
    #[serde(default)]
    pub last_checked_at: Option<String>,
    /// How many probe attempts have failed in a row.
    #[serde(default)]
    pub consecutive_failures: u32,
}

impl RuntimeHealthReport {
    fn unknown(agent: &str) -> Self {
        Self {
            agent: agent.to_string(),
            binary_path: None,
            version: None,
            logged_in: false,
            health: HealthState::Unhealthy,
            reason: Some("probe never ran".to_string()),
            capabilities: HashMap::new(),
            last_successful_at: None,
            last_checked_at: None,
            consecutive_failures: 0,
        }
    }
}

/// Snapshot of all known providers plus the aggregate last_checked_at.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeHealthSnapshot {
    pub providers: Vec<RuntimeHealthReport>,
    pub last_checked_at: Option<String>,
}

/// Process-wide store of latest health reports. Frontend reads via
/// `runtime_health_get`; the probe loop writes here after each round.
#[derive(Clone, Default)]
pub struct RuntimeHealthStore {
    inner: Arc<RwLock<HashMap<String, RuntimeHealthReport>>>,
}

impl RuntimeHealthStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Read the current snapshot. Used by both IPC and the probe loop diff
    /// check before re-emitting `RuntimeHealthChanged`.
    pub async fn snapshot(&self) -> RuntimeHealthSnapshot {
        let guard = self.inner.read().await;
        let mut providers: Vec<RuntimeHealthReport> = SUPPORTED_AGENTS
            .iter()
            .map(|a| RuntimeHealthReport::unknown(a))
            .collect();
        for (key, value) in guard.iter() {
            if let Some(slot) = providers.iter_mut().find(|p| p.agent == *key) {
                *slot = value.clone();
            }
        }
        let last_checked_at = providers
            .iter()
            .filter_map(|p| p.last_checked_at.as_ref())
            .max()
            .cloned();
        RuntimeHealthSnapshot {
            providers,
            last_checked_at,
        }
    }

    /// Apply a fresh report and return whether the new state differs from the
    /// previous one for that agent. Used by the probe loop to decide whether
    /// to emit a bus event.
    pub async fn apply(&self, report: RuntimeHealthReport) -> bool {
        let key = report.agent.clone();
        let mut guard = self.inner.write().await;
        let changed = guard
            .get(&key)
            .map(|prev| !report_equals(prev, &report))
            .unwrap_or(true);
        guard.insert(key, report);
        changed
    }
}

fn report_equals(a: &RuntimeHealthReport, b: &RuntimeHealthReport) -> bool {
    a.health == b.health
        && a.binary_path == b.binary_path
        && a.version == b.version
        && a.logged_in == b.logged_in
        && a.reason == b.reason
        && a.consecutive_failures == b.consecutive_failures
        && a.capabilities == b.capabilities
}

/// Negotiated capability flags for a given agent. Pure function so it can be
/// unit-tested without spawning a CLI.
pub fn negotiate_capabilities(
    agent: &str,
    binary_path: Option<&str>,
    version: Option<&str>,
    logged_in: bool,
) -> (HashMap<String, serde_json::Value>, Vec<String>) {
    let mut caps = HashMap::new();
    let mut unsupported = Vec::new();

    caps.insert(
        "binary_found".into(),
        serde_json::json!(binary_path.is_some()),
    );
    if let Some(v) = version {
        caps.insert("version".into(), serde_json::json!(v));
    }
    caps.insert("logged_in".into(), serde_json::json!(logged_in));

    match agent {
        "claude" => {
            caps.insert("stream_json".into(), serde_json::json!(true));
            caps.insert("mcp".into(), serde_json::json!(true));
            caps.insert("hooks".into(), serde_json::json!(true));
            caps.insert("permission_prompt".into(), serde_json::json!(true));
            if !logged_in {
                unsupported.push("login required for claude runtime".to_string());
            }
        }
        "codex" => {
            caps.insert("stream_json".into(), serde_json::json!(true));
            caps.insert("mcp".into(), serde_json::json!(true));
            caps.insert("permission_prompt".into(), serde_json::json!(true));
            if !logged_in {
                unsupported.push("codex login state unknown".to_string());
            }
        }
        "mimo" => {
            caps.insert("stream_json".into(), serde_json::json!(true));
        }
        "opencode" => {
            caps.insert("stream_json".into(), serde_json::json!(true));
        }
        "cursor" => {
            caps.insert("stream_json".into(), serde_json::json!(true));
        }
        other => {
            unsupported.push(format!("unknown provider '{other}'"));
        }
    }

    (caps, unsupported)
}

/// Build a `RuntimeHealthReport` for one agent. Synchronous — does not
/// actually spawn a process; instead it consults `which_binary` and parses
/// a `--version` flag if `binary_path` is provided. Heavier probing is the
/// caller's responsibility (so this stays unit-testable without a real CLI).
pub fn build_report(
    agent: &str,
    binary_path: Option<String>,
    version: Option<String>,
    logged_in: bool,
    reason: Option<String>,
    previous_failures: u32,
    succeeded: bool,
) -> RuntimeHealthReport {
    let (capabilities, unsupported) =
        negotiate_capabilities(agent, binary_path.as_deref(), version.as_deref(), logged_in);
    let now = now_iso();
    let health = match (binary_path.is_some(), logged_in, unsupported.is_empty()) {
        (false, _, _) => HealthState::Unhealthy,
        (true, true, true) => HealthState::Healthy,
        (true, false, true) => HealthState::Degraded,
        (true, _, false) => HealthState::Degraded,
    };
    let resolved_reason = match &reason {
        Some(r) => Some(r.clone()),
        None if !unsupported.is_empty() => Some(unsupported.join("; ")),
        None => None,
    };
    let consecutive_failures = if succeeded {
        0
    } else {
        previous_failures.saturating_add(1)
    };
    RuntimeHealthReport {
        agent: agent.to_string(),
        binary_path,
        version,
        logged_in,
        health,
        reason: resolved_reason,
        capabilities,
        last_successful_at: if succeeded { Some(now.clone()) } else { None },
        last_checked_at: Some(now),
        consecutive_failures,
    }
}

/// Resolve the binary path for an agent key without spawning it. Pure function.
pub fn resolve_binary(agent: &str) -> Option<String> {
    let bin = match agent {
        "claude" => "claude",
        "codex" => "codex",
        "mimo" | "mimocode" => "mimo",
        "opencode" => "opencode",
        "cursor" => "agent",
        _ => return None,
    };
    which_binary(bin)
}

/// Probe a single agent. Spawns `<bin> --version` with a 10s timeout and
/// inspects the augmented PATH so GUI-launched apps on macOS still find
/// user-installed CLI binaries.
pub async fn probe_agent(agent: &str) -> RuntimeHealthReport {
    let binary_path = resolve_binary(agent);
    let previous = RuntimeHealthReport::unknown(agent);
    let Some(path) = binary_path.clone() else {
        return build_report(
            agent,
            None,
            None,
            false,
            Some(format!("binary '{agent}' not found on PATH")),
            previous.consecutive_failures,
            false,
        );
    };

    let path_env = augmented_path();
    let probe_path = path.clone();
    let agent_label = agent.to_string();
    let outcome =
        tokio::task::spawn_blocking(move || run_version_probe(&probe_path, &path_env)).await;

    match outcome {
        Ok(Ok(version)) => {
            let logged_in = read_login_flag(agent, &path);
            build_report(
                &agent_label,
                Some(path),
                Some(version),
                logged_in,
                None,
                previous.consecutive_failures,
                true,
            )
        }
        Ok(Err(err)) => build_report(
            &agent_label,
            Some(path),
            None,
            false,
            Some(err),
            previous.consecutive_failures,
            false,
        ),
        Err(join_err) => build_report(
            &agent_label,
            Some(path),
            None,
            false,
            Some(format!("probe join error: {join_err}")),
            previous.consecutive_failures,
            false,
        ),
    }
}

fn run_version_probe(bin: &str, path_env: &str) -> Result<String, String> {
    use std::process::Command;
    use std::time::Duration;
    let child = Command::new(bin)
        .arg("--version")
        .env("PATH", path_env)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;
    let output = wait_with_timeout(child, Duration::from_secs(PROBE_TIMEOUT_SECS))?;
    if !output.status.success() {
        return Err(format!(
            "probe exited with status {:?}",
            output.status.code()
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        Err("empty version output".to_string())
    } else {
        Ok(trimmed.lines().next().unwrap_or(trimmed).to_string())
    }
}

fn wait_with_timeout(
    mut child: std::process::Child,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    use std::io::Read;
    use std::time::Instant;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stdout = Vec::new();
                let mut stderr = Vec::new();
                if let Some(mut s) = child.stdout.take() {
                    let _ = s.read_to_end(&mut stdout);
                }
                if let Some(mut s) = child.stderr.take() {
                    let _ = s.read_to_end(&mut stderr);
                }
                return Ok(std::process::Output {
                    status,
                    stdout,
                    stderr,
                });
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    return Err(format!("probe timed out after {:?}", timeout));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("try_wait failed: {e}")),
        }
    }
}

/// Best-effort login probe. We only inspect a couple of well-known auth
/// files so we don't depend on each CLI's flag surface. Returns false if
/// nothing looks configured.
fn read_login_flag(agent: &str, _binary_path: &str) -> bool {
    let home = match crate::storage::home_dir() {
        Some(h) => h,
        None => return false,
    };
    let home_path = std::path::Path::new(&home);
    let probe_files: &[&str] = match agent {
        "claude" => &[".claude.json", ".claude/.credentials.json"],
        "codex" => &[".codex/auth.json", ".codex/config.toml"],
        "mimo" => &[".mimo/auth.json"],
        "opencode" => &[".opencode/auth.json"],
        "cursor" => &[".cursor/auth.json"],
        _ => &[],
    };
    probe_files.iter().any(|rel| home_path.join(rel).exists())
}

/// Start the periodic health probe loop. Returns immediately; the loop runs
/// until the cancellation token fires. The first probe runs immediately so
/// the frontend gets a baseline snapshot without waiting a full interval.
pub fn spawn_probe_loop(
    store: RuntimeHealthStore,
    emitter: Arc<BroadcastEmitter>,
    interval_secs: u64,
    cancel: CancellationToken,
) {
    let interval = Duration::from_secs(interval_secs.max(30));
    tauri::async_runtime::spawn(async move {
        // Initial probe at startup
        if let Err(e) = run_round(&store, &emitter).await {
            log::warn!("[runtime-health] initial probe failed: {e}");
        }
        let mut ticker = tokio::time::interval(interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    log::debug!("[runtime-health] probe loop cancelled");
                    return;
                }
                _ = ticker.tick() => {
                    if let Err(e) = run_round(&store, &emitter).await {
                        log::warn!("[runtime-health] probe round failed: {e}");
                    }
                }
            }
        }
    });
}

async fn run_round(
    store: &RuntimeHealthStore,
    emitter: &Arc<BroadcastEmitter>,
) -> Result<(), String> {
    for agent in SUPPORTED_AGENTS {
        let report = probe_agent(agent).await;
        let changed = store.apply(report.clone()).await;
        if changed {
            emit_change(emitter, &report);
        }
    }
    Ok(())
}

fn emit_change(emitter: &Arc<BroadcastEmitter>, report: &RuntimeHealthReport) {
    let bus = BusEvent::RuntimeHealthChanged {
        agent: report.agent.clone(),
        health: report.health.as_str().to_string(),
        reason: report.reason.clone(),
        binary_path: report.binary_path.clone(),
        version: report.version.clone(),
        logged_in: report.logged_in,
        timestamp_ms: crate::models::now_epoch_ms(),
    };
    // The probe loop has no specific run_id; emit a synthetic per-agent
    // channel so listeners get the right routing.
    emitter.emit_realtime("runtime_health_changed", &bus, Some(&report.agent));
    // Persist through the bus-event A-class channel for replay
    let synthetic_run_id = format!("runtime-health:{}", report.agent);
    emitter.persist_and_emit(&synthetic_run_id, &bus);
}

/// Convenience: convert an `AgentRuntimeKind` to its canonical agent key.
pub fn agent_key(kind: AgentRuntimeKind) -> &'static str {
    match kind {
        AgentRuntimeKind::ClaudeCode => "claude",
        AgentRuntimeKind::Codex => "codex",
        AgentRuntimeKind::MiMoCode => "mimo",
        AgentRuntimeKind::OpenCode => "opencode",
        AgentRuntimeKind::Cursor => "cursor",
    }
}

/// Read the configured CliAccount presence for an agent, used as a quick
/// hint for `logged_in`. Independent from disk probing.
pub fn is_account_configured(account: Option<&CliAccount>) -> bool {
    account.is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_state_as_str_round_trip() {
        assert_eq!(HealthState::Healthy.as_str(), "healthy");
        assert_eq!(HealthState::Degraded.as_str(), "degraded");
        assert_eq!(HealthState::Unhealthy.as_str(), "unhealthy");
    }

    #[test]
    fn negotiate_caps_claude_requires_login() {
        let (caps, unsupported) =
            negotiate_capabilities("claude", Some("/bin/claude"), None, false);
        assert_eq!(caps.get("binary_found"), Some(&serde_json::json!(true)));
        assert_eq!(caps.get("stream_json"), Some(&serde_json::json!(true)));
        assert_eq!(caps.get("logged_in"), Some(&serde_json::json!(false)));
        assert!(!unsupported.is_empty());
    }

    #[test]
    fn negotiate_caps_known_provider_logged_in() {
        let (caps, unsupported) =
            negotiate_capabilities("claude", Some("/bin/claude"), Some("1.2.3"), true);
        assert!(unsupported.is_empty());
        assert_eq!(caps.get("version"), Some(&serde_json::json!("1.2.3")));
        assert_eq!(caps.get("logged_in"), Some(&serde_json::json!(true)));
    }

    #[test]
    fn negotiate_caps_unknown_provider_marks_unsupported() {
        let (_, unsupported) = negotiate_capabilities("wat", Some("/bin/wat"), None, false);
        assert!(!unsupported.is_empty());
    }

    #[test]
    fn build_report_missing_binary_unhealthy() {
        let report = build_report("claude", None, None, false, None, 0, false);
        assert_eq!(report.health, HealthState::Unhealthy);
        assert_eq!(report.consecutive_failures, 1);
        assert!(report.reason.is_some());
        assert!(report.binary_path.is_none());
    }

    #[test]
    fn build_report_login_but_no_binary_path_is_degraded() {
        let report = build_report(
            "claude",
            Some("/bin/claude".into()),
            None,
            false,
            None,
            0,
            false,
        );
        assert_eq!(report.health, HealthState::Degraded);
        assert!(report.reason.is_some());
    }

    #[test]
    fn build_report_healthy_path_and_login() {
        let report = build_report(
            "claude",
            Some("/bin/claude".into()),
            Some("1.0".into()),
            true,
            None,
            0,
            true,
        );
        assert_eq!(report.health, HealthState::Healthy);
        assert!(report.reason.is_none());
        assert_eq!(report.consecutive_failures, 0);
        assert!(report.last_successful_at.is_some());
    }

    #[test]
    fn build_report_failure_increments_counter() {
        let r1 = build_report("claude", None, None, false, None, 0, false);
        let r2 = build_report(
            "claude",
            None,
            None,
            false,
            None,
            r1.consecutive_failures,
            false,
        );
        assert_eq!(r2.consecutive_failures, 2);
        let r3 = build_report(
            "claude",
            Some("/bin/claude".into()),
            Some("1".into()),
            true,
            None,
            r2.consecutive_failures,
            true,
        );
        assert_eq!(r3.consecutive_failures, 0);
    }

    #[test]
    fn resolve_binary_unknown_returns_none() {
        assert!(resolve_binary("nonexistent-binary").is_none());
    }

    #[test]
    fn agent_key_round_trip() {
        for kind in [
            AgentRuntimeKind::ClaudeCode,
            AgentRuntimeKind::Codex,
            AgentRuntimeKind::MiMoCode,
            AgentRuntimeKind::OpenCode,
            AgentRuntimeKind::Cursor,
        ] {
            let key = agent_key(kind);
            assert!(SUPPORTED_AGENTS.contains(&key));
        }
    }

    #[tokio::test]
    async fn store_apply_and_diff() {
        let store = RuntimeHealthStore::new();
        let r1 = build_report("claude", None, None, false, None, 0, false);
        assert!(store.apply(r1.clone()).await);
        // Same content — apply should report no change.
        assert!(!store.apply(r1.clone()).await);
        // Changing the health bucket should report a change.
        let mut r2 = r1.clone();
        r2.health = HealthState::Healthy;
        assert!(store.apply(r2).await);
        let snapshot = store.snapshot().await;
        let claude = snapshot
            .providers
            .iter()
            .find(|p| p.agent == "claude")
            .unwrap();
        assert_eq!(claude.health, HealthState::Healthy);
    }

    #[tokio::test]
    async fn snapshot_initial_state_unknown() {
        let store = RuntimeHealthStore::new();
        let snapshot = store.snapshot().await;
        for agent in SUPPORTED_AGENTS {
            let p = snapshot
                .providers
                .iter()
                .find(|p| p.agent == *agent)
                .unwrap();
            assert_eq!(p.health, HealthState::Unhealthy);
            assert!(p.last_checked_at.is_none());
        }
        assert!(snapshot.last_checked_at.is_none());
    }

    #[test]
    fn report_equals_detects_field_changes() {
        let a = build_report(
            "claude",
            Some("/bin/claude".into()),
            Some("1".into()),
            true,
            None,
            0,
            true,
        );
        let mut b = a.clone();
        b.version = Some("2".into());
        assert!(!report_equals(&a, &b));
        let mut c = a.clone();
        c.health = HealthState::Degraded;
        assert!(!report_equals(&a, &c));
    }

    #[test]
    fn is_account_configured_basics() {
        let none: Option<CliAccount> = None;
        assert!(!is_account_configured(none.as_ref()));
        let some = Some(CliAccount {
            token_source: "anthropic".into(),
            extra: Default::default(),
        });
        assert!(is_account_configured(some.as_ref()));
    }
}
