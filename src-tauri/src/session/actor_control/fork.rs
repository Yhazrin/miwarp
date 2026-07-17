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
    let notes_block = read_project_notes_excerpt(project_cwd);
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
{recent_runs}{notes_block}"#,
        run_id = meta.id,
        project_cwd = project_cwd,
        execution_cwd = execution_cwd,
        total_runs = summary.total_runs,
        active_runs = summary.active_runs,
        idle_runs = summary.idle_runs,
        project_desk_runs = summary.project_desk_runs,
        recent_runs = recent_runs,
        notes_block = notes_block
    )
}

/// Read user-curated notes for `project_cwd` (mirrors
/// `commands::project_meta::encoded_cwd`). Returns an empty string when no
/// notes.md exists, so the caller can append unconditionally.
fn read_project_notes_excerpt(project_cwd: &str) -> String {
    let encoded = project_cwd.replace(['/', '\\', ':'], "_");
    let path = crate::storage::data_dir()
        .join("projects")
        .join(&encoded)
        .join("notes.md");
    let content = match std::fs::read_to_string(&path) {
        Ok(s) if !s.trim().is_empty() => s,
        _ => return String::new(),
    };
    format!(
        "\n\nProject notes (curated by user):\n{}",
        content.trim_end()
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

// P0-2 (permission) hardening: the `permission_mode_override` IPC
// boundary now uses `agent::adapter::canonicalize_permission_mode` as
// the single source of truth. The previous `VALID_PERMISSION_MODE_OVERRIDES`
// + `is_valid_permission_mode_override` pair lived in this file and
// silently drifted out of sync with the rest of the codebase — see
// `audit_2026_06_29.md` P0-8 (audit) and the user review on 2026-06-29.
//
// Validation now lives next to the canonicalization logic in
// `agent::adapter`, where it stays in lock-step with
// `session-store.svelte.ts` (frontend), `cursor.rs` (third-party CLI
// adapter), and `apply_to_command` (the argv builder). Re-exports of
// the canonical function are kept here so existing call sites in this
// file continue to compile.

// ── Tests ──

#[cfg(test)]
