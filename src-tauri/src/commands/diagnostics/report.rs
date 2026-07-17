use crate::agent::claude_stream::augmented_path;
use crate::agent::cli_update::CliInstallMethod;
use crate::agent::ssh::{expand_local_tilde, shell_escape};
use crate::models::{
    ApiTestResult, AuthDiagnostics, ClaudeMdInfo, CliCheckResult, CliDiagnostics, CliDistTags,
    ConfigDiagnostics, ConfigIssue, DiagnosticsReport, LocalProxyStatus, ProjectDiagnostics,
    ProjectInitStatus, RemoteTestResult, ServicesDiagnostics, SshKeyInfo, SystemDiagnostics,
    UpdateCliResult,
};
use crate::process_ext::HideConsole;
use std::path::Path;
use std::process::Command;

/// One-click update for Claude Code. Claude Code ships via two channels that
/// don't share a single update path:
/// - Official installer (macOS/Linux: `~/.local/bin/claude` symlink to
///   `~/.local/share/claude/versions/<ver>`). The installer exposes a
///   `claude update` subcommand which we must use — running
///   `npm install -g @anthropic-ai/claude-code` only updates a parallel copy
///   under `node_modules`, leaving the user's actual `claude` binary stale.
/// - npm (`npm install -g @anthropic-ai/claude-code`).
///
/// We detect which one is in use by looking at the `which claude` path: if it
/// resolves inside a `node_modules` tree, the user is on the npm channel;
/// otherwise we assume the official installer and prefer `claude update`.
/// Falls back to npm if `claude update` itself fails (e.g. user has the
/// npm-global copy in PATH but also has the official installer shadowing it).
#[tauri::command]

pub async fn run_diagnostics(cwd: String) -> Result<DiagnosticsReport, String> {
    let has_valid_cwd = !cwd.trim().is_empty() && Path::new(&cwd).is_dir();
    log::debug!(
        "[diagnostics] run_diagnostics: cwd={:?}, has_valid_cwd={}",
        cwd,
        has_valid_cwd
    );

    // Async checks in parallel
    let (cli, dist, auth, community, mcp_reg) = tokio::join!(
        check_cli_inner(),
        fetch_dist_tags_inner(),
        check_auth_inner(),
        check_community_inner(),
        check_mcp_reg_inner(),
    );

    // Merge CLI + dist tags
    let cli = CliDiagnostics {
        latest: dist.0,
        stable: dist.1,
        auto_update_channel: dist.2,
        ..cli
    };

    // Sync checks
    let home = crate::storage::dirs_next()
        .map(|h| h.join(".claude"))
        .unwrap_or_default();
    let settings_issues = validate_config_files_at(&home, &cwd, has_valid_cwd);
    let keybinding_issues = validate_keybindings_at(&home);
    let mcp_issues = validate_mcp_configs_at(&home, &cwd, has_valid_cwd);
    let env_var_issues = check_env_vars();
    let claude_md_files = scan_claude_md_files_at(&home, &cwd, has_valid_cwd);
    let has_claude_md = claude_md_files
        .iter()
        .any(|f| f.path.ends_with("CLAUDE.md"));
    let sandbox = check_sandbox();
    let locks = list_lock_files_at(&home);

    log::debug!(
        "[diagnostics] cli check: found={}, version={:?}",
        cli.found,
        cli.version
    );
    log::debug!(
        "[diagnostics] auth check: oauth={}, api_key={}",
        auth.has_oauth,
        auth.has_api_key
    );
    log::debug!(
        "[diagnostics] config validation: settings_issues={}, mcp_issues={}, keybinding_issues={}, env_issues={}",
        settings_issues.len(),
        mcp_issues.len(),
        keybinding_issues.len(),
        env_var_issues.len()
    );

    Ok(DiagnosticsReport {
        cli,
        auth,
        project: ProjectDiagnostics {
            cwd: cwd.clone(),
            has_claude_md,
            claude_md_files,
            skipped_project_scope: !has_valid_cwd,
        },
        configs: ConfigDiagnostics {
            settings_issues,
            keybinding_issues,
            mcp_issues,
            env_var_issues,
        },
        services: ServicesDiagnostics {
            community_registry: community,
            mcp_registry: mcp_reg,
        },
        system: SystemDiagnostics {
            sandbox_available: sandbox,
            lock_files: locks,
        },
    })
}

// ── Sub-check: CLI ──

