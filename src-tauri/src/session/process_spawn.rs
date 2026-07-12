//! Process spawning: CLI / Cursor / MiMo process generation + preflight + one-shot print.
//!
//! Extracted from `commands/session.rs` (P0+P1+P2 workbench repair, 2026-06-28).
//! This module owns `tokio::process::Command` lifecycle. Tauri command wrappers in
//! `commands::session` are thin shims that call into here.

use crate::agent::adapter::{self, AdapterSettings};
use crate::agent::attachment::AttachmentData;
use crate::agent::claude_stream;
use crate::models::{RemoteHost, RunMeta, SessionMode};
use crate::process_ext::HideConsole;
use crate::storage;
use crate::web_server::broadcaster::BroadcastEmitter;
use std::sync::Arc;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

/// Check whether a URL points to a local address (`localhost`, `127.x.x.x`, `::1`, `0.0.0.0`).
pub(crate) fn is_local_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    if host == "localhost" {
        return true;
    }
    // Parse as IP and check loopback/unspecified
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return ip.is_loopback() || ip.is_unspecified();
    }
    // Handle bracketed IPv6 like [::1]
    let trimmed = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = trimmed.parse::<std::net::IpAddr>() {
        return ip.is_loopback() || ip.is_unspecified();
    }
    false
}

/// Preflight reachability check for a provider's `base_url`.
///
/// Sends `HEAD` to `{base_url}/v1/models` — any HTTP response (even 401/403/405)
/// means the service is online. Only connection failure/timeout returns `Err`.
pub(crate) async fn preflight_check_base_url(
    base_url: Option<&str>,
    platform_id: Option<&str>,
) -> Result<(), String> {
    let Some(url) = base_url else {
        log::debug!("[session] preflight: no base_url, skipping");
        return Ok(());
    };

    let is_local = is_local_url(url);
    let timeout = if is_local {
        std::time::Duration::from_secs(1)
    } else {
        std::time::Duration::from_secs(3)
    };

    let check_url = format!("{}/v1/models", url.trim_end_matches('/'));
    log::debug!(
        "[session] preflight: checking {} (local={}, timeout={:?})",
        check_url,
        is_local,
        timeout
    );

    let mut builder = reqwest::Client::builder().timeout(timeout);
    if is_local {
        builder = builder.no_proxy();
    }
    let client = builder
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    match client.head(&check_url).send().await {
        Ok(resp) => {
            log::debug!(
                "[session] preflight: {} responded with status {}",
                url,
                resp.status()
            );
            Ok(())
        }
        Err(e) => {
            let display_name = platform_id
                .map(crate::commands::onboarding::preset_name)
                .unwrap_or_else(|| "Provider".to_string());

            let suggestion = if is_local {
                format!(
                    "Make sure {} is running and listening on {}",
                    display_name, url
                )
            } else {
                format!(
                    "Check your network connection and verify {} is accessible",
                    url
                )
            };

            log::warn!("[session] preflight: {} unreachable: {}", url, e);
            Err(format!(
                "{} is unreachable ({}). {}",
                display_name, url, suggestion
            ))
        }
    }
}

// ── Per-runtime spawners ──

/// Spawn a MiMo-Code process via `mimo run --format json`.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn spawn_mimo_process(
    cwd: &str,
    _prompt: &str,
    settings: &AdapterSettings,
    session_mode: &SessionMode,
    resume_session_id: Option<&str>,
    _is_new: bool,
) -> Result<
    (
        tokio::process::Child,
        tokio::process::ChildStdin,
        tokio::process::ChildStdout,
        tokio::process::ChildStderr,
    ),
    String,
