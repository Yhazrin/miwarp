use crate::agent::control::{self, CliInfoCache};
use crate::models::CliInfo;
use tauri::State;

#[tauri::command]
pub async fn get_cli_info(
    cache: State<'_, CliInfoCache>,
    force_refresh: Option<bool>,
    agent: Option<String>,
) -> Result<CliInfo, String> {
    log::debug!(
        "[control] get_cli_info IPC, agent={:?}, force={}",
        agent,
        force_refresh.unwrap_or(false),
    );
    let runtime_kind = agent
        .as_deref()
        .map(crate::models::AgentRuntimeKind::from_agent)
        .unwrap_or_default();
    match control::get_cli_info(&cache, agent.as_deref(), force_refresh.unwrap_or(false)).await {
        Ok(info) => Ok(info),
        Err(e) => {
            log::warn!(
                "[control] CLI info failed ({}): {}, using fallback",
                e.code,
                e.message
            );
            Ok(control::fallback_cli_info_for(&runtime_kind))
        }
    }
}
