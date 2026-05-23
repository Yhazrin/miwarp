pub mod cron;
pub mod model;
pub mod runner;
pub mod store;

use chrono::Utc;
use model::*;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

/// Start the background scheduler loop.
/// Runs every 30 seconds, checks for tasks that need to fire.
pub fn start_scheduler_loop(app: AppHandle, cancel: CancellationToken) {
    let backfilled = store::backfill_scheduled_run_metadata();
    if backfilled > 0 {
        log::info!("[scheduler] startup backfill complete: {backfilled} runs tagged");
    }
    tauri::async_runtime::spawn(async move {
        log::info!("[scheduler] loop started");
        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    log::info!("[scheduler] loop cancelled");
                    break;
                }
                _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => {
                    tick(&app).await;
                }
            }
        }
    });
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

        // Already running?
        if runner::has_running_run(&task.id) {
            log::debug!(
                "[scheduler] task '{}' already has a running execution, skipping",
                task.name
            );
            continue;
        }

        log::info!("[scheduler] firing task '{}'", task.name);

        // Gather state references
        let emitter = app.state::<Arc<crate::web_server::broadcaster::BroadcastEmitter>>();
        let sessions = app.state::<crate::agent::adapter::ActorSessionMap>();
        let spawn_locks = app.state::<crate::agent::spawn_locks::SpawnLocks>();
        let cancel_token = app.state::<CancellationToken>();

        let task_run = runner::execute_task(
            task,
            emitter.inner(),
            sessions.inner(),
            spawn_locks.inner(),
            cancel_token.inner(),
        )
        .await;

        // Update task: lastRunAt, compute nextRunAt
        let mut updated_task = task.clone();
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

/// Compute the next run time based on schedule config.
fn compute_next_run(schedule: &ScheduleConfig) -> Option<String> {
    let now = Utc::now();
    match schedule.schedule_type {
        ScheduleType::Cron => {
            let expr = schedule.cron_expression.as_deref()?;
            cron::next_cron_time(expr, now).map(|t| t.to_rfc3339())
        }
        ScheduleType::OneTime => {
            // One-time tasks don't reschedule
            None
        }
        ScheduleType::Interval => {
            let minutes = schedule.interval_minutes?;
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
        if !cron::validate_cron(expr) {
            return Err(format!("Invalid cron expression: {}", expr));
        }
    }

    // Default to auto-accept-all for unattended scheduled execution
    if input.permission_mode.is_none() {
        input.permission_mode = Some("auto-accept-all".to_string());
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
            if !cron::validate_cron(expr) {
                return Err(format!("Invalid cron expression: {}", expr));
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

    let task_run = runner::execute_task(
        &task,
        emitter.inner(),
        sessions.inner(),
        spawn_locks.inner(),
        cancel_token.inner(),
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
