use crate::models::{
    normalize_session_island_alignment, normalize_workspace_folder_sort_order, AgentSettings,
    AllSettings, UserSettings,
};
use std::fs;
use std::path::{Path, PathBuf};

fn settings_path() -> PathBuf {
    super::data_dir().join("settings.json")
}

/// Back up a corrupt settings file to `settings.json.corrupt.<timestamp>`.
/// Returns the backup path on success so the caller can log it.
fn backup_corrupt_file(path: &Path) -> Option<PathBuf> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let backup = path.with_extension(format!("json.corrupt.{ts}"));
    match fs::rename(path, &backup) {
        Ok(()) => {
            log::warn!(
                "[storage/settings] corrupt file backed up to {}",
                backup.display()
            );
            Some(backup)
        }
        Err(e) => {
            log::error!(
                "[storage/settings] failed to back up corrupt file {}: {}",
                path.display(),
                e
            );
            None
        }
    }
}

fn load_from_path(path: &Path) -> AllSettings {
    match fs::read_to_string(path) {
        Ok(content) => match serde_json::from_str::<AllSettings>(&content) {
            Ok(mut settings) => {
                log::debug!("[storage/settings] loaded settings from {}", path.display());
                // Run one-time migrations on platform credentials
                if migrate_platform_credentials(&mut settings) {
                    log::info!("[storage/settings] migrated platform credentials, saving");
                    let _ = save_to_path(&settings, path);
                }
                if migrate_session_island_alignment(&mut settings) {
                    log::info!("[storage/settings] normalized session_island_alignment, saving");
                    let _ = save_to_path(&settings, path);
                }
                settings
            }
            Err(e) => {
                log::warn!(
                    "[storage/settings] failed to parse settings: {}; using defaults (original preserved)",
                    e
                );
                backup_corrupt_file(path);
                AllSettings::default()
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            log::debug!("[storage/settings] settings file not found, using defaults");
            AllSettings::default()
        }
        Err(e) => {
            // IO error (permission denied, file locked, etc.) — do NOT overwrite
            // the existing file with defaults. Return defaults for in-memory use
            // only; the next explicit save() call will persist them atomically.
            log::warn!(
                "[storage/settings] failed to read settings: {}; using defaults (file preserved)",
                e
            );
            AllSettings::default()
        }
    }
}

fn save_to_path(settings: &AllSettings, path: &Path) -> Result<(), String> {
    log::debug!("[storage/settings] saving settings");
    super::durable_io::write_json_atomic(path, settings)
}

pub fn load() -> AllSettings {
    load_from_path(&settings_path())
}

/// Known provider defaults for migration.
/// Must match the values in platform-presets.ts.
struct ProviderDefaults {
    base_url: Option<&'static str>,
    models: Option<Vec<String>>,
    extra_env: Option<std::collections::HashMap<String, String>>,
    key_optional: bool,
    auth_env_var: Option<&'static str>,
}

/// Known provider defaults exposed for auth resolution fallback.
pub(crate) struct ProviderInfo {
    pub base_url: Option<String>,
    pub models: Option<Vec<String>>,
    pub extra_env: Option<std::collections::HashMap<String, String>>,
    pub key_optional: bool,
    pub auth_env_var: Option<String>,
}

pub(crate) fn is_key_optional_platform(pid: &str) -> bool {
    known_provider_defaults(pid).is_some_and(|d| d.key_optional)
}

pub(crate) fn get_provider_info(pid: &str) -> Option<ProviderInfo> {
    known_provider_defaults(pid).map(|d| ProviderInfo {
        base_url: d.base_url.map(|s| s.to_string()),
        models: d.models,
        extra_env: d.extra_env,
        key_optional: d.key_optional,
        auth_env_var: d.auth_env_var.map(|s| s.to_string()),
    })
}

fn known_provider_defaults(pid: &str) -> Option<ProviderDefaults> {
    use std::collections::HashMap;
    match pid {
        "deepseek" => Some(ProviderDefaults {
            base_url: Some("https://api.deepseek.com/anthropic"),
            models: Some(vec!["deepseek-v4-pro".to_string()]),
            extra_env: Some(HashMap::from([(
                "API_TIMEOUT_MS".to_string(),
                "600000".to_string(),
            )])),
            key_optional: false,
            auth_env_var: None,
        }),
        "kimi" => Some(ProviderDefaults {
            base_url: Some("https://api.moonshot.cn/anthropic"),
            models: Some(vec!["kimi-k2.5".to_string(), "kimi-k2".to_string()]),
            extra_env: None,
            key_optional: false,
            auth_env_var: None,
        }),
        "kimi-coding" => Some(ProviderDefaults {
            base_url: Some("https://api.kimi.com/coding/"),
            models: Some(vec!["kimi-for-coding".to_string()]),
            extra_env: None,
            key_optional: false,
            auth_env_var: None,
        }),
        "zhipu" => Some(ProviderDefaults {
            base_url: Some("https://open.bigmodel.cn/api/anthropic"),
            models: Some(vec![
                "glm-5.1".to_string(),
                "glm-5".to_string(),
                "glm-4.7".to_string(),
            ]),
            extra_env: None,
            key_optional: false,
            auth_env_var: None,
        }),
        "zhipu-intl" => Some(ProviderDefaults {
            base_url: Some("https://api.z.ai/api/anthropic"),
            models: Some(vec![
                "glm-5.1".to_string(),
                "glm-5".to_string(),
                "glm-4.7".to_string(),
            ]),
            extra_env: None,
            key_optional: false,
            auth_env_var: None,
        }),
        "bailian" => Some(ProviderDefaults {
            base_url: Some("https://coding.dashscope.aliyuncs.com/apps/anthropic"),
            models: Some(vec![
                "qwen3.5-plus".to_string(),
                "qwen3-coder-next".to_string(),
            ]),
            extra_env: None,
            key_optional: false,
            auth_env_var: None,
        }),
        "bailian-api" => Some(ProviderDefaults {
            base_url: Some("https://dashscope.aliyuncs.com/apps/anthropic"),
            models: Some(vec![
                "qwen3.5-plus".to_string(),
                "qwen3-coder-next".to_string(),
            ]),
            extra_env: None,
            key_optional: false,
            auth_env_var: None,
        }),
        "doubao" => Some(ProviderDefaults {
            base_url: Some("https://ark.cn-beijing.volces.com/api/coding"),
            models: Some(vec!["doubao-seed-code-preview-latest".to_string()]),
            extra_env: None,
            key_optional: false,
            auth_env_var: None,
        }),
        "minimax" => Some(ProviderDefaults {
            base_url: Some("https://api.minimax.io/anthropic"),
            models: Some(vec!["MiniMax-M2.7".to_string()]),
            extra_env: None,
            key_optional: false,
            auth_env_var: None,
        }),
        "minimax-cn" => Some(ProviderDefaults {
            base_url: Some("https://api.minimaxi.com/anthropic"),
            models: Some(vec!["MiniMax-M2.7".to_string()]),
            extra_env: None,
            key_optional: false,
            auth_env_var: None,
        }),
        "mimo" => Some(ProviderDefaults {
            base_url: Some("https://api.xiaomimimo.com/anthropic"),
            models: Some(vec!["mimo-v2.5-pro".to_string()]),
            extra_env: None,
            key_optional: false,
            auth_env_var: None,
        }),
        "mimo-tp" => Some(ProviderDefaults {
            base_url: Some("https://token-plan-cn.xiaomimimo.com/anthropic"),
            models: Some(vec!["mimo-v2.5-pro".to_string()]),
            extra_env: None,
            key_optional: false,
            auth_env_var: None,
        }),
        "siliconflow" => Some(ProviderDefaults {
            base_url: Some("https://api.siliconflow.com/"),
            models: None,
            extra_env: None,
            key_optional: false,
            auth_env_var: None,
        }),
        "hunyuan" => Some(ProviderDefaults {
            base_url: Some("https://api.hunyuan.cloud.tencent.com/anthropic"),
            models: Some(vec![
                "hunyuan-2.0-thinking-20251109".to_string(),
                "hunyuan-2.0-instruct-20251111".to_string(),
            ]),
            extra_env: None,
            key_optional: false,
            auth_env_var: None,
        }),
        "openrouter" => Some(ProviderDefaults {
            base_url: Some("https://openrouter.ai/api"),
            models: None,
            extra_env: None,
            key_optional: false,
            auth_env_var: None,
        }),
        "aihubmix" => Some(ProviderDefaults {
            base_url: Some("https://aihubmix.com"),
            models: None,
            extra_env: None,
            key_optional: false,
            auth_env_var: None,
        }),
        "zenmux" => Some(ProviderDefaults {
            base_url: Some("https://zenmux.ai/api/anthropic"),
            models: None,
            extra_env: Some(HashMap::from([(
                "API_TIMEOUT_MS".to_string(),
                "30000000".to_string(),
            )])),
            key_optional: false,
            auth_env_var: None,
        }),
        "vercel" => Some(ProviderDefaults {
            base_url: Some("https://ai-gateway.vercel.sh"),
            models: None,
            extra_env: None,
            key_optional: false,
            auth_env_var: None,
        }),
        "ccswitch" => Some(ProviderDefaults {
            base_url: Some("http://127.0.0.1:15721"),
            models: None,
            extra_env: None,
            key_optional: true,
            auth_env_var: Some("ANTHROPIC_AUTH_TOKEN"),
        }),
        "ccr" => Some(ProviderDefaults {
            base_url: Some("http://127.0.0.1:3456"),
            models: Some(vec!["claude-sonnet-4-6".to_string()]),
            extra_env: None,
            key_optional: true,
            auth_env_var: Some("ANTHROPIC_AUTH_TOKEN"),
        }),
        "ollama" => Some(ProviderDefaults {
            base_url: Some("http://localhost:11434"),
            models: None,
            extra_env: None,
            key_optional: true,
            auth_env_var: Some("ANTHROPIC_AUTH_TOKEN"),
        }),
        _ => None,
    }
}

/// Migrate stale platform credential data. Returns true if any changes were made.
///
/// Fixes:
/// - Incorrect auth_env_var for providers that need ANTHROPIC_API_KEY (x-api-key header)
/// - Old "minimax" credentials using minimaxi.com → rename to "minimax-cn" preset
/// - Missing models/extra_env on existing credentials (needed for ANTHROPIC_MODEL injection)
fn migrate_platform_credentials(settings: &mut AllSettings) -> bool {
    let auth_fixes: &[(&str, &str)] = &[
        ("deepseek", "ANTHROPIC_AUTH_TOKEN"),
        ("zhipu", "ANTHROPIC_AUTH_TOKEN"),
        ("zhipu-intl", "ANTHROPIC_AUTH_TOKEN"),
        ("doubao", "ANTHROPIC_AUTH_TOKEN"),
        ("minimax", "ANTHROPIC_AUTH_TOKEN"),
        ("minimax-cn", "ANTHROPIC_AUTH_TOKEN"),
        ("mimo", "ANTHROPIC_AUTH_TOKEN"),
        ("bailian", "ANTHROPIC_AUTH_TOKEN"),
        ("kimi-coding", "ANTHROPIC_AUTH_TOKEN"),
        ("aihubmix", "ANTHROPIC_AUTH_TOKEN"),
    ];
    let mut changed = false;

    for cred in &mut settings.user.platform_credentials {
        // Fix auth_env_var
        for &(pid, correct) in auth_fixes {
            if cred.platform_id == pid && cred.auth_env_var.as_deref() != Some(correct) {
                log::info!(
                    "[storage/settings] migrating auth_env_var for '{}': {:?} → {}",
                    pid,
                    cred.auth_env_var,
                    correct
                );
                cred.auth_env_var = Some(correct.to_string());
                changed = true;
            }
        }

        // Migrate old "minimax" credentials that used minimaxi.com → "minimax-cn"
        if cred.platform_id == "minimax" {
            if let Some(ref url) = cred.base_url {
                if url.contains("api.minimaxi.com") {
                    log::info!(
                        "[storage/settings] migrating minimax credential with minimaxi.com to minimax-cn"
                    );
                    cred.platform_id = "minimax-cn".to_string();
                    changed = true;
                }
            }
        }

        // Populate base_url, models, and extra_env from known provider defaults if missing.
        // base_url is CRITICAL — without it, ANTHROPIC_BASE_URL is not set and
        // requests go to Anthropic's default endpoint instead of the third-party provider.
        if let Some(defaults) = known_provider_defaults(&cred.platform_id) {
            if cred.base_url.as_ref().is_none_or(|s| s.is_empty()) {
                if let Some(url) = defaults.base_url {
                    log::info!(
                        "[storage/settings] migrating base_url for '{}': {}",
                        cred.platform_id,
                        url
                    );
                    cred.base_url = Some(url.to_string());
                    changed = true;
                }
            }
            if cred.models.is_none() {
                if let Some(models) = defaults.models {
                    log::info!(
                        "[storage/settings] migrating models for '{}': {:?}",
                        cred.platform_id,
                        models
                    );
                    cred.models = Some(models);
                    changed = true;
                }
            }
            if cred.extra_env.is_none() {
                if let Some(extra) = defaults.extra_env {
                    log::info!(
                        "[storage/settings] migrating extra_env for '{}': {:?}",
                        cred.platform_id,
                        extra
                    );
                    cred.extra_env = Some(extra);
                    changed = true;
                }
            }
        }
    }

    // If active_platform_id was "minimax" but was migrated to "minimax-cn", update it
    if settings.user.active_platform_id.as_deref() == Some("minimax") {
        // Check if the minimax credential was migrated to minimax-cn
        let has_minimax_cn = settings
            .user
            .platform_credentials
            .iter()
            .any(|c| c.platform_id == "minimax-cn");
        let has_minimax = settings
            .user
            .platform_credentials
            .iter()
            .any(|c| c.platform_id == "minimax");
        if has_minimax_cn && !has_minimax {
            log::info!(
                "[storage/settings] migrating active_platform_id from minimax to minimax-cn"
            );
            settings.user.active_platform_id = Some("minimax-cn".to_string());
            changed = true;
        }
    }

    // Also fix the global auth_env_var if it was set by one of these providers
    // (only if active_platform_id matches a provider that needs fixing)
    if let Some(ref pid) = settings.user.active_platform_id {
        for &(fix_pid, correct) in auth_fixes {
            if pid == fix_pid && settings.user.auth_env_var.as_deref() != Some(correct) {
                log::info!(
                    "[storage/settings] migrating global auth_env_var for active platform '{}': {:?} → {}",
                    pid,
                    settings.user.auth_env_var,
                    correct
                );
                settings.user.auth_env_var = Some(correct.to_string());
                changed = true;
            }
        }
    }

    changed
}

fn migrate_session_island_alignment(settings: &mut AllSettings) -> bool {
    let normalized = normalize_session_island_alignment(&settings.user.session_island_alignment);
    if settings.user.session_island_alignment == normalized {
        return false;
    }
    settings.user.session_island_alignment = normalized;
    true
}

pub fn save(settings: &AllSettings) -> Result<(), String> {
    save_to_path(settings, &settings_path())
}

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

fn validate_ui_zoom(v: &serde_json::Value) -> Result<Option<f64>, String> {
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

pub fn get_agent_settings(agent: &str) -> AgentSettings {
    log::debug!("[storage/settings] get_agent_settings: agent={}", agent);
    let all = load();
    all.agents
        .get(agent)
        .cloned()
        .unwrap_or_else(|| AgentSettings::default_for(agent))
}

/// Apply a JSON patch to AgentSettings (pure function, no I/O).
fn apply_agent_patch(settings: &mut AgentSettings, patch: &serde_json::Value) {
    if let Some(model) = patch.get("model") {
        settings.model = model.as_str().map(|s| s.to_string());
    }
    if let Some(tools) = patch.get("allowed_tools").and_then(|v| v.as_array()) {
        settings.allowed_tools = tools
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
    }
    if let Some(wd) = patch.get("working_directory") {
        settings.working_directory = wd.as_str().map(|s| s.to_string());
    }
    if let Some(v) = patch.get("plan_mode") {
        settings.plan_mode = if v.is_null() { None } else { v.as_bool() };
    }
    if let Some(v) = patch.get("disallowed_tools") {
        settings.disallowed_tools = if v.is_null() {
            None
        } else {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
        };
    }
    if let Some(v) = patch.get("append_system_prompt") {
        settings.append_system_prompt = if v.is_null() {
            None
        } else {
            v.as_str().filter(|s| !s.is_empty()).map(|s| s.to_string())
        };
    }
    if let Some(v) = patch.get("max_budget_usd") {
        settings.max_budget_usd = if v.is_null() { None } else { v.as_f64() };
    }
    if let Some(v) = patch.get("fallback_model") {
        settings.fallback_model = if v.is_null() {
            None
        } else {
            v.as_str().filter(|s| !s.is_empty()).map(|s| s.to_string())
        };
    }
    if let Some(v) = patch.get("system_prompt") {
        settings.system_prompt = if v.is_null() {
            None
        } else {
            v.as_str().filter(|s| !s.is_empty()).map(|s| s.to_string())
        };
    }
    if let Some(v) = patch.get("tool_set") {
        settings.tool_set = if v.is_null() {
            None
        } else {
            v.as_str().filter(|s| !s.is_empty()).map(|s| s.to_string())
        };
    }
    if let Some(v) = patch.get("add_dirs") {
        settings.add_dirs = if v.is_null() {
            None
        } else {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
        };
    }
    if let Some(v) = patch.get("json_schema") {
        settings.json_schema = if v.is_null() { None } else { Some(v.clone()) };
    }
    if let Some(v) = patch.get("include_partial_messages") {
        settings.include_partial_messages = if v.is_null() { None } else { v.as_bool() };
    }
    if let Some(v) = patch.get("cli_debug") {
        settings.cli_debug = if v.is_null() {
            None
        } else {
            // Allow empty string (means "--debug" with no filter)
            v.as_str().map(|s| s.to_string())
        };
    }
    if let Some(v) = patch.get("no_session_persistence") {
        settings.no_session_persistence = if v.is_null() { None } else { v.as_bool() };
    }
    if let Some(v) = patch.get("effort") {
        settings.effort = if v.is_null() {
            None
        } else {
            v.as_str().filter(|s| !s.is_empty()).map(|s| s.to_string())
        };
    }
}

pub fn update_agent_settings(
    agent: &str,
    patch: serde_json::Value,
) -> Result<AgentSettings, String> {
    let mut all = load();
    let mut settings = all
        .agents
        .get(agent)
        .cloned()
        .unwrap_or_else(|| AgentSettings::default_for(agent));
    apply_agent_patch(&mut settings, &patch);
    settings.updated_at = crate::models::now_iso();
    all.agents.insert(agent.to_string(), settings.clone());
    save(&all)?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AllSettings, PlatformCredential, UserSettings};

    fn make_settings_with_cred(cred: PlatformCredential) -> AllSettings {
        let mut s = AllSettings::default();
        s.user.platform_credentials.push(cred);
        s
    }

    #[test]
    fn migrate_empty_base_url_fills_from_defaults() {
        // Credential has base_url = "" (empty string), known defaults have a base_url.
        // Migration should populate the empty base_url from defaults.
        let cred = PlatformCredential {
            platform_id: "ollama".to_string(),
            api_key: None,
            base_url: Some(String::new()), // empty string
            auth_env_var: None,
            name: None,
            models: None,
            extra_env: None,
        };
        let mut settings = make_settings_with_cred(cred);
        let changed = migrate_platform_credentials(&mut settings);

        assert!(changed, "migration should have made changes");
        assert_eq!(
            settings.user.platform_credentials[0].base_url.as_deref(),
            Some("http://localhost:11434"),
            "empty base_url should be filled from defaults"
        );
    }

    #[test]
    fn provider_info_ccswitch() {
        let info = get_provider_info("ccswitch").expect("ccswitch should have provider info");
        assert!(info.key_optional);
        assert_eq!(info.base_url.as_deref(), Some("http://127.0.0.1:15721"));
        assert_eq!(info.auth_env_var.as_deref(), Some("ANTHROPIC_AUTH_TOKEN"));
    }

    #[test]
    fn provider_info_ccr() {
        let info = get_provider_info("ccr").expect("ccr should have provider info");
        assert!(info.key_optional);
        assert_eq!(info.base_url.as_deref(), Some("http://127.0.0.1:3456"));
        assert_eq!(
            info.models
                .as_ref()
                .and_then(|m| m.first())
                .map(|s| s.as_str()),
            Some("claude-sonnet-4-6")
        );
    }

    #[test]
    fn apply_agent_patch_effort_set_and_clear() {
        let mut s = AgentSettings::default_for("claude");
        assert_eq!(s.effort, None);

        // Set effort to "high"
        apply_agent_patch(&mut s, &serde_json::json!({ "effort": "high" }));
        assert_eq!(s.effort, Some("high".to_string()));

        // Clear with empty string
        apply_agent_patch(&mut s, &serde_json::json!({ "effort": "" }));
        assert_eq!(s.effort, None);

        // Set then clear with null
        apply_agent_patch(&mut s, &serde_json::json!({ "effort": "low" }));
        assert_eq!(s.effort, Some("low".to_string()));
        apply_agent_patch(&mut s, &serde_json::json!({ "effort": null }));
        assert_eq!(s.effort, None);

        // Absent key doesn't touch existing value
        apply_agent_patch(&mut s, &serde_json::json!({ "effort": "medium" }));
        apply_agent_patch(&mut s, &serde_json::json!({ "model": "opus" }));
        assert_eq!(s.effort, Some("medium".to_string()));
    }

    #[test]
    fn validate_ui_zoom_rejects_invalid() {
        assert!(validate_ui_zoom(&serde_json::json!(0.1)).is_err());
        assert!(validate_ui_zoom(&serde_json::json!(5.0)).is_err());
        assert!(validate_ui_zoom(&serde_json::json!("abc")).is_err());
    }

    #[test]
    fn validate_ui_zoom_accepts_valid() {
        assert_eq!(
            validate_ui_zoom(&serde_json::json!(1.0)).unwrap(),
            Some(1.0)
        );
        assert_eq!(
            validate_ui_zoom(&serde_json::json!(0.75)).unwrap(),
            Some(0.75)
        );
        assert_eq!(
            validate_ui_zoom(&serde_json::json!(1.5)).unwrap(),
            Some(1.5)
        );
        assert_eq!(validate_ui_zoom(&serde_json::json!(null)).unwrap(), None);
    }

    #[test]
    fn is_key_optional_known_platforms() {
        assert!(is_key_optional_platform("ccswitch"));
        assert!(is_key_optional_platform("ccr"));
        assert!(is_key_optional_platform("ollama"));
        assert!(!is_key_optional_platform("deepseek"));
        assert!(!is_key_optional_platform("unknown-platform"));
    }

    #[test]
    fn user_settings_default_session_island_alignment_is_center() {
        let settings = UserSettings::default();
        assert_eq!(settings.session_island_alignment, "center");
    }

    #[test]
    fn user_settings_deserialize_missing_session_island_alignment_defaults_center() {
        let default = UserSettings::default();
        let mut value = serde_json::to_value(&default).expect("serialize default settings");
        value
            .as_object_mut()
            .expect("settings object")
            .remove("session_island_alignment");
        let settings: UserSettings = serde_json::from_value(value).expect("deserialize settings");
        assert_eq!(settings.session_island_alignment, "center");
    }

    #[test]
    fn normalize_session_island_alignment_maps_invalid_to_center() {
        use crate::models::normalize_session_island_alignment;

        assert_eq!(normalize_session_island_alignment("center"), "center");
        assert_eq!(normalize_session_island_alignment("right"), "right");
        assert_eq!(normalize_session_island_alignment("bogus"), "center");
        assert_eq!(normalize_session_island_alignment(""), "center");
    }

    #[test]
    fn migrate_session_island_alignment_rewrites_invalid_persisted_value() {
        let mut settings = AllSettings::default();
        settings.user.session_island_alignment = "left".to_string();
        assert!(migrate_session_island_alignment(&mut settings));
        assert_eq!(settings.user.session_island_alignment, "center");
    }

    #[test]
    fn update_user_settings_patch_session_island_alignment_center_and_right() {
        let mut all = AllSettings::default();
        all.user.session_island_alignment = "center".to_string();

        let patch = serde_json::json!({ "session_island_alignment": "right" });
        if let Some(v) = patch
            .get("session_island_alignment")
            .and_then(|v| v.as_str())
        {
            all.user.session_island_alignment = normalize_session_island_alignment(v);
        }
        assert_eq!(all.user.session_island_alignment, "right");

        let patch = serde_json::json!({ "session_island_alignment": "center" });
        if let Some(v) = patch
            .get("session_island_alignment")
            .and_then(|v| v.as_str())
        {
            all.user.session_island_alignment = normalize_session_island_alignment(v);
        }
        assert_eq!(all.user.session_island_alignment, "center");
    }

    #[test]
    fn update_user_settings_patch_session_island_alignment_invalid_normalizes_center() {
        let mut all = AllSettings::default();
        all.user.session_island_alignment = "right".to_string();

        let patch = serde_json::json!({ "session_island_alignment": "top-left" });
        if let Some(v) = patch
            .get("session_island_alignment")
            .and_then(|v| v.as_str())
        {
            all.user.session_island_alignment = normalize_session_island_alignment(v);
        }
        assert_eq!(all.user.session_island_alignment, "center");
    }

    fn make_user_with_personal_overrides_and_secrets() -> UserSettings {
        let mut user = UserSettings::default();
        // Personal fields the reset MUST restore to defaults.
        user.user_display_name = Some("Alex Doe".to_string());
        user.user_role = Some("Senior Engineer".to_string());
        user.user_timezone = Some("Asia/Shanghai".to_string());
        user.default_agent = "codex".to_string();
        user.default_model = Some("gpt-5".to_string());
        user.fallback_model = Some("gpt-4o".to_string());
        user.default_session_mode = "single".to_string();
        user.notifications_enabled = Some(true);
        user.notify_on_run_completed = Some(false);
        user.notify_on_run_failed = Some(true);
        user.notify_on_approval_required = Some(true);
        user.notify_on_schedule_completed = Some(false);
        user.notify_on_team_completed = Some(true);
        user.ui_zoom = Some(1.25);

        // Credential-bearing fields the reset MUST leave untouched.
        user.anthropic_api_key = Some("sk-secret-123".to_string());
        user.anthropic_base_url = Some("https://api.example.test".to_string());
        user.auth_env_var = Some("ANTHROPIC_AUTH_TOKEN".to_string());
        user.platform_credentials = vec![PlatformCredential {
            platform_id: "anthropic".to_string(),
            api_key: Some("sk-platform-leak-9999".to_string()),
            base_url: Some("https://api.anthropic.com".to_string()),
            auth_env_var: Some("ANTHROPIC_API_KEY".to_string()),
            name: Some("primary".to_string()),
            models: Some(vec!["claude-sonnet-4-6".to_string()]),
            extra_env: None,
        }];
        user.active_platform_id = Some("anthropic".to_string());
        user.remote_hosts = vec![crate::models::RemoteHost {
            name: "prod".to_string(),
            host: "prod.example.test".to_string(),
            user: "deploy".to_string(),
            port: 22,
            key_path: Some("/Users/leak/.ssh/id_rsa".to_string()),
            remote_cwd: None,
            remote_claude_path: None,
            forward_api_key: true,
        }];
        user.feishu_webhook_url = Some("https://hooks.feishu.test/secret".to_string());
        user.feishu_webhook_enabled = true;
        user.feishu_webhook_triggers = vec!["run.completed".to_string()];
        user.feishu_webhook_template = Some("token: ${token}".to_string());
        user.web_server_enabled = Some(true);
        user.web_server_token = Some("web-server-secret-token-xyz".to_string());
        user.web_server_port = Some(7777);
        user.web_server_bind = Some("127.0.0.1".to_string());
        user.web_server_allowed_origins = Some(vec!["https://trusted.test".to_string()]);
        user.web_server_tunnel_url = Some("https://tunnel.example.test".to_string());
        user.keybinding_overrides = vec![crate::models::KeyBindingOverride {
            command: "chat.send".to_string(),
            key: "Cmd+Shift+S".to_string(),
        }];
        user.workspace_folder_sort_order = "name_asc".to_string();
        user.onboarding_completed = true;
        user
    }

    #[test]
    fn apply_personal_profile_reset_restores_only_personal_fields() {
        let original = make_user_with_personal_overrides_and_secrets();
        let patched = apply_personal_profile_reset(original.clone());

        // ── Personal fields are reset to defaults ──
        assert_eq!(patched.user_display_name, None);
        assert_eq!(patched.user_role, None);
        assert_eq!(patched.user_timezone, None);
        assert_eq!(patched.default_agent, UserSettings::default().default_agent);
        assert_eq!(patched.default_model, None);
        assert_eq!(patched.fallback_model, None);
        assert_eq!(
            patched.default_session_mode,
            UserSettings::default().default_session_mode
        );
        assert_eq!(patched.notifications_enabled, None);
        assert_eq!(patched.notify_on_run_completed, None);
        assert_eq!(patched.notify_on_run_failed, None);
        assert_eq!(patched.notify_on_approval_required, None);
        assert_eq!(patched.notify_on_schedule_completed, None);
        assert_eq!(patched.notify_on_team_completed, None);
        assert_eq!(patched.ui_zoom, None);

        // ── Credential-bearing fields are byte-for-byte preserved ──
        assert_eq!(patched.anthropic_api_key, original.anthropic_api_key);
        assert_eq!(patched.anthropic_base_url, original.anthropic_base_url);
        assert_eq!(patched.auth_env_var, original.auth_env_var);
        assert_eq!(
            patched.platform_credentials.len(),
            original.platform_credentials.len()
        );
        assert_eq!(
            serde_json::to_string(&patched.platform_credentials).unwrap(),
            serde_json::to_string(&original.platform_credentials).unwrap(),
        );
        assert_eq!(patched.active_platform_id, original.active_platform_id);
        assert_eq!(patched.remote_hosts.len(), original.remote_hosts.len());
        assert_eq!(
            serde_json::to_string(&patched.remote_hosts).unwrap(),
            serde_json::to_string(&original.remote_hosts).unwrap(),
        );
        assert_eq!(patched.feishu_webhook_url, original.feishu_webhook_url);
        assert_eq!(
            patched.feishu_webhook_enabled,
            original.feishu_webhook_enabled
        );
        assert_eq!(
            patched.feishu_webhook_triggers,
            original.feishu_webhook_triggers
        );
        assert_eq!(
            patched.feishu_webhook_template,
            original.feishu_webhook_template
        );
        assert_eq!(patched.web_server_enabled, original.web_server_enabled);
        assert_eq!(patched.web_server_token, original.web_server_token);
        assert_eq!(patched.web_server_port, original.web_server_port);
        assert_eq!(patched.web_server_bind, original.web_server_bind);
        assert_eq!(
            patched.web_server_allowed_origins,
            original.web_server_allowed_origins
        );
        assert_eq!(
            patched.web_server_tunnel_url,
            original.web_server_tunnel_url
        );
        assert_eq!(
            patched.keybinding_overrides.len(),
            original.keybinding_overrides.len()
        );
        assert_eq!(
            serde_json::to_string(&patched.keybinding_overrides).unwrap(),
            serde_json::to_string(&original.keybinding_overrides).unwrap(),
        );
        assert_eq!(
            patched.workspace_folder_sort_order,
            original.workspace_folder_sort_order
        );
        assert_eq!(patched.onboarding_completed, original.onboarding_completed);
    }

    #[test]
    fn apply_personal_profile_reset_refreshes_updated_at() {
        let mut original = make_user_with_personal_overrides_and_secrets();
        original.updated_at = "1970-01-01T00:00:00.000Z".to_string();
        let patched = apply_personal_profile_reset(original);
        assert_ne!(patched.updated_at, "1970-01-01T00:00:00.000Z");
        // The reset should mint a fresh ISO timestamp.
        assert!(!patched.updated_at.is_empty());
    }

    #[test]
    fn reset_personal_profile_persists_personal_changes_only() {
        // The full I/O path is exercised against a real `AllSettings` struct —
        // not the on-disk JSON — so we can validate field-level semantics
        // without polluting the developer's real `~/.miwarp/settings.json`.
        let original = make_user_with_personal_overrides_and_secrets();
        let mut all = AllSettings::default();
        all.user = original.clone();
        let before_keys = all.user.platform_credentials.len();
        let before_remote_hosts = all.user.remote_hosts.len();

        // Apply the same patch the storage helper uses.
        all.user = apply_personal_profile_reset(all.user.clone());
        let patched = all.user.clone();

        // Personal fields reset.
        assert_eq!(patched.user_display_name, None);
        assert_eq!(patched.user_role, None);
        assert_eq!(patched.user_timezone, None);
        assert_eq!(patched.default_model, None);
        assert_eq!(patched.fallback_model, None);
        assert_eq!(patched.ui_zoom, None);

        // Credentials intact.
        assert_eq!(patched.anthropic_api_key, original.anthropic_api_key);
        assert_eq!(
            patched.platform_credentials.len(),
            before_keys,
            "platform_credentials length must not change"
        );
        assert_eq!(
            patched.remote_hosts.len(),
            before_remote_hosts,
            "remote_hosts length must not change"
        );
        assert_eq!(patched.web_server_token, original.web_server_token);
        assert_eq!(patched.feishu_webhook_url, original.feishu_webhook_url);
        assert_eq!(
            serde_json::to_string(&patched.keybinding_overrides).unwrap(),
            serde_json::to_string(&original.keybinding_overrides).unwrap(),
        );
    }

    // ── Durability tests ──────────────────────────────────────────────

    #[test]
    fn load_truncated_json_backs_up_and_returns_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        // Write truncated JSON (missing closing brace)
        fs::write(&path, r#"{"user":{"default_agent":"claude""#).unwrap();

        let loaded = load_from_path(&path);

        // Should return defaults (not crash)
        let defaults = AllSettings::default();
        assert_eq!(loaded.user.default_agent, defaults.user.default_agent);

        // Original file should be renamed to .corrupt.*
        assert!(!path.exists(), "original corrupt file should be renamed");
        let entries: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .is_some_and(|n| n.contains("corrupt"))
            })
            .collect();
        assert_eq!(entries.len(), 1, "exactly one .corrupt backup should exist");

        // Backup content matches original
        let backup_content = fs::read_to_string(entries[0].path()).unwrap();
        assert!(backup_content.contains("claude"));
    }

    #[test]
    fn load_io_error_preserves_file_returns_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        // Write valid settings first
        let mut valid = AllSettings::default();
        valid.user.default_agent = "custom-agent".to_string();
        let json = serde_json::to_string_pretty(&valid).unwrap();
        fs::write(&path, &json).unwrap();

        // Make file unreadable (Unix only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();

            let loaded = load_from_path(&path);

            // Should return defaults (not crash)
            assert_eq!(
                loaded.user.default_agent,
                AllSettings::default().user.default_agent
            );

            // Original file MUST still exist (not overwritten)
            assert!(path.exists(), "original file must be preserved on IO error");

            // Restore permissions for cleanup
            fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        }
    }

    #[test]
    fn load_missing_file_returns_defaults_without_creating_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        let loaded = load_from_path(&path);

        // Should return defaults
        assert_eq!(
            loaded.user.default_agent,
            AllSettings::default().user.default_agent
        );

        // Should NOT create the file (no implicit save on missing)
        assert!(!path.exists(), "missing file should not be created by load");
    }

    #[test]
    fn save_atomic_write_never_leaves_partial_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        // Write initial valid settings
        let mut initial = AllSettings::default();
        initial.user.default_agent = "initial".to_string();
        save_to_path(&initial, &path).unwrap();

        // Write updated settings
        let mut updated = AllSettings::default();
        updated.user.default_agent = "updated".to_string();
        save_to_path(&updated, &path).unwrap();

        // File should contain the updated value (not partial)
        let content = fs::read_to_string(&path).unwrap();
        let loaded: AllSettings = serde_json::from_str(&content).unwrap();
        assert_eq!(loaded.user.default_agent, "updated");
    }

    #[test]
    fn save_then_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        let mut original = AllSettings::default();
        original.user.default_agent = "roundtrip-agent".to_string();
        original.user.ui_zoom = Some(1.25);
        original
            .user
            .platform_credentials
            .push(crate::models::PlatformCredential {
                platform_id: "test".to_string(),
                api_key: Some("sk-test-123".to_string()),
                base_url: Some("https://test.example.com".to_string()),
                auth_env_var: None,
                name: None,
                models: None,
                extra_env: None,
            });

        save_to_path(&original, &path).unwrap();
        let loaded = load_from_path(&path);

        assert_eq!(loaded.user.default_agent, "roundtrip-agent");
        assert_eq!(loaded.user.ui_zoom, Some(1.25));
        assert_eq!(loaded.user.platform_credentials.len(), 1);
        assert_eq!(loaded.user.platform_credentials[0].platform_id, "test");
    }

    #[test]
    fn concurrent_save_last_writer_wins() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        let mut s1 = AllSettings::default();
        s1.user.default_agent = "writer-1".to_string();

        let mut s2 = AllSettings::default();
        s2.user.default_agent = "writer-2".to_string();

        // Simulate concurrent writes (both succeed)
        save_to_path(&s1, &path).unwrap();
        save_to_path(&s2, &path).unwrap();

        // Last writer wins
        let loaded = load_from_path(&path);
        assert_eq!(loaded.user.default_agent, "writer-2");
    }
}
