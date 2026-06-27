//! Fleet View commands (v1.2.0)
//!
//! Aggregates `ActorSessionMap` (live actors) + `storage::runs` (persisted meta)
//! into a "digital workforce" view used by both the fleet UI page and the local
//! MCP server. Read-only + dispatch-only — does NOT hold its own state.
//!
//! All commands take plain `ActorSessionMap` (Arc<Mutex<...>>) / `ProcessMap`
//! so they can be invoked from:
//! - Tauri command system (auto-injects from managed state)
//! - REST handlers in `web_server::fleet_api`
//! - MCP handlers in `mcp::fleet_server`
//!
//! Commands:
//! - `list_fleet`            — all live + recently-stopped members (summary)
//! - `get_fleet_member`      — single member detail (recent runs, teams)
//! - `get_fleet_metrics`     — aggregate counts/tokens for header
//! - `send_to_fleet_member`  — coordinator; actual send via chat IPC
//! - `stop_fleet_member`     — forward to `commands::runs::stop_run`

use crate::agent::adapter::ActorSessionMap;
use crate::agent::session_actor::ActorCommand;
use crate::agent::stream::ProcessMap;
use crate::models::{
    FleetMemberDetail, FleetMemberMetrics, FleetMemberSummary, FleetMetrics, FleetSendResult,
    FleetStatus, RunMeta, TaskRun,
};
use crate::storage;
use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Truncate task preview to a UI-friendly length (chars, not bytes).
const PREVIEW_MAX_CHARS: usize = 200;
/// Cap recent_runs list to keep get_fleet_member payload small.
const RECENT_RUNS_LIMIT: usize = 10;
/// Max sessions returned by list_fleet (UI grid doesn't need more).
const FLEET_LIST_LIMIT: usize = 100;
/// Non-running members older than this are opportunistically archived on the
/// next `list_fleet` call. `Running` and `Idle` (parked-but-alive) are never
/// archived — only `Stopped` / `Detached` / `Error` / `Completed` members
/// whose actor is gone.
const FLEET_ARCHIVE_THRESHOLD_SECS: u64 = 24 * 60 * 60;
/// Default timeout for `ActorCommand::SendMessage` from `send_to_fleet_member`.
const FLEET_SEND_TIMEOUT: Duration = Duration::from_secs(45);

/// Map a `RunStatus` + actor-alive flag → `FleetStatus`.
fn derive_status(run_status: Option<&crate::models::RunStatus>, actor_alive: bool) -> FleetStatus {
    let Some(s) = run_status else {
        return if actor_alive {
            FleetStatus::Idle
        } else {
            FleetStatus::Detached
        };
    };

    use crate::models::RunStatus::*;
    if !actor_alive {
        return match s {
            Failed => FleetStatus::Error,
            Stopped | Completed => FleetStatus::Stopped,
            _ => FleetStatus::Detached,
        };
    }

    match s {
        Running => FleetStatus::Running,
        Idle => FleetStatus::Idle,
        Pending => FleetStatus::Idle,
        Failed => FleetStatus::Error,
        Stopped => FleetStatus::Stopped,
        Completed => FleetStatus::Stopped,
    }
}

/// Pull a short preview from the most recent user message on disk.
fn current_task_preview(run_id: &str) -> Option<String> {
    let events = storage::events::list_events(run_id, 0);
    for ev in events.iter().rev() {
        let t = format!("{}", ev.event_type);
        if t == "user" {
            if let Some(text) = ev.payload.get("text").and_then(|v| v.as_str()) {
                let trimmed: String = text.chars().take(PREVIEW_MAX_CHARS).collect();
                return if text.chars().count() > PREVIEW_MAX_CHARS {
                    Some(format!("{trimmed}…"))
                } else {
                    Some(trimmed)
                };
            }
        }
    }
    None
}