async fn check_cli_inner() -> CliDiagnostics {
    let aug_path = augmented_path();
    // Reuse check_agent_cli for CLI detection + version
    let cli = check_agent_cli("claude".into())
        .await
        .unwrap_or(CliCheckResult {
            agent: "claude".into(),
            found: false,
            path: None,
            version: None,
        });

    let ripgrep_available = Command::new("rg")
        .arg("--version")
        .env("PATH", &aug_path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .hide_console()
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    CliDiagnostics {
        found: cli.found,
        version: cli.version,
        path: cli.path,
        latest: None,              // filled by caller after dist tags fetch
        stable: None,              // filled by caller
        auto_update_channel: None, // filled by caller
        ripgrep_available,
    }
}

// ── Sub-check: dist tags + auto-update channel ──

async fn fetch_dist_tags_inner() -> (Option<String>, Option<String>, Option<String>) {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[diagnostics] dist tags: client build failed: {}", e);
            return (None, None, None);
        }
    };

    let resp = client
        .get("https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags")
        .header("Accept", "application/json")
        .send()
        .await;

    let (latest, stable) = match resp {
        Ok(r) if r.status().is_success() => {
            let body: serde_json::Value = match r.json().await {
                Ok(v) => v,
                Err(e) => {
                    log::warn!("[diagnostics] dist tags: json parse failed: {}", e);
                    return (None, None, None);
                }
            };
            (
                body.get("latest")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                body.get("stable")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            )
        }
        Ok(r) => {
            log::debug!("[diagnostics] dist tags: HTTP {}", r.status());
            (None, None)
        }
        Err(e) => {
            log::warn!("[diagnostics] dist tags fetch failed: {}", e);
            (None, None)
        }
    };

    // Auto-update channel from CLI config
    let cli_config = crate::storage::cli_config::load_cli_config();
    let auto_update_channel = cli_config
        .get("autoUpdatesChannel")
        .and_then(|v| v.as_str())
        .map(String::from);

    (latest, stable, auto_update_channel)
}

// ── Sub-check: Auth ──

async fn check_auth_inner() -> AuthDiagnostics {
    let (has_oauth, oauth_account) = match tokio::time::timeout(
        std::time::Duration::from_secs(12),
        super::onboarding::check_cli_oauth(),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => {
            log::warn!("[diagnostics] oauth check timed out");
            (false, None)
        }
    };

    let cli_config = crate::storage::cli_config::load_cli_config();
    let (api_key, api_key_source) = super::onboarding::detect_cli_api_key(&cli_config);
    let has_api_key = api_key.is_some();
    let api_key_hint = api_key.as_ref().map(|k| {
        if k.len() > 4 {
            format!("...{}", &k[k.len() - 4..])
        } else {
            "***".to_string()
        }
    });

    let user_settings = crate::storage::settings::get_user_settings();
    let app_has_credentials =
        user_settings.anthropic_api_key.is_some() || !user_settings.platform_credentials.is_empty();
    let app_platform_name = user_settings.active_platform_id.clone();

    log::debug!(
        "[diagnostics] auth: oauth={}, api_key={}, app_creds={}",
        has_oauth,
        has_api_key,
        app_has_credentials
    );

    AuthDiagnostics {
        has_oauth,
        oauth_account,
        has_api_key,
        api_key_hint,
        api_key_source,
        app_has_credentials,
        app_platform_name,
    }
}

// ── Sub-check: Community & MCP registry health ──

async fn check_community_inner() -> Option<bool> {
    match tokio::time::timeout(
        std::time::Duration::from_secs(10),
        crate::storage::community_skills::health_check(),
    )
    .await
    {
        Ok(health) => Some(health.available),
        Err(_) => {
            log::warn!("[diagnostics] community health check timed out");
            None
        }
    }
}

async fn check_mcp_reg_inner() -> Option<bool> {
    match tokio::time::timeout(
        std::time::Duration::from_secs(10),
        crate::storage::mcp_registry::health_check(),
    )
    .await
    {
        Ok(health) => Some(health.available),
        Err(_) => {
            log::warn!("[diagnostics] mcp registry health check timed out");
            None
        }
    }
}

// ── Sub-check: Config file validation ──

fn validate_config_files_at(home: &Path, cwd: &str, has_valid_cwd: bool) -> Vec<ConfigIssue> {
    let mut issues = Vec::new();

    // User scope: ~/.claude/settings.json
    let user_settings_path = home.join("settings.json");
    validate_json_file(&user_settings_path, "user", &mut issues);

    // Project scope: {cwd}/.claude/settings.json
    if has_valid_cwd {
        let project_settings_path = Path::new(cwd).join(".claude").join("settings.json");
        validate_json_file(&project_settings_path, "project", &mut issues);
    }

    issues
}