> {
    use crate::agent::runtime::RuntimeConfig;
    use crate::models::AgentRuntimeKind;

    let binary = RuntimeConfig::resolve_binary(&AgentRuntimeKind::MiMoCode);
    let mut args: Vec<String> = vec!["run".into(), "--format".into(), "json".into()];

    // Session mode args
    match session_mode {
        SessionMode::Resume | SessionMode::Continue => {
            let sid = resume_session_id.ok_or("session_id required for resume/continue")?;
            args.push("--session".into());
            args.push(sid.into());
        }
        SessionMode::Fork => {
            args.push("--fork".into());
            if let Some(sid) = resume_session_id {
                args.push("--session".into());
                args.push(sid.into());
            }
        }
        SessionMode::New => {}
    }

    // Model
    if let Some(ref m) = settings.model {
        if !m.is_empty() {
            args.push("--model".into());
            args.push(m.clone());
        }
    }

    // Permission mode → MiMo equivalent
    if let Some(ref perm) = settings.permission_mode {
        match perm.as_str() {
            "bypassPermissions" | "auto" => {
                args.push("--dangerously-skip-permissions".into());
            }
            _ => {}
        }
    }

    // Working directory
    args.push("--dir".into());
    args.push(cwd.to_string());

    log::debug!(
        "[session] spawning MiMo: {} {}, cwd={}",
        binary,
        args.join(" "),
        cwd
    );

    let mut cmd = tokio::process::Command::new(&binary);
    for arg in &args {
        cmd.arg(arg);
    }

    cmd.current_dir(cwd)
        .env_remove("CLAUDECODE")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn mimo: {e}"))?;

    let mut child = child;
    let stdin = child.stdin.take().ok_or("mimo: no stdin")?;
    let stdout = child.stdout.take().ok_or("mimo: no stdout")?;
    let stderr = child.stderr.take().ok_or("mimo: no stderr")?;

    Ok((child, stdin, stdout, stderr))
}

pub(crate) async fn spawn_cursor_process(
    cwd: &str,
    settings: &AdapterSettings,
    session_mode: &SessionMode,
    resume_session_id: Option<&str>,
    is_new: bool,
) -> Result<
    (
        tokio::process::Child,
        tokio::process::ChildStdin,
        tokio::process::ChildStdout,
        tokio::process::ChildStderr,
    ),
    String,
> {
    use crate::agent::control_plane::adapters::cursor::{
        build_cursor_session_args, resolve_cursor_agent_binary,
    };

    let binary = resolve_cursor_agent_binary().ok_or("Cursor Agent CLI (agent) not found")?;
    let resume_id = if is_new { None } else { resume_session_id };
    let mut args = build_cursor_session_args(settings, resume_id);

    match session_mode {
        SessionMode::Continue => {
            args.push("--continue".into());
        }
        SessionMode::Fork => {
            return Err("Fork mode not supported for Cursor Agent CLI".into());
        }
        SessionMode::New | SessionMode::Resume => {}
    }

    log::debug!(
        "[session] spawning Cursor Agent: {} {}, cwd={}",
        binary,
        args.join(" "),
        cwd
    );

    let mut cmd = tokio::process::Command::new(&binary);
    for arg in &args {
        cmd.arg(arg);
    }

    cmd.current_dir(cwd)
        .env("PATH", claude_stream::augmented_path())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn cursor agent: {e}"))?;

    let mut child = child;
    let stdin = child.stdin.take().ok_or("cursor: no stdin")?;
    let stdout = child.stdout.take().ok_or("cursor: no stdout")?;
    let stderr = child.stderr.take().ok_or("cursor: no stderr")?;

    Ok((child, stdin, stdout, stderr))
}

/// Spawn a Claude CLI process and return `(Child, ChildStdin, ChildStdout, ChildStderr)`.
/// Sends the initial prompt via stdin for new sessions.
/// For remote sessions, wraps the CLI command in SSH.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn spawn_cli_process(
    cwd: &str,
    prompt: &str,
    settings: &AdapterSettings,
    session_mode: &SessionMode,
    resume_session_id: Option<&str>,
    _is_new: bool,
    _initial_attachments: &[AttachmentData],
    remote_host: Option<&RemoteHost>,
    remote_cwd: Option<&str>,
    api_key: Option<&str>,
    auth_token: Option<&str>,
    base_url: Option<&str>,
    _run_id: &str,
    models: Option<&[String]>,
    extra_env: Option<&std::collections::HashMap<String, String>>,
) -> Result<
    (
        tokio::process::Child,
        tokio::process::ChildStdin,
        tokio::process::ChildStdout,
        tokio::process::ChildStderr,
    ),
    String,