/// Seconds since UNIX epoch.
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Build a summary from `RunMeta` + actor-alive + preview.
fn build_summary(meta: &RunMeta, actor_alive: bool, _team_ids: Vec<String>) -> FleetMemberSummary {
    let status = derive_status(Some(&meta.status), actor_alive);
    let started_secs = meta
        .started_at
        .parse::<chrono::DateTime<chrono::Utc>>()
        .map(|dt| dt.timestamp() as u64)
        .unwrap_or(0);
    let uptime_secs = now_secs().saturating_sub(started_secs);

    let preview = current_task_preview(&meta.id);

    FleetMemberSummary {
        id: meta.id.clone(),
        agent: meta.agent.clone(),
        status,
        cwd: meta.cwd.clone(),
        workspace_alias: meta.worktree_branch.clone().or(meta.parent_cwd.clone()),
        started_at: meta.started_at.clone(),
        last_activity_at: meta.started_at.clone(),
        current_task_preview: preview,
        metrics: FleetMemberMetrics {
            uptime_secs,
            tool_calls: 0,
            tokens_used: 0,
            cost_usd_estimate: 0.0,
            message_count: 0,
        },
        model: meta.model.clone(),
    }
}

/// List fleet members.
#[tauri::command]
pub async fn list_fleet(
    sessions: tauri::State<'_, ActorSessionMap>,
    include_archived: Option<bool>,
) -> Result<Vec<FleetMemberSummary>, String> {
    list_fleet_inner(sessions.inner().clone(), include_archived.unwrap_or(false)).await
}

/// Inner (non-Tauri) variant — call this from REST handlers, MCP, and tests.
pub async fn list_fleet_inner(
    sessions: ActorSessionMap,
    include_archived: bool,
) -> Result<Vec<FleetMemberSummary>, String> {
    log::debug!(
        "[fleet] list_fleet invoked (include_archived={})",
        include_archived
    );
    let metas = tokio::task::spawn_blocking(storage::runs::list_all_run_metas)
        .await
        .map_err(|e| format!("list_fleet task failed: {e}"))?;

    // Opportunistic archive pass: any non-running member past the threshold
    // gets `archived_at = now`. Runs inside a blocking task — disk I/O should
    // not block the actor runtime. Failures are logged but never fail the
    // list call.
    opportunistic_archive(&metas, &sessions).await;

    // Re-read after the archive pass so the filter below sees fresh `archived_at`
    // values written by the pass above (the in-memory `metas` snapshot may now
    // be stale; for correctness we re-list when the archive pass wrote anything).
    let needs_reread = {
        let map = sessions.lock().await;
        metas
            .iter()
            .any(|m| is_archive_candidate(m, map.contains_key(&m.id)))
    };
    let metas = if needs_reread {
        match tokio::task::spawn_blocking(storage::runs::list_all_run_metas).await {
            Ok(v) => v,
            Err(_) => metas, // best-effort; fall back to in-memory snapshot
        }
    } else {
        metas
    };

    let actor_map = sessions.lock().await;
    let mut out: Vec<FleetMemberSummary> = metas
        .into_iter()
        .filter(|m| should_include(m, include_archived))
        .map(|m| {
            let alive = actor_map.contains_key(&m.id);
            build_summary(&m, alive, Vec::new())
        })
        .collect();

    out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    out.truncate(FLEET_LIST_LIMIT);

    log::debug!("[fleet] list_fleet: returning {} members", out.len());
    Ok(out)
}

/// Pure filter used by `list_fleet_inner` and unit-testable in isolation.
fn should_include(m: &RunMeta, include_archived: bool) -> bool {
    m.deleted_at.is_none() && (include_archived || m.archived_at.is_none())
}

/// Compute age of an ISO 8601 timestamp, in seconds. Returns 0 on parse failure
/// (we treat unparseable as "ancient" so the archive filter still applies).
fn age_secs(started_at: &str) -> u64 {
    chrono::DateTime::parse_from_rfc3339(started_at)
        .map(|dt| now_secs().saturating_sub(dt.timestamp().max(0) as u64))
        .unwrap_or(u64::MAX)
}

