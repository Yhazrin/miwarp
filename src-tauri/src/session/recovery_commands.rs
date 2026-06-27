//! Runtime recovery: respawn crashed SessionActor + replay pending user messages.
//!
//! Extracted from `commands/session.rs` (P0+P1+P2 workbench repair, 2026-06-28).
//! Owns the recovery state machine lifecycle: detect crash → wait shutdown_rx →
//! compute backoff → rebuild CLI process → re-spawn actor → drain replay batch.

use crate::agent::adapter::{self};
use crate::agent::recovery::{RecoveryState, RuntimeError};
use crate::agent::runtime_recovery::{
    compute_respawn_backoff, emit_session_lifecycle, mark_unrecoverable, transition_recovery,
};
use crate::agent::session_actor::{self, ActorCommand};
use crate::agent::spawn_locks::SpawnLocks;
use crate::models::BusEvent;
use crate::storage;
use crate::web_server::broadcaster::BroadcastEmitter;
use std::sync::Arc;
use std::time::Instant;
use tokio_util::sync::CancellationToken;

use super::actor_control::{await_actor_reply, ACTOR_READY_TIMEOUT_MS, ACTOR_SEND_TIMEOUT_MS};
use super::auth_resolution::{augment_with_shell_auth, resolve_auth_env_for_platform};
use super::platform_routing::effective_platform_id;
use super::remote_context::resolve_remote_host;

