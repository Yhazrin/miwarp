use super::model::{RunStatus, ScheduledTask, ScheduledTaskRun};
use super::store;
use crate::agent::adapter::ActorSessionMap;
use crate::agent::spawn_locks::SpawnLocks;
use crate::commands::chat::send_chat_message;
use crate::commands::session::start_session_impl;
use crate::models::{ExecutionPath, RunMeta, RunStatus as AppRunStatus};
use crate::storage;
use crate::web_server::broadcaster::BroadcastEmitter;
use chrono::Utc;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

/// Outcome of polling a run while waiting for an unattended scheduled task to finish.
enum MonitorPoll {
    /// Ready to close the scheduled-task record (success or definitive failure / cancel).
    Terminal(RunStatus, Option<String>),
    /// Session-actor finished a turn: CLI is waiting for more input (`Idle`).
    /// Debounce requires two consecutive clean Idle samples so we do not flap on transient states.
    IdleClean,
    /// Still executing (Pending / Running / etc.).
    Active,
}

fn classify_monitor_poll(meta: &RunMeta) -> MonitorPoll {
    use crate::models::RunStatus as S;
    match meta.status {
        S::Completed => MonitorPoll::Terminal(RunStatus::Completed, None),
        S::Failed => MonitorPoll::Terminal(RunStatus::Failed, meta.error_message.clone()),
        S::Stopped => MonitorPoll::Terminal(RunStatus::Cancelled, None),
        S::Idle => {
            if meta.error_message.is_some() {
                return MonitorPoll::Terminal(RunStatus::Failed, meta.error_message.clone());
            }
            if meta
                .result_subtype
                .as_deref()
                .map(|s| s.starts_with("error"))
                .unwrap_or(false)
            {
                return MonitorPoll::Terminal(
                    RunStatus::Failed,
                    meta.error_message.clone().or_else(|| {
                        Some("Assistant reported an error (see run for details)".to_string())
                    }),
                );
            }
            MonitorPoll::IdleClean
        }
        _ => MonitorPoll::Active,
    }
}

/// If a scheduler row is still `Running`/`Queued` but the linked MiWarp run already finished (or is
/// idle after a turn / missing), patch the row so cron and **Run now** are not blocked forever.
/// Returns `true` when the record was updated.
pub fn reconcile_stale_scheduler_run(tr: &ScheduledTaskRun) -> bool {
    if tr.status != RunStatus::Running && tr.status != RunStatus::Queued {
        return false;
    }
    let Some(ref miwarp_id) = tr.run_id else {
        return false;
    };

    let Some(meta) = storage::runs::get_run(miwarp_id) else {
        if let Some(mut row) = store::load_run(&tr.id) {
            if row.status == RunStatus::Running || row.status == RunStatus::Queued {
                row.status = RunStatus::Failed;
                row.error = Some("Linked session run no longer exists".to_string());
                row.ended_at = Some(Utc::now().to_rfc3339());
                let _ = store::save_run(&row);
                log::warn!(
                    "[scheduler] reconciled task run {}: miwarp run {} missing",
                    tr.id,
                    miwarp_id
                );
                return true;
            }
        }
        return false;
    };

    match classify_monitor_poll(&meta) {
        MonitorPoll::Terminal(st, err) => {
            if let Some(mut row) = store::load_run(&tr.id) {
                if row.status != RunStatus::Running && row.status != RunStatus::Queued {
                    return false;
                }
                row.status = st;
                row.error = err;
                row.ended_at = Some(Utc::now().to_rfc3339());
                let _ = store::save_run(&row);
                log::info!(
                    "[scheduler] reconciled task run {} from miwarp {} (terminal {:?})",
                    tr.id,
                    miwarp_id,
                    row.status
                );
                return true;
            }
            false
        }
        MonitorPoll::IdleClean => {
            if let Some(mut row) = store::load_run(&tr.id) {
                if row.status != RunStatus::Running && row.status != RunStatus::Queued {
                    return false;
                }
                row.status = RunStatus::Completed;
                row.error = None;
                row.ended_at = Some(Utc::now().to_rfc3339());
                let _ = store::save_run(&row);
                log::info!(
                    "[scheduler] reconciled task run {}: miwarp {} idle, scheduler was still running",
                    tr.id,
                    miwarp_id
                );
                return true;
            }
            false
        }
        MonitorPoll::Active => false,
    }
}

