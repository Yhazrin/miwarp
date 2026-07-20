//! Actor control: session start / stop / fork, get_cmd_tx, stop_actor, runtime status.
//!
//! Extracted from `commands/session.rs` (P0+P1+P2 workbench repair, 2026-06-28).
//! Owns the lifecycle of a `SessionActor`: acquire `SpawnLocks` → resolve auth & remote
//! → spawn process → insert handle → send initial message.

use crate::agent::adapter;
use crate::agent::attachment::AttachmentData;
use crate::agent::session_actor::{self, ActorCommand};
use crate::agent::spawn_locks::SpawnLocks;
use crate::governor::{Admission, ResourceGovernor};
use crate::models::{AgentRuntimeKind, BusEvent, RunStatus, SessionMode};
use crate::storage;
use crate::web_server::broadcaster::BroadcastEmitter;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

use super::fork::apply_project_desk_context;
use super::reply::{await_actor_reply, stop_actor, ACTOR_SEND_TIMEOUT_MS};

#[allow(clippy::too_many_arguments)]
pub(crate) async fn start_session_impl(
    emitter: &Arc<BroadcastEmitter>,
    sessions: &crate::agent::adapter::ActorSessionMap,
    spawn_locks: &SpawnLocks,
    cancel_token: &CancellationToken,
    recovery_registry: &crate::agent::runtime_recovery::RecoveryRegistry,
    governor: &ResourceGovernor,
    run_id: String,
    mode: Option<SessionMode>,
    session_id: Option<String>,
    initial_message: Option<String>,
    attachments: Option<Vec<AttachmentData>>,
    platform_id: Option<String>,
    permission_mode_override: Option<String>,
    client_message_id: Option<String>,
) -> Result<(), String> {
    // P0-2 (permission) hardening: validate `permission_mode_override`
    // against the canonical permission-mode contract BEFORE acquiring
    // spawn locks or doing any other work. The canonicalization table
    // lives in `agent::adapter` so the IPC boundary check, the cursor
    // adapter mapping, the Agent Editor dropdown, and the session-store
    // canonicalization all share a single source of truth. Unknown values
    // are rejected with a structured `PermissionError` so the frontend
    // can surface a typed failure (and so we never pass a free-form
    // string to the CLI process).
    if let Some(ref mode) = permission_mode_override {
        if let Err(reason) = crate::agent::adapter::canonicalize_permission_mode(mode) {
            log::warn!(
                "[session] start_session rejected: invalid permission_mode_override={:?} for run_id={}: {}",
                mode,
                run_id,
                reason
            );
            return Err(crate::agent::permission_error::PermissionError::new(
                crate::agent::permission_error::PermissionErrorCode::Unknown,
                format!("permission_mode_override rejected: {reason}"),
                false,
            )
            .to_string());
        }
    }
    let _guard = spawn_locks.acquire(&run_id).await;
    let session_mode = mode.unwrap_or_default();
    let att_list = attachments.unwrap_or_default();
    log::debug!(
        "[session] start_session called, run_id={}, mode={:?}, session_id={:?}, has_message={}, attachments={}, client_message_id={:?}",
        run_id,
        session_mode,
        session_id,
        initial_message.is_some(),
        att_list.len(),
        client_message_id,
    );

    // 1. Read run metadata + validate execution path
    let mut meta =
        storage::runs::get_run(&run_id).ok_or_else(|| format!("Run {} not found", run_id))?;
    let exec_path = meta.resolved_execution_path();
    if exec_path != crate::models::ExecutionPath::SessionActor {
        return Err(format!(
            "start_session requires execution_path=session_actor, got {:?} for run {}",
            exec_path, run_id
        ));
    }
    log::debug!(
        "[session] meta loaded: agent={}, prompt={:?}, cwd={}, exec_path={:?}",
        meta.agent,
        crate::storage::shared::truncate_str(&meta.prompt, 80),
        meta.cwd,
        exec_path
    );

    // 1a. Reconcile governor slots with live actors — actors that exited
    //     without an explicit stop_session can otherwise leak slots until
    //     the app restarts.
    {
        let live: Vec<String> = sessions.lock().await.keys().cloned().collect();
        governor.reconcile_live_sessions(&live).await;
    }

    // 1b. Resource Governor admission check (110-S5) — refuse to spawn
    //     when the concurrent-run budget is exhausted. Emit a typed
    //     BusEvent so the frontend can surface the reason in a toast.
    //     Replacing an already-tracked run_id (resume) does not need a
    //     new slot.
    let admission = governor.try_admit_for_run(&run_id).await;
    if let Admission::Deny { .. } = &admission {
        governor.emit_budget_exceeded(&run_id, &admission);
        return Err(admission
            .deny_reason()
            .unwrap_or_else(|| "budget exceeded".into()));
    }

    // 1c. Idempotent continue/resume without a new message: duplicate
    // start_session calls (URL resume racing loadRun, or double handleResume)
    // must not kill a live actor and respawn.
    if initial_message.is_none()
        && matches!(session_mode, SessionMode::Continue | SessionMode::Resume)
    {
        let already_live = sessions.lock().await.contains_key(&run_id);
        if already_live {
            log::debug!(
                "[session] start_session noop: actor already alive for run_id={}, mode={:?}",
                run_id,
                session_mode
            );
            return Ok(());
        }
    }

    // 2. Read settings and build unified adapter settings
    let agent_settings = storage::settings::get_agent_settings(&meta.agent);
    let user_settings = storage::settings::get_user_settings();
    let mut adapter_settings =
        adapter::build_adapter_settings(&agent_settings, &user_settings, meta.model.clone());

    // 2a. Apply per-session permission_mode override (e.g. ExitPlanMode → acceptEdits).
    //     Session-scoped: does not touch persisted user settings. Must run BEFORE spawn
    //     so the CLI's --permission-mode arg reflects the override for the first turn.
    if let Some(ref override_mode) = permission_mode_override {
        // Normalize the override through the same mapping as user settings
        let mapped = adapter::map_permission_mode(override_mode);
        log::debug!(
            "[session] permission_mode override: {:?} → {:?} (mapped from {:?})",
            adapter_settings.permission_mode,
            mapped,
            override_mode
        );
        adapter_settings.permission_mode = Some(mapped);
    }
    apply_project_desk_context(&mut adapter_settings, &mut meta);

    // P2-14 / P2-16: persist the snapshot stamp the helper just filled in
    // so the workbench sidebar sees a fresh `snapshot_generated_at` /
    // `context_char_count` / `estimated_tokens` on the next `list_runs`
    // call. Best-effort: if the meta write fails the spawn still proceeds
    // (the in-memory value is gone but the session is intact).
    if meta.project_desk_context.is_some() {
        if let Err(e) = storage::runs::save_meta(&meta) {
            log::warn!("[session] failed to persist project_desk_context: {}", e);
        }
    }

    // 2b. Resolve remote host from RunMeta (audit #2: single truth source)
    let remote = super::super::remote_context::resolve_remote_host(&meta)?;
    let effective_pid = super::super::platform_routing::effective_platform_id(
        &user_settings.auth_mode,
        platform_id.as_deref(),
        meta.platform_id.as_deref(),
        user_settings.active_platform_id.as_deref(),
    );
    let resolved = super::super::auth_resolution::resolve_auth_env_for_platform(
        &remote,
        &user_settings,
        effective_pid.as_deref(),
    );
    adapter::clear_model_if_provider_overrides(
        &mut adapter_settings,
        &meta.model,
        &agent_settings.model,
        &resolved.models,
    );
    let resolved = super::super::auth_resolution::augment_with_shell_auth(
        resolved,
        &user_settings.auth_mode,
        remote.is_some(),
        &meta.cwd,
    );
    if remote.is_some() {
        log::debug!(
            "[session] remote mode: host={:?}, remote_cwd={:?}, has_key={}",
            meta.remote_host_name,
            meta.remote_cwd,
            resolved.api_key.is_some() || resolved.auth_token.is_some()
        );
    }

    // 3. Resolve resume session_id
    let resume_session_id = match &session_mode {
        SessionMode::Resume | SessionMode::Continue => {
            let sid = session_id
                .or_else(|| meta.session_id.clone())
                .ok_or_else(|| {
                    format!(
                        "session_id required for {:?} but not found in params or run metadata",
                        session_mode
                    )
                })?;
            Some(sid)
        }
        SessionMode::Fork => {
            return Err(
                "Fork mode not supported in start_session — use fork_session command instead"
                    .into(),
            );
        }
        SessionMode::New => None,
    };

    // Validate
    adapter::validate_session_params(&adapter_settings, &session_mode)?;

    let is_new = matches!(session_mode, SessionMode::New);

    // Preflight: check base_url reachability
    // Skip for SSH remote — reachability depends on remote host's network
    if remote.is_none() {
        if let Err(e) = super::super::process_spawn::preflight_check_base_url(
            resolved.base_url.as_deref(),
            effective_pid.as_deref(),
        )
        .await
        {
            // Only mark as Failed for new runs still in Pending — don't overwrite history
            if is_new && meta.status == RunStatus::Pending {
                storage::runs::update_status(&run_id, RunStatus::Failed, None, Some(e.clone()))
                    .ok();
            }
            return Err(e);
        }
    }

    // 4. Stop any existing actor BEFORE emitting spawning — the old actor's
    // terminal RunState("stopped") must not arrive after spawning and pin the
    // frontend phase machine at "stopped" while the replacement actor runs.
    let had_session = stop_actor(sessions, &run_id).await?;
    if had_session {
        log::debug!(
            "[session] old actor teardown complete for run_id={}",
            run_id
        );
        // Free the slot synchronously before re-registering — the async
        // recovery watcher may fire later and must not drop the new slot.
        governor.release_run(&run_id).await;
    }

    // 5. Emit RunState(spawning) — UserMessage now handled by actor
    let spawning_event = BusEvent::RunState {
        run_id: run_id.clone(),
        state: "spawning".to_string(),
        exit_code: None,
        error: None,
    };
    emitter.persist_and_emit(&run_id, &spawning_event);
    storage::runs::update_status(&run_id, RunStatus::Running, None, None).ok();

    // 6. Spawn CLI process (no initial stdin write — actor handles it)
    let effective_cwd = meta.remote_cwd.as_deref().unwrap_or(&meta.cwd);
    let runtime_kind = meta.resolved_runtime_kind();

    let (child, stdin, stdout, stderr) = match &runtime_kind {
        AgentRuntimeKind::MiMoCode => {
            // MiMoCode: spawn via mimo run --format json
            super::super::process_spawn::spawn_mimo_process(
                effective_cwd,
                &meta.prompt,
                &adapter_settings,
                &session_mode,
                resume_session_id.as_deref(),
                is_new,
            )
            .await?
        }
        AgentRuntimeKind::Cursor => {
            super::super::process_spawn::spawn_cursor_process(
                effective_cwd,
                &adapter_settings,
                &session_mode,
                resume_session_id.as_deref(),
                is_new,
            )
            .await?
        }
        _ => {
            // ClaudeCode (default): existing spawn logic
            super::super::process_spawn::spawn_cli_process(
                effective_cwd,
                &meta.prompt,
                &adapter_settings,
                &session_mode,
                resume_session_id.as_deref(),
                is_new,
                &att_list,
                remote.as_ref(),
                meta.remote_cwd.as_deref(),
                resolved.api_key.as_deref(),
                resolved.auth_token.as_deref(),
                resolved.base_url.as_deref(),
                &run_id,
                resolved.models.as_deref(),
                resolved.extra_env.as_ref(),
            )
            .await?
        }
    };

    // 7. Compute turn baselines — 1-based: next_turn_index = N means next message gets turnIndex=N.
    // New session: first message gets turnIndex=1. Resume: first new message gets total+1.
    let (initial_turn_index, initial_auto_ctx_id) = if is_new {
        (1_u32, 1_u32)
    } else {
        let (total, normal) = crate::storage::events::count_user_messages(&run_id);
        (total + 1, normal + 1)
    };
    log::debug!(
        "[session] turn baselines: initial_turn_index={}, initial_auto_ctx_id={}",
        initial_turn_index,
        initial_auto_ctx_id
    );

    // 8. Spawn actor
    crate::agent::runtime_recovery::ensure_run_registered(
        recovery_registry,
        &run_id,
        resume_session_id.clone().or(meta.session_id.clone()),
    )
    .await;

    // Resource Governor: capture the OS PID before the child is consumed by
    // the actor. Best-effort; remote runs may yield None.
    let child_pid = child.id();
    let mut actor_handle = session_actor::spawn_actor_with_runtime(
        Arc::clone(emitter),
        sessions.clone(),
        run_id.clone(),
        child,
        stdin,
        stdout,
        stderr,
        !is_new,
        cancel_token.clone(),
        initial_turn_index,
        initial_auto_ctx_id,
        runtime_kind,
        Some(recovery_registry.clone()),
        None,
    );
    // Resource Governor: register the run as active now that the actor is
    // spawned. We only do this after spawn_actor succeeds so we don't leak
    // governor slots on admission-denied or spawn-failed runs.
    governor.register_run(&run_id, child_pid).await;
    let cmd_tx = actor_handle.cmd_tx.clone();
    let shutdown_rx = {
        let (tx, rx) = tokio::sync::oneshot::channel();
        drop(tx);
        std::mem::replace(&mut actor_handle.shutdown_rx, rx)
    };
    sessions.lock().await.insert(run_id.clone(), actor_handle);

    super::super::recovery_commands::spawn_recovery_watcher(
        run_id.clone(),
        shutdown_rx,
        recovery_registry.clone(),
        sessions.clone(),
        Arc::clone(emitter),
        cancel_token.clone(),
        spawn_locks.clone(),
        governor.clone(),
    );

    // 9. Send initial message through actor (unified entry point for Turn Engine)
    let initial_text = if is_new {
        Some(meta.prompt.clone())
    } else {
        initial_message.clone()
    };
    if let Some(text) = initial_text {
        let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
        cmd_tx
            .send(ActorCommand::SendMessage {
                text,
                attachments: att_list,
                reply: reply_tx,
                client_message_id: client_message_id.clone(),
            })
            .await
            .map_err(|_| "Actor dead before initial message".to_string())?;
        await_actor_reply(reply_rx, "initial_message", ACTOR_SEND_TIMEOUT_MS).await?;
        log::debug!(
            "[session] initial message sent through actor for run_id={}",
            run_id
        );
    } else {
        // Resume/continue without message: emit synthetic idle so frontend shows input box
        let idle_event = BusEvent::RunState {
            run_id: run_id.clone(),
            state: "idle".to_string(),
            exit_code: None,
            error: None,
        };
        emitter.persist_and_emit(&run_id, &idle_event);
        // Persist idle status (allows Pending→Idle, not just Running→Idle)
        let should_update = storage::runs::get_run(&run_id)
            .map(|m| m.status != RunStatus::Idle)
            .unwrap_or(false);
        if should_update {
            if let Err(e) = storage::runs::update_status(&run_id, RunStatus::Idle, None, None) {
                log::warn!("[session] synthetic idle meta update failed: {}", e);
            } else {
                emitter.emit_realtime(
                    "ocv:status-changed",
                    &serde_json::json!({"run_id": run_id.as_str(), "status": "idle"}),
                    Some(&run_id),
                );
            }
        }
        log::debug!(
            "[session] resume/continue: emitted synthetic RunState(idle) for run_id={}",
            run_id
        );
    }

    log::debug!("[session] actor spawned successfully for run_id={}", run_id);
    Ok(())
}
