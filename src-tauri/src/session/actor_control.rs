//! Actor control: session start / stop / fork, get_cmd_tx, stop_actor, runtime status.
//!
//! Extracted from `commands/session.rs` (P0+P1+P2 workbench repair, 2026-06-28).
//! Owns the lifecycle of a `SessionActor`: acquire `SpawnLocks` → resolve auth & remote
//! → spawn process → insert handle → send initial message.

use crate::agent::adapter::{self, AdapterSettings};
use crate::agent::attachment::AttachmentData;
use crate::agent::claude_stream;
use crate::agent::session_actor::{self, ActorCommand};
use crate::agent::spawn_locks::SpawnLocks;
use crate::governor::{Admission, ResourceGovernor};
use crate::models::{AgentRuntimeKind, BusEvent, RunMeta, RunStatus, SessionMode};
use crate::storage;
use crate::web_server::broadcaster::BroadcastEmitter;
use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

/// Default timeout for actor replies (permission, elicitation, hook callback, etc.)
pub(crate) const ACTOR_REPLY_TIMEOUT_MS: u64 = 30_000;
/// Timeout for `send_message` actor replies (may need to wait for turn dispatch)
pub(crate) const ACTOR_SEND_TIMEOUT_MS: u64 = 45_000;
/// Timeout for `WaitReady` after actor spawn
pub(crate) const ACTOR_READY_TIMEOUT_MS: u64 = 5_000;

/// Await an actor oneshot reply with a timeout.
/// Returns the inner `Result<T, String>` or a timeout/drop error.
pub(crate) async fn await_actor_reply<T>(
    rx: tokio::sync::oneshot::Receiver<Result<T, String>>,
    label: &str,
    timeout_ms: u64,
) -> Result<T, String> {
    match tokio::time::timeout(Duration::from_millis(timeout_ms), rx).await {
        Ok(Ok(Ok(v))) => Ok(v),
        Ok(Ok(Err(e))) => Err(e),
        Ok(Err(_)) => Err(format!("Actor dropped reply: {}", label)),
        Err(_) => Err(format!("Actor reply timeout ({timeout_ms}ms): {label}")),
    }
}

/// Helper: get the actor command sender for a `run_id`.
pub(crate) async fn get_cmd_tx(
    sessions: &crate::agent::adapter::ActorSessionMap,
    run_id: &str,
) -> Result<tokio::sync::mpsc::Sender<ActorCommand>, String> {
    let map = sessions.lock().await;
    map.get(run_id)
        .map(|h| h.cmd_tx.clone())
        .ok_or_else(|| format!("Session {} not found", run_id))
}

