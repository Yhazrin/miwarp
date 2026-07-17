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

pub async fn detect_local_proxy(
    proxy_id: String,
    base_url: String,
) -> Result<LocalProxyStatus, String> {
    Ok(detect_proxy_inner(&proxy_id, &base_url).await)
}

// ── API connectivity test ──

/// Probe model used when the user hasn't configured one — just for connectivity testing.
const PROBE_MODEL: &str = "claude-sonnet-4-6";

async fn test_api_inner(
    api_key: &str,
    base_url: &str,
    auth_env_var: &str,
    model: &str,
) -> ApiTestResult {
    let is_probe = model.is_empty();
    let effective_model = if is_probe { PROBE_MODEL } else { model };
    let effective_base_url = if base_url.is_empty() {
        "https://api.anthropic.com"
    } else {
        base_url
    };
    let url = format!("{}/v1/messages", effective_base_url.trim_end_matches('/'));

    log::debug!(
        "[diagnostics] test_api_connectivity: url={}, auth={}, model={}, probe={}",
        url,
        auth_env_var,
        effective_model,
        is_probe
    );
    log::debug!(
        "[diagnostics] test_api_connectivity: key_len={}",
        api_key.len()
    );

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::debug!(
                "[diagnostics] test_api_connectivity: client build failed: {}",
                e
            );
            return ApiTestResult {
                success: false,
                latency_ms: 0,
                reply: None,
                error: Some(format!("HTTP client build failed: {}", e)),
                partial: false,
            };
        }
    };

    let mut req = client
        .post(&url)
        .header("content-type", "application/json")
        .header("anthropic-version", "2023-06-01");

    req = match auth_env_var {
        "ANTHROPIC_AUTH_TOKEN" => req.header("authorization", format!("Bearer {}", api_key)),
        _ => req.header("x-api-key", api_key),
    };

    let body = serde_json::json!({
        "model": effective_model,
        "max_tokens": 1,
        "messages": [{"role": "user", "content": "hi"}]
    });

    let start = std::time::Instant::now();
    let resp = match req.json(&body).send().await {
        Ok(r) => r,
        Err(e) => {
            let latency_ms = start.elapsed().as_millis() as u64;
            let error = if e.is_timeout() {
                "Connection timed out".to_string()
            } else if e.is_connect() {
                "Connection refused — is the service running?".to_string()
            } else {
                format!("Request failed: {}", e)
            };
            log::debug!(
                "[diagnostics] test_api_connectivity: failed, error={}",
                error
            );
            return ApiTestResult {
                success: false,
                latency_ms,
                reply: None,
                error: Some(error),
                partial: false,
            };
        }
    };

    let latency_ms = start.elapsed().as_millis() as u64;
    let status = resp.status().as_u16();

    if status == 200 {
        // Parse successful response — must contain content[0].text to count as valid
        let body_text = resp.text().await.unwrap_or_default();
        let reply = serde_json::from_str::<serde_json::Value>(&body_text)
            .ok()
            .and_then(|v| {
                v.get("content")?
                    .get(0)?
                    .get("text")?
                    .as_str()
                    .map(String::from)
            })
            .map(|s| {
                if s.len() > 50 {
                    format!("{}…", &s[..50])
                } else {
                    s
                }
            });

        if reply.is_some() {
            log::debug!(
                "[diagnostics] test_api_connectivity: success, latency={}ms",
                latency_ms
            );
            ApiTestResult {
                success: true,
                latency_ms,
                reply,
                error: None,
                partial: false,
            }
        } else {
            log::debug!("[diagnostics] test_api_connectivity: 200 but invalid response body");
            ApiTestResult {
                success: false,
                latency_ms,
                reply: None,
                error: Some(
                    "Received 200 but response is not a valid Messages API reply".to_string(),
                ),
                partial: false,
            }
        }
    } else {
        // Parse error response
        let body_text = resp.text().await.unwrap_or_default();
        let api_error = serde_json::from_str::<serde_json::Value>(&body_text)
            .ok()
            .and_then(|v| v.get("error")?.get("message")?.as_str().map(String::from));

        // Probe mode: 400 with model-related error means auth+connectivity OK, just wrong model
        let is_model_error = status == 400
            && api_error
                .as_deref()
                .map(|m| {
                    let lower = m.to_lowercase();
                    lower.contains("model") || lower.contains("not found")
                })
                .unwrap_or(false);

        if is_probe && is_model_error {
            log::debug!(
                "[diagnostics] test_api_connectivity: partial success (probe model rejected), latency={}ms",
                latency_ms
            );
            return ApiTestResult {
                success: true,
                latency_ms,
                reply: None,
                error: None,
                partial: true,
            };
        }

        let error = match status {
            401 | 403 => "Authentication failed — check your API key".to_string(),
            404 => "Endpoint not found — check your base URL".to_string(),
            429 => "Rate limited — try again later".to_string(),
            _ => {
                if let Some(msg) = api_error {
                    format!("HTTP {}: {}", status, msg)
                } else {
                    format!("HTTP {}", status)
                }
            }
        };

        log::debug!(
            "[diagnostics] test_api_connectivity: failed, status={}, error={}",
            status,
            error
        );
        ApiTestResult {
            success: false,
            latency_ms,
            reply: None,
            error: Some(error),
            partial: false,
        }
    }
}

