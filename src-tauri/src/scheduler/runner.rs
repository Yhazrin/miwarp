use super::model::{RunStatus, ScheduledTask, ScheduledTaskRun};
use super::store;
use crate::agent::adapter::ActorSessionMap;
use crate::agent::spawn_locks::SpawnLocks;
use crate::commands::session::start_session_impl;
use crate::models::{ExecutionPath, RunStatus as AppRunStatus};
use crate::storage;
use crate::web_server::broadcaster::BroadcastEmitter;
use chrono::Utc;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

/// Execute a scheduled task: create a run, start a session, and track the execution.
pub async fn execute_task(
    task: &ScheduledTask,
    emitter: &Arc<BroadcastEmitter>,
    sessions: &ActorSessionMap,
    spawn_locks: &SpawnLocks,
    cancel_token: &CancellationToken,
) -> ScheduledTaskRun {
    let run_uuid = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    // Create the task run record
    let task_run = ScheduledTaskRun {
        id: uuid::Uuid::new_v4().to_string(),
        task_id: task.id.clone(),
        run_id: None,
        session_id: None,
        started_at: now.clone(),
        ended_at: None,
        status: RunStatus::Running,
        error: None,
        summary: None,
    };

    // Persist the running task run
    if let Err(e) = store::save_run(&task_run) {
        log::error!("[scheduler] failed to save task run: {e}");
    }

    // Create a MiWarp run record (same as start_run command)
    // Expand tilde in cwd so sessions work with paths like ~/Downloads
    let cwd = {
        let raw = task.workspace.cwd.clone();
        if raw.starts_with("~/") || raw == "~" {
            if let Some(home) = crate::storage::home_dir() {
                raw.replacen("~", &home, 1)
            } else {
                raw
            }
        } else {
            raw
        }
    };
    let agent = match task.agent {
        super::model::Agent::Claude => "claude",
        super::model::Agent::Codex => "codex",
    };
    let execution_path = if agent == "claude" {
        ExecutionPath::SessionActor
    } else {
        ExecutionPath::PipeExec
    };

    let remote_host_name = task.workspace.remote_host_name.clone();
    let (remote_cwd, remote_host_snapshot) = if let Some(ref name) = remote_host_name {
        let settings = storage::settings::get_user_settings();
        match settings.remote_hosts.iter().find(|h| h.name == *name) {
            Some(host) => (host.remote_cwd.clone(), Some(host.clone())),
            None => (None, None),
        }
    } else {
        (None, None)
    };

    let run_meta = storage::runs::create_run(
        &run_uuid,
        &task.prompt,
        &cwd,
        agent,
        AppRunStatus::Pending,
        task.model.clone(),
        None,
        remote_host_name,
        remote_cwd,
        remote_host_snapshot,
        None, // platform_id
    );

    let run_meta = match run_meta {
        Ok(mut meta) => {
            meta.execution_path = Some(execution_path);
            // Tag as scheduled task
            meta.source = Some(crate::models::RunSource::Native);
            if let Err(e) = storage::runs::save_meta(&meta) {
                log::error!("[scheduler] failed to save run meta: {e}");
            }
            meta
        }
        Err(e) => {
            log::error!("[scheduler] failed to create run: {e}");
            let mut failed = task_run.clone();
            failed.status = RunStatus::Failed;
            failed.error = Some(format!("Failed to create run: {e}"));
            failed.ended_at = Some(Utc::now().to_rfc3339());
            let _ = store::save_run(&failed);
            return failed;
        }
    };

    // Update task run with the MiWarp run ID
    let mut task_run = task_run;
    task_run.run_id = Some(run_uuid.clone());

    // Start the session using existing infrastructure.
    // Scheduled tasks run unattended, so default to "auto-accept-all" if not set.
    // The "auto-accept-all" string is mapped to "bypassPermissions" by map_permission_mode.
    let permission_mode = task
        .permission_mode
        .clone()
        .or_else(|| Some("auto-accept-all".to_string()));
    // Normalize through the shared mapping so CLI always gets a valid value.
    let permission_mode = permission_mode.map(|m| crate::agent::adapter::map_permission_mode(&m));

    let session_result = start_session_impl(
        emitter,
        sessions,
        spawn_locks,
        cancel_token,
        run_uuid.clone(),
        None,                      // mode: default New
        None,                      // session_id: new session
        Some(task.prompt.clone()), // initial_message
        None,                      // attachments
        None,                      // platform_id
        permission_mode,
    )
    .await;

    match session_result {
        Ok(()) => {
            log::info!(
                "[scheduler] task '{}' started session, run_id={}",
                task.name,
                run_uuid
            );
            let _ = store::save_run(&task_run);

            // Spawn a monitor that polls the run status and updates the task run
            // when the session completes or fails.
            let task_run_id = task_run.id.clone();
            let run_id = run_uuid.clone();
            let notify_on_completion = task.notify_on_completion;
            let task_name = task.name.clone();
            tokio::spawn(async move {
                monitor_run_completion(&task_run_id, &run_id, notify_on_completion, &task_name)
                    .await;
            });

            task_run
        }
        Err(e) => {
            log::error!(
                "[scheduler] failed to start session for task '{}': {e}",
                task.name
            );
            task_run.status = RunStatus::Failed;
            task_run.error = Some(format!("Session start failed: {e}"));
            task_run.ended_at = Some(Utc::now().to_rfc3339());
            let _ = store::save_run(&task_run);
            task_run
        }
    }
}

