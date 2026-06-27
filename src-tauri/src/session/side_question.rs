//! Side question (BTW): one-shot forked CLI process that streams text deltas back via
//! Tauri events without polluting the original session's history.
//!
//! Extracted from `commands/session.rs` (P0+P1+P2 workbench repair, 2026-06-28).

use crate::agent::adapter;
use crate::agent::claude_stream;
use crate::process_ext::HideConsole;
use crate::storage;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::auth_resolution::{augment_with_shell_auth, resolve_auth_env_for_platform};
use super::platform_routing::{effective_platform_id, resolve_model_tiers};
use super::remote_context::resolve_remote_host;

/// Spawn a one-shot forked CLI process to answer a side question without
/// polluting the original session. Streams text deltas back via Tauri events.
pub(crate) async fn side_question_impl(
    app: tauri::AppHandle,
    run_id: String,
    question: String,
) -> Result<String, String> {
    use serde_json::Value;
    use tauri::Emitter;

    let btw_id = uuid::Uuid::new_v4().to_string();
    log::debug!(
        "[btw] side_question: run_id={}, btw_id={}, question={}",
        run_id,
        btw_id,
        crate::storage::shared::truncate_str(&question, 80)
    );

    // 1. Read source run metadata
    let source =
        storage::runs::get_run(&run_id).ok_or_else(|| format!("Run {} not found", run_id))?;
    let session_id = source
        .session_id
        .clone()
        .ok_or_else(|| "No session_id available for side question".to_string())?;

    // 2. Resolve auth
    let user_settings = storage::settings::get_user_settings();
    let remote = resolve_remote_host(&source)?;
    let effective_pid = effective_platform_id(
        &user_settings.auth_mode,
        None,
        source.platform_id.as_deref(),
        user_settings.active_platform_id.as_deref(),
    );
    let resolved = resolve_auth_env_for_platform(&remote, &user_settings, effective_pid.as_deref());
    let resolved = augment_with_shell_auth(
        resolved,
        &user_settings.auth_mode,
        remote.is_some(),
        &source.cwd,
    );

    // 3. Wrap question in system-reminder
    let wrapped_question = format!(
        "<system-reminder>\nThe user is asking a side question. Answer it concisely. \
         This answer will NOT be added to the conversation history.\n</system-reminder>\n\n{}",
        question
    );

    let claude_bin = claude_stream::resolve_claude_path();
    let effective_cwd = source.remote_cwd.as_deref().unwrap_or(&source.cwd);

    let mut claude_args: Vec<String> = vec![
        "--resume".into(),
        session_id.clone(),
        "--fork-session".into(),
        "--no-session-persistence".into(),
        "-p".into(),
        wrapped_question,
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--max-turns".into(),
        "1".into(),
    ];

    let agent_settings = storage::settings::get_agent_settings(&source.agent);
    let mut adapter = adapter::build_adapter_settings(&agent_settings, &user_settings, None);
    adapter::clear_model_if_provider_overrides(
        &mut adapter,
        &None,
        &agent_settings.model,
        &resolved.models,
    );
    let flag_args = adapter::build_settings_args(&adapter, false);
    claude_args.extend(flag_args.iter().cloned());

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
            .stderr(std::process::Stdio::piped());
        if let Some(key) = &resolved.api_key {
            local_cmd.env("ANTHROPIC_API_KEY", key);
            local_cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
        }
        if let Some(token) = &resolved.auth_token {
            local_cmd.env("ANTHROPIC_AUTH_TOKEN", token);
            local_cmd.env_remove("ANTHROPIC_API_KEY");
        }
        if let Some(url) = &resolved.base_url {
            local_cmd.env("ANTHROPIC_BASE_URL", url);
        }
        if let Some(m) = &resolved.models {
            for (k, v) in resolve_model_tiers(m) {
                local_cmd.env(k, v);
            }
        }
        if let Some(extra) = &resolved.extra_env {
            for (k, v) in extra {
                local_cmd.env(k, v);
            }
        }
        local_cmd
    };

    cmd.hide_console().kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn side question CLI: {}", e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture CLI stdout for side question")?;

    let stderr = child.stderr.take();

    let btw_id_clone = btw_id.clone();
    let app_clone = app.clone();
    tokio::spawn(async move {
        if let Some(stderr) = stderr {
            let btw_id_err = btw_id_clone.clone();
            tokio::spawn(async move {
                let mut err_reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = err_reader.next_line().await {
                    log::debug!("[btw] stderr ({}): {}", btw_id_err, line);
                }
            });
        }

        let mut reader = BufReader::new(stdout).lines();
        let mut got_content = false;
        while let Ok(Some(line)) = reader.next_line().await {
            log::trace!("[btw] stdout line: {}", &line[..line.len().min(200)]);
            if let Ok(obj) = serde_json::from_str::<Value>(&line) {
                let event = if obj.get("type").and_then(|t| t.as_str()) == Some("stream_event") {
                    obj.get("event").cloned().unwrap_or(obj.clone())
                } else {
                    obj.clone()
                };

                let event_type = event.get("type").and_then(|t| t.as_str()).unwrap_or("");
                match event_type {
                    "content_block_delta" => {
                        if let Some(text) = event.pointer("/delta/text").and_then(|v| v.as_str()) {
                            got_content = true;
                            log::debug!("[btw] delta: {} chars", text.len());
                            let _ = app_clone.emit(
                                "btw-delta",
                                serde_json::json!({
                                    "btw_id": btw_id_clone,
                                    "text": text
                                }),
                            );
                        }
                    }
                    "assistant" => {
                        let message = event.get("message").unwrap_or(&event);
                        if let Some(content) = message.get("content").and_then(|c| c.as_array()) {
                            for block in content {
                                if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                                    if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                        if !text.is_empty() {
                                            got_content = true;
                                            log::debug!(
                                                "[btw] assistant text block: {} chars",
                                                text.len()
                                            );
                                            let _ = app_clone.emit(
                                                "btw-delta",
                                                serde_json::json!({
                                                    "btw_id": btw_id_clone,
                                                    "text": text
                                                }),
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                    "result" => {
                        log::debug!(
                            "[btw] received result event, completing btw_id={}",
                            btw_id_clone
                        );
                        break;
                    }
                    "error" => {
                        let msg = event
                            .get("error")
                            .and_then(|e| e.as_str())
                            .unwrap_or("unknown error");
                        log::error!("[btw] CLI error: {}", msg);
                        let _ = app_clone.emit(
                            "btw-error",
                            serde_json::json!({
                                "btw_id": btw_id_clone,
                                "error": msg
                            }),
                        );
                        break;
                    }
                    other => {
                        log::debug!("[btw] event type: {}", other);
                    }
                }
            }
        }

        if !got_content {
            let status = child.wait().await;
            let code = status.as_ref().ok().and_then(|s| s.code());
            log::error!(
                "[btw] no content received, exit={:?}, btw_id={}",
                code,
                btw_id_clone
            );
            let _ = app_clone.emit(
                "btw-error",
                serde_json::json!({
                    "btw_id": btw_id_clone,
                    "error": format!("Side question failed (exit code: {:?})", code)
                }),
            );
        } else {
            let _ = app_clone.emit(
                "btw-complete",
                serde_json::json!({ "btw_id": btw_id_clone }),
            );
        }

        let _ = child.kill().await;
        log::debug!(
            "[btw] side question process finished, btw_id={}",
            btw_id_clone
        );
    });

    log::debug!("[btw] spawned side question stream, btw_id={}", btw_id);
    Ok(btw_id)
}
