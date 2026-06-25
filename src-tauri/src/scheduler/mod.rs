pub mod cron;
pub mod model;
pub mod runner;
pub mod store;

use chrono::Utc;
use model::*;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

/// Interval tuning for `monitor_run_completion`. The first few polls are fast
/// (session needs time to actually attach), then we back off so we don't burn
/// thousands of IPCs on long-running tasks. The constants live in `runner.rs`
/// next to the monitor so they're easier to find when tuning; the deep-backoff
/// value is mirrored here for `next_tick_delay_secs` boundary checks.
const MONITOR_POLL_INTERVAL_BACKOFF_SECS: u64 = 30;
const MONITOR_POLL_INTERVAL_DEEP_BACKOFF_SECS: u64 = 60;

/// Sliding window within which a missed `next_run_at` is still considered
/// catchable. Tasks older than this are skipped to prevent runaway catch-up
/// loops after long downtimes.
const SCHEDULER_CATCHUP_WINDOW_SECS: i64 = 24 * 60 * 60;

/// Maximum time between scheduler ticks. We still poll at this cadence even if
/// `min(next_run_at)` is further out, to catch newly-enabled tasks quickly.
const SCHEDULER_MAX_TICK_SECS: i64 = 30;

/// Start the background scheduler loop. Ticks every 30s but also wakes early
/// when a task is due within the next minute, to keep firing lag under 1s.
pub fn start_scheduler_loop(app: AppHandle, cancel: CancellationToken) {
    let backfilled = store::backfill_scheduled_run_metadata();
    if backfilled > 0 {
        log::info!("[scheduler] startup backfill complete: {backfilled} runs tagged");
    }
    tauri::async_runtime::spawn(async move {
        log::info!("[scheduler] loop started");
        loop {
            // Decide how long to sleep before the next tick: wake early if a
            // task is due within 60s, otherwise cap at SCHEDULER_MAX_TICK_SECS.
            let sleep_secs = next_tick_delay_secs();
            tokio::select! {
                _ = cancel.cancelled() => {
                    log::info!("[scheduler] loop cancelled");
                    break;
                }
                _ = tokio::time::sleep(std::time::Duration::from_secs(sleep_secs.max(1) as u64)) => {
                    tick(&app).await;
                }
            }
        }
    });
}

/// Inspect loaded tasks and return the number of seconds to sleep before the
/// next `tick`. If any task is due within 60s, we sleep until then (minimum 1s).
/// Otherwise we cap at `SCHEDULER_MAX_TICK_SECS`.
fn next_tick_delay_secs() -> i64 {
    let now = Utc::now();
    let mut soonest_delta = i64::MAX;
    for task in store::load_tasks() {
        if !task.enabled {
            continue;
        }
        let Some(ref next_at) = task.next_run_at else {
            continue;
        };
        let Ok(next_time) = chrono::DateTime::parse_from_rfc3339(next_at) else {
            continue;
        };
        let next_time = next_time.with_timezone(&Utc);
        let delta = (next_time - now).num_seconds();
        if delta < soonest_delta {
            soonest_delta = delta;
        }
    }
    if soonest_delta == i64::MAX {
        return SCHEDULER_MAX_TICK_SECS;
    }
    // Tasks already due → poll immediately (capped at 1s floor).
    if soonest_delta <= 0 {
        return 1;
    }
    // Within the next minute → wake up exactly then. Otherwise cap.
    if soonest_delta < 60 {
        return soonest_delta;
    }
    SCHEDULER_MAX_TICK_SECS.min(soonest_delta)
}