fn validate_json_file(path: &Path, scope: &str, issues: &mut Vec<ConfigIssue>) {
    match std::fs::read_to_string(path) {
        Ok(content) if content.trim().is_empty() => {} // Empty file = OK (same as not found)
        Ok(content) => {
            if let Err(e) = serde_json::from_str::<serde_json::Value>(&content) {
                issues.push(ConfigIssue {
                    scope: scope.to_string(),
                    file: path.display().to_string(),
                    severity: "error".to_string(),
                    message: format!("Invalid JSON: {}", e),
                });
            }
        }
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            issues.push(ConfigIssue {
                scope: scope.to_string(),
                file: path.display().to_string(),
                severity: "warning".to_string(),
                message: format!("Cannot read file: {}", e),
            });
        }
        _ => {} // File not found is OK
    }
}

// ── Sub-check: Keybindings validation ──

fn validate_keybindings_at(home: &Path) -> Vec<ConfigIssue> {
    let mut issues = Vec::new();
    let path = home.join("keybindings.json");

    match std::fs::read_to_string(&path) {
        Ok(content) => {
            match serde_json::from_str::<serde_json::Value>(&content) {
                Ok(v) => {
                    if !v.is_object() {
                        issues.push(ConfigIssue {
                            scope: "user".to_string(),
                            file: path.display().to_string(),
                            severity: "error".to_string(),
                            message: "Top-level value must be an object".to_string(),
                        });
                    } else if let Some(obj) = v.as_object() {
                        // Best-effort: values should be string or null
                        for (key, val) in obj {
                            if !val.is_string() && !val.is_null() {
                                issues.push(ConfigIssue {
                                    scope: "user".to_string(),
                                    file: path.display().to_string(),
                                    severity: "warning".to_string(),
                                    message: format!(
                                        "Key \"{}\" — value should be string or null (best-effort)",
                                        key
                                    ),
                                });
                            }
                        }
                    }
                }
                Err(e) => {
                    issues.push(ConfigIssue {
                        scope: "user".to_string(),
                        file: path.display().to_string(),
                        severity: "error".to_string(),
                        message: format!("Invalid JSON: {}", e),
                    });
                }
            }
        }
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            issues.push(ConfigIssue {
                scope: "user".to_string(),
                file: path.display().to_string(),
                severity: "warning".to_string(),
                message: format!("Cannot read file: {}", e),
            });
        }
        _ => {} // Not found is OK
    }

    issues
}

// ── Sub-check: MCP config validation ──

fn validate_mcp_configs_at(home: &Path, cwd: &str, has_valid_cwd: bool) -> Vec<ConfigIssue> {
    let mut issues = Vec::new();
    let home_parent = home.parent().unwrap_or(home);

    // 1. ~/.claude.json → top-level mcpServers (user scope)
    let claude_json_path = home_parent.join(".claude.json");
    if let Some(root) = read_json_file(&claude_json_path) {
        if let Some(servers) = root.get("mcpServers") {
            validate_mcp_servers(servers, "user", &claude_json_path, &mut issues);
        }

        // 2. ~/.claude.json → projects[cwd].mcpServers (local scope)
        if has_valid_cwd {
            if let Some(projects) = root.get("projects").and_then(|p| p.as_object()) {
                if let Some(proj) = projects.get(cwd).and_then(|p| p.as_object()) {
                    if let Some(servers) = proj.get("mcpServers") {
                        validate_mcp_servers(servers, "local", &claude_json_path, &mut issues);
                    }
                }
            }
        }
    }

    // 3. ~/.claude/settings.json → mcpServers (user scope fallback)
    let settings_path = home.join("settings.json");
    if let Some(root) = read_json_file(&settings_path) {
        if let Some(servers) = root.get("mcpServers") {
            validate_mcp_servers(servers, "user", &settings_path, &mut issues);
        }
    }

    // 4. {cwd}/.mcp.json → mcpServers (project scope)
    if has_valid_cwd {
        let mcp_json_path = Path::new(cwd).join(".mcp.json");
        if let Some(root) = read_json_file(&mcp_json_path) {
            if let Some(servers) = root.get("mcpServers") {
                validate_mcp_servers(servers, "project", &mcp_json_path, &mut issues);
            }
        }
    }

    issues
}

