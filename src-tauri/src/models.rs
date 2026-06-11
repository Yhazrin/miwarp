use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LocalProxyStatus {
    pub proxy_id: String,
    pub running: bool,
    pub needs_auth: bool,
    pub base_url: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiTestResult {
    pub success: bool,
    pub latency_ms: u64,
    pub reply: Option<String>,
    pub error: Option<String>,
    /// True when auth+connectivity OK but probe model was rejected (no user model configured).
    pub partial: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryFileCandidate {
    pub path: String,
    pub label: String,
    pub scope: String, // "project" | "global" | "memory"
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Pending,
    Running,
    /// Turn complete, waiting for user input. Session is still alive.
    Idle,
    Completed,
    Failed,
    Stopped,
}

impl std::fmt::Display for RunStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RunStatus::Pending => write!(f, "pending"),
            RunStatus::Running => write!(f, "running"),
            RunStatus::Idle => write!(f, "idle"),
            RunStatus::Completed => write!(f, "completed"),
            RunStatus::Failed => write!(f, "failed"),
            RunStatus::Stopped => write!(f, "stopped"),
        }
    }
}

/// Run source — how this run was created.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RunSource {
    Native,    // app-created run
    CliImport, // imported from CLI transcript
}

/// Session creation mode — single-branch or isolated worktree.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SessionCreationMode {
    Single,
    Worktree,
}

/// Import watermark for incremental CLI session sync.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportWatermark {
    pub offset: u64,
    pub mtime_ns: u128,
    pub file_size: u64,
    pub last_uuid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunEventType {
    System,
    Stdout,
    Stderr,
    Command,
    User,
    Assistant,
}

impl std::fmt::Display for RunEventType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RunEventType::System => write!(f, "system"),
            RunEventType::Stdout => write!(f, "stdout"),
            RunEventType::Stderr => write!(f, "stderr"),
            RunEventType::Command => write!(f, "command"),
            RunEventType::User => write!(f, "user"),
            RunEventType::Assistant => write!(f, "assistant"),
        }
    }
}

/// App-internal execution path — which backend subsystem handles this run.
/// NOT a protocol description; a single agent may support multiple paths.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionPath {
    /// Long-lived process with bidirectional control protocol (Claude stream-json via session_actor)
    SessionActor,
    /// Single-shot process, stdout only (Codex exec, Claude --print via stream.rs)
    PipeExec,
}

/// Which agent runtime backend powers this run.
/// Determines binary, protocol, settings, and session management.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentRuntimeKind {
    /// Anthropic Claude Code CLI (`claude`)
    #[default]
    ClaudeCode,
    /// Xiaomi MiMo-Code CLI (`mimo`)
    MiMoCode,
    /// OpenAI Codex CLI (`codex`)
    Codex,
}

impl std::fmt::Display for AgentRuntimeKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ClaudeCode => write!(f, "claude"),
            Self::MiMoCode => write!(f, "mimo"),
            Self::Codex => write!(f, "codex"),
        }
    }
}

impl AgentRuntimeKind {
    /// Parse from the agent string stored in RunMeta.
    pub fn from_agent(agent: &str) -> Self {
        match agent {
            "mimo" | "mimocode" => Self::MiMoCode,
            "codex" => Self::Codex,
            _ => Self::ClaudeCode,
        }
    }
}

/// Communication protocol between MiWarp and the agent runtime.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeProtocolKind {
    /// NDJSON line-delimited JSON events (Claude stream-json, MiMo --format json)
    StreamJson,
    /// PTY embedded mode (TUI rendering in xterm.js)
    Pty,
    /// Single-shot pipe (stdout text, no streaming)
    Pipe,
    /// Protocol not yet determined
    #[default]
    Unknown,
}