/// Execute a scheduled task: create a run, start execution (session actor or pipe), and track it.
pub async fn execute_task(
    app: &AppHandle,
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

    let _run_meta = match run_meta {
        Ok(mut meta) => {
            meta.execution_path = Some(execution_path.clone());
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

    // Unattended execution: default permission mode for Claude session-actor runs.
    let permission_mode = task
        .permission_mode
        .clone()
        .or_else(|| Some("auto-accept-all".to_string()));
    let permission_mode = permission_mode.map(|m| crate::agent::adapter::map_permission_mode(&m));

    let session_result = if execution_path == ExecutionPath::PipeExec {
        let pm = app.state::<crate::agent::stream::ProcessMap>();
        send_chat_message(
            app.clone(),
            pm,
            run_uuid.clone(),
            task.prompt.clone(),
            None,
            task.model.clone(),
        )
        .await
    } else {
        start_session_impl(
            emitter,
            sessions,
            spawn_locks,
            cancel_token,
            run_uuid.clone(),
            None,                      // mode: default New
            None,                      // session_id: new session
            Some(task.prompt.clone()), // initial_message (used for resume; new run uses meta.prompt)
            None,                      // attachments
            None,                      // platform_id
            permission_mode,
        )
        .await
    };

    match session_result {
        Ok(()) => {
            log::info!(
                "[scheduler] task '{}' started run_id={} path={:?}",
                task.name,
                run_uuid,
                execution_path
            );
            let _ = store::save_run(&task_run);

            // Spawn a monitor that polls the run status and updates the task run
            // when the session completes or fails.
            let task_run_id = task_run.id.clone();
            let run_id = run_uuid.clone();
            let task_id = task.id.clone();
            tokio::spawn(async move {
                monitor_run_completion(&task_id, &task_run_id, &run_id).await;
            });

            task_run
        }
        Err(e) => {
            log::error!(
                "[scheduler] failed to start execution for task '{}': {e}",
                task.name
            );
            task_run.status = RunStatus::Failed;
            task_run.error = Some(format!("Execution start failed: {e}"));
            task_run.ended_at = Some(Utc::now().to_rfc3339());
            let _ = store::save_run(&task_run);
            task_run
        }
    }
}

/// Poll the MiWarp run status and update the ScheduledTaskRun when it finishes.
/// Times out after 24 hours.
/// Implements retry with configurable backoff for failed tasks.
async fn monitor_run_completion(task_id: &str, task_run_id: &str, run_id: &str) {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(24 * 3600);

    // Load task to get retry config
    let tasks = store::load_tasks();
    let task = tasks.iter().find(|t| t.id == task_id);
    let max_retries = task.and_then(|t| t.max_retries).unwrap_or(0) as usize;
    let retry_backoff_secs = task.and_then(|t| t.retry_backoff_secs).unwrap_or(60) as u64;

    // Wait a bit before first check — session needs time to start
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;

    // Track retry attempts for this task
    let mut retry_count = 0;
    // Consecutive clean `Idle` polls (session actor: one turn done, CLI waiting for stdin)
    let mut idle_clean_streak: u32 = 0;

    loop {
        if tokio::time::Instant::now() >= deadline {
            log::warn!("[scheduler] monitor timeout for run {run_id}, marking as failed");
            if let Some(mut task_run) = store::load_run(task_run_id) {
                task_run.status = RunStatus::Failed;
                task_run.error = Some("Timed out after 24 hours".into());
                task_run.ended_at = Some(Utc::now().to_rfc3339());
                let _ = store::save_run(&task_run);
                send_feishu_schedule_notification(task_id, RunStatus::Failed);
            }
            return;
        }

        let poll = storage::runs::get_run(run_id).map(|m| classify_monitor_poll(&m));

        match poll {
            Some(MonitorPoll::Terminal(status, error)) => {
                idle_clean_streak = 0;
                log::info!(
                    "[scheduler] run {run_id} finished with status {status:?}, retry_count={retry_count}",
                );

                if let Some(mut task_run) = store::load_run(task_run_id) {
                    // Check if we should retry
                    if status == RunStatus::Failed && retry_count < max_retries {
                        retry_count += 1;
                        let delay = retry_backoff_secs * retry_count as u64; // Simple linear backoff
                        log::info!(
                            "[scheduler] scheduling retry {retry_count}/{max_retries} for task '{task_id}' in {delay}s"
                        );

                        // Wait before retry
                        tokio::time::sleep(Duration::from_secs(delay)).await;

                        // Would need to trigger re-execution here
                        // For now, mark as retry pending (could implement re-run logic)
                        task_run.status = RunStatus::Running;
                        task_run.error = Some(format!("Retry {retry_count}/{max_retries} pending"));
                        let _ = store::save_run(&task_run);
                        continue;
                    }

                    task_run.status = status.clone();
                    task_run.error = error;
                    task_run.ended_at = Some(Utc::now().to_rfc3339());
                    let _ = store::save_run(&task_run);

                    // Send Feishu webhook notification for scheduled task completion
                    send_feishu_schedule_notification(task_id, status);
                }
                return;
            }
            Some(MonitorPoll::IdleClean) => {
                idle_clean_streak += 1;
                if idle_clean_streak >= 2 {
                    log::info!(
                        "[scheduler] run {run_id} stable idle (session turn done), marking scheduled task completed",
                    );
                    if let Some(mut task_run) = store::load_run(task_run_id) {
                        task_run.status = RunStatus::Completed;
                        task_run.error = None;
                        task_run.ended_at = Some(Utc::now().to_rfc3339());
                        let _ = store::save_run(&task_run);
                        send_feishu_schedule_notification(task_id, RunStatus::Completed);
                    }
                    return;
                }
            }
            Some(MonitorPoll::Active) | None => {
                idle_clean_streak = 0;
            }
        }

        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
    }
}

/// Check if a task has a currently running execution.
pub fn has_running_run(task_id: &str) -> bool {
    let runs = store::load_runs_for_task(task_id, Some(50));
    for r in &runs {
        if r.status == RunStatus::Running || r.status == RunStatus::Queued {
            let _ = reconcile_stale_scheduler_run(r);
        }
    }
    let runs = store::load_runs_for_task(task_id, Some(50));
    runs.iter()
        .any(|r| r.status == RunStatus::Running || r.status == RunStatus::Queued)
}

/// Send a Feishu webhook notification when a scheduled task finishes.
/// Only sends if notify_on_completion is enabled (default true).
fn send_feishu_schedule_notification(task_id: &str, status: RunStatus) {
    let task = store::load_tasks().into_iter().find(|t| t.id == task_id);

    // Check if notification is enabled (defaults to true if not set)
    let notify_enabled = task
        .as_ref()
        .map(|t| t.notify_on_completion)
        .unwrap_or(true);

    if !notify_enabled {
        log::info!(
            "[scheduler] notifications disabled for task '{}', skipping webhook",
            task.as_ref().map(|t| t.name.as_str()).unwrap_or("unknown")
        );
        return;
    }

    let task_name = task
        .map(|t| t.name)
        .unwrap_or_else(|| "Scheduled Task".to_string());

    let status_str = match status {
        RunStatus::Completed => "completed",
        RunStatus::Failed => "failed",
        RunStatus::Cancelled => "cancelled",
        _ => "unknown",
    };

    crate::commands::notification::dispatch_feishu_card(
        "定时任务完成",
        &task_name,
        status_str,
        None,
    );
}