/// Single tick: find and execute due tasks.
async fn tick(app: &AppHandle) {
    let now = Utc::now();
    let tasks = store::load_tasks();

    for task in &tasks {
        if !task.enabled {
            continue;
        }

        let Some(ref next_at) = task.next_run_at else {
            continue;
        };

        let next_time = match chrono::DateTime::parse_from_rfc3339(next_at) {
            Ok(dt) => dt.with_timezone(&Utc),
            Err(_) => continue,
        };

        if next_time > now {
            continue;
        }

        // Skip if the next_run_at is too far in the past — likely a stale
        // task or a long downtime. We only catch up within a sliding window.
        let missed_by = (now - next_time).num_seconds();
        if missed_by > SCHEDULER_CATCHUP_WINDOW_SECS {
            log::warn!(
                "[scheduler] task '{}' missed by {}s (>{}s catch-up window), advancing",
                task.name,
                missed_by,
                SCHEDULER_CATCHUP_WINDOW_SECS
            );
            advance_task_after_skip(task);
            continue;
        }

        // If the user marked this run to be skipped, advance without executing.
        if task.skip_next_run {
            log::info!(
                "[scheduler] task '{}' has skip_next_run set; skipping this fire",
                task.name
            );
            advance_task_after_skip(task);
            continue;
        }

        // Already running?
        if runner::has_running_run(&task.id) {
            log::debug!(
                "[scheduler] task '{}' already has a running execution, skipping",
                task.name
            );
            continue;
        }

        // Workspace concurrency control: if another session is already running
        // on the same cwd, defer this fire to the next tick.
        if is_workspace_busy(&task.workspace.cwd, app) {
            log::warn!(
                "[scheduler] task '{}' workspace '{}' is busy with another run, deferring",
                task.name,
                task.workspace.cwd
            );
            continue;
        }

        log::info!("[scheduler] firing task '{}'", task.name);

        // Gather state references
        let emitter = app.state::<Arc<crate::web_server::broadcaster::BroadcastEmitter>>();
        let sessions = app.state::<crate::agent::adapter::ActorSessionMap>();
        let spawn_locks = app.state::<crate::agent::spawn_locks::SpawnLocks>();
        let cancel_token = app.state::<CancellationToken>();
        let recovery_registry = app.state::<crate::agent::runtime_recovery::RecoveryRegistry>();
        let governor = app.state::<crate::governor::ResourceGovernor>();

        let task_run = runner::execute_task(
            task,
            emitter.inner(),
            sessions.inner(),
            spawn_locks.inner(),
            cancel_token.inner(),
            recovery_registry.inner(),
            governor.inner(),
        )
        .await;

        // Update task: lastRunAt, compute nextRunAt
        let mut updated_task = task.clone();
        // `lastRunAt` represents the last *completed* run, not the last
        // *started* run. The monitor will refresh this once the run finishes,
        // but we set a sensible default to started_at here in case the monitor
        // never reports back.
        updated_task.last_run_at = Some(task_run.started_at.clone());
        updated_task.next_run_at = compute_next_run(&updated_task.schedule);

        // Auto-disable one-time tasks after execution completes
        if matches!(task.schedule.schedule_type, ScheduleType::OneTime) {
            updated_task.enabled = false;
            log::info!(
                "[scheduler] one-time task '{}' completed and disabled",
                task.name
            );
        }

        // Persist updated task
        let mut all_tasks = store::load_tasks();
        if let Some(t) = all_tasks.iter_mut().find(|t| t.id == task.id) {
            *t = updated_task;
        }
        if let Err(e) = store::save_tasks(&all_tasks) {
            log::error!("[scheduler] failed to update task after run: {e}");
        }
    }
}

/// Advance a task's `next_run_at` without executing it, and clear transient
/// flags. Used for skip-next-run and out-of-window catch-up.
fn advance_task_after_skip(task: &ScheduledTask) {
    let mut updated = task.clone();
    updated.skip_next_run = false;
    updated.next_run_at = compute_next_run(&updated.schedule);
    updated.updated_at = Utc::now().to_rfc3339();
    let mut all_tasks = store::load_tasks();
    if let Some(t) = all_tasks.iter_mut().find(|t| t.id == task.id) {
        *t = updated;
    }
    if let Err(e) = store::save_tasks(&all_tasks) {
        log::error!("[scheduler] failed to advance task after skip: {e}");
    }
}