/// Unified resume/fork identity across agents.
/// Claude = session_id from system/init; Codex = thread_id from thread.started.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", content = "id")]
pub enum ConversationRef {
    /// Claude Code session ID (from system/init event)
    #[serde(rename = "claude_session")]
    ClaudeSession(String),
    /// Codex thread ID (from thread.started event)
    #[serde(rename = "codex_thread")]
    CodexThread(String),
    /// MiMo-Code session ID (from sessionID in JSON events)
    #[serde(rename = "mimo_session")]
    MimoSession(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRun {
    pub id: String,
    pub prompt: String,
    pub cwd: String,
    pub agent: String,
    #[serde(default = "default_auth_mode")]
    pub auth_mode: String,
    pub status: RunStatus,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_message_preview: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_subtype: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// The run_id this session was forked from (None if not a fork).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_run_id: Option<String>,
    /// User-assigned display name (None = use prompt as label).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Remote host name (if this run is on a remote machine).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_host_name: Option<String>,
    /// Snapshot of remote working directory at run creation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_cwd: Option<String>,
    /// Snapshot of active_platform_id at run creation time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform_id: Option<String>,
    /// Snapshot of anthropic_base_url at run creation time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform_base_url: Option<String>,
    /// Run source (native or cli_import).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<RunSource>,
    /// CLI import watermark for incremental sync.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_import_watermark: Option<ImportWatermark>,
    /// Absolute path to CLI session JSONL file (read-only reference).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_session_path: Option<String>,
    /// True when CLI import couldn't reconstruct complete usage data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_usage_incomplete: Option<bool>,
    /// Snapshot of no_session_persistence at run creation time.
    #[serde(default)]
    pub no_session_persistence: bool,
    /// Resolved execution path (materialized from RunMeta, never None in API output).
    pub execution_path: ExecutionPath,
    /// Resolved conversation identity (None = not resumable).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_ref: Option<ConversationRef>,
    /// User-created folder ID for organizing sessions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    /// Soft-delete timestamp. Populated by incremental sync so frontend can remove deleted runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<String>,
    /// Session creation mode (single-branch or worktree).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creation_mode: Option<SessionCreationMode>,
    /// Path to the git worktree directory (only when creation_mode = Worktree).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    /// Auto-generated branch name for worktree sessions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_branch: Option<String>,
    /// Original project cwd before worktree redirection (for sidebar grouping).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_cwd: Option<String>,
    /// Scheduled task definition id when this run was created by the scheduler.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheduled_task_id: Option<String>,
    /// Scheduler execution record id (`scheduler/runs/<id>.json`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheduled_task_run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunEvent {
    pub id: String,
    pub task_id: String,
    pub seq: u64,
    #[serde(rename = "type")]
    pub event_type: RunEventType,
    pub payload: serde_json::Value,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunArtifact {
    pub task_id: String,
    pub files_changed: Vec<String>,
    pub diff_summary: String,
    pub commands: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_estimate: Option<f64>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    /// native glass is enabled. `header_view` (default) is a much
    /// lighter blur than `sidebar` and combines cleanly with the CSS
    /// wash layer. `sidebar` is the heavy traditional macOS sidebar
    /// material (~30-40px native blur) for users who want a
    /// stronger effect.
    #[serde(default = "default_native_window_glass_material")]
    pub native_window_glass_material: String,
    /// Minutes between automatic CLI sync passes.
    #[serde(default = "default_cli_auto_sync_interval_minutes")]
    pub cli_auto_sync_interval_minutes: u32,
    /// Also import newly discovered CLI sessions (not only sync existing imports).
    #[serde(default)]
    pub cli_auto_sync_import_new: bool,
    /// Process visibility: output | guided | developer | expert (default developer).
    #[serde(default = "default_process_visibility")]
    pub process_visibility: String,
    /// Visual performance mode: auto | quality | balanced | performance (default auto).
    #[serde(default = "default_visual_performance_mode")]
    pub visual_performance_mode: String,
    /// Custom session status colors.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_status_colors: Option<SessionStatusColors>,
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
    "developer".to_string()
}

fn default_visual_performance_mode() -> String {
    "auto".to_string()
}

fn default_native_window_glass_material() -> String {
    // Default to the lighter HeaderView (macOS 10.14+). It's a much
    // softer native blur than Sidebar and combines cleanly with the
    // CSS wash layer (no double-stacking of blur). The user can opt
    // into the heavier Sidebar material from Settings → Appearance.
    "header_view".to_string()
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
            native_window_glass_material: "header_view".to_string(),
            cli_auto_sync_import_new: false,
            process_visibility: "developer".to_string(),
            visual_performance_mode: "auto".to_string(),
            session_status_colors: None,
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
pub struct RunMeta {
    pub id: String,
    pub prompt: String,
    pub cwd: String,
    pub agent: String,
    #[serde(default = "default_auth_mode")]
    pub auth_mode: String,
    pub status: RunStatus,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_subtype: Option<String>,
    /// The model used in this run (updated on hot-switch).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// The run_id this session was forked from (None if not a fork).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_run_id: Option<String>,
    /// User-assigned display name (None = use prompt as label).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Remote host name (references UserSettings.remote_hosts by name).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_host_name: Option<String>,
    /// Snapshot of remote_cwd at run creation time (stable — not affected by later settings changes).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_cwd: Option<String>,
    /// Full snapshot of RemoteHost config at run creation time.
    /// Used to restore remote sessions even if the host is renamed/deleted from settings.
    /// Falls back to name-based lookup for old runs that don't have this field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_host_snapshot: Option<RemoteHost>,
    /// Snapshot of active_platform_id at run creation time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform_id: Option<String>,
    /// Snapshot of anthropic_base_url at run creation time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform_base_url: Option<String>,
    /// Run source (native or cli_import).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<RunSource>,
    /// CLI import watermark for incremental sync.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_import_watermark: Option<ImportWatermark>,
    /// Absolute path to CLI session JSONL file (read-only reference).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_session_path: Option<String>,
    /// True when CLI import couldn't reconstruct complete usage data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_usage_incomplete: Option<bool>,
    /// User-created folder ID for organizing sessions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    /// Soft-delete timestamp (ISO 8601). When set, run is hidden from all read paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<String>,
    /// Session creation mode (single-branch or worktree).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creation_mode: Option<SessionCreationMode>,
    /// Path to the git worktree directory (only when creation_mode = Worktree).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    /// Auto-generated branch name for worktree sessions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_branch: Option<String>,
    /// Original project cwd before worktree redirection (for sidebar grouping).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_cwd: Option<String>,
    /// Snapshot of no_session_persistence at run creation time (metadata only — runtime
    /// resume gate uses current agent settings, not this snapshot).
    #[serde(default)]
    pub no_session_persistence: bool,
    /// App execution path for this run. Option on disk (backward compat); resolved via agent heuristic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_path: Option<ExecutionPath>,
    /// Unified resume identity. None = not resumable. Written by runtime events (session_init / thread.started).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_ref: Option<ConversationRef>,
    /// Scheduled task definition id when this run was created by the scheduler.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheduled_task_id: Option<String>,
    /// Scheduler execution record id (`scheduler/runs/<id>.json`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheduled_task_run_id: Option<String>,
    /// Runtime backend kind. None for old runs → resolved via AgentRuntimeKind::from_agent(agent).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_kind: Option<AgentRuntimeKind>,
    /// Communication protocol used by this runtime. None → resolved via runtime_kind default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol_kind: Option<RuntimeProtocolKind>,
}

impl RunMeta {
    /// Resolve execution_path for old runs that don't have it on disk.
    /// Migration assumption: historically, Claude runs used session_actor,
    /// Codex runs used pipe_exec. MiMoCode uses session_actor (StreamJson protocol).
    pub fn resolved_execution_path(&self) -> ExecutionPath {
        self.execution_path.clone().unwrap_or_else(|| {
            let rk = self.resolved_runtime_kind();
            match rk {
                AgentRuntimeKind::ClaudeCode => ExecutionPath::SessionActor,
                AgentRuntimeKind::MiMoCode => ExecutionPath::SessionActor,
                AgentRuntimeKind::Codex => ExecutionPath::PipeExec,
            }
        })
    }

    /// Resolve runtime_kind for old runs that don't have it on disk.
    pub fn resolved_runtime_kind(&self) -> AgentRuntimeKind {
        self.runtime_kind
            .clone()
            .unwrap_or_else(|| AgentRuntimeKind::from_agent(&self.agent))
    }

    /// Resolve protocol_kind for old runs that don't have it on disk.
    pub fn resolved_protocol_kind(&self) -> RuntimeProtocolKind {
        self.protocol_kind.clone().unwrap_or_else(|| {
            let rk = self.resolved_runtime_kind();
            match rk {
                AgentRuntimeKind::ClaudeCode => RuntimeProtocolKind::StreamJson,
                AgentRuntimeKind::MiMoCode => RuntimeProtocolKind::StreamJson,
                AgentRuntimeKind::Codex => RuntimeProtocolKind::Pipe,
            }
        })
    }

    /// Resolve conversation_ref for old runs. Falls back to session_id → ClaudeSession.
    pub fn resolved_conversation_ref(&self) -> Option<ConversationRef> {
        self.conversation_ref.clone().or_else(|| {
            self.session_id
                .as_ref()
                .map(|sid| ConversationRef::ClaudeSession(sid.clone()))
        })
    }

    pub fn to_task_run(
        &self,
        last_activity_at: Option<String>,
        message_count: Option<u32>,
        last_message_preview: Option<String>,
    ) -> TaskRun {
        TaskRun {
            id: self.id.clone(),
            prompt: self.prompt.clone(),
            cwd: self.cwd.clone(),
            agent: self.agent.clone(),
            auth_mode: self.auth_mode.clone(),
            status: self.status.clone(),
            started_at: self.started_at.clone(),
            ended_at: self.ended_at.clone(),
            exit_code: self.exit_code,
            error_message: self.error_message.clone(),
            last_activity_at,
            message_count,
            last_message_preview,
            session_id: self.session_id.clone(),
            result_subtype: self.result_subtype.clone(),
            model: self.model.clone(),
            parent_run_id: self.parent_run_id.clone(),
            name: self.name.clone(),
            remote_host_name: self.remote_host_name.clone(),
            remote_cwd: self.remote_cwd.clone(),
            platform_id: self.platform_id.clone(),
            platform_base_url: self.platform_base_url.clone(),
            source: self.source.clone(),
            cli_import_watermark: self.cli_import_watermark.clone(),
            cli_session_path: self.cli_session_path.clone(),
            cli_usage_incomplete: self.cli_usage_incomplete,
            no_session_persistence: self.no_session_persistence,
            execution_path: self.resolved_execution_path(),
            conversation_ref: self.resolved_conversation_ref(),
            folder_id: self.folder_id.clone(),
            deleted_at: self.deleted_at.clone(),
            creation_mode: self.creation_mode.clone(),
            worktree_path: self.worktree_path.clone(),
            worktree_branch: self.worktree_branch.clone(),
            parent_cwd: self.parent_cwd.clone(),
            scheduled_task_id: self.scheduled_task_id.clone(),
            scheduled_task_run_id: self.scheduled_task_run_id.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirListing {
    pub path: String,
    pub entries: Vec<DirEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatDelta {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatDone {
    pub ok: bool,
    pub code: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub name: String,
    #[serde(rename = "type")]
    pub mime_type: String,
    pub size: u64,
    #[serde(rename = "contentBase64")]
    pub content_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliCheckResult {
    pub agent: String,
    pub found: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliDistTags {
    pub latest: Option<String>,
    pub stable: Option<String>,
}

/// Result of `update_claude_cli` — `success` is the npm exit code, `stdout`/`stderr`
/// are captured for diagnostic reporting. Returned by the doctor-panel button.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCliResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInitStatus {
    pub cwd: String,
    pub has_claude_md: bool,
}

// ── Diagnostics report (run_diagnostics command) ──

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticsReport {
    pub cli: CliDiagnostics,
    pub auth: AuthDiagnostics,
    pub project: ProjectDiagnostics,
    pub configs: ConfigDiagnostics,
    pub services: ServicesDiagnostics,
    pub system: SystemDiagnostics,
}

#[derive(Debug, Clone, Serialize)]
pub struct CliDiagnostics {
    pub found: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub latest: Option<String>,
    pub stable: Option<String>,
    pub auto_update_channel: Option<String>,
    pub ripgrep_available: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthDiagnostics {
    pub has_oauth: bool,
    pub oauth_account: Option<String>,
    pub has_api_key: bool,
    pub api_key_hint: Option<String>,
    pub api_key_source: Option<String>,
    pub app_has_credentials: bool,
    pub app_platform_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectDiagnostics {
    pub cwd: String,
    pub has_claude_md: bool,
    pub claude_md_files: Vec<ClaudeMdInfo>,
    pub skipped_project_scope: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeMdInfo {
    pub path: String,
    pub size_chars: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfigDiagnostics {
    pub settings_issues: Vec<ConfigIssue>,
    pub keybinding_issues: Vec<ConfigIssue>,
    pub mcp_issues: Vec<ConfigIssue>,
    pub env_var_issues: Vec<ConfigIssue>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfigIssue {
    pub scope: String,
    pub file: String,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServicesDiagnostics {
    pub community_registry: Option<bool>,
    pub mcp_registry: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemDiagnostics {
    pub sandbox_available: Option<bool>,
    pub lock_files: Vec<String>,
}

/// Raw usage data extracted from a run's events.jsonl (no RunMeta fields).
#[derive(Debug, Clone, Default)]
pub struct RawRunUsage {
    pub total_cost_usd: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub duration_ms: u64,
    pub num_turns: u64,
    pub model_usage: HashMap<String, ModelUsageSummary>,
}

/// Per-run usage summary (RunMeta + usage data), returned by IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunUsageSummary {
    pub run_id: String,
    pub name: String,
    pub agent: String,
    pub model: Option<String>,
    pub status: RunStatus,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub total_cost_usd: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub duration_ms: u64,
    pub num_turns: u64,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub model_usage: HashMap<String, ModelUsageSummary>,
}

/// Per-model token and cost summary.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsageSummary {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub cost_usd: f64,
}

/// Aggregated usage overview across all runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageOverview {
    pub total_cost_usd: f64,
    pub total_tokens: u64,
    pub total_runs: u32,
    pub avg_cost_per_run: f64,
    pub by_model: Vec<ModelAggregate>,
    pub daily: Vec<DailyAggregate>,
    pub runs: Vec<RunUsageSummary>,
    /// How the data was produced: "memory", "disk", "incremental", "full".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scan_mode: Option<String>,
    /// Number of days with activity.
    #[serde(default)]
    pub active_days: u32,
    /// Current consecutive active days (including today).
    #[serde(default)]
    pub current_streak: u32,
    /// Longest consecutive active days ever.
    #[serde(default)]
    pub longest_streak: u32,
}

/// Per-model aggregate stats.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelAggregate {
    pub model: String,
    pub runs: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub cost_usd: f64,
    pub pct: f64,
}

/// Daily aggregate stats.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyAggregate {
    pub date: String,
    pub cost_usd: f64,
    pub runs: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// Message count (Global mode — from Claude Code stats-cache).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_count: Option<u32>,
    /// Session count (Global mode — from Claude Code stats-cache).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_count: Option<u32>,
    /// Tool call count (Global mode — from Claude Code stats-cache).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_count: Option<u32>,
    /// Per-model token breakdown (populated for last 30 daily entries only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_breakdown: Option<std::collections::HashMap<String, ModelTokens>>,
}

/// Per-model token counts for a single day (stacked chart).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelTokens {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
}

// ── CLI Control Protocol types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliModelInfo {
    pub value: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(default)]
    pub description: String,
    #[serde(
        default,
        rename = "supportsEffort",
        skip_serializing_if = "Option::is_none"
    )]
    pub supports_effort: Option<bool>,
    #[serde(
        default,
        rename = "supportedEffortLevels",
        skip_serializing_if = "Option::is_none"
    )]
    pub supported_effort_levels: Option<Vec<String>>,
    #[serde(
        default,
        rename = "supportsAdaptiveThinking",
        skip_serializing_if = "Option::is_none"
    )]
    pub supports_adaptive_thinking: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliCommand {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliAccount {
    #[serde(default, rename = "tokenSource")]
    pub token_source: String,
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliInfo {
    pub models: Vec<CliModelInfo>,
    pub commands: Vec<CliCommand>,
    #[serde(default)]
    pub available_output_styles: Vec<String>,
    pub account: Option<CliAccount>,
    /// The model currently selected in Claude Code (from ~/.claude/settings.json)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_model: Option<String>,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliInfoError {
    pub code: String,
    pub message: String,
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

// ── Attachment limits ──
// Images: no app-side limit — CLI compresses via sharp (→ ≤3.75MB + ≤2000px).
pub const MAX_TEXT_SIZE: u64 = 10 * 1024 * 1024; // 10MB — text files
pub const MAX_PDF_BINARY_SIZE: u64 = 20 * 1024 * 1024; // 20MB — PDF binary inline (CLI dj6)
pub const ALLOWED_IMAGE_TYPES: &[&str] = &["image/png", "image/jpeg", "image/webp", "image/gif"];
pub const ALLOWED_DOC_TYPES: &[&str] = &["application/pdf"];

/// Max size for attachment by MIME type. Images: no limit, PDF: 20MB, text: 10MB.
pub fn max_attachment_size(mime: &str) -> u64 {
    if ALLOWED_IMAGE_TYPES.iter().any(|t| mime.starts_with(t)) {
        u64::MAX // CLI handles compression
    } else if ALLOWED_DOC_TYPES.contains(&mime) {
        MAX_PDF_BINARY_SIZE // 20MB for PDF (CLI dj6)
    } else {
        MAX_TEXT_SIZE // 10MB for text
    }
}

// ── Per-model usage breakdown ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelUsageEntry {
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_read_tokens: u64,
    #[serde(default)]
    pub cache_write_tokens: u64,
    #[serde(default)]
    pub web_search_requests: u64,
    pub cost_usd: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    /// Maximum output tokens for this model (e.g. 32000).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u64>,
}

// ── MCP server info ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerInfo {
    pub name: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── Ralph Loop types ──

/// Reason a Ralph loop ended. Serializes to snake_case for frontend union matching.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RalphCompleteReason {
    MaxIterations,
    CompletionPromise,
    Cancelled,
    FailStopped,
}

// ── Event Bus types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BusEvent {
    SessionInit {
        run_id: String,
        session_id: Option<String>,
        model: Option<String>,
        tools: Vec<String>,
        cwd: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        slash_commands: Vec<Value>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        mcp_servers: Vec<McpServerInfo>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "permissionMode"
        )]
        permission_mode: Option<String>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "apiKeySource"
        )]
        api_key_source: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        claude_code_version: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        output_style: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        agents: Vec<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        skills: Vec<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        plugins: Vec<Value>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        plugin_errors: Vec<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fast_mode_state: Option<String>,
    },
    MessageDelta {
        run_id: String,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    MessageComplete {
        run_id: String,
        message_id: String,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
        /// Actual model used for this message (e.g. "claude-opus-4-6").
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        /// Stop reason (v2.1.41: usually null; future: "end_turn", "tool_use").
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_reason: Option<String>,
        /// Per-message token usage (raw JSON — result event has aggregated totals).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message_usage: Option<Value>,
    },
    ToolStart {
        run_id: String,
        tool_use_id: String,
        tool_name: String,
        input: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    ToolEnd {
        run_id: String,
        tool_use_id: String,
        tool_name: String,
        output: Value,
        status: String,
        duration_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
        /// Structured tool result metadata from CLI verbose mode (e.g. file info for Read)
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_use_result: Option<Value>,
    },
    UserMessage {
        run_id: String,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        uuid: Option<String>,
    },
    RunState {
        run_id: String,
        state: String,
        exit_code: Option<i32>,
        error: Option<String>,
    },
    UsageUpdate {
        run_id: String,
        input_tokens: u64,
        output_tokens: u64,
        cache_read_tokens: Option<u64>,
        cache_write_tokens: Option<u64>,
        total_cost_usd: f64,
        /// Backend-authoritative turn index (1-based). Injected by session_actor for user turns.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        turn_index: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model_usage: Option<HashMap<String, ModelUsageEntry>>,
        /// Official CLI context window used percentage, when provided by status/result payloads.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        context_window_used_percentage: Option<f64>,
        /// Official CLI context window remaining percentage, when provided by status/result payloads.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        context_window_remaining_percentage: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        duration_api_ms: Option<u64>,
        /// Total duration including hooks/overhead (from result event).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
        /// Number of turns in this session (from result event).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        num_turns: Option<u64>,
        /// Stop reason from result event (v2.1.41: usually null).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_reason: Option<String>,
        /// Service tier (e.g. "standard").
        #[serde(default, skip_serializing_if = "Option::is_none")]
        service_tier: Option<String>,
        /// Speed tier (e.g. "standard").
        #[serde(default, skip_serializing_if = "Option::is_none")]
        speed: Option<String>,
        /// Web fetch request count (from usage.server_tool_use).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        web_fetch_requests: Option<u64>,
        /// 5-minute ephemeral cache creation tokens.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cache_creation_5m: Option<u64>,
        /// 1-hour ephemeral cache creation tokens.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cache_creation_1h: Option<u64>,
    },
    Raw {
        run_id: String,
        source: String,
        data: Value,
    },
    PermissionDenied {
        run_id: String,
        tool_name: String,
        tool_use_id: String,
        tool_input: Value,
    },
    /// Thinking/reasoning text delta (from extended thinking).
    ThinkingDelta {
        run_id: String,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    /// Partial JSON input for a tool being invoked (real-time streaming).
    ToolInputDelta {
        run_id: String,
        tool_use_id: String,
        partial_json: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    /// Inline permission prompt from `--permission-prompt-tool stdio`.
    /// CLI is waiting for a control_response with allow/deny.
    PermissionPrompt {
        run_id: String,
        request_id: String,
        tool_name: String,
        tool_use_id: String,
        tool_input: Value,
        decision_reason: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        suggestions: Vec<Value>,
    },
    /// Context compaction boundary — CLI auto-compressed the conversation context.
    CompactBoundary {
        run_id: String,
        trigger: String,
        pre_tokens: Option<u64>,
    },
    /// System status change (e.g. "compacting").
    SystemStatus {
        run_id: String,
        /// CLI status string, e.g. "compacting", null for cleared
        status: Option<String>,
        data: Value,
    },
    /// Hook execution started.
    HookStarted {
        run_id: String,
        hook_event: String,
        hook_id: String,
        data: Value,
        /// Hook name (e.g. "SessionStart:startup").
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hook_name: Option<String>,
    },
    /// Hook execution progress.
    HookProgress {
        run_id: String,
        hook_id: String,
        data: Value,
    },
    /// Hook execution completed with result.
    HookResponse {
        run_id: String,
        hook_id: String,
        hook_event: String,
        outcome: String,
        data: Value,
        /// Hook name (e.g. "SessionStart:startup").
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hook_name: Option<String>,
        /// Hook stdout.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stdout: Option<String>,
        /// Hook stderr.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stderr: Option<String>,
        /// Hook process exit code.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        exit_code: Option<i32>,
    },
    /// Background task notification (file indexing, MCP init, etc.).
    TaskNotification {
        run_id: String,
        task_id: String,
        status: String,
        data: Value,
    },
    /// Files persisted notification.
    FilesPersisted {
        run_id: String,
        files: Value,
        data: Value,
    },
    /// Tool progress update (real-time elapsed time).
    /// Top-level event type "tool_progress" (not a content_block_delta subtype).
    ToolProgress {
        run_id: String,
        tool_use_id: String,
        elapsed_time_seconds: Option<f64>,
        data: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    /// Tool use summary — top-level event type "tool_use_summary".
    ToolUseSummary {
        run_id: String,
        tool_use_id: String,
        summary: String,
        preceding_tool_use_ids: Vec<String>,
        data: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    /// Authentication status update.
    AuthStatus {
        run_id: String,
        is_authenticating: bool,
        output: Vec<String>,
        data: Value,
    },
    /// Hook callback control_request — CLI requests hook execution/approval.
    /// Analogous to PermissionPrompt (needs a control_response).
    HookCallback {
        run_id: String,
        request_id: String,
        hook_event: String,
        hook_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        hook_name: Option<String>,
        data: Value,
    },
    /// CLI cancelled a pending control_request (e.g. cancelled permission prompt).
    ControlCancelled { run_id: String, request_id: String },
    /// Output from a CLI slash command (e.g. /context, /cost).
    /// Extracted from `<local-command-stdout>` tags in user messages.
    CommandOutput { run_id: String, content: String },
    /// MCP elicitation: CLI requests user input for MCP server authentication/configuration.
    ElicitationPrompt {
        run_id: String,
        request_id: String,
        mcp_server_name: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        elicitation_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        mode: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        url: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        requested_schema: Option<Value>,
    },
    /// Rate limit event — emitted when API rate limit status changes.
    RateLimitEvent {
        run_id: String,
        /// Rate limit status: "allowed", "allowed_warning", "rejected"
        status: String,
        /// When the rate limit window resets (epoch seconds).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resets_at: Option<f64>,
        /// Which limit: "five_hour", "seven_day", etc.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        rate_limit_type: Option<String>,
        /// Utilization percentage (0.0-1.0).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        utilization: Option<f64>,
        data: Value,
    },
    /// Ralph loop started — carries full config for replay.
    RalphStarted {
        run_id: String,
        prompt: String,
        max_iterations: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        completion_promise: Option<String>,
        started_at: String,
    },
    /// Ralph loop iteration completed (not the final one).
    RalphIteration {
        run_id: String,
        iteration: u32,
        max_iterations: u32,
    },
    /// Ralph loop ended.
    RalphComplete {
        run_id: String,
        reason: RalphCompleteReason,
        iteration: u32,
    },
    /// v1.0.6 / hardening A1: emitted when a session enters quarantine.
    /// Lets the UI surface "会话恢复中…（最多 N 秒）" instead of going silent.
    SessionRecovering {
        run_id: String,
        reason: String,
        deadline_ms: u64,
        #[serde(default)]
        from_internal: bool,
    },
    /// v1.0.6 / hardening A1: emitted when a session exits quarantine.
    /// `ok=true` means CLI responded; `ok=false` means the deadline hit and
    /// the run was force-failed.
    SessionRecovered { run_id: String, ok: bool },
    /// v1.0.6 / hardening A2: emitted when JSON parse failures exceed the
    /// threshold within a sliding window. Frontend uses this to surface a
    /// "会话状态已重置" toast and unlock the input.
    ProtocolDesync {
        run_id: String,
        fail_count: u32,
        /// First 200 bytes of the most recent bad line, for debugging.
        sample: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SessionMode {
    #[default]
    New,
    Resume,
    Continue,
    Fork,
}

// ── Agent Team Mode types ──
// Read from ~/.claude/teams/ and ~/.claude/tasks/ (Claude Code team collaboration)

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamConfig {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(rename = "createdAt", default)]
    pub created_at: u64,
    #[serde(rename = "leadAgentId", default)]
    pub lead_agent_id: String,
    #[serde(rename = "leadSessionId", default)]
    pub lead_session_id: String,
    #[serde(default)]
    pub members: Vec<TeamMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMember {
    #[serde(rename = "agentId")]
    pub agent_id: String,
    pub name: String,
    #[serde(rename = "agentType", default)]
    pub agent_type: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub color: String,
    #[serde(rename = "planModeRequired", default)]
    pub plan_mode_required: bool,
    #[serde(rename = "joinedAt", default)]
    pub joined_at: u64,
    #[serde(rename = "tmuxPaneId", default)]
    pub tmux_pane_id: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub subscriptions: Vec<String>,
    #[serde(rename = "backendType", default)]
    pub backend_type: String,
    /// The prompt given to spawned teammates (not present on leader)
    #[serde(default)]
    pub prompt: String,
    /// Runtime active status (set by setMemberActive in Claude Code SDK)
    #[serde(rename = "isActive", default)]
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamInboxMessage {
    #[serde(default)]
    pub from: String,
    pub text: String,
    #[serde(default)]
    pub summary: String,
    pub timestamp: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub read: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamTask {
    pub id: String,
    pub subject: String,
    #[serde(default)]
    pub description: String,
    #[serde(rename = "activeForm", default)]
    pub active_form: String,
    #[serde(default)]
    pub owner: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub blocks: Vec<String>,
    #[serde(rename = "blockedBy", default)]
    pub blocked_by: Vec<String>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamSummary {
    pub name: String,
    pub description: String,
    pub member_count: usize,
    pub task_count: usize,
    pub created_at: u64,
}

// ── Plugin types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplacePlugin {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub author: Option<PluginAuthor>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    /// Raw source — string for local ("./plugins/name"), object for external
    #[serde(default)]
    pub source: Option<serde_json::Value>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub strict: Option<bool>,
    #[serde(default, rename = "lspServers")]
    pub lsp_servers: Option<serde_json::Value>,
    // ── Fields enriched by our code (not from marketplace.json) ──
    #[serde(default)]
    pub marketplace_name: Option<String>,
    #[serde(default)]
    pub install_count: Option<u64>,
    /// Components discovered by scanning plugin subdirectories
    #[serde(default)]
    pub components: PluginComponents,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginAuthor {
    pub name: String,
    #[serde(default)]
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PluginComponents {
    pub skills: Vec<String>,
    pub commands: Vec<String>,
    pub agents: Vec<String>,
    pub hooks: bool,
    pub mcp_servers: Vec<String>,
    pub lsp_servers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplaceInfo {
    pub name: String,
    pub source: serde_json::Value,
    pub install_location: String,
    pub last_updated: Option<String>,
    pub plugin_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StandaloneSkill {
    pub name: String,
    pub description: String,
    pub path: String,
    /// "user" or "project"
    #[serde(default)]
    pub scope: String,
    /// Present when installed from a remote skill source (read from .miwarp_remote.json).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_ref: Option<SkillRemoteRef>,
}

// ── Skill source / remote skill registry ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRemoteRef {
    pub source_id: String,
    /// "feishu" | "github" | "folder" | "marketplace"
    pub source_type: String,
    pub remote_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    pub content_hash: String,
    pub last_synced_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillSourceConfigFeishu {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_profile: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wiki_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wiki_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_token: Option<String>,
    #[serde(default)]
    pub doc_tokens: Vec<String>,
    #[serde(default)]
    pub doc_urls: Vec<String>,
    #[serde(default)]
    pub include_children: bool,
    #[serde(default = "default_feishu_parser_mode")]
    pub parser_mode: String,
}

fn default_feishu_parser_mode() -> String {
    "strict".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillSourceConfigSync {
    #[serde(default = "default_sync_mode")]
    pub mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interval_minutes: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_synced_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

fn default_sync_mode() -> String {
    "manual".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSourceConfig {
    pub id: String,
    pub name: String,
    /// "feishu" | "github" | "folder" | "marketplace"
    pub r#type: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feishu: Option<SkillSourceConfigFeishu>,
    #[serde(default)]
    pub sync: SkillSourceConfigSync,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSkillDocumentContent {
    pub remote_id: String,
    pub title: String,
    pub markdown: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSkillDocument {
    pub content: RemoteSkillDocumentContent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSkillCandidate {
    pub id: String,
    pub source_id: String,
    pub remote_id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub content_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_url: Option<String>,
    /// "not_installed" | "installed" | "update_available" | "conflict"
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub skipped: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillSourceSyncResult {
    pub source_id: String,
    #[serde(default)]
    pub fetched: u32,
    #[serde(default)]
    pub skipped: u32,
    #[serde(default)]
    pub errors: Vec<String>,
    #[serde(default)]
    pub candidates: Vec<RemoteSkillCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillSourceHealth {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRemoteSkillResult {
    pub success: bool,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conflict_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSourceUpdateCheck {
    pub source_id: String,
    #[serde(default)]
    pub updates: Vec<RemoteSkillUpdateItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSkillUpdateItem {
    pub skill_path: String,
    pub skill_name: String,
    pub remote_id: String,
    pub local_hash: String,
    pub remote_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPlugin {
    #[serde(default, alias = "id")]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub marketplace: Option<String>,
    #[serde(default, rename = "pluginId")]
    pub plugin_id: Option<String>,
    /// Project directory this plugin was installed in (project/local scope only).
    #[serde(
        default,
        rename = "projectPath",
        skip_serializing_if = "Option::is_none"
    )]
    pub project_path: Option<String>,
    /// Catch-all for unknown fields
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginOperationResult {
    pub success: bool,
    pub message: String,
}

// ── Community skill types ──

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct CommunitySkillResult {
    pub id: String,
    pub name: String,
    pub skill_id: String,
    pub installs: u64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct CommunitySkillDetail {
    pub id: String,
    pub name: String,
    pub description: String,
    pub installs: u64,
    pub source: String,
    pub content: Option<String>,
    pub raw_url: Option<String>,
    pub skills_sh_url: Option<String>,
    pub github_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderHealth {
    pub available: bool,
    pub reason: Option<String>,
}

// ── MCP Registry API response types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpRegistrySearchResult {
    pub servers: Vec<McpRegistryServer>,
    pub next_cursor: Option<String>,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryServer {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub packages: Vec<McpRegistryPackage>,
    #[serde(default)]
    pub remotes: Vec<McpRegistryRemote>,
    #[serde(default)]
    pub repository: Option<McpRegistryRepository>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryPackage {
    #[serde(default)]
    pub registry_type: String,
    #[serde(default)]
    pub identifier: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub environment_variables: Vec<McpRegistryEnvVar>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryRemote {
    #[serde(rename = "type", default)]
    pub remote_type: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub headers: Vec<McpRegistryHeader>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryEnvVar {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub is_required: Option<bool>,
    #[serde(default)]
    pub is_secret: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryHeader {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub is_required: Option<bool>,
    #[serde(default)]
    pub is_secret: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryRepository {
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

// ── Configured MCP server ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfiguredMcpServer {
    pub name: String,
    pub server_type: String,
    pub scope: String,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub url: Option<String>,
    #[serde(default)]
    pub env_keys: Vec<String>,
    #[serde(default)]
    pub header_keys: Vec<String>,
}

// ── Keybinding types ──

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
#[serde(rename_all = "camelCase")]
pub struct PromptSearchResult {
    pub run_id: String,
    pub run_name: Option<String>,
    pub run_prompt: String,
    pub agent: String,
    pub model: Option<String>,
    pub status: RunStatus,
    pub started_at: String,
    pub matched_text: String,
    pub matched_seq: u64,
    pub matched_ts: String,
    /// Stable event ID: uuid (user_message) or message_id (message_complete).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_event_id: Option<String>,
    pub is_favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptFavorite {
    pub run_id: String,
    pub seq: u64,
    pub text: String,
    pub tags: Vec<String>,
    pub note: String,
    pub created_at: String,
}

// ── History search ──

/// History 页面搜索过滤条件
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSearchFilters {
    pub query: Option<String>,
    pub projects: Option<Vec<String>>,
    pub tools: Option<Vec<String>>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub cost_min: Option<f64>,
    pub cost_max: Option<f64>,
    pub statuses: Option<Vec<RunStatus>>,
    pub has_errors: Option<bool>,
    pub agents: Option<Vec<String>>,
    pub sort_by: Option<String>,
    pub sort_asc: Option<bool>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

/// History 搜索结果条目
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSearchResult {
    pub run_id: String,
    pub cwd: String,
    pub agent: String,
    pub model: Option<String>,
    pub status: RunStatus,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub name: Option<String>,
    pub prompt_preview: String,
    pub tools_used: Vec<String>,
    pub tool_call_count: u32,
    pub files_touched_count: u32,
    pub total_cost_usd: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub duration_ms: u64,
    pub num_turns: u64,
    pub has_errors: bool,
    pub error_summary: Option<String>,
}

/// Facet 统计（用于 filter UI 下拉选项）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FacetCount {
    pub value: String,
    pub count: usize,
}

/// History 页面 facets
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSearchFacets {
    pub projects: Vec<FacetCount>,
    pub tools: Vec<FacetCount>,
    pub agents: Vec<FacetCount>,
    pub cost_range: [f64; 2],
    pub date_range: [String; 2],
    pub total_runs: usize,
    pub total_cost: f64,
}

/// History 搜索响应（结果 + facets + 总数）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSearchResponse {
    pub results: Vec<RunSearchResult>,
    pub facets: RunSearchFacets,
    pub total_matching: usize,
}

// ── Team Run types ──
// MiWarp's own team orchestration system (stored in ~/.miwarp/team-runs/)

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TeamRunStatus {
    Created,
    Planning,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl std::fmt::Display for TeamRunStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TeamRunStatus::Created => write!(f, "created"),
            TeamRunStatus::Planning => write!(f, "planning"),
            TeamRunStatus::Running => write!(f, "running"),
            TeamRunStatus::Completed => write!(f, "completed"),
            TeamRunStatus::Failed => write!(f, "failed"),
            TeamRunStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TeamMemberStatus {
    Pending,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamPresetMember {
    pub id: String,
    pub name: String,
    pub role: String,
    pub system_prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamPreset {
    pub id: String,
    pub name: String,
    pub description: String,
    pub members: Vec<TeamPresetMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberRun {
    pub id: String,
    pub member_id: String,
    pub member_name: String,
    pub role: String,
    pub task: String,
    pub status: TeamMemberStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamRun {
    pub id: String,
    pub team_name: String,
    pub preset_id: String,
    pub cwd: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_run_id: Option<String>,
    pub prompt: String,
    #[serde(default = "default_team_mode")]
    pub mode: String,
    pub status: TeamRunStatus,
    pub member_runs: Vec<TeamMemberRun>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lead_run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lead_plan: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn default_team_mode() -> String {
    "plan_first".to_string()
}
