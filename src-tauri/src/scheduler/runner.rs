use super::model::{RunStatus, ScheduledTask, ScheduledTaskRun};
use super::store;
use crate::agent::adapter::ActorSessionMap;
use crate::agent::runtime_recovery::RecoveryRegistry;
use crate::agent::spawn_locks::SpawnLocks;
use crate::commands::session::start_session_impl;
use crate::governor::ResourceGovernor;
use crate::models::{ExecutionPath, RunStatus as AppRunStatus};
use crate::storage;
use crate::web_server::broadcaster::BroadcastEmitter;
use chrono::Utc;
use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

/// Initial poll interval for the run-completion monitor. Sessions need a few
/// seconds to actually attach, so we poll quickly at the start.
const MONITOR_INITIAL_POLL_SECS: u64 = 5;
/// After this many seconds we back off to a slower poll cadence.
const MONITOR_BACKOFF_THRESHOLD_SECS: u64 = 5 * 60;
/// After this many seconds we back off further — at this point any active run
/// is likely long-running and we don't want to waste IPCs polling it.
const MONITOR_DEEP_BACKOFF_THRESHOLD_SECS: u64 = 60 * 60;
/// Total hard deadline. Past this point we stop polling and mark the task run
/// as Failed — but we first do a final terminal check so a run that just
/// finished in the last few seconds is still marked Completed.
const MONITOR_TIMEOUT_SECS: u64 = 24 * 60 * 60;

/// Execute a scheduled task: create a run, start a session, and track the execution.
pub async fn execute_task(
    task: &ScheduledTask,
    emitter: &Arc<BroadcastEmitter>,
    sessions: &ActorSessionMap,
    spawn_locks: &SpawnLocks,
    cancel_token: &CancellationToken,
    recovery_registry: &RecoveryRegistry,
    governor: &ResourceGovernor,
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

    let _run_meta = match run_meta {
        Ok(mut meta) => {
            meta.execution_path = Some(execution_path);
            // Tag as scheduled task
            meta.source = Some(crate::models::RunSource::Native);
            meta.scheduled_task_id = Some(task.id.clone());
            meta.scheduled_task_run_id = Some(task_run.id.clone());
            meta.name = Some(format!("⏱ {}", task.name));
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

    // Start the session using existing infrastructure. Scheduled tasks run
    // unattended, so we default to "acceptEdits" when the user hasn't picked
    // one — this lets the agent edit files in the workspace but still prompts
    // for non-edit operations. The "acceptEdits" string is mapped to the
    // appropriate CLI value by map_permission_mode.
    let permission_mode = task
        .permission_mode
        .clone()
        .or_else(|| Some("acceptEdits".to_string()));
    // Normalize through the shared mapping so CLI always gets a valid value.
    let permission_mode = permission_mode.map(|m| crate::agent::adapter::map_permission_mode(&m));

    let session_result = start_session_impl(
        emitter,
        sessions,
        spawn_locks,
        cancel_token,
        recovery_registry,
        governor,
        run_uuid.clone(),
        None,                      // mode: default New
        None,                      // session_id: new session
        Some(task.prompt.clone()), // initial_message
        None,                      // attachments
        None,                      // platform_id
        permission_mode,
        None, // client_message_id: scheduler has no client token
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
/// Uses an adaptive poll interval so long-running tasks don't burn thousands
/// of IPCs, but still polls fast at the start to catch quick completions.
async fn monitor_run_completion(
    task_run_id: &str,
    run_id: &str,
    notify_on_completion: bool,
    task_name: &str,
) {
    let started_at = tokio::time::Instant::now();
    let deadline = started_at + Duration::from_secs(MONITOR_TIMEOUT_SECS);

    // Wait a bit before first check — session needs time to start
    tokio::time::sleep(Duration::from_secs(MONITOR_INITIAL_POLL_SECS)).await;

    loop {
        let elapsed = started_at.elapsed();
        // Pick the right poll interval based on how long the run has been going.
        let poll_secs = if elapsed >= Duration::from_secs(MONITOR_DEEP_BACKOFF_THRESHOLD_SECS) {
            super::MONITOR_POLL_INTERVAL_DEEP_BACKOFF_SECS
        } else if elapsed >= Duration::from_secs(MONITOR_BACKOFF_THRESHOLD_SECS) {
            super::MONITOR_POLL_INTERVAL_BACKOFF_SECS
        } else {
            MONITOR_INITIAL_POLL_SECS
        };

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
                let ended_at = Utc::now().to_rfc3339();
                task_run.ended_at = Some(ended_at.clone());
                let _ = store::save_run(&task_run);

                // Refresh `lastRunAt` on the task. This is the canonical
                // "last completed" time (not the last started time, which can
                // be earlier if the run took a while to settle).
                if let Some(mut task) = store::load_task(&task_run.task_id) {
                    task.last_run_at = Some(ended_at);
                    task.updated_at = Utc::now().to_rfc3339();
                    let _ = store::save_task(&task);
                }

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

        // Hit the hard deadline. Do one final check so runs that just finished
        // in the last `MONITOR_GRACE_PERIOD_SECS` are recorded correctly
        // rather than being misclassified as "Timed out".
        if started_at.elapsed() + Duration::from_secs(poll_secs)
            >= Duration::from_secs(MONITOR_TIMEOUT_SECS)
        {
            let final_check = storage::runs::get_run(run_id).and_then(|meta| {
                use crate::models::RunStatus as S;
                match meta.status {
                    S::Completed => Some((RunStatus::Completed, None)),
                    S::Failed => Some((RunStatus::Failed, meta.error_message.clone())),
                    S::Stopped => Some((RunStatus::Cancelled, None)),
                    _ => None,
                }
            });
            let ended_at = Utc::now().to_rfc3339();
            if let Some((status, error)) = final_check {
                log::warn!(
                    "[scheduler] run {run_id} hit 24h deadline but finished with {status:?} — recording real status"
                );
                if let Some(mut task_run) = store::load_run(task_run_id) {
                    task_run.status = status;
                    task_run.error = error;
                    task_run.ended_at = Some(ended_at.clone());
                    let _ = store::save_run(&task_run);
                    if let Some(mut task) = store::load_task(&task_run.task_id) {
                        task.last_run_at = Some(ended_at);
                        let _ = store::save_task(&task);
                    }
                }
            } else {
                log::warn!("[scheduler] monitor timeout for run {run_id}, marking as failed");
                if let Some(mut task_run) = store::load_run(task_run_id) {
                    task_run.status = RunStatus::Failed;
                    task_run.error = Some("Timed out after 24 hours".into());
                    task_run.ended_at = Some(ended_at);
                    let _ = store::save_run(&task_run);
                }
            }
            let _ = deadline; // silence unused — kept for future extension
            return;
        }

        tokio::time::sleep(Duration::from_secs(poll_secs)).await;
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
