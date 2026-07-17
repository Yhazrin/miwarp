use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

pub struct UserSettings {
    pub default_agent: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    pub allowed_tools: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
    pub provider_mode: String,
    #[serde(default = "default_auth_mode")]
    pub auth_mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anthropic_api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anthropic_base_url: Option<String>,
    /// Which env var to inject: "ANTHROPIC_API_KEY" or "ANTHROPIC_AUTH_TOKEN".
    /// Set by the selected platform preset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_env_var: Option<String>,
    #[serde(default = "default_permission_mode")]
    pub permission_mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_budget_usd: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback_model: Option<String>,
    #[serde(default)]
    pub keybinding_overrides: Vec<KeyBindingOverride>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub remote_hosts: Vec<RemoteHost>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub platform_credentials: Vec<PlatformCredential>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_platform_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_zoom: Option<f64>,
    #[serde(default)]
    pub onboarding_completed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_server_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_server_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_server_port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_server_bind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_server_allowed_origins: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_server_tunnel_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feishu_webhook_url: Option<String>,
    #[serde(default)]
    pub feishu_webhook_enabled: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub feishu_webhook_triggers: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feishu_webhook_template: Option<String>,
    // Notification settings (OS-level + feishu)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notifications_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_on_run_completed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_on_run_failed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_on_approval_required: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_on_schedule_completed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_on_team_completed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notification_min_duration_sec: Option<u32>,
    /// Semantic UI sound feedback: off | minimal | standard | detailed. Default minimal.
    #[serde(default = "default_sound_feedback_level")]
    pub sound_feedback_level: String,
    /// Default session mode: "single" or "worktree". Default: "worktree".
    #[serde(default = "default_session_mode")]
    pub default_session_mode: String,
    /// Auto-commit worktree changes when session completes.
    #[serde(default)]
    pub auto_commit_on_complete: bool,
    /// Auto-create PR after auto-commit.
    #[serde(default)]
    pub auto_pr_on_complete: bool,
    /// Cleanup worktree directory when session is deleted.
    #[serde(default = "default_true")]
    pub auto_cleanup_worktree: bool,
    /// Show token usage report at the bottom of each chat.
    #[serde(default = "default_true")]
    pub show_token_usage_report: bool,
    /// Show pixel-art mascot in sidebar for Claude Code workspaces.
    #[serde(default = "default_true")]
    pub mascot_enabled: bool,
    /// Show left icon rail (Chat / Teams / Memory / Settings shortcuts).
    #[serde(default = "default_true")]
    pub icon_rail_enabled: bool,
    /// Periodically sync CLI-imported sessions from ~/.claude transcript files.
    #[serde(default = "default_true")]
    pub cli_auto_sync_enabled: bool,
    /// v1.0.6 follow-up: enable the native window-level glass material for the
    /// left sidebar (macOS vibrancy / Windows mica or acrylic). When false the
    /// sidebar falls back to the existing opaque background.
    #[serde(default = "default_true")]
    pub native_window_glass_enabled: bool,
    /// v1.0.6: which macOS NSVisualEffectMaterial to apply when the
    /// native glass is enabled. `sidebar` (default) is the heavy traditional
    /// macOS sidebar material (~30–40px native blur). `header_view` is a
    /// lighter alternative (~15–20px) for users who want less frost.
    #[serde(default = "default_native_window_glass_material")]
    pub native_window_glass_material: String,
    /// Minutes between automatic CLI sync passes.
    #[serde(default = "default_cli_auto_sync_interval_minutes")]
    pub cli_auto_sync_interval_minutes: u32,
    /// Also import newly discovered CLI sessions (not only sync existing imports).
    #[serde(default)]
    pub cli_auto_sync_import_new: bool,
    /// Automatically check GitHub-backed MiWarp app updates on startup and periodically.
    #[serde(default = "default_true")]
    pub app_auto_update_check_enabled: bool,
    /// Process visibility: output | guided | developer | expert (default developer).
    #[serde(default = "default_process_visibility")]
    pub process_visibility: String,
    /// Visual performance mode: auto | quality | balanced | performance (default auto).
    #[serde(default = "default_visual_performance_mode")]
    pub visual_performance_mode: String,
    /// Top session island capsule alignment: center (default) | right.
    #[serde(default = "default_session_island_alignment")]
    pub session_island_alignment: String,
    /// Custom session status colors.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_status_colors: Option<SessionStatusColors>,
    /// Display name appended to every session's system prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_display_name: Option<String>,
    /// Role / occupation appended to every session's system prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_role: Option<String>,
    /// IANA time zone (e.g. "Asia/Shanghai") appended to every session's system prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_timezone: Option<String>,
    /// Sidebar workspace folder sort order.
    #[serde(default = "default_workspace_folder_sort_order")]
    pub workspace_folder_sort_order: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionStatusColors {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub running: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paused: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocked: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idle: Option<String>,
}

fn default_auth_mode() -> String {
    "cli".to_string()
}

fn default_ssh_port() -> u16 {
    22
}

fn default_process_visibility() -> String {
    "output".to_string()
}

fn default_visual_performance_mode() -> String {
    "auto".to_string()
}

fn default_session_island_alignment() -> String {
    "center".to_string()
}

fn default_workspace_folder_sort_order() -> String {
    "last_active".to_string()
}

/// Canonicalize sidebar workspace folder sort — unknown values fall back to last_active.
pub fn normalize_workspace_folder_sort_order(value: &str) -> String {
    match value {
        "name_asc" | "name_desc" | "created_asc" | "created_desc" | "last_active" => {
            value.to_string()
        }
        _ => default_workspace_folder_sort_order(),
    }
}

/// Canonicalize persisted session island alignment — only center | right are stored.
pub fn normalize_session_island_alignment(value: &str) -> String {
    if value == "right" {
        "right".to_string()
    } else {
        "center".to_string()
    }
}

fn default_native_window_glass_material() -> String {
    // Sidebar material (~30–40px native blur) is the product default —
    // pairs with the CSS perf-tier complement for a high-frost look.
    // Users who prefer a lighter feel can switch to HeaderView in Settings.
    "sidebar".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteHost {
    pub name: String,
    pub host: String,
    pub user: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_claude_path: Option<String>,
    #[serde(default)]
    pub forward_api_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteTestResult {
    pub ssh_ok: bool,
    pub cli_found: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn default_permission_mode() -> String {
    "auto_read".to_string()
}

fn default_session_mode() -> String {
    // v1.0.6 follow-up: prefer "single" by default so the user's
    // workspace branch is shared across sessions unless they explicitly
    // opt in to per-session worktrees. Multi-worktree mode is still
    // available behind the settings toggle.
    "single".to_string()
}

fn default_sound_feedback_level() -> String {
    "minimal".to_string()
}

fn default_true() -> bool {
    true
}

fn default_cli_auto_sync_interval_minutes() -> u32 {
    5
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformCredential {
    pub platform_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_env_var: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub models: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_env: Option<HashMap<String, String>>,
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            default_agent: "claude".to_string(),
            default_model: None,
            allowed_tools: vec![],
            working_directory: None,
            provider_mode: "local".to_string(),
            auth_mode: "cli".to_string(),
            anthropic_api_key: None,
            anthropic_base_url: None,
            auth_env_var: None,
            permission_mode: "auto_read".to_string(),
            max_budget_usd: None,
            fallback_model: None,
            keybinding_overrides: vec![],
            remote_hosts: vec![],
            platform_credentials: vec![],
            active_platform_id: None,
            ui_zoom: None,
            onboarding_completed: false,
            web_server_enabled: None,
            web_server_token: None,
            web_server_port: None,
            web_server_bind: None,
            web_server_allowed_origins: None,
            web_server_tunnel_url: None,
            feishu_webhook_url: None,
            feishu_webhook_enabled: false,
            feishu_webhook_triggers: vec![],
            feishu_webhook_template: None,
            notifications_enabled: None,
            notify_on_run_completed: None,
            notify_on_run_failed: None,
            notify_on_approval_required: None,
            notify_on_schedule_completed: None,
            notify_on_team_completed: None,
            notification_min_duration_sec: None,
            sound_feedback_level: default_sound_feedback_level(),
            default_session_mode: "worktree".to_string(),
            auto_commit_on_complete: false,
            auto_pr_on_complete: false,
            auto_cleanup_worktree: true,
            show_token_usage_report: true,
            mascot_enabled: true,
            icon_rail_enabled: true,
            cli_auto_sync_enabled: true,
            cli_auto_sync_interval_minutes: 5,
            native_window_glass_enabled: true,
            native_window_glass_material: "sidebar".to_string(),
            cli_auto_sync_import_new: false,
            app_auto_update_check_enabled: true,
            process_visibility: "output".to_string(),
            visual_performance_mode: "auto".to_string(),
            session_island_alignment: default_session_island_alignment(),
            session_status_colors: None,
            user_display_name: None,
            user_role: None,
            user_timezone: None,
            workspace_folder_sort_order: default_workspace_folder_sort_order(),
            updated_at: now_iso(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSettings {
    pub agent: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub allowed_tools: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_mode: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disallowed_tools: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub append_system_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_budget_usd: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_set: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub add_dirs: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub json_schema: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_partial_messages: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_debug: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_session_persistence: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub betas: Option<Vec<String>>,
    /// Custom agent definitions JSON string (passed to --agents flag).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agents_json: Option<String>,
    /// MiMo-Code: custom binary path (auto-detected if None).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mimo_binary_path: Option<String>,
    /// MiMo-Code: protocol mode (Auto/StreamJson/PTY/Pipe).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mimo_protocol_mode: Option<String>,
    pub updated_at: String,
}

impl AgentSettings {
    pub fn default_for(agent: &str) -> Self {
        Self {
            agent: agent.to_string(),
            model: None,
            allowed_tools: vec![],
            working_directory: None,
            plan_mode: None,
            disallowed_tools: None,
            append_system_prompt: None,
            max_budget_usd: None,
            fallback_model: None,
            system_prompt: None,
            tool_set: None,
            add_dirs: None,
            json_schema: None,
            include_partial_messages: None,
            cli_debug: None,
            no_session_persistence: None,
            max_turns: None,
            effort: None,
            betas: None,
            agents_json: None,
            mimo_binary_path: None,
            mimo_protocol_mode: None,
            updated_at: now_iso(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllSettings {
    pub user: UserSettings,
    pub agents: std::collections::HashMap<String, AgentSettings>,
}

impl Default for AllSettings {
    fn default() -> Self {
        let mut agents = std::collections::HashMap::new();
        agents.insert("claude".to_string(), AgentSettings::default_for("claude"));
        agents.insert("codex".to_string(), AgentSettings::default_for("codex"));
        agents.insert("mimo".to_string(), AgentSettings::default_for("mimo"));
        Self {
            user: UserSettings::default(),
            agents,
        }
    }
}

/// User-created session folder for organizing conversations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFolder {
    pub id: String,
    pub name: String,
    pub workspace_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyBindingOverride {
    pub command: String,
    pub key: String,
}

// ── Onboarding types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshKeyInfo {
    pub key_path: String,
    pub key_path_expanded: String,
    pub pub_key_path: String,
    pub key_type: String,
    pub exists: bool,
    pub pub_exists: bool,
    pub ssh_copy_id_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthCheckResult {
    pub has_oauth: bool,
    pub has_api_key: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oauth_account: Option<String>,
}

/// Overview of all three authentication sources (configuration state only — no effective_source inference).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthOverview {
    /// User-configured mode: "cli" or "api"
    pub auth_mode: String,
    /// CLI Login (OAuth) available via `claude auth status`
    pub cli_login_available: bool,
    /// CLI Login account email (if logged in)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_login_account: Option<String>,
    /// CLI API Key detected from settings/env/shell config
    pub cli_has_api_key: bool,
    /// Hint of the CLI API key (last 4 chars)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_api_key_hint: Option<String>,
    /// Source of CLI API key: "settings", "env", "shell_config", or None
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_api_key_source: Option<String>,
    /// App has platform credentials configured
    pub app_has_credentials: bool,
    /// Active platform ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_platform_id: Option<String>,
    /// Active platform display name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_platform_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallMethod {
    pub id: String,
    pub name: String,
    pub command: String,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

// ── Prompt search & favorites ──

#[derive(Debug, Clone, Serialize)]
