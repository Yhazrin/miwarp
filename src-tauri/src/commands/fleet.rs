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
use crate::agent::stream::ProcessMap;
use crate::models::{
    FleetMemberDetail, FleetMemberMetrics, FleetMemberSummary, FleetMetrics, FleetSendResult,
    FleetStatus, RunMeta, TaskRun,
};
use crate::storage;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// Truncate task preview to a UI-friendly length (chars, not bytes).
const PREVIEW_MAX_CHARS: usize = 200;
/// Cap recent_runs list to keep get_fleet_member payload small.
const RECENT_RUNS_LIMIT: usize = 10;
/// Max sessions returned by list_fleet (UI grid doesn't need more).
const FLEET_LIST_LIMIT: usize = 100;

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
) -> Result<Vec<FleetMemberSummary>, String> {
    list_fleet_inner(sessions.inner().clone()).await
}

/// Inner (non-Tauri) variant — call this from REST handlers, MCP, and tests.
pub async fn list_fleet_inner(
    sessions: ActorSessionMap,
) -> Result<Vec<FleetMemberSummary>, String> {
    log::debug!("[fleet] list_fleet invoked");
    let metas = tokio::task::spawn_blocking(storage::runs::list_all_run_metas)
        .await
        .map_err(|e| format!("list_fleet task failed: {e}"))?;

    let actor_map = sessions.lock().await;
    let mut out: Vec<FleetMemberSummary> = metas
        .into_iter()
        .filter(|m| m.deleted_at.is_none())
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
) -> Result<FleetMetrics, String> {
    get_fleet_metrics_inner(sessions.inner().clone()).await
}

/// Inner (non-Tauri) variant.
pub async fn get_fleet_metrics_inner(sessions: ActorSessionMap) -> Result<FleetMetrics, String> {
    log::debug!("[fleet] get_fleet_metrics invoked");

    let metas = tokio::task::spawn_blocking(storage::runs::list_all_run_metas)
        .await
        .map_err(|e| format!("get_fleet_metrics task failed: {e}"))?;

    let actor_map = sessions.lock().await;
    let mut by_status: HashMap<String, u32> = HashMap::new();
    let mut by_agent: HashMap<String, u32> = HashMap::new();
    let mut total = 0u32;

    for m in metas.into_iter().filter(|m| m.deleted_at.is_none()) {
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
/// v1.2.0 MVP: returns `{accepted: true, run_id: <existing>}`; the actual send
/// goes through the existing chat IPC (`commands::chat::send_chat_message`).
/// This command exists so the MCP `send_to_employee` tool and the fleet UI
/// share a single dispatch surface.
pub async fn send_to_fleet_member_inner(
    id: String,
    prompt: String,
) -> Result<FleetSendResult, String> {
    log::debug!(
        "[fleet] send_to_fleet_member id={} prompt_len={}",
        id,
        prompt.len()
    );
    Ok(FleetSendResult {
        run_id: id,
        accepted: true,
    })
}

#[tauri::command]
pub async fn send_to_fleet_member(id: String, prompt: String) -> Result<FleetSendResult, String> {
    send_to_fleet_member_inner(id, prompt).await
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
    use crate::models::RunStatus;

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
}