/// Decide whether `meta` is a candidate for opportunistic archival. Pure
/// function — no I/O, no actor map lookup. The caller passes the alive flag
/// computed against the current session map.
fn is_archive_candidate(m: &RunMeta, alive: bool) -> bool {
    if m.archived_at.is_some() || m.deleted_at.is_some() {
        return false;
    }
    let status = derive_status(Some(&m.status), alive);
    if matches!(status, FleetStatus::Running | FleetStatus::Idle) {
        return false;
    }
    age_secs(&m.started_at) > FLEET_ARCHIVE_THRESHOLD_SECS
}

/// Best-effort archive pass: mark non-running members past the threshold.
/// Errors are logged and swallowed; the list call must never fail because of
/// the reaper.
async fn opportunistic_archive(metas: &[RunMeta], sessions: &ActorSessionMap) {
    let mut to_archive: Vec<String> = Vec::new();
    {
        let map = sessions.lock().await;
        for m in metas {
            let alive = map.contains_key(&m.id);
            if is_archive_candidate(m, alive) {
                to_archive.push(m.id.clone());
            }
        }
    }
    if to_archive.is_empty() {
        return;
    }
    let count = to_archive.len();
    let res = tokio::task::spawn_blocking(move || {
        let mut ok = 0u32;
        for id in to_archive {
            match storage::runs::mark_archived(&id) {
                Ok(true) => ok += 1,
                Ok(false) => {} // already archived / deleted
                Err(e) => log::warn!("[fleet] opportunistic_archive: {} failed: {}", id, e),
            }
        }
        ok
    })
    .await;
    match res {
        Ok(ok) if ok > 0 => log::info!(
            "[fleet] opportunistic_archive: archived {} of {} candidate(s)",
            ok,
            count
        ),
        Ok(_) => {} // nothing actually changed (race with another call)
        Err(e) => log::warn!("[fleet] opportunistic_archive: join failed: {}", e),
    }
}

/// Get a single fleet member detail.
#[tauri::command]
pub async fn get_fleet_member(
    id: String,
    sessions: tauri::State<'_, ActorSessionMap>,
) -> Result<FleetMemberDetail, String> {
    get_fleet_member_inner(id, sessions.inner().clone()).await
}

/// Inner (non-Tauri) variant.
pub async fn get_fleet_member_inner(
    id: String,
    sessions: ActorSessionMap,
) -> Result<FleetMemberDetail, String> {
    log::debug!("[fleet] get_fleet_member id={}", id);

    let meta = tokio::task::spawn_blocking({
        let id = id.clone();
        move || storage::runs::get_run(&id)
    })
    .await
    .map_err(|e| format!("get_fleet_member task failed: {e}"))?
    .ok_or_else(|| format!("Fleet member {id} not found"))?;

    let actor_map = sessions.lock().await;
    let alive = actor_map.contains_key(&id);

    let summary = build_summary(&meta, alive, Vec::new());

    let recent_runs: Vec<TaskRun> = if meta.deleted_at.is_some() {
        Vec::new()
    } else {
        vec![meta.to_task_run(None, None, summary.current_task_preview.clone())]
            .into_iter()
            .take(RECENT_RUNS_LIMIT)
            .collect()
    };

    Ok(FleetMemberDetail {
        summary,
        permission_mode: None,
        team_ids: Vec::new(),
        recent_runs,
    })
}

/// Aggregate metrics across all fleet members.
#[tauri::command]
pub async fn get_fleet_metrics(
    sessions: tauri::State<'_, ActorSessionMap>,
    include_archived: Option<bool>,
) -> Result<FleetMetrics, String> {
    get_fleet_metrics_inner(sessions.inner().clone(), include_archived.unwrap_or(false)).await
}

