use crate::models::{
    normalize_session_island_alignment, normalize_workspace_folder_sort_order, UserSettings,
};

use super::core::{load, save};

pub fn get_user_settings() -> UserSettings {
    let mut user = load().user;
    let normalized = normalize_session_island_alignment(&user.session_island_alignment);
    if user.session_island_alignment != normalized {
        user.session_island_alignment = normalized;
    }
    user
}

/// Save web server config fields. Called by restart_with_config on success.
pub fn save_web_server_config(
    enabled: bool,
    port: u16,
    bind: &str,
    allowed_origins: &Option<Vec<String>>,
    tunnel_url: &Option<String>,
) -> Result<(), String> {
    let mut all = load();
    all.user.web_server_enabled = Some(enabled);
    all.user.web_server_port = Some(port);
    all.user.web_server_bind = Some(bind.to_string());
    all.user.web_server_allowed_origins = allowed_origins.clone();
    all.user.web_server_tunnel_url = tunnel_url.clone();
    all.user.updated_at = crate::models::now_iso();
    save(&all)?;
    log::debug!(
        "[storage/settings] web_server config saved: enabled={}, port={}, bind={}, tunnel={:?}",
        enabled,
        port,
        bind,
        tunnel_url,
    );
    Ok(())
}

/// Set only web_server_enabled, preserving all other web server fields.
pub fn set_web_server_enabled(enabled: bool) -> Result<(), String> {
    let mut all = load();
    all.user.web_server_enabled = Some(enabled);
    all.user.updated_at = crate::models::now_iso();
    save(&all)?;
    log::debug!("[storage/settings] web_server_enabled set to {}", enabled);
    Ok(())
}

/// Partial disable: only set enabled=false, never touch other web server fields.
/// Used by the disable path to ensure disable always succeeds regardless of form state.
pub fn save_web_server_partial_disable() -> Result<(), String> {
    let mut all = load();
    all.user.web_server_enabled = Some(false);
    all.user.updated_at = crate::models::now_iso();
    save(&all)?;
    log::debug!("[storage/settings] web_server partial disable saved");
    Ok(())
}

pub(super) fn validate_ui_zoom(v: &serde_json::Value) -> Result<Option<f64>, String> {
    if v.is_null() {
        return Ok(None);
    }
    let f = v
        .as_f64()
        .ok_or_else(|| "ui_zoom must be a number".to_string())?;
    if !(0.75..=1.5).contains(&f) {
        return Err(format!("ui_zoom must be between 0.75 and 1.5, got {}", f));
    }
    Ok(Some(f))
}

/// v1.0.6 follow-up: reset all user settings to defaults.
/// Returns `(old, new)` so the command layer can diff and rotate the web
/// server token if it was cleared by the reset.
pub fn reset_user_settings() -> Result<(UserSettings, UserSettings), String> {
    let mut all = load();
    let old = all.user.clone();
    all.user = UserSettings::default();
    save(&all)?;
    log::info!("[storage/settings] user settings reset to defaults");
    Ok((old, all.user))
}

/// v1.x.x: reset ONLY the personal-profile subset of `UserSettings` — identity,
/// AI preferences, default session mode, notification prefs, and UI zoom. All
/// credential-bearing fields (api keys, platform credentials, remote hosts,
/// webhook URLs, web server config, keybindings, workspace folders) are
/// preserved verbatim. Returns `(old, new)` for symmetry with the global
/// reset so the command layer can audit the diff if needed.
///
/// Pure helper: takes a `UserSettings` by value, applies the personal-field
/// defaults, and returns the patched value. The caller (`reset_personal_profile`)
/// is responsible for persistence.
pub fn apply_personal_profile_reset(mut settings: UserSettings) -> UserSettings {
    let defaults = UserSettings::default();

    // Identity — only the fields the backend actually persists.
    settings.user_display_name = defaults.user_display_name;
    settings.user_role = defaults.user_role;
    settings.user_timezone = defaults.user_timezone;

    // AI preferences — defaults match `UserSettings::default()` for the runtime
    // CLI choice ("claude") and unset model selection.
    settings.default_agent = defaults.default_agent;
    settings.default_model = defaults.default_model;
    settings.fallback_model = defaults.fallback_model;

    // Default session mode — restore the per-user default.
    settings.default_session_mode = defaults.default_session_mode;

    // Notification prefs — wipe the per-flag overrides so the OS-level defaults
    // are consulted again. `None` is the canonical "follow system default"
    // sentinel; do NOT set them to `Some(false)` (that would suppress the
    // notification even when the user has them enabled at the OS level).
    settings.notifications_enabled = defaults.notifications_enabled;
    settings.notify_on_run_completed = defaults.notify_on_run_completed;
    settings.notify_on_run_failed = defaults.notify_on_run_failed;
    settings.notify_on_approval_required = defaults.notify_on_approval_required;
    settings.notify_on_schedule_completed = defaults.notify_on_schedule_completed;
    settings.notify_on_team_completed = defaults.notify_on_team_completed;

    // Display prefs.
    settings.ui_zoom = defaults.ui_zoom;

    settings.updated_at = crate::models::now_iso();
    settings
}