fn read_json_file(path: &Path) -> Option<serde_json::Value> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn validate_mcp_servers(
    servers: &serde_json::Value,
    scope: &str,
    file: &Path,
    issues: &mut Vec<ConfigIssue>,
) {
    let obj = match servers.as_object() {
        Some(o) => o,
        None => {
            issues.push(ConfigIssue {
                scope: scope.to_string(),
                file: file.display().to_string(),
                severity: "error".to_string(),
                message: "mcpServers must be an object".to_string(),
            });
            return;
        }
    };

    for (name, entry) in obj {
        let entry_obj = match entry.as_object() {
            Some(o) => o,
            None => {
                issues.push(ConfigIssue {
                    scope: scope.to_string(),
                    file: file.display().to_string(),
                    severity: "error".to_string(),
                    message: format!("\"{}\" — entry must be an object", name),
                });
                continue;
            }
        };

        let transport_type = entry_obj
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("stdio");

        match transport_type {
            "stdio" if !entry_obj.contains_key("command") || !entry_obj["command"].is_string() => {
                issues.push(ConfigIssue {
                    scope: scope.to_string(),
                    file: file.display().to_string(),
                    severity: "error".to_string(),
                    message: format!("\"{}\" — missing \"command\" field (type=stdio)", name),
                });
            }
            "http" | "sse" if !entry_obj.contains_key("url") || !entry_obj["url"].is_string() => {
                issues.push(ConfigIssue {
                    scope: scope.to_string(),
                    file: file.display().to_string(),
                    severity: "error".to_string(),
                    message: format!(
                        "\"{}\" — missing \"url\" field (type={})",
                        name, transport_type
                    ),
                });
            }
            _ => {} // Valid or unknown transport type
        }
    }
}

// ── Sub-check: Environment variables ──

fn check_env_vars() -> Vec<ConfigIssue> {
    let mut issues = Vec::new();

    for &(name, min, max) in ENV_VAR_LIMITS {
        if let Ok(val_str) = std::env::var(name) {
            match val_str.parse::<u64>() {
                Ok(val) if val < min || val > max => {
                    issues.push(ConfigIssue {
                        scope: "env".to_string(),
                        file: name.to_string(),
                        severity: "warning".to_string(),
                        message: format!("{}={} (valid range: {}–{})", name, val, min, max),
                    });
                }
                Err(_) => {
                    issues.push(ConfigIssue {
                        scope: "env".to_string(),
                        file: name.to_string(),
                        severity: "warning".to_string(),
                        message: format!("{}={} — not a valid integer", name, val_str),
                    });
                }
                _ => {} // In range, OK
            }
        }
    }

    issues
}

// ── Sub-check: CLAUDE.md files ──

fn scan_claude_md_files_at(home: &Path, cwd: &str, has_valid_cwd: bool) -> Vec<ClaudeMdInfo> {
    let mut files = Vec::new();

    // ~/.claude/CLAUDE.md
    let global_path = home.join("CLAUDE.md");
    if let Ok(content) = std::fs::read_to_string(&global_path) {
        files.push(ClaudeMdInfo {
            path: global_path.display().to_string(),
            size_chars: content.chars().count(),
        });
    }

    if has_valid_cwd {
        // {cwd}/CLAUDE.md
        let cwd_path = Path::new(cwd).join("CLAUDE.md");
        if let Ok(content) = std::fs::read_to_string(&cwd_path) {
            files.push(ClaudeMdInfo {
                path: cwd_path.display().to_string(),
                size_chars: content.chars().count(),
            });
        }

        // {cwd}/.claude/CLAUDE.md
        let cwd_dot_path = Path::new(cwd).join(".claude").join("CLAUDE.md");
        if let Ok(content) = std::fs::read_to_string(&cwd_dot_path) {
            files.push(ClaudeMdInfo {
                path: cwd_dot_path.display().to_string(),
                size_chars: content.chars().count(),
            });
        }
    }

    files
}

// ── Sub-check: Sandbox ──

fn check_sandbox() -> Option<bool> {
    if cfg!(target_os = "macos") {
        Some(Path::new("/usr/bin/sandbox-exec").exists())
    } else {
        None
    }
}

// ── Sub-check: Lock files ──

fn list_lock_files_at(home: &Path) -> Vec<String> {
    let locks_dir = home.join("locks");
    match std::fs::read_dir(&locks_dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect(),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
