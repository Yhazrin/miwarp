//! Thin façade re-exporting the session subsystem's Tauri command functions.
//!
//! Extracted from the original 3787-line `commands/session.rs` (P0+P1+P2 workbench
//! repair, 2026-06-28). All logic now lives in `crate::session::*`. This module
//! keeps the IPC contract intact (`commands::session::start_session` etc. must
//! resolve to the same function pointer the frontend calls).
//!
//! Internal `pub(crate) ::_impl` helpers and tests also live here because the
//! `mod tests` block in this file references private symbols from the original
//! file. Once the rest of the codebase migrates, those can move into the
//! appropriate submodules.

pub(crate) use crate::session::actor_control::{
    fork_session_impl, start_session_impl, stop_actor, stop_session_impl,
};
pub(crate) use crate::session::interactive_control::approve_session_tool_impl;
pub(crate) use crate::session::process_spawn::{resolve_model_tiers, run_claude_print_prompt};

// ── Tauri commands (preserve IPC contract) ──

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_session(
    emitter: tauri::State<'_, std::sync::Arc<crate::web_server::broadcaster::BroadcastEmitter>>,
    sessions: tauri::State<'_, crate::agent::adapter::ActorSessionMap>,
    spawn_locks: tauri::State<'_, crate::agent::spawn_locks::SpawnLocks>,
    cancel_token: tauri::State<'_, tokio_util::sync::CancellationToken>,
    recovery_registry: tauri::State<'_, crate::agent::runtime_recovery::RecoveryRegistry>,
    governor: tauri::State<'_, crate::governor::ResourceGovernor>,
    run_id: String,
    mode: Option<crate::models::SessionMode>,
    session_id: Option<String>,
    initial_message: Option<String>,
    attachments: Option<Vec<crate::agent::attachment::AttachmentData>>,
    platform_id: Option<String>,
    permission_mode_override: Option<String>,
    client_message_id: Option<String>,
) -> Result<(), String> {
    crate::session::actor_control::start_session_impl(
        emitter.inner(),
        sessions.inner(),
        spawn_locks.inner(),
        cancel_token.inner(),
        recovery_registry.inner(),
        governor.inner(),
        run_id,
        mode,
        session_id,
        initial_message,
        attachments,
        platform_id,
        permission_mode_override,
        client_message_id,
    )
    .await
}