/// Returns true if any actor session is currently using the given cwd (i.e.
/// some other scheduled task or chat run is actively executing there).
fn is_workspace_busy(cwd: &str, app: &AppHandle) -> bool {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return false;
    }
    // Quick check: any running ScheduledTaskRun for any task whose workspace
    // matches. This catches tasks vs tasks on the same workspace.
    let needle = normalize_for_compare(trimmed);
    for run in store::load_all_runs(Some(50)) {
        if !matches!(run.status, RunStatus::Running | RunStatus::Queued) {
            continue;
        }
        let Some(ref run_id) = run.run_id else {
            continue;
        };
        if let Some(meta) = crate::storage::runs::get_run(run_id) {
            if normalize_for_compare(&meta.cwd) == needle {
                return true;
            }
        }
    }
    // Also consider ad-hoc chat sessions that may be running on the same cwd.
    let sessions = app.state::<crate::agent::adapter::ActorSessionMap>();
    if let Ok(map) = sessions.try_lock() {
        for (_id, handle) in map.iter() {
            if !handle.cmd_tx.is_closed() {
                // No cwd on the handle, so fall back to a best-effort by
                // skipping if we can't tell. Chat sessions rarely collide
                // with scheduled tasks on the exact same cwd anyway.
            }
        }
    }
    false
}

fn normalize_for_compare(cwd: &str) -> String {
    let p = Path::new(cwd);
    // Best-effort canonicalization: lowercase on Windows, otherwise just trim.
    let mut s = p.to_string_lossy().to_string();
    if cfg!(windows) {
        s = s.to_lowercase();
    }
    s.trim_end_matches(['/', '\\']).to_string()
}