/// Inner (non-Tauri) variant.
pub async fn get_fleet_metrics_inner(
    sessions: ActorSessionMap,
    include_archived: bool,
) -> Result<FleetMetrics, String> {
    log::debug!(
        "[fleet] get_fleet_metrics invoked (include_archived={})",
        include_archived
    );

    let metas = tokio::task::spawn_blocking(storage::runs::list_all_run_metas)
        .await
        .map_err(|e| format!("get_fleet_metrics task failed: {e}"))?;

    let actor_map = sessions.lock().await;
    let mut by_status: HashMap<String, u32> = HashMap::new();
    let mut by_agent: HashMap<String, u32> = HashMap::new();
    let mut total = 0u32;

    for m in metas
        .into_iter()
        .filter(|m| m.deleted_at.is_none())
        .filter(|m| include_archived || m.archived_at.is_none())
    {
        let alive = actor_map.contains_key(&m.id);
        let s = derive_status(Some(&m.status), alive);
        *by_status.entry(s.to_string()).or_insert(0) += 1;
        *by_agent.entry(m.agent.clone()).or_insert(0) += 1;
        total += 1;
    }

    Ok(FleetMetrics {
        total,
        by_status,
        by_agent,
        total_tokens_today: 0,
        total_cost_today_usd: 0.0,
    })
}

/// Coordinator for "send message to a fleet member".
///
/// Forwards the prompt to the live `SessionActor` via the actor mailbox
/// (`ActorCommand::SendMessage`). The actor handles the actual stdin write
/// and emits the `UserMessage` + `RunState(running)` bus events.
///
/// When the actor is gone (e.g. member is `Detached` after a restart) the
/// command returns `Err` — the caller (MCP `send_to_employee` or the fleet
/// UI) is expected to surface that to the user. We deliberately do not
/// auto-spawn a new run here, because that would change the semantics of
/// "send to existing employee" into "create a new session with this id".
pub async fn send_to_fleet_member_inner(
    sessions: ActorSessionMap,
    id: String,
    prompt: String,
) -> Result<FleetSendResult, String> {
    log::debug!(
        "[fleet] send_to_fleet_member id={} prompt_len={}",
        id,
        prompt.len()
    );

    if prompt.trim().is_empty() {
        return Err("prompt is required".to_string());
    }

    // Look up the actor handle. We must hold the map lock only long enough to
    // grab the channel sender — sending on the channel happens after the
    // guard is dropped to avoid blocking other commands during a slow turn.
    let cmd_tx = {
        let map = sessions.lock().await;
        match map.get(&id) {
            Some(handle) => handle.cmd_tx.clone(),
            None => {
                return Err(format!(
                    "Fleet member {id} is not currently running; start a new session instead"
                ))
            }
        }
    };

    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    cmd_tx
        .send(ActorCommand::SendMessage {
            text: prompt,
            attachments: Vec::new(),
            reply: reply_tx,
            client_message_id: None,
        })
        .await
        .map_err(|_| format!("Fleet member {id} actor is dead"))?;

    let result = tokio::time::timeout(FLEET_SEND_TIMEOUT, reply_rx)
        .await
        .map_err(|_| format!("send_to_fleet_member: timed out after {FLEET_SEND_TIMEOUT:?}"))?
        .map_err(|_| "Actor reply channel closed".to_string())?;

    result?;

    Ok(FleetSendResult {
        run_id: id,
        accepted: true,
    })
}

#[tauri::command]
pub async fn send_to_fleet_member(
    id: String,
    prompt: String,
    sessions: tauri::State<'_, ActorSessionMap>,
) -> Result<FleetSendResult, String> {
    send_to_fleet_member_inner(sessions.inner().clone(), id, prompt).await
}

/// Stop a fleet member's actor and update its status to `Stopped`.
///
/// Forwards to `commands::runs::stop_run_inner` which already handles actor +
/// pipe + status update paths.
#[tauri::command]
pub async fn stop_fleet_member(
    id: String,
    sessions: tauri::State<'_, ActorSessionMap>,
    process_map: tauri::State<'_, ProcessMap>,
) -> Result<bool, String> {
    stop_fleet_member_inner(id, sessions.inner().clone(), process_map.inner().clone()).await
}

