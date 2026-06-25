//! IPC commands for the Resource Governor (110-S5).

use crate::governor::{
    ActiveRun, GovernorConfig, GovernorConfigUpdate, GovernorSnapshot, ResourceGovernor,
};

/// Read the current governor configuration.
#[tauri::command]
pub async fn governor_get_config(
    governor: tauri::State<'_, ResourceGovernor>,
) -> Result<GovernorConfig, String> {
    Ok(governor.config().await)
}

/// Update the governor configuration. Any `None` field in the request is
/// preserved from the current configuration.
#[tauri::command]
pub async fn governor_update_config(
    update: GovernorConfigUpdate,
    governor: tauri::State<'_, ResourceGovernor>,
) -> Result<GovernorConfig, String> {
    Ok(governor.update_config(update).await)
}

/// List active runs currently held by the governor.
#[tauri::command]
pub async fn governor_active_runs(
    governor: tauri::State<'_, ResourceGovernor>,
) -> Result<Vec<ActiveRun>, String> {
    let snap = governor.snapshot().await;
    Ok(snap.active_runs)
}

/// Read the full governor snapshot (config + active runs + timestamp).
#[tauri::command]
pub async fn governor_snapshot(
    governor: tauri::State<'_, ResourceGovernor>,
) -> Result<GovernorSnapshot, String> {
    Ok(governor.snapshot().await)
}

#[cfg(test)]
mod tests {
    use crate::governor::{GovernorConfigUpdate, ResourceGovernor};

    #[tokio::test]
    async fn snapshot_via_state_returns_active_runs() {
        let g = ResourceGovernor::with_emitter(None);
        g.register_run("r1", Some(1)).await;
        let snap = g.snapshot().await;
        assert_eq!(snap.active_runs.len(), 1);
        assert_eq!(snap.active_runs[0].run_id, "r1");
    }

    #[tokio::test]
    async fn update_via_partial_payload_preserves_other_fields() {
        let g = ResourceGovernor::with_emitter(None);
        let new_cfg = g
            .update_config(GovernorConfigUpdate {
                max_concurrent_runs: Some(2),
                max_memory_bytes: None,
                probe_interval_secs: None,
            })
            .await;
        assert_eq!(new_cfg.max_concurrent_runs, 2);
        // Default values preserved
        assert!(new_cfg.max_memory_bytes > 0);
        assert!(new_cfg.probe_interval_secs > 0);
    }
}