/// Spawn a watcher task that, after the actor signals shutdown, checks the recovery
/// state and re-spawns the actor if the crash is recoverable.
pub fn spawn_recovery_watcher(
    run_id: String,
    shutdown_rx: tokio::sync::oneshot::Receiver<()>,
    registry: crate::agent::runtime_recovery::RecoveryRegistry,
    sessions: crate::agent::adapter::ActorSessionMap,
    emitter: Arc<BroadcastEmitter>,
    cancel_token: CancellationToken,
    spawn_locks: SpawnLocks,
) {
    tokio::spawn(async move {
        if shutdown_rx.await.is_err() {
            return;
        }
        let should_respawn = {
            let map = registry.lock().await;
            map.get(&run_id)
                .map(|e| !e.unrecoverable && e.last_crash_reason.is_some())
                .unwrap_or(false)
        };
        if !should_respawn {
            return;
        }
        if let Err(e) = respawn_session_actor(
            &emitter,
            &sessions,
            &spawn_locks,
            &cancel_token,
            &registry,
            &run_id,
        )
        .await
        {
            log::warn!("[recovery] respawn failed for run_id={}: {}", run_id, e);
        }
    });
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn respawn_session_actor(
    emitter: &Arc<BroadcastEmitter>,
    sessions: &crate::agent::adapter::ActorSessionMap,
    spawn_locks: &SpawnLocks,
    cancel_token: &CancellationToken,
    registry: &crate::agent::runtime_recovery::RecoveryRegistry,
    run_id: &str,
) -> Result<(), String> {
    let _guard = spawn_locks.acquire(run_id).await;

    let (bootstrap, session_id, backoff) = {
        let mut map = registry.lock().await;
        let entry = map
            .get_mut(run_id)
            .ok_or_else(|| format!("No recovery state for run {run_id}"))?;
        if entry.unrecoverable {
            return Err("Session is unrecoverable".into());
        }
        entry.respawn_in_flight = true;
        let now = Instant::now();
        entry.record_respawn_attempt(now);
        if !transition_recovery(entry, RecoveryState::Reconnecting, now) {
            mark_unrecoverable(
                entry,
                run_id,
                emitter,
                RuntimeError::RecoveryExhausted {
                    run_id: run_id.to_string(),
                    attempts: entry.recovery_sm.consecutive_failures(),
                },
            );
            return Err("Recovery budget exhausted".into());
        }
        emit_session_lifecycle(
            emitter,
            run_id,
            entry.session_id.as_deref(),
            "respawning",
            RecoveryState::Recovering,
            entry.last_crash_reason.map(|r| (r, None, None)),
            entry.connection_generation,
            entry.recovery_sm.consecutive_failures(),
        );
        (
            entry.bootstrap(),
            entry.session_id.clone(),
            compute_respawn_backoff(entry),
        )
    };

    let mut bootstrap = bootstrap;
    bootstrap.connection_generation = bootstrap.connection_generation.saturating_add(1);
    {
        let mut map = registry.lock().await;
        if let Some(entry) = map.get_mut(run_id) {
            entry.connection_generation = bootstrap.connection_generation;
        }
    }

    tokio::time::sleep(backoff).await;

    let meta = storage::runs::get_run(run_id).ok_or_else(|| format!("Run {run_id} not found"))?;
    let agent_settings = storage::settings::get_agent_settings(&meta.agent);
    let user_settings = storage::settings::get_user_settings();
    let mut adapter_settings =
        adapter::build_adapter_settings(&agent_settings, &user_settings, meta.model.clone());
    let remote = resolve_remote_host(&meta)?;
    let effective_pid = effective_platform_id(
        &user_settings.auth_mode,
        None,
        meta.platform_id.as_deref(),
        user_settings.active_platform_id.as_deref(),
    );
    let resolved = resolve_auth_env_for_platform(&remote, &user_settings, effective_pid.as_deref());
    adapter::clear_model_if_provider_overrides(
        &mut adapter_settings,
        &meta.model,
        &agent_settings.model,
        &resolved.models,
    );
    let resolved = augment_with_shell_auth(
        resolved,
        &user_settings.auth_mode,
        remote.is_some(),
        &meta.cwd,
    );

    let resume_session_id = session_id
        .or(meta.session_id.clone())
        .ok_or_else(|| "session_id required for recovery respawn".to_string())?;

    let effective_cwd = meta.remote_cwd.as_deref().unwrap_or(&meta.cwd);
    let runtime_kind = meta.resolved_runtime_kind();

    let (child, stdin, stdout, stderr) = match &runtime_kind {
        crate::models::AgentRuntimeKind::MiMoCode => {
            super::process_spawn::spawn_mimo_process(
                effective_cwd,
                &meta.prompt,
                &adapter_settings,
                &crate::models::SessionMode::Continue,
                Some(&resume_session_id),
                false,
            )
            .await?
        }
        _ => {
            super::process_spawn::spawn_cli_process(
                effective_cwd,
                &meta.prompt,
                &adapter_settings,
                &crate::models::SessionMode::Continue,
                Some(&resume_session_id),
                false,
                &[],
                remote.as_ref(),
                meta.remote_cwd.as_deref(),
                resolved.api_key.as_deref(),
                resolved.auth_token.as_deref(),
                resolved.base_url.as_deref(),
                run_id,
                resolved.models.as_deref(),
                resolved.extra_env.as_ref(),
            )
            .await?
        }
    };

    let mut actor_handle = session_actor::spawn_actor_with_runtime(
        Arc::clone(emitter),
        sessions.clone(),
        run_id.to_string(),
        child,
        stdin,
        stdout,
        stderr,
        true,
        cancel_token.clone(),
        bootstrap.next_turn_index,
        bootstrap.next_auto_ctx_id,
        runtime_kind,
        Some(registry.clone()),
        Some(bootstrap),
    );
    let cmd_tx = actor_handle.cmd_tx.clone();
    let shutdown_rx = {
        let (tx, rx) = tokio::sync::oneshot::channel();
        drop(tx);
        std::mem::replace(&mut actor_handle.shutdown_rx, rx)
    };
    sessions
        .lock()
        .await
        .insert(run_id.to_string(), actor_handle);

    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    cmd_tx
        .send(ActorCommand::WaitReady { reply: ready_tx })
        .await
        .map_err(|_| "Actor dead before wait_ready".to_string())?;
    await_actor_reply(ready_rx, "recovery_wait_ready", ACTOR_READY_TIMEOUT_MS).await?;

    let replay_batch = {
        let mut map = registry.lock().await;
        let entry = map
            .get_mut(run_id)
            .ok_or_else(|| format!("Recovery state lost for run {run_id}"))?;
        entry.respawn_in_flight = false;
        let now = Instant::now();
        transition_recovery(entry, RecoveryState::Recovered, now);
        transition_recovery(entry, RecoveryState::Healthy, now);
        emit_session_lifecycle(
            emitter,
            run_id,
            entry.session_id.as_deref(),
            "ready",
            RecoveryState::Recovered,
            None,
            entry.connection_generation,
            entry.recovery_sm.consecutive_failures(),
        );
        emitter.persist_and_emit(
            run_id,
            &BusEvent::SessionRecovered {
                run_id: run_id.to_string(),
                ok: true,
            },
        );
        entry.drain_replay_batch()
    };

    for msg in replay_batch {
        let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
        cmd_tx
            .send(ActorCommand::SendMessage {
                text: msg.text,
                attachments: msg.attachments,
                client_message_id: msg.client_message_id,
                reply: reply_tx,
            })
            .await
            .map_err(|_| "Actor dead during replay".to_string())?;
        await_actor_reply(reply_rx, "recovery_replay", ACTOR_SEND_TIMEOUT_MS).await?;
    }

    spawn_recovery_watcher(
        run_id.to_string(),
        shutdown_rx,
        registry.clone(),
        sessions.clone(),
        Arc::clone(emitter),
        cancel_token.clone(),
        spawn_locks.clone(),
    );

    log::info!("[recovery] respawn complete for run_id={}", run_id);
    Ok(())
}

pub(crate) async fn send_or_queue_recovery(
    registry: &crate::agent::runtime_recovery::RecoveryRegistry,
    run_id: &str,
    message: String,
    attachments: Vec<crate::agent::attachment::AttachmentData>,
    client_message_id: Option<String>,
) -> Result<bool, String> {
    let mut map = registry.lock().await;
    let entry = map
        .get_mut(run_id)
        .ok_or_else(|| format!("Session {run_id} not found"))?;
    if entry.unrecoverable {
        return Err(RuntimeError::RecoveryExhausted {
            run_id: run_id.to_string(),
            attempts: entry.recovery_sm.consecutive_failures(),
        }
        .to_string());
    }
    if !entry.is_recovering() {
        return Ok(false);
    }
    entry
        .enqueue_recovery_send(message, attachments, client_message_id)
        .map_err(|e| e.to_string())?;
    Ok(true)
}