/// Reset only the personal-profile fields on the persisted `UserSettings`.
/// Returns `(old, new)`. The personal fields are patched; every other field
/// (api keys, platform credentials, remote hosts, webhook URLs, web server
/// config / token, keybindings, workspace folders, etc.) is left untouched.
pub fn reset_personal_profile() -> Result<(UserSettings, UserSettings), String> {
    let mut all = load();
    let old = all.user.clone();
    let new_user = apply_personal_profile_reset(all.user.clone());
    all.user = new_user;
    save(&all)?;
    log::info!(
        "[storage/settings] personal profile reset (api_key preserved={}, platform_credentials={}, remote_hosts={}, webhooks_enabled={}, web_server_token_present={})",
        old.anthropic_api_key.is_some(),
        old.platform_credentials.len(),
        old.remote_hosts.len(),
        old.feishu_webhook_enabled,
        old.web_server_token.is_some(),
    );
    Ok((old, all.user))
}

pub fn update_user_settings(patch: serde_json::Value) -> Result<UserSettings, String> {
    let mut all = load();
    if let Some(agent) = patch.get("default_agent").and_then(|v| v.as_str()) {
        all.user.default_agent = agent.to_string();
    }
    if let Some(model) = patch.get("default_model") {
        all.user.default_model = model.as_str().map(|s| s.to_string());
    }
    if let Some(tools) = patch.get("allowed_tools").and_then(|v| v.as_array()) {
        all.user.allowed_tools = tools
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
    }
    if let Some(wd) = patch.get("working_directory") {
        all.user.working_directory = wd.as_str().map(|s| s.to_string());
    }
    if let Some(mode) = patch.get("provider_mode").and_then(|v| v.as_str()) {
        all.user.provider_mode = mode.to_string();
    }
    if let Some(mode) = patch.get("auth_mode").and_then(|v| v.as_str()) {
        all.user.auth_mode = mode.to_string();
    }
    if let Some(key) = patch.get("anthropic_api_key") {
        all.user.anthropic_api_key = key
            .as_str()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
    }
    if let Some(url) = patch.get("anthropic_base_url") {
        all.user.anthropic_base_url = url
            .as_str()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
    }
    if let Some(v) = patch.get("auth_env_var") {
        all.user.auth_env_var = v.as_str().filter(|s| !s.is_empty()).map(|s| s.to_string());
    }
    if let Some(mode) = patch.get("permission_mode").and_then(|v| v.as_str()) {
        all.user.permission_mode = mode.to_string();
    }
    if let Some(v) = patch.get("max_budget_usd") {
        all.user.max_budget_usd = if v.is_null() { None } else { v.as_f64() };
    }
    if let Some(v) = patch.get("fallback_model") {
        all.user.fallback_model = if v.is_null() {
            None
        } else {
            v.as_str().filter(|s| !s.is_empty()).map(|s| s.to_string())
        };
    }
    if let Some(v) = patch.get("keybinding_overrides") {
        if v.is_null() {
            all.user.keybinding_overrides = vec![];
        } else {
            all.user.keybinding_overrides = serde_json::from_value(v.clone())
                .map_err(|e| format!("Invalid keybinding_overrides: {}", e))?;
        }
    }
    if let Some(v) = patch.get("remote_hosts") {
        if v.is_null() {
            all.user.remote_hosts = vec![];
        } else {
            all.user.remote_hosts = serde_json::from_value(v.clone())
                .map_err(|e| format!("Invalid remote_hosts: {}", e))?;
        }
    }
    if let Some(v) = patch.get("platform_credentials") {
        if v.is_null() {
            all.user.platform_credentials = vec![];
        } else {
            all.user.platform_credentials = serde_json::from_value(v.clone())
                .map_err(|e| format!("Invalid platform_credentials: {}", e))?;
        }
    }
    if let Some(v) = patch.get("active_platform_id") {
        all.user.active_platform_id = if v.is_null() {
            None
        } else {
            v.as_str().filter(|s| !s.is_empty()).map(|s| s.to_string())
        };
    }
    if let Some(v) = patch.get("ui_zoom") {
        all.user.ui_zoom = validate_ui_zoom(v)?;
        log::debug!("[storage/settings] ui_zoom patched: {:?}", all.user.ui_zoom);
    }
    if let Some(v) = patch.get("onboarding_completed") {
        all.user.onboarding_completed = v.as_bool().unwrap_or(false);
    }
    // Notification settings
    if let Some(v) = patch.get("notifications_enabled") {
        all.user.notifications_enabled = v.as_bool();
    }
    if let Some(v) = patch.get("notify_on_run_completed") {
        all.user.notify_on_run_completed = v.as_bool();
    }
    if let Some(v) = patch.get("notify_on_run_failed") {
        all.user.notify_on_run_failed = v.as_bool();
    }
    if let Some(v) = patch.get("notify_on_approval_required") {
        all.user.notify_on_approval_required = v.as_bool();
    }
    if let Some(v) = patch.get("notify_on_schedule_completed") {
        all.user.notify_on_schedule_completed = v.as_bool();
    }
    if let Some(v) = patch.get("notify_on_team_completed") {
        all.user.notify_on_team_completed = v.as_bool();
    }
    if let Some(v) = patch.get("notification_min_duration_sec") {
        all.user.notification_min_duration_sec = v.as_u64().map(|n| n as u32);
    }
    if let Some(v) = patch.get("sound_feedback_level") {
        if let Some(s) = v.as_str() {
            let level = s.trim();
            if matches!(level, "off" | "minimal" | "standard" | "detailed") {
                all.user.sound_feedback_level = level.to_string();
            }
        }
    }
    // Feishu webhook settings
    if let Some(v) = patch.get("feishu_webhook_url") {
        all.user.feishu_webhook_url = if v.is_null() {
            None
        } else {
            v.as_str().filter(|s| !s.is_empty()).map(|s| s.to_string())
        };
    }
    if let Some(v) = patch.get("feishu_webhook_enabled") {
        all.user.feishu_webhook_enabled = v.as_bool().unwrap_or(false);
    }
    if let Some(v) = patch.get("feishu_webhook_triggers") {
        if v.is_null() {
            all.user.feishu_webhook_triggers = vec![];
        } else {
            all.user.feishu_webhook_triggers = serde_json::from_value(v.clone())
                .map_err(|e| format!("Invalid feishu_webhook_triggers: {}", e))?;
        }
    }
    if let Some(v) = patch.get("feishu_webhook_template") {
        all.user.feishu_webhook_template = if v.is_null() {
            None
        } else {
            v.as_str().filter(|s| !s.is_empty()).map(|s| s.to_string())
        };
    }
    if let Some(v) = patch.get("show_token_usage_report") {
        all.user.show_token_usage_report = v.as_bool().unwrap_or(true);
    }
    if let Some(v) = patch.get("mascot_enabled") {
        all.user.mascot_enabled = v.as_bool().unwrap_or(true);
    }
    if let Some(v) = patch.get("icon_rail_enabled") {
        all.user.icon_rail_enabled = v.as_bool().unwrap_or(true);
    }
    if let Some(v) = patch.get("cli_auto_sync_enabled") {
        all.user.cli_auto_sync_enabled = v.as_bool().unwrap_or(true);
    }
    if let Some(v) = patch.get("cli_auto_sync_interval_minutes") {
        if let Some(n) = v.as_u64() {
            all.user.cli_auto_sync_interval_minutes = (n as u32).clamp(1, 120);
        }
    }
    if let Some(v) = patch.get("cli_auto_sync_import_new") {
        all.user.cli_auto_sync_import_new = v.as_bool().unwrap_or(false);
    }
    if let Some(v) = patch.get("app_auto_update_check_enabled") {
        all.user.app_auto_update_check_enabled = v.as_bool().unwrap_or(true);
    }
    if let Some(v) = patch.get("native_window_glass_enabled") {
        all.user.native_window_glass_enabled = v.as_bool().unwrap_or(true);
    }
    if let Some(v) = patch
        .get("native_window_glass_material")
        .and_then(|v| v.as_str())
    {
        if matches!(v, "header_view" | "sidebar") {
            all.user.native_window_glass_material = v.to_string();
        }
    }
    if let Some(v) = patch.get("process_visibility").and_then(|v| v.as_str()) {
        if matches!(v, "output" | "guided" | "developer" | "expert") {
            all.user.process_visibility = v.to_string();
        }
    }
    if let Some(v) = patch
        .get("visual_performance_mode")
        .and_then(|v| v.as_str())
    {
        if matches!(v, "auto" | "quality" | "balanced" | "performance") {
            all.user.visual_performance_mode = v.to_string();
        }
    }
    if let Some(v) = patch
        .get("session_island_alignment")
        .and_then(|v| v.as_str())
    {
        all.user.session_island_alignment = normalize_session_island_alignment(v);
    }
    if let Some(v) = patch
        .get("workspace_folder_sort_order")
        .and_then(|v| v.as_str())
    {
        all.user.workspace_folder_sort_order = normalize_workspace_folder_sort_order(v);
    }
    if let Some(v) = patch.get("session_status_colors") {
        if v.is_null() {
            all.user.session_status_colors = None;
        } else {
            match serde_json::from_value::<crate::models::SessionStatusColors>(v.clone()) {
                Ok(colors) => {
                    all.user.session_status_colors = Some(colors);
                }
                Err(e) => {
                    log::warn!("[storage/settings] invalid session_status_colors: {}", e);
                }
            }
        }
    }
    all.user.updated_at = crate::models::now_iso();
    save(&all)?;
    Ok(all.user)
}