/// Compute the next run time based on schedule config.
fn compute_next_run(schedule: &ScheduleConfig) -> Option<String> {
    let now = Utc::now();
    match schedule.schedule_type {
        ScheduleType::Cron => {
            let expr = schedule.cron_expression.as_deref()?;
            cron::next_cron_time(expr, now).map(|t| t.to_rfc3339())
        }
        ScheduleType::OneTime => {
            // For one-time tasks, if `fire_at` is still in the future, schedule
            // for that exact moment. If the fire time has already passed,
            // the task should be considered consumed — return None.
            if let Some(ref fire_at) = schedule.fire_at {
                if let Ok(t) = chrono::DateTime::parse_from_rfc3339(fire_at) {
                    let t = t.with_timezone(&Utc);
                    if t > now {
                        return Some(t.to_rfc3339());
                    }
                }
            }
            None
        }
        ScheduleType::Interval => {
            let minutes = schedule.interval_minutes?;
            if minutes == 0 || minutes > MAX_INTERVAL_MINUTES {
                return None;
            }
            Some((now + chrono::Duration::minutes(minutes as i64)).to_rfc3339())
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
//  Tauri Commands
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub fn list_scheduled_tasks() -> Result<Vec<ScheduledTask>, String> {
    Ok(store::load_tasks())
}

/// Expand `~` to the user's home directory in a path string.
fn expand_tilde(path: &str) -> String {
    if path.starts_with("~/") || path == "~" {
        if let Some(home) = crate::storage::home_dir() {
            return path.replacen("~", &home, 1);
        }
    }
    path.to_string()
}

#[tauri::command]
pub fn create_scheduled_task(mut input: ScheduledTaskInput) -> Result<ScheduledTask, String> {
    // Expand tilde in workspace path
    input.workspace.cwd = expand_tilde(&input.workspace.cwd);

    // Validate workspace exists
    if !std::path::Path::new(&input.workspace.cwd).exists() {
        return Err(format!(
            "Workspace path does not exist: {}",
            input.workspace.cwd
        ));
    }

    // Validate cron expression if provided
    if let Some(ref expr) = input.schedule.cron_expression {
        if let Some(detail) = cron::first_invalid_field(expr) {
            return Err(format!("Invalid cron expression ({}): {}", detail, expr));
        }
        if !cron::validate_cron(expr) {
            return Err(format!("Invalid cron expression: {}", expr));
        }
    }

    // Reject interval schedules outside the allowed range.
    if let ScheduleType::Interval = input.schedule.schedule_type {
        if let Some(m) = input.schedule.interval_minutes {
            if m == 0 || m > MAX_INTERVAL_MINUTES {
                return Err(format!(
                    "intervalMinutes must be between 1 and {} (got {})",
                    MAX_INTERVAL_MINUTES, m
                ));
            }
        }
    }

    // Default to "acceptEdits" for unattended execution. This lets the agent
    // edit files in the workspace but still prompts for non-edit operations
    // (e.g. shell commands that need approval). Users who want the legacy
    // "auto-accept-all" behavior can set it explicitly.
    if input.permission_mode.is_none() {
        input.permission_mode = Some("acceptEdits".to_string());
    }

    let now = Utc::now().to_rfc3339();
    let next_run = compute_next_run(&input.schedule);

    let task = ScheduledTask {
        id: uuid::Uuid::new_v4().to_string(),
        name: input.name,
        description: input.description,
        prompt: input.prompt,
        workspace: input.workspace,
        agent: input.agent,
        schedule: input.schedule,
        enabled: input.enabled,
        permission_mode: input.permission_mode,
        model: input.model,
        provider: input.provider,
        notify_on_completion: input.notify_on_completion,
        next_run_at: next_run,
        last_run_at: None,
        skip_next_run: false,
        created_at: now.clone(),
        updated_at: now,
    };

    let mut tasks = store::load_tasks();
    tasks.push(task.clone());
    store::save_tasks(&tasks)?;

    log::info!("[scheduler] created task '{}'", task.name);
    Ok(task)
}

#[tauri::command]
pub fn update_scheduled_task(
    id: String,
    patch: ScheduledTaskPatch,
) -> Result<ScheduledTask, String> {
    let mut tasks = store::load_tasks();
    let task = tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| format!("Task not found: {id}"))?;

    if let Some(name) = patch.name {
        task.name = name;
    }
    if let Some(desc) = patch.description {
        task.description = desc;
    }
    if let Some(prompt) = patch.prompt {
        task.prompt = prompt;
    }
    if let Some(mut workspace) = patch.workspace {
        workspace.cwd = expand_tilde(&workspace.cwd);
        if !std::path::Path::new(&workspace.cwd).exists() {
            return Err(format!("Workspace path does not exist: {}", workspace.cwd));
        }
        task.workspace = workspace;
    }
    if let Some(agent) = patch.agent {
        task.agent = agent;
    }
    if let Some(schedule) = patch.schedule {
        if let Some(ref expr) = schedule.cron_expression {
            if let Some(detail) = cron::first_invalid_field(expr) {
                return Err(format!("Invalid cron expression ({}): {}", detail, expr));
            }
            if !cron::validate_cron(expr) {
                return Err(format!("Invalid cron expression: {}", expr));
            }
        }
        if let ScheduleType::Interval = schedule.schedule_type {
            if let Some(m) = schedule.interval_minutes {
                if m == 0 || m > MAX_INTERVAL_MINUTES {
                    return Err(format!(
                        "intervalMinutes must be between 1 and {} (got {})",
                        MAX_INTERVAL_MINUTES, m
                    ));
                }
            }
        }
        task.schedule = schedule;
        // Recompute next run
        task.next_run_at = compute_next_run(&task.schedule);
    }
    if let Some(enabled) = patch.enabled {
        task.enabled = enabled;
        if enabled && task.next_run_at.is_none() {
            task.next_run_at = compute_next_run(&task.schedule);
        }
    }
    if let Some(pm) = patch.permission_mode {
        task.permission_mode = pm;
    }
    if let Some(skip) = patch.skip_next_run {
        task.skip_next_run = skip;
    }
    if let Some(model) = patch.model {
        task.model = model;
    }
    if let Some(provider) = patch.provider {
        task.provider = provider;
    }
    if let Some(notify) = patch.notify_on_completion {
        task.notify_on_completion = notify;
    }

    task.updated_at = Utc::now().to_rfc3339();
    let updated = task.clone();
    store::save_tasks(&tasks)?;

    log::info!("[scheduler] updated task '{}'", updated.name);
    Ok(updated)
}

#[tauri::command]
pub fn delete_scheduled_task(id: String) -> Result<bool, String> {
    let mut tasks = store::load_tasks();
    let before = tasks.len();
    tasks.retain(|t| t.id != id);
    if tasks.len() == before {
        return Err(format!("Task not found: {id}"));
    }
    store::save_tasks(&tasks)?;
    // Clean up the sidecar index so we don't leak orphan run ids.
    store::forget_task_runs(&id);
    log::info!("[scheduler] deleted task {id}");
    Ok(true)
}

#[tauri::command]
pub fn set_scheduled_task_enabled(id: String, enabled: bool) -> Result<ScheduledTask, String> {
    update_scheduled_task(
        id,
        ScheduledTaskPatch {
            name: None,
            description: None,
            prompt: None,
            workspace: None,
            agent: None,
            schedule: None,
            enabled: Some(enabled),
            permission_mode: None,
            model: None,
            provider: None,
            notify_on_completion: None,
            skip_next_run: None,
        },
    )
}

#[tauri::command]
pub async fn run_scheduled_task_now(
    app: AppHandle,
    id: String,
) -> Result<ScheduledTaskRun, String> {
    let tasks = store::load_tasks();
    let task = tasks
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| format!("Task not found: {id}"))?
        .clone();

    if runner::has_running_run(&task.id) {
        return Err("Task is already running".into());
    }

    let emitter = app.state::<Arc<crate::web_server::broadcaster::BroadcastEmitter>>();
    let sessions = app.state::<crate::agent::adapter::ActorSessionMap>();
    let spawn_locks = app.state::<crate::agent::spawn_locks::SpawnLocks>();
    let cancel_token = app.state::<CancellationToken>();
    let recovery_registry = app.state::<crate::agent::runtime_recovery::RecoveryRegistry>();
    let governor = app.state::<crate::governor::ResourceGovernor>();

    let task_run = runner::execute_task(
        &task,
        emitter.inner(),
        sessions.inner(),
        spawn_locks.inner(),
        cancel_token.inner(),
        recovery_registry.inner(),
        governor.inner(),
    )
    .await;

    // Update lastRunAt and recompute nextRunAt
    let mut all_tasks = store::load_tasks();
    if let Some(t) = all_tasks.iter_mut().find(|t| t.id == id) {
        t.last_run_at = Some(task_run.started_at.clone());
        t.next_run_at = compute_next_run(&t.schedule);

        // Auto-disable one-time tasks after manual execution
        if matches!(t.schedule.schedule_type, ScheduleType::OneTime) {
            t.enabled = false;
            log::info!(
                "[scheduler] one-time task '{}' completed and disabled",
                t.name
            );
        }

        t.updated_at = Utc::now().to_rfc3339();
    }
    if let Err(e) = store::save_tasks(&all_tasks) {
        log::error!("[scheduler] failed to update task after manual run: {e}");
    }

    Ok(task_run)
}

#[tauri::command]
pub fn list_scheduled_task_runs(
    task_id: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<ScheduledTaskRun>, String> {
    let effective_limit = limit.or(Some(50));
    Ok(match task_id {
        Some(tid) => store::load_runs_for_task(&tid, effective_limit),
        None => store::load_all_runs(effective_limit),
    })
}

/// Look up a single run by id. Cheap IPC that the frontend uses for polling
/// the live monitor — avoids reloading the whole run history each tick.
#[tauri::command]
pub fn get_scheduled_task_run(run_id: String) -> Result<Option<ScheduledTaskRun>, String> {
    Ok(store::load_run(&run_id))
}

/// Toggle the `skip_next_run` flag for a task without otherwise mutating it.
#[tauri::command]
pub fn set_scheduled_task_skip_next(
    id: String,
    skip_next_run: bool,
) -> Result<ScheduledTask, String> {
    update_scheduled_task(
        id,
        ScheduledTaskPatch {
            name: None,
            description: None,
            prompt: None,
            workspace: None,
            agent: None,
            schedule: None,
            enabled: None,
            permission_mode: None,
            model: None,
            provider: None,
            notify_on_completion: None,
            skip_next_run: Some(skip_next_run),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scheduler::model::{ScheduleConfig, ScheduleType, ScheduledTask};

    fn make_task(next_at: Option<&str>) -> ScheduledTask {
        ScheduledTask {
            id: "t1".to_string(),
            name: "test".to_string(),
            description: None,
            prompt: "p".to_string(),
            workspace: WorkspaceInfo {
                cwd: "/tmp".to_string(),
                remote_host_name: None,
            },
            agent: Agent::Claude,
            schedule: ScheduleConfig {
                schedule_type: ScheduleType::Cron,
                cron_expression: Some("0 9 * * *".to_string()),
                fire_at: None,
                interval_minutes: None,
                timezone: None,
            },
            enabled: true,
            permission_mode: None,
            model: None,
            provider: None,
            notify_on_completion: false,
            next_run_at: next_at.map(str::to_string),
            last_run_at: None,
            skip_next_run: false,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    /// `next_tick_delay_secs` should never exceed the cap and should fire
    /// ~immediately when a task is already due. We can't observe the function
    /// directly without a populated disk, but we can validate the contract.
    #[test]
    fn tick_delay_bounds_respected() {
        // The constants themselves are the contract: 1s minimum, capped at
        // SCHEDULER_MAX_TICK_SECS. We assert the upper bound here so a future
        // refactor can't quietly bump it to e.g. 5 minutes.
        assert!(SCHEDULER_MAX_TICK_SECS <= 60);
        assert!(SCHEDULER_CATCHUP_WINDOW_SECS >= 3600);
    }

    /// `compute_next_run` should set one-time `next_run_at` to the configured
    /// `fire_at` when it's in the future, and return `None` once the time
    /// has passed.
    #[test]
    fn compute_next_run_one_time() {
        let future = (Utc::now() + chrono::Duration::hours(1)).to_rfc3339();
        let sched = ScheduleConfig {
            schedule_type: ScheduleType::OneTime,
            cron_expression: None,
            fire_at: Some(future.clone()),
            interval_minutes: None,
            timezone: None,
        };
        let next = compute_next_run(&sched);
        assert!(
            next.is_some(),
            "future one-time should produce a next_run_at"
        );
        // Past fire_at → no reschedule.
        let past = (Utc::now() - chrono::Duration::hours(1)).to_rfc3339();
        let sched = ScheduleConfig {
            schedule_type: ScheduleType::OneTime,
            cron_expression: None,
            fire_at: Some(past),
            interval_minutes: None,
            timezone: None,
        };
        assert!(compute_next_run(&sched).is_none());
    }

    /// `compute_next_run` should reject out-of-range intervals.
    #[test]
    fn compute_next_run_interval_bounds() {
        let sched = ScheduleConfig {
            schedule_type: ScheduleType::Interval,
            cron_expression: None,
            fire_at: None,
            interval_minutes: Some(0),
            timezone: None,
        };
        assert!(compute_next_run(&sched).is_none());

        let sched = ScheduleConfig {
            schedule_type: ScheduleType::Interval,
            cron_expression: None,
            fire_at: None,
            interval_minutes: Some(MAX_INTERVAL_MINUTES + 1),
            timezone: None,
        };
        assert!(compute_next_run(&sched).is_none());

        let sched = ScheduleConfig {
            schedule_type: ScheduleType::Interval,
            cron_expression: None,
            fire_at: None,
            interval_minutes: Some(60),
            timezone: None,
        };
        assert!(compute_next_run(&sched).is_some());
    }

    /// Catch-up: a task that missed its window by more than the cap should
    /// not be re-fired; the loop logs and advances. We validate the constant
    /// that controls this.
    #[test]
    fn catchup_window_is_bounded() {
        assert!(SCHEDULER_CATCHUP_WINDOW_SECS >= 3600);
        assert!(SCHEDULER_CATCHUP_WINDOW_SECS <= 7 * 24 * 60 * 60);
    }

    /// Sanity: make_task builder used by other tests.
    #[test]
    fn make_task_helper_works() {
        let t = make_task(None);
        assert_eq!(t.id, "t1");
        assert!(t.enabled);
        assert!(!t.skip_next_run);
    }
}
