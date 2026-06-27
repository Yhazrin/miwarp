//! Interactive control: permission / hook / MCP elicitation responses + approve tool + cancel.
//!
//! Extracted from `commands/session.rs` (P0+P1+P2 workbench repair, 2026-06-28).
//! These commands take user input that the actor is currently waiting on (e.g. tool
//! approval, hook decision, MCP elicitation). They all use `get_cmd_tx` to route the
//! response back through the SessionActor channel.
//!
//! The `*_impl` functions in this module are NOT Tauri commands — they receive
//! `&ActorSessionMap` (already unwrapped from `State`) so they can be tested and
//! called from `commands::session`'s thin façade.

use crate::agent::adapter::{self, AdapterSettings};
use crate::agent::session_actor::ActorCommand;
use crate::agent::spawn_locks::SpawnLocks;
use crate::models::{BusEvent, RunStatus, SessionMode};
use crate::storage;
use crate::web_server::broadcaster::BroadcastEmitter;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

use super::actor_control::{
    await_actor_reply, get_cmd_tx, stop_actor, ACTOR_READY_TIMEOUT_MS, ACTOR_REPLY_TIMEOUT_MS,
    ACTOR_SEND_TIMEOUT_MS,
};
use super::auth_resolution::augment_with_shell_auth;
use super::auth_resolution::resolve_auth_env_for_platform;
use super::platform_routing::effective_platform_id;