> {
    // Build CLI args (shared between local and remote)
    let mut claude_args: Vec<String> = vec![
        "--output-format".into(),
        "stream-json".into(),
        "--input-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--permission-prompt-tool".into(),
        "stdio".into(),
    ];

    // Session mode args
    match session_mode {
        SessionMode::Resume | SessionMode::Continue => {
            let sid = resume_session_id.ok_or("session_id required for resume/continue")?;
            claude_args.push("--resume".into());
            claude_args.push(sid.into());
        }
        SessionMode::Fork => {
            return Err("Fork mode not supported in spawn_cli_process — use fork_oneshot()".into());
        }
        SessionMode::New => {}
    }

    // Settings flags
    let flag_args = adapter::build_settings_args(settings, false);
    claude_args.extend(flag_args.iter().cloned());
    if settings.include_partial_messages {
        claude_args.push("--include-partial-messages".into());
    }

    log::debug!(
        "[session] session_mode={:?}, resume_id={:?}, flag_args={:?}, remote={:?}",
        session_mode,
        resume_session_id,
        flag_args,
        remote_host.map(|r| &r.name),
    );

    let mut child = if let Some(remote) = remote_host {
        // SSH branch: wrap claude command in ssh
        let effective_remote_cwd = remote_cwd.unwrap_or(cwd);
        let remote_cmd = crate::agent::ssh::build_remote_claude_command(
            remote,
            effective_remote_cwd,
            &claude_args,
            api_key,
            auth_token,
            base_url,
            models,
            extra_env,
        );
        let mut ssh_cmd = crate::agent::ssh::build_ssh_command(remote, &remote_cmd);
        ssh_cmd
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        log::debug!(
            "[session] spawning remote CLI via SSH: {}@{}, cwd={}",
            remote.user,
            remote.host,
            effective_remote_cwd
        );

        ssh_cmd
            .hide_console()
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| {
                log::error!("[session] Failed to spawn ssh: {}", e);
                format!("Failed to spawn ssh: {}", e)
            })?
    } else {
        // Local branch: existing logic
        let claude_bin = claude_stream::resolve_claude_path();
        log::debug!("[session] resolved binary: {}", claude_bin);

        let mut cmd = tokio::process::Command::new(&claude_bin);
        for arg in &claude_args {
            // On Windows, .cmd batch files are spawned via cmd.exe which
            // interprets \r\n as command separators, causing "batch file
            // arguments are invalid". Normalize to \n before passing.
            #[cfg(target_os = "windows")]
            let sanitized = arg.replace("\r\n", "\n");
            #[cfg(not(target_os = "windows"))]
            let sanitized = arg.as_str();
            cmd.arg(&sanitized);
        }

        let path_env = claude_stream::augmented_path();
        log::debug!("[session] PATH: {}", path_env);
        log::debug!(
            "[session] cwd: {}, prompt: {:?}",
            cwd,
            crate::storage::shared::truncate_str(prompt, 80)
        );
        cmd.current_dir(cwd)
            .env("PATH", &path_env)
            .env_remove("CLAUDECODE")
            .env("CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING", "1")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        // Pass API key to CLI when using API Key authentication mode (x-api-key header).
        // MUST remove AUTH_TOKEN to avoid inherited shell env vars taking priority.
        // Use env_remove (not empty string) — CLI may treat empty as "set but invalid".
        if let Some(key) = api_key {
            log::debug!("[session] setting ANTHROPIC_API_KEY env for local CLI");
            cmd.env("ANTHROPIC_API_KEY", key);
            cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
        }

        // Pass auth token for third-party platforms using Bearer auth.
        // MUST remove API_KEY to avoid inherited shell env vars causing conflicts.
        if let Some(token) = auth_token {
            log::debug!("[session] setting ANTHROPIC_AUTH_TOKEN env for local CLI");
            cmd.env("ANTHROPIC_AUTH_TOKEN", token);
            cmd.env_remove("ANTHROPIC_API_KEY");
        }

        // Pass Base URL for third-party API endpoints
        if let Some(url) = base_url {
            log::debug!("[session] setting ANTHROPIC_BASE_URL={}", url);
            cmd.env("ANTHROPIC_BASE_URL", url);
        }

        // Pass model tier env vars for third-party platforms (low priority — --model flag overrides)
        if let Some(m) = models {
            for (k, v) in super::platform_routing::resolve_model_tiers(m) {
                cmd.env(k, v);
            }
        }

        // Pass extra env vars for third-party platforms (e.g. API_TIMEOUT_MS for DeepSeek)
        if let Some(extra) = extra_env {
            for (k, v) in extra {
                log::debug!("[session] setting extra env {}={}", k, v);
                cmd.env(k, v);
            }
        }

        cmd.hide_console().kill_on_drop(true).spawn().map_err(|e| {
            log::error!("[session] Failed to spawn claude: {}", e);
            format!("Failed to spawn claude: {}", e)
        })?
    };
    log::debug!("[session] child process spawned, pid={:?}", child.id());

    let stdin = child.stdin.take().ok_or("Failed to capture claude stdin")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture claude stdout")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Failed to capture claude stderr")?;

    // Initial prompt is now sent via ActorCommand::SendMessage after actor spawn.
    // This ensures ALL user messages go through the Turn Transaction Engine.

    Ok((child, stdin, stdout, stderr))
}

// ── One-shot print prompt (used by side_question + auto-title) ──

