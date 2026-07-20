use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
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
