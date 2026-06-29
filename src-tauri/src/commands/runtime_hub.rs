use crate::agent::control_plane::config_transaction::{
    ConfigTransactionPreview, ConfigTransactionResult,
};
use crate::agent::control_plane::{
    ConfigWatchEvent, RuntimeControlPlane, RuntimeControlPlaneList, RuntimeHubDiagnoseResponse,
    RuntimeHubHealthResponse,
};
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[derive(Clone)]
pub struct RuntimeControlPlaneState(pub Arc<RuntimeControlPlane>);

impl Default for RuntimeControlPlaneState {
    fn default() -> Self {
        Self(Arc::new(RuntimeControlPlane::new()))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfigWatchPayload {
    pub event: ConfigWatchEvent,
}

#[tauri::command]
pub async fn runtime_hub_list(
    state: State<'_, RuntimeControlPlaneState>,
    force: Option<bool>,
) -> Result<RuntimeControlPlaneList, String> {
    let control_plane = state.0.clone();
    let force = force.unwrap_or(false);
    tokio::task::spawn_blocking(move || control_plane.list(force))
        .await
        .map_err(|e| format!("runtime list task failed: {e}"))
}

#[tauri::command]
pub fn runtime_hub_health(
    state: State<'_, RuntimeControlPlaneState>,
    runtime_id: String,
    force: Option<bool>,
) -> Result<RuntimeHubHealthResponse, String> {
    state.0.health(&runtime_id, force.unwrap_or(false))
}

#[tauri::command]
pub fn runtime_hub_diagnose(
    state: State<'_, RuntimeControlPlaneState>,
    runtime_id: String,
) -> Result<RuntimeHubDiagnoseResponse, String> {
    state.0.diagnose(&runtime_id)
}

#[tauri::command]
pub fn runtime_hub_set_default(
    state: State<'_, RuntimeControlPlaneState>,
    runtime_id: String,
) -> Result<String, String> {
    state.0.set_default(&runtime_id)
}

#[tauri::command]
pub fn runtime_hub_preview_config(
    state: State<'_, RuntimeControlPlaneState>,
    runtime_id: String,
    patch: Value,
) -> Result<ConfigTransactionPreview, String> {
    state.0.preview_config(&runtime_id, patch)
}

#[tauri::command]
pub fn runtime_hub_apply_config(
    state: State<'_, RuntimeControlPlaneState>,
    runtime_id: String,
    patch: Value,
) -> Result<ConfigTransactionResult, String> {
    state.0.apply_config(&runtime_id, patch)
}

#[tauri::command]
pub fn runtime_hub_start_config_watch(
    app: AppHandle,
    state: State<'_, RuntimeControlPlaneState>,
    runtime_id: String,
) -> Result<u64, String> {
    let app_handle = app.clone();
    let runtime_id_for_cb = runtime_id.clone();
    state.0.watch_config(
        &runtime_id,
        Arc::new(move |event| {
            let payload = RuntimeConfigWatchPayload { event };
            let _ = app_handle.emit("runtime-config-changed", payload);
            let _ = runtime_id_for_cb;
        }),
    )
}

#[tauri::command]
pub fn runtime_hub_stop_config_watch(
    state: State<'_, RuntimeControlPlaneState>,
    runtime_id: String,
) -> Result<bool, String> {
    Ok(state.0.unwatch_config(&runtime_id))
}