/// Run a one-shot local/remote `claude --print` command for a run's cwd/auth context.
pub(crate) async fn run_claude_print_prompt(
    meta: &RunMeta,
    prompt: String,
    configure: impl FnOnce(&mut AdapterSettings),
) -> Result<String, String> {
    let user_settings = storage::settings::get_user_settings();
    let remote = super::remote_context::resolve_remote_host(meta)?;
    let effective_pid = super::platform_routing::effective_platform_id(
        &user_settings.auth_mode,
        None,
        meta.platform_id.as_deref(),
        user_settings.active_platform_id.as_deref(),
    );
    let resolved = super::auth_resolution::resolve_auth_env_for_platform(
        &remote,
        &user_settings,
        effective_pid.as_deref(),
    );
    let resolved = super::auth_resolution::augment_with_shell_auth(
        resolved,
        &user_settings.auth_mode,
        remote.is_some(),
        &meta.cwd,
    );

    let claude_bin = claude_stream::resolve_claude_path();
    let effective_cwd = meta.remote_cwd.as_deref().unwrap_or(&meta.cwd);

    let agent_settings = storage::settings::get_agent_settings(&meta.agent);
    let mut adapter = adapter::build_adapter_settings(&agent_settings, &user_settings, None);
    adapter::clear_model_if_provider_overrides(
        &mut adapter,
        &None,
        &agent_settings.model,
        &resolved.models,
    );
    configure(&mut adapter);

    let mut claude_args: Vec<String> = vec!["--print".into()];
    claude_args.extend(adapter::build_settings_args(&adapter, true));
    claude_args.push(prompt);

    let mut cmd = if let Some(ref remote_host) = remote {
        let remote_cmd = crate::agent::ssh::build_remote_claude_command(
            remote_host,
            effective_cwd,
            &claude_args,
            resolved.api_key.as_deref(),
            resolved.auth_token.as_deref(),
            resolved.base_url.as_deref(),
            resolved.models.as_deref(),
            resolved.extra_env.as_ref(),
        );
        let mut ssh_cmd = crate::agent::ssh::build_ssh_command(remote_host, &remote_cmd);
        ssh_cmd
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        ssh_cmd
    } else {
        let mut local_cmd = Command::new(&claude_bin);
        for arg in &claude_args {
            local_cmd.arg(arg);
        }
        let path_env = claude_stream::augmented_path();
        local_cmd
            .current_dir(effective_cwd)
            .env("PATH", &path_env)
            .env_remove("CLAUDECODE")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        if let Some(key) = &resolved.api_key {
            local_cmd.env("ANTHROPIC_API_KEY", key);
            local_cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
        } else if let Some(token) = &resolved.auth_token {
            local_cmd.env("ANTHROPIC_AUTH_TOKEN", token);
            local_cmd.env_remove("ANTHROPIC_API_KEY");
        }
        if let Some(url) = &resolved.base_url {
            local_cmd.env("ANTHROPIC_BASE_URL", url);
        }
        if let Some(models) = &resolved.models {
            for (k, v) in super::platform_routing::resolve_model_tiers(models) {
                local_cmd.env(k, v);
            }
        }
        if let Some(extra) = &resolved.extra_env {
            for (k, v) in extra {
                if k.chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
                {
                    local_cmd.env(k, v);
                }
            }
        }
        local_cmd
    };

    log::debug!(
        "[session] run_claude_print_prompt: run_id={}, cwd={}",
        meta.id,
        effective_cwd
    );

    // kill_on_drop(true) was set on the local_cmd / ssh_cmd builder above so
    // that if the future is dropped (e.g. the actor task is dropped on
    // session stop, or the IPC caller cancels), the spawned `claude --print`
    // child process is reaped by the OS instead of leaking.

    let output = timeout(Duration::from_secs(25), cmd.output())
        .await
        .map_err(|_| "Title generation timed out".to_string())?
        .map_err(|e| format!("Title generation spawn failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Title generation failed (exit {:?}): {}",
            output.status.code(),
            crate::storage::shared::truncate_str(stderr.trim(), 200)
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

// Re-export for tests in commands::session
#[doc(hidden)]
pub use crate::session::auth_resolution::{
    augment_with_shell_auth, config_value_has_auth_key, resolve_shell_auth,
    should_skip_env_injection,
};
#[doc(hidden)]
pub use crate::session::platform_routing::resolve_model_tiers;

// keep the unused-import linter quiet on Arc — used by callers
#[allow(dead_code)]
fn _ensure_arc_in_scope(_: Arc<BroadcastEmitter>) {}
