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

pub async fn check_agent_cli(agent: String) -> Result<CliCheckResult, String> {
    let binary = match agent.as_str() {
        "claude" => "claude",
        "codex" => "codex",
        "mimo" | "mimocode" => "mimo",
        "opencode" => "opencode",
        "cursor" => "agent",
        _ => return Err(format!("Unknown agent: {}", agent)),
    };

    log::debug!("[diagnostics] check_agent_cli: agent={}", agent);
    let aug_path = augmented_path();

    // Check if binary exists (cross-platform: uses `where` on Windows, `which` on Unix)
    let (found, path) = match crate::agent::claude_stream::which_binary(binary) {
        Some(p) => (true, Some(p)),
        None => (false, None),
    };

    // Get version if found
    let version = if found {
        let ver_output = Command::new(binary)
            .arg("--version")
            .env("PATH", &aug_path)
            .hide_console()
            .output();
        match ver_output {
            Ok(output) if output.status.success() => {
                let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
                // Strip trailing suffix like " (Claude Code)" to get bare semver
                Some(raw.find(" (").map(|i| raw[..i].to_string()).unwrap_or(raw))
            }
            _ => None,
        }
    } else {
        None
    };

    log::debug!(
        "[diagnostics] check_agent_cli result: agent={}, found={}, path={:?}",
        agent,
        found,
        path
    );
    Ok(CliCheckResult {
        agent,
        found,
        path,
        version,
    })
}

/// Multi-source detection for known CLI tools. Unlike `check_cli_binary`
/// (which only probes `which <name>`), this dispatches to a per-tool
/// detector that knows about the tool's install channels — Spotlight for
/// macOS apps, `dpkg -l` for Linux packages, etc. — so we don't miss
/// DMG-installed tools like CC-Switch that aren't on `PATH`.
///
/// Currently only CC-Switch has a dedicated detector; other tools fall
/// through to the generic PATH probe.
#[tauri::command]
pub async fn detect_cli_tool(tool_id: String) -> Result<DetectCliToolResult, String> {
    use crate::agent::cli_update::detect_ccswitch;

    let info = match tool_id.as_str() {
        "ccswitch" | "cc-switch" => detect_ccswitch(),
        // For tools without a dedicated detector, fall through to a generic
        // PATH probe and synthesize an InstallInfo.
        other => {
            let name = match other {
                "claude-code" | "claude" => "claude",
                "codex" => "codex",
                "mimo" | "mimocode" => "mimo",
                _ => other,
            };
            crate::agent::cli_update::detect_via_path(name)
        }
    };

    log::debug!(
        "[diagnostics] detect_cli_tool: id={} found={} version={:?} method={}",
        tool_id,
        info.found,
        info.version,
        info.method.as_str()
    );

    Ok(DetectCliToolResult {
        tool_id,
        found: info.found,
        version: info.version,
        install_method: info.method.as_str().to_string(),
        install_path: info.install_path,
    })
}

/// Tool-agnostic install descriptor returned by `detect_cli_tool`. Mirrors
/// `cli_update::InstallInfo` but with snake_case fields the frontend can
/// consume directly.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DetectCliToolResult {
    pub tool_id: String,
    pub found: bool,
    pub version: Option<String>,
    pub install_method: String,
    pub install_path: Option<String>,
}

/// Probe an arbitrary CLI binary by name. Unlike `check_agent_cli`, this is
/// not tied to the MiWarp "agent" abstraction (e.g. `claude`/`codex`) — it's a
/// generic `which <name>` + `<name> --version` probe used by the CLI update
/// registry for tools like `CC-Switch` that aren't session agents.
///
/// Prefer `detect_cli_tool` for known tool IDs — it knows about non-PATH
/// install channels.
#[tauri::command]
pub async fn check_cli_binary(name: String) -> Result<CliCheckResult, String> {
    let aug_path = augmented_path();

    let (found, path) = match crate::agent::claude_stream::which_binary(&name) {
        Some(p) => (true, Some(p)),
        None => (false, None),
    };

    let version = if found {
        let probe = Command::new(&name)
            .arg("--version")
            .env("PATH", &aug_path)
            .hide_console()
            .output();
        match probe {
            Ok(output) if output.status.success() => {
                let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let cleaned = raw.find(" (").map(|i| raw[..i].to_string()).unwrap_or(raw);
                Some(cleaned)
            }
            _ => None,
        }
    } else {
        None
    };

    log::debug!(
        "[diagnostics] check_cli_binary name={} found={} path={:?} version={:?}",
        name,
        found,
        path,
        version
    );
    Ok(CliCheckResult {
        agent: name,
        found,
        path,
        version,
    })
}

// ── Local proxy detection ──

async fn detect_proxy_inner(proxy_id: &str, base_url: &str) -> LocalProxyStatus {
    log::debug!(
        "[diagnostics] detect_local_proxy: proxy_id={}, base_url={}",
        proxy_id,
        base_url
    );
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .no_proxy() // Local services must be reached directly, never via system proxy
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::debug!(
                "[diagnostics] detect_local_proxy: client build failed: {}",
                e
            );
            return LocalProxyStatus {
                proxy_id: proxy_id.to_string(),
                running: false,
                needs_auth: false,
                base_url: base_url.to_string(),
                error: Some(format!("HTTP client build failed: {}", e)),
            };
        }
    };
    let url = format!("{}/v1/models", base_url.trim_end_matches('/'));
    match client.get(&url).send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            // Any HTTP response = service is running (connection succeeded).
            // 401/403 = running but needs auth. All others = running normally.
            let needs_auth = status == 401 || status == 403;
            log::debug!(
                "[diagnostics] detect_local_proxy result: proxy_id={}, running=true, status={}, needs_auth={}",
                proxy_id,
                status,
                needs_auth
            );
            LocalProxyStatus {
                proxy_id: proxy_id.to_string(),
                running: true,
                needs_auth,
                base_url: base_url.to_string(),
                error: None,
            }
        }
        Err(e) => {
            log::debug!(
                "[diagnostics] detect_local_proxy result: proxy_id={}, running=false, err={}",
                proxy_id,
                e
            );
            LocalProxyStatus {
                proxy_id: proxy_id.to_string(),
                running: false,
                needs_auth: false,
                base_url: base_url.to_string(),
                error: Some(e.to_string()),
            }
        }
    }
}

#[tauri::command]
