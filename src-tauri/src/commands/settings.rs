use crate::models::{AgentSettings, UserSettings};
use crate::storage;
use std::sync::atomic::Ordering;

/// Shared logic for updating user settings with token rotation detection.
/// Used by both IPC (Tauri command) and WS (dispatch) paths.
pub async fn update_user_settings_with_rotation(
    patch: serde_json::Value,
    token_ver: &std::sync::atomic::AtomicU64,
    shutdown: &tokio::sync::broadcast::Sender<()>,
    live_token: &tokio::sync::RwLock<String>,
) -> Result<UserSettings, String> {
    let old = storage::settings::get_user_settings();
    let new_settings = storage::settings::update_user_settings(patch)?;
    if old.web_server_token != new_settings.web_server_token {
        match &new_settings.web_server_token {
            Some(new_tok) => *live_token.write().await = new_tok.clone(),
            None => *live_token.write().await = String::new(),
        }
        token_ver.fetch_add(1, Ordering::Relaxed);
        log::debug!("[web_server] token rotated, updating in-memory + disconnecting WS clients");
        let _ = shutdown.send(());
    }
    Ok(new_settings)
}

#[tauri::command]
pub fn get_user_settings() -> UserSettings {
    log::debug!("[settings] get_user_settings");
    storage::settings::get_user_settings()
}

#[tauri::command]
pub async fn update_user_settings(
    app: tauri::AppHandle,
    patch: serde_json::Value,
    token_ver: tauri::State<'_, crate::SharedTokenVersion>,
    shutdown: tauri::State<'_, crate::WsShutdownSender>,
    live_token: tauri::State<'_, crate::SharedLiveToken>,
) -> Result<UserSettings, String> {
    log::debug!("[settings] update_user_settings");
    let result =
        update_user_settings_with_rotation(patch, &token_ver, &shutdown, &live_token).await?;
    // v1.0.6 follow-up: re-apply native window blur when the user toggles
    // the glass effect. The dispatch.rs WS path is a no-op for the visual
    // (only the desktop process owns the window), so we handle it here.
    crate::window_effect::apply_for_setting(&app);
    Ok(result)
}

#[tauri::command]
pub fn get_agent_settings(agent: String) -> AgentSettings {
    log::debug!("[settings] get_agent_settings: agent={}", agent);
    storage::settings::get_agent_settings(&agent)
}

/// v1.0.6 follow-up: reset all user settings to defaults.
/// If the prior settings held a web server token and the reset cleared it,
/// rotate the live token state so stale clients can no longer authenticate.
#[tauri::command]
pub async fn reset_user_settings(
    token_ver: tauri::State<'_, crate::SharedTokenVersion>,
    shutdown: tauri::State<'_, crate::WsShutdownSender>,
    live_token: tauri::State<'_, crate::SharedLiveToken>,
) -> Result<UserSettings, String> {
    log::info!("[settings] reset_user_settings");
    let (old_settings, new_settings) = storage::settings::reset_user_settings()?;
    if old_settings.web_server_token != new_settings.web_server_token {
        match &new_settings.web_server_token {
            Some(tok) => *live_token.write().await = tok.clone(),
            None => *live_token.write().await = String::new(),
        }
        token_ver.fetch_add(1, Ordering::Relaxed);
        let _ = shutdown.send(());
    }
    Ok(new_settings)
}

/// Reset only the personal-profile subset of `UserSettings` — identity
/// (display name / role / timezone), AI preferences (default agent + models),
/// default session mode, notification prefs, and UI zoom. The Personal page
/// uses this so clicking "Reset profile" never wipes API keys, platform
/// credentials, remote hosts, webhook URLs, web server config / token,
/// keybindings, or workspace folders.
#[tauri::command]
pub fn reset_personal_profile() -> Result<UserSettings, String> {
    log::info!("[settings] reset_personal_profile");
    let (_old, new_settings) = storage::settings::reset_personal_profile()?;
    Ok(new_settings)
}

#[tauri::command]
pub fn update_agent_settings(
    agent: String,
    patch: serde_json::Value,
) -> Result<AgentSettings, String> {
    log::debug!("[settings] update_agent_settings: agent={}", agent);
    storage::settings::update_agent_settings(&agent, patch)
}

/// Detect MiMo-Code availability and version.
/// Returns (available, binary_path, version).
#[tauri::command]
pub fn detect_mimo_runtime() -> Result<(bool, String, Option<String>), String> {
    use crate::agent::runtime::{detect_mimo_version, resolve_mimo_binary};

    let binary = resolve_mimo_binary();
    let version = detect_mimo_version(&binary);
    let available = version.is_some();
    Ok((available, binary, version))
}
