//! IPC commands for the runtime health probe (110-A4 Capability Matrix).
//!
//! Exposes the cached health snapshot to the frontend and lets the UI force a
//! fresh probe (e.g. after the user logs in or out of a provider). All
//! commands are read-only w.r.t. the CLI process; the probe loop owns
//! mutation of the underlying store.

use crate::agent::runtime_health::{probe_agent, RuntimeHealthSnapshot, RuntimeHealthStore};
use crate::web_server::broadcaster::BroadcastEmitter;
use std::sync::Arc;
use tauri::State;

/// Read the current health snapshot. Always returns cached state — never
/// spawns a CLI. Use `runtime_health_probe_now` to force a fresh probe.
#[tauri::command]
pub async fn runtime_health_get(
    store: State<'_, RuntimeHealthStore>,
) -> Result<RuntimeHealthSnapshot, String> {
    Ok(store.snapshot().await)
}

/// Force a fresh probe for one agent (or all known agents when `agent` is
/// None). Updates the in-process store and emits `BusEvent::RuntimeHealthChanged`
/// if the new state differs from the previous one.
#[tauri::command]
pub async fn runtime_health_probe_now(
    agent: Option<String>,
    store: State<'_, RuntimeHealthStore>,
    emitter: State<'_, Arc<BroadcastEmitter>>,
) -> Result<RuntimeHealthSnapshot, String> {
    let agents: Vec<String> = match agent {
        Some(a) if !a.trim().is_empty() => vec![a],
        _ => crate::agent::runtime_health::supported_agents()
            .iter()
            .map(|s| s.to_string())
            .collect(),
    };

    for agent_key in agents {
        let report = probe_agent(&agent_key).await;
        let changed = store.apply(report.clone()).await;
        if changed {
            let bus = crate::models::BusEvent::RuntimeHealthChanged {
                agent: report.agent.clone(),
                health: report.health.as_str().to_string(),
                reason: report.reason.clone(),
                binary_path: report.binary_path.clone(),
                version: report.version.clone(),
                logged_in: report.logged_in,
                timestamp_ms: crate::models::now_epoch_ms(),
            };
            let synthetic_run_id = format!("runtime-health:{}", report.agent);
            emitter.persist_and_emit(&synthetic_run_id, &bus);
        }
    }

    Ok(store.snapshot().await)
}

#[cfg(test)]
mod tests {
    use crate::agent::runtime_health::RuntimeHealthStore;
    use crate::agent::runtime_health::{build_report, HealthState, SUPPORTED_AGENTS};

    #[tokio::test]
    async fn store_starts_empty_per_agent() {
        let store = RuntimeHealthStore::new();
        let snapshot = store.snapshot().await;
        for agent in SUPPORTED_AGENTS {
            let p = snapshot
                .providers
                .iter()
                .find(|p| p.agent == *agent)
                .expect("agent must be present");
            assert_eq!(p.health, HealthState::Unhealthy);
            assert!(p.last_checked_at.is_none());
        }
    }

    #[tokio::test]
    async fn store_apply_persists_last_checked_at() {
        let store = RuntimeHealthStore::new();
        let report = build_report(
            "claude",
            Some("/bin/claude".into()),
            Some("1".into()),
            true,
            None,
            0,
            true,
        );
        store.apply(report).await;
        let snapshot = store.snapshot().await;
        let claude = snapshot
            .providers
            .iter()
            .find(|p| p.agent == "claude")
            .unwrap();
        assert!(claude.last_checked_at.is_some());
        assert!(snapshot.last_checked_at.is_some());
    }

    #[test]
    fn supported_agents_includes_claude_and_codex() {
        assert!(SUPPORTED_AGENTS.contains(&"claude"));
        assert!(SUPPORTED_AGENTS.contains(&"codex"));
    }
}