#[tauri::command]
pub async fn send_session_message(
    sessions: tauri::State<'_, crate::agent::adapter::ActorSessionMap>,
    recovery_registry: tauri::State<'_, crate::agent::runtime_recovery::RecoveryRegistry>,
    run_id: String,
    message: String,
    attachments: Option<Vec<crate::agent::attachment::AttachmentData>>,
    client_message_id: Option<String>,
) -> Result<(), String> {
    // No SpawnLock — data operation, routed through actor channel
    let att_list = attachments.unwrap_or_default();
    log::debug!(
        "[session] send_session_message: run_id={}, msg_len={}, attachments={}, client_message_id={:?}",
        run_id,
        message.len(),
        att_list.len(),
        client_message_id,
    );

    if crate::session::recovery_commands::send_or_queue_recovery(
        recovery_registry.inner(),
        &run_id,
        message.clone(),
        att_list.clone(),
        client_message_id.clone(),
    )
    .await?
    {
        log::debug!(
            "[session] send_session_message: queued during recovery, run_id={}",
            run_id
        );
        return Ok(());
    }

    let cmd_tx = crate::session::actor_control::get_cmd_tx(&sessions, &run_id).await?;

    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    cmd_tx
        .send(crate::agent::session_actor::ActorCommand::SendMessage {
            text: message.clone(),
            attachments: att_list,
            client_message_id: client_message_id.clone(),
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Actor dead".to_string())?;
    crate::session::actor_control::await_actor_reply(
        reply_rx,
        "send_message",
        crate::session::actor_control::ACTOR_SEND_TIMEOUT_MS,
    )
    .await?;

    log::debug!(
        "[session] send_session_message: delivered to actor, run_id={}, client_message_id={:?}",
        run_id,
        client_message_id,
    );
    Ok(())
}

#[tauri::command]
pub async fn stop_session(
    emitter: tauri::State<'_, std::sync::Arc<crate::web_server::broadcaster::BroadcastEmitter>>,
    sessions: tauri::State<'_, crate::agent::adapter::ActorSessionMap>,
    spawn_locks: tauri::State<'_, crate::agent::spawn_locks::SpawnLocks>,
    governor: tauri::State<'_, crate::governor::ResourceGovernor>,
    run_id: String,
) -> Result<(), String> {
    crate::session::actor_control::stop_session_impl(
        emitter.inner(),
        sessions.inner(),
        spawn_locks.inner(),
        governor.inner(),
        run_id,
    )
    .await
}

#[tauri::command]
pub async fn send_session_control(
    sessions: tauri::State<'_, crate::agent::adapter::ActorSessionMap>,
    run_id: String,
    subtype: String,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    log::debug!(
        "[session] send_session_control: run_id={}, subtype={}",
        run_id,
        subtype
    );

    let cmd_tx = crate::session::actor_control::get_cmd_tx(&sessions, &run_id).await?;

    // Build control request
    let mut request = serde_json::json!({ "subtype": subtype });
    if let Some(p) = params {
        if let Some(obj) = p.as_object() {
            for (k, v) in obj {
                request[k] = v.clone();
            }
        }
    }

    // Phase 1: send control request, get response receiver
    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    cmd_tx
        .send(crate::agent::session_actor::ActorCommand::SendControl {
            request,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Actor dead".to_string())?;

    let (request_id, response_rx) = crate::session::actor_control::await_actor_reply(
        reply_rx,
        "send_control",
        crate::session::actor_control::ACTOR_REPLY_TIMEOUT_MS,
    )
    .await?;

    // Phase 2: await response outside actor (no lock held)
    match tokio::time::timeout(std::time::Duration::from_secs(10), response_rx).await {
        Ok(Ok(response)) => {
            log::debug!(
                "[session] control response received for req_id={}",
                request_id
            );
            Ok(response)
        }
        Ok(Err(_)) => {
            log::warn!(
                "[session] control response channel closed for req_id={}",
                request_id
            );
            Err("Control response channel closed (session may have ended)".to_string())
        }
        Err(_) => {
            log::warn!(
                "[session] control request timed out for req_id={}",
                request_id
            );
            Err("Timeout waiting for control response".to_string())
        }
    }
}

#[tauri::command]
pub async fn broadcast_mcp_toggle(
    sessions: tauri::State<'_, crate::agent::adapter::ActorSessionMap>,
    server_name: String,
    enabled: bool,
) -> Result<u32, String> {
    let senders: Vec<(
        String,
        tokio::sync::mpsc::Sender<crate::agent::session_actor::ActorCommand>,
    )> = {
        let map = sessions.lock().await;
        map.iter()
            .map(|(id, h)| (id.clone(), h.cmd_tx.clone()))
            .collect()
    };
    let request = serde_json::json!({
        "subtype": "mcp_toggle",
        "serverName": server_name,
        "enabled": enabled,
    });
    let mut sent: u32 = 0;
    for (run_id, tx) in &senders {
        let (reply_tx, _reply_rx) = tokio::sync::oneshot::channel();
        if tx
            .send(crate::agent::session_actor::ActorCommand::SendControl {
                request: request.clone(),
                reply: reply_tx,
            })
            .await
            .is_ok()
        {
            sent += 1;
            log::debug!(
                "[session] broadcast_mcp_toggle: sent to run_id={}, server={}, enabled={}",
                run_id,
                server_name,
                enabled,
            );
        }
    }
    log::debug!(
        "[session] broadcast_mcp_toggle: sent to {}/{} sessions",
        sent,
        senders.len()
    );
    Ok(sent)
}

#[tauri::command]
pub async fn get_bus_events(
    id: String,
    since_seq: Option<u64>,
) -> Result<Vec<serde_json::Value>, String> {
    crate::storage::runs::get_run(&id).ok_or_else(|| format!("Run {} not found", id))?;
    // Run file I/O + JSON parsing on a blocking thread so we don't stall
    // the tokio runtime when the events.jsonl is large (100MB+).
    let run_id = id.clone();
    tokio::task::spawn_blocking(move || crate::storage::events::list_bus_events(&run_id, since_seq))
        .await
        .map_err(|e| format!("spawn_blocking failed: {}", e))
}

#[tauri::command]
pub async fn fork_session(
    emitter: tauri::State<'_, std::sync::Arc<crate::web_server::broadcaster::BroadcastEmitter>>,
    sessions: tauri::State<'_, crate::agent::adapter::ActorSessionMap>,
    spawn_locks: tauri::State<'_, crate::agent::spawn_locks::SpawnLocks>,
    run_id: String,
) -> Result<String, String> {
    crate::session::actor_control::fork_session_impl(
        emitter.inner(),
        sessions.inner(),
        spawn_locks.inner(),
        run_id,
    )
    .await
}

#[tauri::command]
pub async fn approve_session_tool(
    emitter: tauri::State<'_, std::sync::Arc<crate::web_server::broadcaster::BroadcastEmitter>>,
    sessions: tauri::State<'_, crate::agent::adapter::ActorSessionMap>,
    spawn_locks: tauri::State<'_, crate::agent::spawn_locks::SpawnLocks>,
    cancel_token: tauri::State<'_, tokio_util::sync::CancellationToken>,
    run_id: String,
    tool_name: String,
) -> Result<(), String> {
    crate::session::interactive_control::approve_session_tool_impl(
        emitter.inner(),
        sessions.inner(),
        spawn_locks.inner(),
        cancel_token.inner(),
        run_id,
        tool_name,
    )
    .await
}

use crate::session::interactive_control::{
    cancel_control_request_impl as _cancel_control_request_impl,
    respond_elicitation_impl as _respond_elicitation_impl,
    respond_hook_callback_impl as _respond_hook_callback_impl,
    respond_permission_impl as _respond_permission_impl,
};
use crate::session::ralph_commands::{
    cancel_ralph_loop_impl as _cancel_ralph_loop_impl,
    start_ralph_loop_impl as _start_ralph_loop_impl,
};
use crate::session::side_question::side_question_impl as _side_question_impl;

#[tauri::command]
pub async fn get_session_runtime_status(
    sessions: tauri::State<'_, crate::agent::adapter::ActorSessionMap>,
    run_id: String,
) -> Result<serde_json::Value, String> {
    let map = sessions.lock().await;
    let actor_alive = map.contains_key(&run_id);
    Ok(serde_json::json!({
        "actor_alive": actor_alive,
        "run_id": run_id,
    }))
}

#[tauri::command]
pub async fn retry_session_recovery(
    emitter: tauri::State<'_, std::sync::Arc<crate::web_server::broadcaster::BroadcastEmitter>>,
    sessions: tauri::State<'_, crate::agent::adapter::ActorSessionMap>,
    spawn_locks: tauri::State<'_, crate::agent::spawn_locks::SpawnLocks>,
    cancel_token: tauri::State<'_, tokio_util::sync::CancellationToken>,
    recovery_registry: tauri::State<'_, crate::agent::runtime_recovery::RecoveryRegistry>,
    governor: tauri::State<'_, crate::governor::ResourceGovernor>,
    run_id: String,
) -> Result<(), String> {
    {
        let mut map = recovery_registry.lock().await;
        if let Some(entry) = map.get_mut(&run_id) {
            if entry.unrecoverable {
                entry.unrecoverable = false;
                entry.recovery_sm = crate::agent::recovery::RecoveryStateMachine::new();
                entry.last_error = None;
            }
        }
    }
    crate::session::recovery_commands::respawn_session_actor(
        emitter.inner(),
        sessions.inner(),
        spawn_locks.inner(),
        cancel_token.inner(),
        recovery_registry.inner(),
        &run_id,
        governor.inner().clone(),
    )
    .await
}

#[tauri::command]
pub async fn side_question(
    app: tauri::AppHandle,
    run_id: String,
    question: String,
) -> Result<String, String> {
    _side_question_impl(app, run_id, question).await
}

#[tauri::command]
pub async fn start_ralph_loop(
    sessions: tauri::State<'_, crate::agent::adapter::ActorSessionMap>,
    run_id: String,
    prompt: String,
    max_iterations: u32,
    completion_promise: Option<String>,
) -> Result<(), String> {
    _start_ralph_loop_impl(
        sessions.inner(),
        run_id,
        prompt,
        max_iterations,
        completion_promise,
    )
    .await
}

#[tauri::command]
pub async fn cancel_ralph_loop(
    sessions: tauri::State<'_, crate::agent::adapter::ActorSessionMap>,
    run_id: String,
) -> Result<crate::agent::session_actor::RalphCancelResult, String> {
    _cancel_ralph_loop_impl(sessions.inner(), run_id).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn respond_permission(
    sessions: tauri::State<'_, crate::agent::adapter::ActorSessionMap>,
    run_id: String,
    request_id: String,
    behavior: String,
    updated_permissions: Option<Vec<serde_json::Value>>,
    updated_input: Option<serde_json::Value>,
    deny_message: Option<String>,
    interrupt: Option<bool>,
    tool_name: Option<String>,
) -> Result<(), String> {
    _respond_permission_impl(
        sessions.inner(),
        run_id,
        request_id,
        behavior,
        updated_permissions,
        updated_input,
        deny_message,
        interrupt,
        tool_name,
    )
    .await
}

#[tauri::command]
pub async fn respond_hook_callback(
    sessions: tauri::State<'_, crate::agent::adapter::ActorSessionMap>,
    run_id: String,
    request_id: String,
    decision: String,
    updated_input: Option<serde_json::Value>,
) -> Result<(), String> {
    _respond_hook_callback_impl(
        sessions.inner(),
        run_id,
        request_id,
        decision,
        updated_input,
    )
    .await
}

#[tauri::command]
pub async fn cancel_control_request(
    sessions: tauri::State<'_, crate::agent::adapter::ActorSessionMap>,
    run_id: String,
    request_id: String,
) -> Result<(), String> {
    _cancel_control_request_impl(sessions.inner(), run_id, request_id).await
}

#[tauri::command]
pub async fn respond_elicitation(
    sessions: tauri::State<'_, crate::agent::adapter::ActorSessionMap>,
    run_id: String,
    request_id: String,
    action: String,
    content: Option<serde_json::Value>,
) -> Result<(), String> {
    _respond_elicitation_impl(sessions.inner(), run_id, request_id, action, content).await
}

// ── Internal helpers re-exported so existing callers keep working ──
//
// `apply_project_desk_context` is called from `start_session_impl` (now in
// actor_control). It is also re-exported here in case any test still uses
// `super::apply_project_desk_context` in `mod tests` below.
pub(crate) use crate::session::actor_control::apply_project_desk_context;

// ── Tests ──
//
// Unit tests for the session command façade live in a sibling file so that this
// module stays a thin façade. They exercise the pure helpers in
// `session::auth_resolution` and `session::platform_routing`; the names and
// assertions are preserved verbatim.
#[cfg(test)]
#[path = "session_command_tests.rs"]
mod session_command_tests;