#[tauri::command]
pub async fn test_api_connectivity(
    api_key: String,
    base_url: String,
    auth_env_var: String,
    model: String,
) -> Result<ApiTestResult, String> {
    Ok(test_api_inner(&api_key, &base_url, &auth_env_var, &model).await)
}

/// Platform-aware message for missing SSH binaries.
fn ssh_not_found_msg(binary: &str) -> String {
    #[cfg(windows)]
    {
        format!(
            "{} not found. Install OpenSSH: Settings → Apps → Optional Features → OpenSSH Client.",
            binary
        )
    }
    #[cfg(not(windows))]
    {
        format!(
            "{} not found. Please install OpenSSH (e.g. apt install openssh-client / brew install openssh).",
            binary
        )
    }
}

/// Test SSH connectivity and Claude CLI availability on a remote host.
/// Uses async tokio::process::Command with timeout (audit #8).
#[tauri::command]
pub async fn test_remote_host(
    host: String,
    user: String,
    port: Option<u16>,
    key_path: Option<String>,
    remote_claude_path: Option<String>,
) -> Result<RemoteTestResult, String> {
    use tokio::process::Command as TokioCommand;

    if crate::agent::claude_stream::which_binary("ssh").is_none() {
        return Ok(RemoteTestResult {
            ssh_ok: false,
            cli_found: false,
            cli_path: None,
            cli_version: None,
            error: Some(ssh_not_found_msg("ssh")),
        });
    }

    let port = port.unwrap_or(22);
    let target = format!("{}@{}", user, host);
    log::debug!(
        "[diagnostics] test_remote_host: target={}, port={}, key={:?}",
        target,
        port,
        key_path
    );

    // Step 1: SSH connectivity check (15s timeout)
    let mut ssh_cmd = TokioCommand::new("ssh");
    ssh_cmd.args([
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "StrictHostKeyChecking=accept-new",
    ]);
    ssh_cmd.arg("-p").arg(port.to_string());
    if let Some(ref key) = key_path {
        ssh_cmd.args(["-i", &expand_local_tilde(key)]);
    }
    ssh_cmd.arg(&target).arg("echo ok");
    ssh_cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .hide_console()
        .kill_on_drop(true);

    let ssh_result =
        tokio::time::timeout(std::time::Duration::from_secs(15), ssh_cmd.output()).await;

    let (ssh_ok, ssh_error) = match ssh_result {
        Ok(Ok(output)) if output.status.success() => (true, None),
        Ok(Ok(output)) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            (
                false,
                Some(format!(
                    "SSH failed (exit {:?}): {}",
                    output.status.code(),
                    stderr
                )),
            )
        }
        Ok(Err(e)) => (false, Some(format!("SSH spawn failed: {}", e))),
        Err(_) => (false, Some("SSH connection timed out (15s)".into())),
    };

    if !ssh_ok {
        log::debug!(
            "[diagnostics] test_remote_host: SSH failed: {:?}",
            ssh_error
        );
        return Ok(RemoteTestResult {
            ssh_ok: false,
            cli_found: false,
            cli_version: None,
            cli_path: None,
            error: ssh_error,
        });
    }

    // Step 2: CLI check (15s timeout)
    let claude_bin = remote_claude_path.as_deref().unwrap_or("claude");
    let escaped_bin = shell_escape(claude_bin);
    // `command -v` is POSIX-portable (works on Linux, macOS, and most BSDs).
    // `which` is not guaranteed on all systems and behaves inconsistently.
    let check_cmd_str = format!("command -v {} && {} --version", escaped_bin, escaped_bin);

    let mut cli_cmd = TokioCommand::new("ssh");
    cli_cmd.args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"]);
    cli_cmd.arg("-p").arg(port.to_string());
    if let Some(ref key) = key_path {
        cli_cmd.args(["-i", &expand_local_tilde(key)]);
    }
    cli_cmd.arg(&target).arg(&check_cmd_str);
    cli_cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .hide_console()
        .kill_on_drop(true);

    let cli_result =
        tokio::time::timeout(std::time::Duration::from_secs(15), cli_cmd.output()).await;

    let (cli_found, cli_path, cli_version, cli_error) = match cli_result {
        Ok(Ok(output)) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let lines: Vec<&str> = stdout.lines().collect();
            let path = lines.first().map(|s| s.to_string());
            let version = lines.get(1).map(|s| s.to_string());
            (true, path, version, None)
        }
        Ok(Ok(output)) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            (
                false,
                None,
                None,
                Some(format!("CLI not found: {}", stderr)),
            )
        }
        Ok(Err(e)) => (false, None, None, Some(format!("CLI check failed: {}", e))),
        Err(_) => (false, None, None, Some("CLI check timed out (15s)".into())),
    };

    log::debug!(
        "[diagnostics] test_remote_host result: ssh_ok={}, cli_found={}, path={:?}, version={:?}",
        ssh_ok,
        cli_found,
        cli_path,
        cli_version
    );

    Ok(RemoteTestResult {
        ssh_ok,
        cli_found,
        cli_version,
        cli_path,
        error: cli_error,
    })
}

/// Check if a project directory has been initialized (has CLAUDE.md).
#[tauri::command]