#[allow(clippy::too_many_arguments)]
pub(crate) async fn respond_permission_impl(
    sessions: &crate::agent::adapter::ActorSessionMap,
    run_id: String,
    request_id: String,
    behavior: String,
    updated_permissions: Option<Vec<serde_json::Value>>,
    updated_input: Option<serde_json::Value>,
    deny_message: Option<String>,
    interrupt: Option<bool>,
    tool_name: Option<String>,
) -> Result<(), String> {
    log::debug!(
        "[session] respond_permission: run_id={}, req_id={}, behavior={}, updated_perms={}, has_updated_input={}, has_deny_message={}, interrupt={:?}",
        run_id,
        request_id,
        behavior,
        updated_permissions.as_ref().map_or(0, |v| v.len()),
        updated_input.is_some(),
        deny_message.is_some(),
        interrupt,
    );

    // ── Behavior validation ──
    if behavior != "allow" && behavior != "deny" {
        return Err(format!(
            r#"{{"code":"unknown","message":"invalid behavior: {behavior}","retryable":false}}"#
        ));
    }

    // ── Permanent allow policy ──
    if let (Some(perms), Some(tool)) = (updated_permissions.as_ref(), tool_name.as_ref()) {
        let attempts_permanent = perms.iter().any(|p| {
            p.get("type").and_then(|v| v.as_str()) == Some("addRules")
                || p.get("destination").and_then(|v| v.as_str()) == Some("userSettings")
        });
        if attempts_permanent && crate::agent::permission_error::is_permanent_allow_blocked(tool) {
            log::warn!(
                "[session] respond_permission: permanent allow blocked for tool={}, run_id={}",
                tool,
                run_id
            );
            return Err(crate::agent::permission_error::PermissionError::new(
                crate::agent::permission_error::PermissionErrorCode::DangerToolBlocked,
                format!("Permanent allow refused for {tool}"),
                false,
            )
            .to_string());
        }
    }

    let cmd_tx = get_cmd_tx(sessions, &run_id).await?;

    let mut response = if behavior == "allow" {
        let input_val = updated_input.unwrap_or_else(|| serde_json::json!({}));
        serde_json::json!({
            "behavior": "allow",
            "updatedInput": input_val,
        })
    } else {
        let msg = deny_message.unwrap_or_else(|| "User denied permission".to_string());
        let mut deny_obj = serde_json::json!({
            "behavior": "deny",
            "message": msg,
        });
        if interrupt == Some(true) {
            deny_obj["interrupt"] = serde_json::json!(true);
        }
        deny_obj
    };
    if let Some(perms) = updated_permissions {
        if behavior == "allow" && !perms.is_empty() {
            response["updatedPermissions"] = serde_json::Value::Array(perms);
        }
    }

    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    cmd_tx
        .send(ActorCommand::RespondPermission {
            request_id: request_id.clone(),
            response,
            tool_name: tool_name.clone(),
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Actor dead".to_string())?;
    await_actor_reply(reply_rx, "respond_permission", ACTOR_REPLY_TIMEOUT_MS).await?;

    log::debug!(
        "[session] respond_permission: delivered req_id={}",
        request_id
    );
    Ok(())
}

pub(crate) async fn respond_hook_callback_impl(
    sessions: &crate::agent::adapter::ActorSessionMap,
    run_id: String,
    request_id: String,
    decision: String,
    updated_input: Option<serde_json::Value>,
) -> Result<(), String> {
    log::debug!(
        "[session] respond_hook_callback: run_id={}, req_id={}, decision={}, has_updated_input={}",
        run_id,
        request_id,
        decision,
        updated_input.is_some(),
    );

    let cmd_tx = get_cmd_tx(sessions, &run_id).await?;

    let mut response = serde_json::json!({ "decision": decision });
    if decision == "allow" {
        if let Some(input) = updated_input {
            response["updatedInput"] = input;
        }
    }

    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    cmd_tx
        .send(ActorCommand::RespondHookCallback {
            request_id: request_id.clone(),
            response,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Actor dead".to_string())?;
    await_actor_reply(reply_rx, "respond_hook_callback", ACTOR_REPLY_TIMEOUT_MS).await?;

    log::debug!(
        "[session] respond_hook_callback: delivered req_id={}",
        request_id
    );
    Ok(())
}

pub(crate) async fn cancel_control_request_impl(
    sessions: &crate::agent::adapter::ActorSessionMap,
    run_id: String,
    request_id: String,
) -> Result<(), String> {
    log::debug!(
        "[session] cancel_control_request: run_id={}, req_id={}",
        run_id,
        request_id
    );

    let cmd_tx = get_cmd_tx(sessions, &run_id).await?;

    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    cmd_tx
        .send(ActorCommand::CancelControlRequest {
            request_id,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Actor dead".to_string())?;
    await_actor_reply(reply_rx, "cancel_control_request", ACTOR_REPLY_TIMEOUT_MS).await?;

    Ok(())
}

pub(crate) async fn respond_elicitation_impl(
    sessions: &crate::agent::adapter::ActorSessionMap,
    run_id: String,
    request_id: String,
    action: String,
    content: Option<serde_json::Value>,
) -> Result<(), String> {
    log::debug!(
        "[session] respond_elicitation: run_id={}, req_id={}, action={}",
        run_id,
        request_id,
        action
    );

    if !matches!(action.as_str(), "accept" | "decline" | "cancel") {
        return Err(format!("Invalid elicitation action: {}", action));
    }

    let response = match action.as_str() {
        "accept" => {
            let c = content.unwrap_or(serde_json::json!({}));
            if !c.is_object() {
                return Err("content must be a JSON object for accept".into());
            }
            serde_json::json!({"action": "accept", "content": c})
        }
        other => serde_json::json!({"action": other}),
    };

    let cmd_tx = get_cmd_tx(sessions, &run_id).await?;

    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    cmd_tx
        .send(ActorCommand::RespondElicitation {
            request_id: request_id.clone(),
            response,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Actor dead".to_string())?;
    await_actor_reply(reply_rx, "respond_elicitation", ACTOR_REPLY_TIMEOUT_MS).await?;

    log::debug!(
        "[session] respond_elicitation: delivered req_id={}",
        request_id
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn approve_session_tool_impl(
    emitter: &Arc<BroadcastEmitter>,
    sessions: &crate::agent::adapter::ActorSessionMap,
    spawn_locks: &SpawnLocks,
    cancel_token: &CancellationToken,
    run_id: String,
    tool_name: String,
) -> Result<(), String> {
    let _guard = spawn_locks.acquire(&run_id).await;
    log::debug!(
        "[session] approve_session_tool: run_id={}, tool={}",
        run_id,
        tool_name
    );

    // Tools that must never be permanently allowed — they require per-use approval.
    if crate::storage::shared::NEVER_ALLOW_TOOLS.contains(&tool_name.as_str()) {
        log::warn!(
            "[session] approve_session_tool: refusing to permanently allow '{}' (requires per-use approval)",
            tool_name
        );
        return Err(format!(
            "'{}' cannot be permanently allowed — it requires approval each time",
            tool_name
        ));
    }

    let meta =
        storage::runs::get_run(&run_id).ok_or_else(|| format!("Run {} not found", run_id))?;

    let mut agent_settings = storage::settings::get_agent_settings(&meta.agent);
    if !agent_settings.allowed_tools.contains(&tool_name) {
        agent_settings.allowed_tools.push(tool_name.clone());
        let patch = serde_json::json!({
            "allowed_tools": agent_settings.allowed_tools,
        });
        storage::settings::update_agent_settings(&meta.agent, patch)?;
        log::debug!(
            "[session] added {} to allowed_tools for {}",
            tool_name,
            meta.agent
        );
    }

    let remote = super::remote_context::resolve_remote_host(&meta)?;
    let effective_cwd = meta.remote_cwd.clone().unwrap_or_else(|| meta.cwd.clone());
    let prompt = meta.prompt.clone();
    let session_id = meta
        .session_id
        .clone()
        .ok_or_else(|| "No session_id for continue".to_string())?;

    let refreshed_agent = storage::settings::get_agent_settings(&meta.agent);
    let user = storage::settings::get_user_settings();
    let mut adapter = adapter::build_adapter_settings(&refreshed_agent, &user, None);
    let effective_pid = effective_platform_id(
        &user.auth_mode,
        None,
        meta.platform_id.as_deref(),
        user.active_platform_id.as_deref(),
    );
    let resolved = resolve_auth_env_for_platform(&remote, &user, effective_pid.as_deref());
    adapter::clear_model_if_provider_overrides(
        &mut adapter,
        &None,
        &refreshed_agent.model,
        &resolved.models,
    );
    let resolved = augment_with_shell_auth(resolved, &user.auth_mode, remote.is_some(), &meta.cwd);

    if remote.is_none() {
        super::process_spawn::preflight_check_base_url(
            resolved.base_url.as_deref(),
            effective_pid.as_deref(),
        )
        .await?;
    }

    stop_actor(sessions, &run_id).await?;

    let spawning_event = BusEvent::RunState {
        run_id: run_id.clone(),
        state: "spawning".to_string(),
        exit_code: None,
        error: None,
    };
    emitter.persist_and_emit(&run_id, &spawning_event);
    storage::runs::update_status(&run_id, RunStatus::Running, None, None).ok();

    let (child, stdin, stdout, stderr) = super::process_spawn::spawn_cli_process(
        &effective_cwd,
        &prompt,
        &adapter,
        &SessionMode::Continue,
        Some(&session_id),
        false,
        &[],
        remote.as_ref(),
        Some(&effective_cwd),
        resolved.api_key.as_deref(),
        resolved.auth_token.as_deref(),
        resolved.base_url.as_deref(),
        &run_id,
        resolved.models.as_deref(),
        resolved.extra_env.as_ref(),
    )
    .await?;

    let (total, normal) = crate::storage::events::count_user_messages(&run_id);

    let actor_handle = crate::agent::session_actor::spawn_actor(
        Arc::clone(emitter),
        sessions.clone(),
        run_id.clone(),
        child,
        stdin,
        stdout,
        stderr,
        true, // is_resume
        cancel_token.clone(),
        total + 1,
        normal + 1,
        None,
        None,
    );
    sessions.lock().await.insert(run_id.clone(), actor_handle);

    let cmd_tx = get_cmd_tx(sessions, &run_id).await?;
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    cmd_tx
        .send(ActorCommand::WaitReady { reply: ready_tx })
        .await
        .map_err(|_| "Actor dead before wait_ready".to_string())?;
    if let Err(e) = await_actor_reply(ready_rx, "wait_ready", ACTOR_READY_TIMEOUT_MS).await {
        log::warn!("[session] WaitReady failed for run_id={}: {}", run_id, e);
        return Err(format!("Actor not ready after spawn: {e}"));
    }

    let retry_msg = format!(
        "The tool {} is now allowed. Please retry your previous action using this tool.",
        tool_name
    );
    let cmd_tx = get_cmd_tx(sessions, &run_id).await?;
    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    cmd_tx
        .send(ActorCommand::SendMessage {
            text: retry_msg,
            attachments: Vec::new(),
            reply: reply_tx,
            client_message_id: None,
        })
        .await
        .map_err(|_| "Actor dead after approve restart".to_string())?;
    await_actor_reply(reply_rx, "approve_retry_message", ACTOR_SEND_TIMEOUT_MS).await?;

    log::debug!(
        "[session] approve_session_tool completed for run_id={}",
        run_id
    );
    Ok(())
}

// keep `AdapterSettings` import warm
#[allow(dead_code)]
type _AdapterSettings = AdapterSettings;