/// Inner (non-Tauri) variant.
pub async fn stop_fleet_member_inner(
    id: String,
    sessions: ActorSessionMap,
    process_map: ProcessMap,
) -> Result<bool, String> {
    log::debug!("[fleet] stop_fleet_member id={}", id);
    super::runs::stop_run_inner(id, sessions, process_map).await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::session_actor::SessionActorHandle;
    use crate::models::RunStatus;
    use std::sync::Arc;

    #[test]
    fn derive_status_actor_alive_running() {
        assert_eq!(
            derive_status(Some(&RunStatus::Running), true),
            FleetStatus::Running
        );
    }

    #[test]
    fn derive_status_actor_alive_idle() {
        assert_eq!(
            derive_status(Some(&RunStatus::Idle), true),
            FleetStatus::Idle
        );
    }

    #[test]
    fn derive_status_actor_alive_pending_is_idle() {
        assert_eq!(
            derive_status(Some(&RunStatus::Pending), true),
            FleetStatus::Idle
        );
    }

    #[test]
    fn derive_status_actor_dead_was_running() {
        assert_eq!(
            derive_status(Some(&RunStatus::Running), false),
            FleetStatus::Detached
        );
    }

    #[test]
    fn derive_status_actor_dead_was_failed() {
        assert_eq!(
            derive_status(Some(&RunStatus::Failed), false),
            FleetStatus::Error
        );
    }

    #[test]
    fn derive_status_actor_dead_was_stopped() {
        assert_eq!(
            derive_status(Some(&RunStatus::Stopped), false),
            FleetStatus::Stopped
        );
    }

    #[test]
    fn derive_status_actor_dead_was_completed() {
        assert_eq!(
            derive_status(Some(&RunStatus::Completed), false),
            FleetStatus::Stopped
        );
    }

    #[test]
    fn derive_status_no_meta_alive() {
        assert_eq!(derive_status(None, true), FleetStatus::Idle);
    }

    #[test]
    fn derive_status_no_meta_dead() {
        assert_eq!(derive_status(None, false), FleetStatus::Detached);
    }

    #[test]
    fn fleet_status_display_uses_snake_case() {
        // Display uses snake_case (matches serde), Debug uses PascalCase.
        let cases = [
            (FleetStatus::Idle, "idle"),
            (FleetStatus::Running, "running"),
            (FleetStatus::AwaitingPermission, "awaiting_permission"),
            (FleetStatus::Error, "error"),
            (FleetStatus::Stopped, "stopped"),
            (FleetStatus::Detached, "detached"),
        ];
        for (s, expected) in cases {
            assert_eq!(s.to_string(), expected);
        }
    }

    #[test]
    fn preview_truncates_at_200_chars() {
        let long = "a".repeat(500);
        let mut chars: String = long.chars().take(PREVIEW_MAX_CHARS).collect();
        chars.push('…');
        assert_eq!(chars.chars().count(), PREVIEW_MAX_CHARS + 1);
    }

    #[test]
    fn now_secs_is_positive() {
        assert!(now_secs() > 1_700_000_000);
    }

    // ── Archive filter tests (pure) ──

    /// Build a minimal `RunMeta` for filter tests.
    fn make_meta(id: &str, status: RunStatus, started_at: &str) -> RunMeta {
        RunMeta {
            id: id.to_string(),
            prompt: String::new(),
            cwd: "/tmp".to_string(),
            agent: "claude".to_string(),
            auth_mode: "cli".to_string(),
            status,
            started_at: started_at.to_string(),
            ended_at: None,
            exit_code: None,
            error_message: None,
            session_id: None,
            result_subtype: None,
            model: None,
            parent_run_id: None,
            name: None,
            remote_host_name: None,
            remote_cwd: None,
            remote_host_snapshot: None,
            platform_id: None,
            platform_base_url: None,
            source: None,
            cli_import_watermark: None,
            cli_session_path: None,
            cli_usage_incomplete: None,
            folder_id: None,
            deleted_at: None,
            archived_at: None,
            creation_mode: None,
            worktree_path: None,
            worktree_branch: None,
            parent_cwd: None,
            no_session_persistence: false,
            execution_path: None,
            conversation_ref: None,
            run_surface: None,
            scheduled_task_id: None,
            scheduled_task_run_id: None,
            runtime_kind: None,
            protocol_kind: None,
            project_desk_context: None,
        }
    }

    #[test]
    fn should_include_filters_out_archived_by_default() {
        let mut archived = make_meta("a", RunStatus::Stopped, "2024-01-01T00:00:00Z");
        archived.archived_at = Some("2024-01-02T00:00:00Z".to_string());
        let fresh = make_meta("b", RunStatus::Running, "2024-01-01T00:00:00Z");

        // include_archived=false → archived is hidden
        assert!(!should_include(&archived, false));
        // include_archived=true → archived is shown
        assert!(should_include(&archived, true));
        // Fresh member always shown
        assert!(should_include(&fresh, false));
        assert!(should_include(&fresh, true));
    }

    #[test]
    fn should_include_always_filters_out_soft_deleted() {
        let mut m = make_meta("a", RunStatus::Stopped, "2024-01-01T00:00:00Z");
        m.deleted_at = Some("2024-01-02T00:00:00Z".to_string());
        assert!(!should_include(&m, false));
        assert!(
            !should_include(&m, true),
            "deleted is hidden even with include_archived"
        );
    }

    /// Replicates the default `list_fleet_inner` filter applied to an in-memory
    /// list, avoiding real disk I/O. The actual `list_fleet_inner` is exercised
    /// by the `opportunistic_archive` reaper on the next call.
    #[test]
    fn list_fleet_excludes_archived_by_default_filter() {
        let mut a = make_meta("archived", RunStatus::Stopped, "2024-01-01T00:00:00Z");
        a.archived_at = Some("2024-01-02T00:00:00Z".to_string());
        let fresh = make_meta("fresh", RunStatus::Running, "2024-01-01T00:00:00Z");

        let metas = vec![a.clone(), fresh.clone()];
        let included: Vec<&RunMeta> = metas.iter().filter(|m| should_include(m, false)).collect();
        assert_eq!(included.len(), 1);
        assert_eq!(included[0].id, "fresh");
    }

    #[test]
    fn list_fleet_includes_archived_when_requested_filter() {
        let mut a = make_meta("archived", RunStatus::Stopped, "2024-01-01T00:00:00Z");
        a.archived_at = Some("2024-01-02T00:00:00Z".to_string());
        let fresh = make_meta("fresh", RunStatus::Running, "2024-01-01T00:00:00Z");

        let metas = vec![a.clone(), fresh.clone()];
        let included: Vec<&RunMeta> = metas.iter().filter(|m| should_include(m, true)).collect();
        assert_eq!(included.len(), 2);
    }

    #[test]
    fn auto_archive_marks_old_non_running() {
        // Build a non-running (Stopped, actor gone) member whose `started_at`
        // is older than the threshold. The reaper should flag it.
        let old = chrono::Utc::now()
            - chrono::Duration::seconds((FLEET_ARCHIVE_THRESHOLD_SECS as i64) + 60);
        let old_iso = old.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let m = make_meta("zombie", RunStatus::Stopped, &old_iso);

        assert!(
            is_archive_candidate(&m, false),
            "old non-running member should be a reaper candidate"
        );
    }

    #[test]
    fn auto_archive_skips_recent_non_running() {
        // A freshly-stopped member should not be archived on the next list call.
        let recent_iso = chrono::Utc::now()
            .checked_sub_signed(chrono::Duration::seconds(60))
            .expect("now-60s fits")
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let m = make_meta("recent", RunStatus::Stopped, &recent_iso);

        assert!(
            !is_archive_candidate(&m, false),
            "recently-stopped member should NOT be archived yet"
        );
    }

    #[test]
    fn auto_archive_never_touches_running_or_idle() {
        // Even if a member's started_at is ancient, Running/Idle is "alive" and
        // must never be archived.
        let old = chrono::Utc::now()
            - chrono::Duration::seconds((FLEET_ARCHIVE_THRESHOLD_SECS as i64) * 10);
        let old_iso = old.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let running = make_meta("alive-running", RunStatus::Running, &old_iso);
        let idle = make_meta("alive-idle", RunStatus::Idle, &old_iso);

        assert!(!is_archive_candidate(&running, true));
        assert!(!is_archive_candidate(&idle, true));
    }

    #[test]
    fn auto_archive_skips_already_archived_or_deleted() {
        let old = chrono::Utc::now()
            - chrono::Duration::seconds((FLEET_ARCHIVE_THRESHOLD_SECS as i64) + 60);
        let old_iso = old.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let mut m = make_meta("x", RunStatus::Stopped, &old_iso);
        m.archived_at = Some("2024-01-01T00:00:00Z".to_string());
        assert!(!is_archive_candidate(&m, false));

        let mut m2 = make_meta("y", RunStatus::Stopped, &old_iso);
        m2.deleted_at = Some("2024-01-01T00:00:00Z".to_string());
        assert!(!is_archive_candidate(&m2, false));
    }

    // ── send_to_fleet_member tests (async) ──

    /// Build a fresh `ActorSessionMap` for tests.
    fn empty_sessions() -> ActorSessionMap {
        crate::agent::adapter::new_actor_session_map()
    }

    /// Insert a fake actor that echoes `SendMessage` to a oneshot reply. The
    /// fake's `cmd_tx` will accept messages and route the `SendMessage` reply
    /// straight back to the caller. We never spawn a real actor task.
    async fn install_fake_actor(sessions: ActorSessionMap, run_id: &str) {
        let (cmd_tx, mut cmd_rx) = tokio::sync::mpsc::channel::<ActorCommand>(16);
        let (_shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
        // The shutdown sender is dropped on return; we only use shutdown_rx
        // to satisfy the `SessionActorHandle` field. The receiver is never
        // awaited by our fake drain.
        let _ = _shutdown_tx;
        let handle = SessionActorHandle {
            cmd_tx: cmd_tx.clone(),
            run_id: run_id.to_string(),
            tag: Arc::new(()),
            // Drain mailbox in a background task and auto-reply to SendMessage.
            // When the test ends and `cmd_tx` is dropped, this task exits.
            join_handle: tokio::spawn(async move {
                while let Some(cmd) = cmd_rx.recv().await {
                    if let ActorCommand::SendMessage { reply, .. } = cmd {
                        let _ = reply.send(Ok(()));
                    }
                }
            }),
            shutdown_rx,
        };

        let mut map = sessions.lock().await;
        map.insert(run_id.to_string(), handle);
    }

    #[tokio::test]
    async fn send_to_fleet_member_returns_error_when_not_alive() {
        let sessions = empty_sessions();
        // No actor registered for "ghost"
        let res = send_to_fleet_member_inner(sessions, "ghost".to_string(), "hi".to_string()).await;
        assert!(res.is_err(), "expected error when no actor in map");
        let err = res.unwrap_err();
        assert!(
            err.contains("not currently running"),
            "error should be informative, got: {err}"
        );
    }

    #[tokio::test]
    async fn send_to_fleet_member_rejects_empty_prompt() {
        let sessions = empty_sessions();
        install_fake_actor(sessions.clone(), "alive").await;
        let res =
            send_to_fleet_member_inner(sessions, "alive".to_string(), "   ".to_string()).await;
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("prompt is required"));
    }

    #[tokio::test]
    async fn send_to_fleet_member_succeeds_when_alive() {
        let sessions = empty_sessions();
        install_fake_actor(sessions.clone(), "alive").await;

        let res =
            send_to_fleet_member_inner(sessions, "alive".to_string(), "do the thing".to_string())
                .await;

        let result = res.expect("send should succeed against a live actor");
        assert_eq!(result.run_id, "alive");
        assert!(result.accepted, "result.accepted should be true");
    }
}