/// Poll the MiWarp run status and update the ScheduledTaskRun when it finishes.
/// Times out after 24 hours.
async fn monitor_run_completion(
    task_run_id: &str,
    run_id: &str,
    notify_on_completion: bool,
    task_name: &str,
) {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(24 * 3600);

    // Wait a bit before first check — session needs time to start
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;

    loop {
        if tokio::time::Instant::now() >= deadline {
            log::warn!("[scheduler] monitor timeout for run {run_id}, marking as failed");
            if let Some(mut task_run) = store::load_run(task_run_id) {
                task_run.status = RunStatus::Failed;
                task_run.error = Some("Timed out after 24 hours".into());
                task_run.ended_at = Some(Utc::now().to_rfc3339());
                let _ = store::save_run(&task_run);
            }
            return;
        }

        // Check the MiWarp run status
        let terminal = storage::runs::get_run(run_id).and_then(|meta| {
            use crate::models::RunStatus as S;
            match meta.status {
                S::Completed => Some((RunStatus::Completed, None)),
                S::Failed => Some((RunStatus::Failed, meta.error_message.clone())),
                S::Stopped => Some((RunStatus::Cancelled, None)),
                _ => None,
            }
        });

        if let Some((status, error)) = terminal {
            log::info!("[scheduler] run {run_id} finished with status {status:?}");
            if let Some(mut task_run) = store::load_run(task_run_id) {
                task_run.status = status.clone();
                task_run.error = error;
                task_run.ended_at = Some(Utc::now().to_rfc3339());
                let _ = store::save_run(&task_run);

                // Send notification if enabled
                if notify_on_completion {
                    send_feishu_schedule_notification(task_name, status);
                }

                // Auto-disable one-time tasks after completion
                if let Some(mut task) = store::load_task(&task_run.task_id) {
                    if task.schedule.schedule_type == super::model::ScheduleType::OneTime {
                        task.enabled = false;
                        if let Err(e) = store::save_task(&task) {
                            log::error!(
                                "[scheduler] failed to disable one-time task {}: {e}",
                                task_run.task_id
                            );
                        } else {
                            log::info!(
                                "[scheduler] one-time task {} auto-disabled after completion",
                                task.name
                            );
                        }
                    }
                }
            }
            return;
        }

        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
    }
}

/// Check if a task has a currently running execution.
pub fn has_running_run(task_id: &str) -> bool {
    let runs = store::load_runs_for_task(task_id, Some(5));
    runs.iter()
        .any(|r| r.status == RunStatus::Running || r.status == RunStatus::Queued)
}

/// Send a Feishu webhook notification when a scheduled task finishes.
fn send_feishu_schedule_notification(task_name: &str, status: RunStatus) {
    let status_str = match status {
        RunStatus::Completed => "completed",
        RunStatus::Failed => "failed",
        RunStatus::Cancelled => "cancelled",
        _ => "unknown",
    };

    crate::commands::notification::dispatch_feishu_card(
        "定时任务完成",
        task_name,
        status_str,
        None,
    );
}