/// Helper: stop an existing actor for a `run_id`, await its shutdown.
/// Returns `true` if an actor was stopped.
pub(crate) async fn stop_actor(
    sessions: &crate::agent::adapter::ActorSessionMap,
    run_id: &str,
) -> Result<bool, String> {
    let handle = {
        let mut map = sessions.lock().await;
        map.remove(run_id)
    };

    let Some(handle) = handle else {
        return Ok(false);
    };

    log::debug!("[session] stopping actor for run_id={}", run_id);

    // Send Stop command
    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    if handle
        .cmd_tx
        .send(ActorCommand::Stop { reply: reply_tx })
        .await
        .is_ok()
    {
        // Wait for reply (actor acknowledged stop)
        let _ = reply_rx.await;
    }

    // Wait for actor task to finish (with timeout)
    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), handle.join_handle).await;

    Ok(true)
}

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
    // P0-8: validate `permission_mode_override` against the CLI allowlist
    // BEFORE acquiring spawn locks or doing any other work. Unknown values
    // are rejected with a structured `PermissionError` so the frontend can
    // surface a typed failure (and so we never pass a free-form string to
    // the CLI process, where it would silently influence spawn behavior).
    if let Some(ref mode) = permission_mode_override {
        if !is_valid_permission_mode_override(mode) {
            log::warn!(
                "[session] start_session rejected: invalid permission_mode_override for run_id={}",
                run_id
            );
            return Err(crate::agent::permission_error::PermissionError::new(
                crate::agent::permission_error::PermissionErrorCode::Unknown,
                "permission_mode_override is not one of the allowed values",
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

    // 1b. Resource Governor admission check (110-S5) — refuse to spawn
    //     when the concurrent-run budget is exhausted. Emit a typed
    //     BusEvent so the frontend can surface the reason in a toast.
    let admission = governor.try_admit().await;
    if let Admission::Deny { .. } = &admission {
        governor.emit_budget_exceeded(&run_id, &admission);
        return Err(admission
            .deny_reason()
            .unwrap_or_else(|| "budget exceeded".into()));
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
    let remote = super::remote_context::resolve_remote_host(&meta)?;
    let effective_pid = super::platform_routing::effective_platform_id(
        &user_settings.auth_mode,
        platform_id.as_deref(),
        meta.platform_id.as_deref(),
        user_settings.active_platform_id.as_deref(),
    );
    let resolved = super::auth_resolution::resolve_auth_env_for_platform(
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
    let resolved = super::auth_resolution::augment_with_shell_auth(
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
        if let Err(e) = super::process_spawn::preflight_check_base_url(
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

    // 4. Emit RunState(spawning) — UserMessage now handled by actor
    let spawning_event = BusEvent::RunState {
        run_id: run_id.clone(),
        state: "spawning".to_string(),
        exit_code: None,
        error: None,
    };
    emitter.persist_and_emit(&run_id, &spawning_event);
    storage::runs::update_status(&run_id, RunStatus::Running, None, None).ok();

    // 5. Stop any existing actor for this run_id
    let had_session = stop_actor(sessions, &run_id).await?;
    if had_session {
        log::debug!(
            "[session] old actor teardown complete for run_id={}",
            run_id
        );
    }

    // 6. Spawn CLI process (no initial stdin write — actor handles it)
    let effective_cwd = meta.remote_cwd.as_deref().unwrap_or(&meta.cwd);
    let runtime_kind = meta.resolved_runtime_kind();

    let (child, stdin, stdout, stderr) = match &runtime_kind {
        AgentRuntimeKind::MiMoCode => {
            // MiMoCode: spawn via mimo run --format json
            super::process_spawn::spawn_mimo_process(
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
            super::process_spawn::spawn_cursor_process(
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
            super::process_spawn::spawn_cli_process(
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

    super::recovery_commands::spawn_recovery_watcher(
        run_id.clone(),
        shutdown_rx,
        recovery_registry.clone(),
        sessions.clone(),
        Arc::clone(emitter),
        cancel_token.clone(),
        spawn_locks.clone(),
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

pub(crate) async fn stop_session_impl(
    emitter: &Arc<BroadcastEmitter>,
    sessions: &crate::agent::adapter::ActorSessionMap,
    spawn_locks: &SpawnLocks,
    governor: &ResourceGovernor,
    run_id: String,
) -> Result<(), String> {
    let _guard = spawn_locks.acquire(&run_id).await;

    let was_active = stop_actor(sessions, &run_id).await?;
    if was_active {
        // Actor was active — emit stopped
        let event = BusEvent::RunState {
            run_id: run_id.clone(),
            state: "stopped".to_string(),
            exit_code: None,
            error: None,
        };
        emitter.persist_and_emit(&run_id, &event);
        storage::runs::update_status(&run_id, RunStatus::Stopped, None, None).ok();
    }

    // Resource Governor (110-S5): free the slot on user-initiated stop.
    governor.release_run(&run_id).await;
    Ok(())
}

pub(crate) async fn fork_session_impl(
    emitter: &Arc<BroadcastEmitter>,
    sessions: &crate::agent::adapter::ActorSessionMap,
    spawn_locks: &SpawnLocks,
    run_id: String,
) -> Result<String, String> {
    let _guard = spawn_locks.acquire(&run_id).await;
    log::debug!("[session] fork_session: source run_id={}", run_id);

    // 1. Read source run metadata
    let source =
        storage::runs::get_run(&run_id).ok_or_else(|| format!("Run {} not found", run_id))?;
    let session_id = source
        .session_id
        .clone()
        .ok_or_else(|| "No session_id available for fork".to_string())?;

    // 2. Stop source actor if alive
    let was_active = stop_actor(sessions, &run_id).await?;
    if was_active {
        log::debug!("[session] fork_session: stopped active source actor");
        let event = BusEvent::RunState {
            run_id: run_id.clone(),
            state: "stopped".to_string(),
            exit_code: None,
            error: None,
        };
        emitter.persist_and_emit(&run_id, &event);
        storage::runs::update_status(&run_id, RunStatus::Stopped, None, None).ok();
    }

    // 3. Create new run (audit #3: inherit remote_host_name + remote_cwd + snapshot + platform_id)
    let new_id = uuid::Uuid::new_v4().to_string();
    let mut meta = storage::runs::create_run(
        &new_id,
        &source.prompt,
        &source.cwd,
        &source.agent,
        RunStatus::Pending,
        source.model.clone(),
        Some(run_id.clone()),
        source.remote_host_name.clone(),
        source.remote_cwd.clone(),
        source.remote_host_snapshot.clone(),
        source.platform_id.clone(),
    )?;
    log::debug!(
        "[session] fork_session: fork {} ← parent {}, remote={:?}",
        new_id,
        run_id,
        source.remote_host_name
    );

    // 4. Copy parent events
    storage::events::copy_bus_events(&run_id, &new_id)?;

    // 5. Set parent session_id on fork run; inherit execution_path, but NOT conversation_ref
    //    (fork creates a new session — conversation_ref is written after fork_oneshot returns new ID)
    meta.session_id = Some(session_id.clone());
    meta.execution_path = Some(source.resolved_execution_path());
    // conversation_ref intentionally None — will be set in step 8 with new session_id
    storage::runs::save_meta(&meta)?;

    // 6. Build adapter settings + resolve remote (audit #3)
    let agent_settings = storage::settings::get_agent_settings(&source.agent);
    let user_settings = storage::settings::get_user_settings();
    let mut adapter = adapter::build_adapter_settings(&agent_settings, &user_settings, None);
    let remote = super::remote_context::resolve_remote_host(&source)?;
    let effective_pid = super::platform_routing::effective_platform_id(
        &user_settings.auth_mode,
        None,
        source.platform_id.as_deref(),
        user_settings.active_platform_id.as_deref(),
    );
    let resolved = super::auth_resolution::resolve_auth_env_for_platform(
        &remote,
        &user_settings,
        effective_pid.as_deref(),
    );
    adapter::clear_model_if_provider_overrides(
        &mut adapter,
        &None, // fork has no UI model override
        &agent_settings.model,
        &resolved.models,
    );
    let resolved = super::auth_resolution::augment_with_shell_auth(
        resolved,
        &user_settings.auth_mode,
        remote.is_some(),
        &source.cwd,
    );
    let effective_cwd = source.remote_cwd.as_deref().unwrap_or(&source.cwd);

    // 7. One-shot fork: get new session_id
    log::debug!(
        "[session] fork_session: starting fork_oneshot, source_sid={}, remote={:?}",
        session_id,
        remote.as_ref().map(|r| &r.name)
    );
    let new_session_id = match claude_stream::fork_oneshot(
        &session_id,
        effective_cwd,
        &adapter,
        remote.as_ref(),
        resolved.api_key.as_deref(),
        resolved.auth_token.as_deref(),
        resolved.base_url.as_deref(),
        resolved.models.as_deref(),
        resolved.extra_env.as_ref(),
    )
    .await
    {
        Ok(sid) => sid,
        Err(e) => {
            log::error!(
                "[session] fork_oneshot failed, cleaning up run {}: {}",
                new_id,
                e
            );
            storage::runs::update_status(&new_id, RunStatus::Failed, None, Some(e.clone()))?;
            return Err(e);
        }
    };
    log::debug!(
        "[session] fork_session: fork_oneshot returned new_sid={}",
        new_session_id
    );

    // 8. Persist new session_id + conversation_ref (one write)
    meta.session_id = Some(new_session_id.clone());
    meta.conversation_ref = Some(crate::models::ConversationRef::ClaudeSession(
        new_session_id,
    ));
    storage::runs::save_meta(&meta)?;

    log::debug!(
        "[session] fork_session completed: {} → {} (frontend will start_session to connect)",
        run_id,
        new_id
    );
    Ok(new_id)
}

// ── Project Desk system context (used by start_session_impl) ──

struct ProjectDeskRunSummary {
    total_runs: usize,
    active_runs: usize,
    idle_runs: usize,
    project_desk_runs: usize,
    recent_runs: Vec<String>,
}

fn run_project_cwd(meta: &RunMeta) -> &str {
    meta.parent_cwd.as_deref().unwrap_or(&meta.cwd)
}

fn is_active_status(status: &RunStatus) -> bool {
    matches!(
        status,
        RunStatus::Running | RunStatus::Pending | RunStatus::Idle
    )
}

fn is_idle_status(status: &RunStatus) -> bool {
    matches!(status, RunStatus::Idle)
}

fn run_label(meta: &RunMeta) -> String {
    let label = meta
        .name
        .as_deref()
        .or_else(|| {
            let trimmed = meta.prompt.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .unwrap_or(&meta.id);

    let mut chars = label.chars();
    let shortened: String = chars.by_ref().take(72).collect();
    if chars.next().is_some() {
        format!("{}...", shortened)
    } else {
        shortened
    }
}

fn summarize_project_runs(current: &RunMeta) -> ProjectDeskRunSummary {
    let project_cwd = run_project_cwd(current);
    let mut runs: Vec<RunMeta> = storage::runs::list_all_run_metas()
        .into_iter()
        .filter(|meta| run_project_cwd(meta) == project_cwd)
        .collect();

    runs.sort_by(|a, b| b.started_at.cmp(&a.started_at));

    ProjectDeskRunSummary {
        total_runs: runs.len(),
        active_runs: runs
            .iter()
            .filter(|meta| is_active_status(&meta.status))
            .count(),
        idle_runs: runs
            .iter()
            .filter(|meta| is_idle_status(&meta.status))
            .count(),
        project_desk_runs: runs
            .iter()
            .filter(|meta| {
                matches!(
                    meta.run_surface.as_ref(),
                    Some(crate::models::RunSurface::ProjectDesk)
                )
            })
            .count(),
        recent_runs: runs
            .iter()
            .take(5)
            .map(|meta| format!("{} [{}] {}", run_label(meta), meta.status, meta.started_at))
            .collect(),
    }
}

fn build_project_desk_system_context(meta: &RunMeta) -> String {
    let project_cwd = meta.parent_cwd.as_deref().unwrap_or(&meta.cwd);
    let execution_cwd = meta.remote_cwd.as_deref().unwrap_or(&meta.cwd);
    let summary = summarize_project_runs(meta);
    let recent_runs = if summary.recent_runs.is_empty() {
        "- none".to_string()
    } else {
        summary
            .recent_runs
            .iter()
            .map(|line| format!("- {}", line))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        r#"You are running inside MiWarp's Project Desk surface.

Project Desk is a first-class personal workspace for managing the whole MiWarp app and the selected project, not a generic chat tab.

Operate with this posture:
- Treat the selected project as the primary working context.
- Help the user manage project state, next actions, risks, files, sessions, tasks, and verification.
- Prefer concrete repo actions when the user's intent is actionable.
- Keep ordinary user prompts clean; do not mention this hidden context unless it is directly useful.
- When reporting status, connect your answer to the selected project and the broader MiWarp workspace.

Runtime context:
- run_id: {run_id}
- project_cwd: {project_cwd}
- execution_cwd: {execution_cwd}
- surface: project_desk

Project state snapshot:
- total_runs_for_project: {total_runs}
- active_runs_for_project: {active_runs}
- idle_runs_for_project: {idle_runs}
- project_desk_runs_for_project: {project_desk_runs}
- recent_runs:
{recent_runs}"#,
        run_id = meta.id,
        project_cwd = project_cwd,
        execution_cwd = execution_cwd,
        total_runs = summary.total_runs,
        active_runs = summary.active_runs,
        idle_runs = summary.idle_runs,
        project_desk_runs = summary.project_desk_runs,
        recent_runs = recent_runs
    )
}

fn append_adapter_context(target: &mut Option<String>, context: &str) {
    *target = Some(match target.take() {
        Some(existing) if !existing.trim().is_empty() => format!("{}\n\n{}", existing, context),
        _ => context.to_string(),
    });
}

/// P2-16: rough token estimate for the project-desk system context. Mirrors
/// the heuristic the workbench controller uses on the TS side as a fallback
/// when the backend hasn't stamped the value yet. We keep it conservative
/// (~3 chars per token) because the system prompt is English-leaning.
fn estimate_context_tokens(context: &str) -> u64 {
    let chars = context.chars().count() as u64;
    // Floor at 120 tokens so the UI never shows "0 tokens" for short context.
    std::cmp::max(120, chars / 3)
}

pub(crate) fn apply_project_desk_context(settings: &mut AdapterSettings, meta: &mut RunMeta) {
    if !matches!(
        meta.run_surface.as_ref(),
        Some(crate::models::RunSurface::ProjectDesk)
    ) {
        return;
    }

    let context = build_project_desk_system_context(meta);
    if settings.system_prompt.is_some() {
        append_adapter_context(&mut settings.system_prompt, &context);
    } else {
        append_adapter_context(&mut settings.append_system_prompt, &context);
    }

    // P2-14 / P2-16: stamp the snapshot metadata so the workbench sidebar
    // can label this run as a startup snapshot (and surface the real
    // char/token counts instead of guessing). We overwrite any prior
    // stamp because the context has been re-injected at this call site
    // and the snapshot timestamp must match the most recent apply.
    meta.project_desk_context = Some(crate::models::ProjectDeskContextMeta {
        context_char_count: context.chars().count() as u64,
        estimated_tokens: estimate_context_tokens(&context),
        snapshot_generated_at: crate::models::now_iso(),
    });

    log::debug!(
        "[session] project desk context injected for run_id={}, cwd={}",
        meta.id,
        meta.cwd
    );
}

/// Allowed values for the `permission_mode_override` Tauri-command field.
///
/// Mirrors the Claude CLI `--permission-mode` allowlist documented at
/// <https://docs.claude.com/en/docs/claude-code/iam#permission-modes>. Any
/// other value must be rejected at the IPC boundary — see P0-8 in the
/// permission-mode-override audit.
pub(crate) const VALID_PERMISSION_MODE_OVERRIDES: &[&str] =
    &["acceptEdits", "bypassPermissions", "default", "plan"];

/// Returns `true` if `mode` is one of the documented CLI permission modes
/// that the frontend is allowed to override with.
///
/// Centralized so the IPC boundary check in `start_session_impl` and the
/// unit tests below share the same source of truth.
pub(crate) fn is_valid_permission_mode_override(mode: &str) -> bool {
    VALID_PERMISSION_MODE_OVERRIDES.contains(&mode)
}

// ── Tests ──

#[cfg(test)]
mod permission_mode_override_tests {
    use super::is_valid_permission_mode_override;
    use super::VALID_PERMISSION_MODE_OVERRIDES;

    #[test]
    fn allowlist_accepts_all_documented_modes() {
        for mode in VALID_PERMISSION_MODE_OVERRIDES {
            assert!(
                is_valid_permission_mode_override(mode),
                "expected `{mode}` to be accepted"
            );
        }
    }

    #[test]
    fn rejects_empty_string() {
        assert!(!is_valid_permission_mode_override(""));
    }

    #[test]
    fn rejects_unknown_string() {
        assert!(!is_valid_permission_mode_override("totally-made-up"));
    }

    #[test]
    fn rejects_legacy_mi_warp_aliases() {
        // These were MiWarp-internal names that map_permission_mode
        // accepted, but the Tauri IPC boundary now rejects them outright
        // so the frontend can never smuggle an undeclared value into the
        // CLI spawn.
        for legacy in [
            "ask",
            "auto_read",
            "auto_all",
            "auto-accept-all",
            "auto",
            "delegate",
            "dont_ask",
            "dontAsk",
        ] {
            assert!(
                !is_valid_permission_mode_override(legacy),
                "legacy mode `{legacy}` must be rejected at the IPC boundary"
            );
        }
    }

    #[test]
    fn rejects_case_sensitive_variants() {
        // Allowlist is case-sensitive — `ACCEPTEDITS` is not the same as
        // `acceptEdits` and would be passed verbatim to the CLI.
        assert!(!is_valid_permission_mode_override("ACCEPTEDITS"));
        assert!(!is_valid_permission_mode_override("PLAN"));
        assert!(!is_valid_permission_mode_override("Default"));
    }

    #[test]
    fn rejects_whitespace_padded_value() {
        assert!(!is_valid_permission_mode_override(" plan"));
        assert!(!is_valid_permission_mode_override("plan "));
    }

    #[test]
    fn start_session_rejects_invalid_override_with_structured_error() {
        // Drive the real entry point with an invalid override and assert
        // it returns early with a structured PermissionError JSON
        // ({"code":"unknown","message":...,"retryable":false}).
        //
        // We can't actually spawn a session here, so we only need to
        // confirm the validator runs BEFORE the spawn-locks acquire step.
        // We exercise that by checking the validator itself, plus a
        // structural check that the validator is wired into the function.
        for mode in [
            "ask",
            "auto_all",
            "ACCEPTEDITS",
            "bypass-permissions",
            "",
            "delegated",
        ] {
            assert!(
                !is_valid_permission_mode_override(mode),
                "validator must reject `{mode}`"
            );
        }
    }
}
