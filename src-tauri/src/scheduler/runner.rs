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

/// Map a terminal MiWarp run status to scheduler run status + error text.
fn map_app_run_terminal(meta: &crate::models::RunMeta) -> Option<(RunStatus, Option<String>)> {
    match meta.status {
        AppRunStatus::Completed => Some((RunStatus::Completed, None)),
        AppRunStatus::Failed => Some((RunStatus::Failed, meta.error_message.clone())),
        AppRunStatus::Stopped => Some((RunStatus::Cancelled, meta.error_message.clone())),
        _ => None,
    }
}

fn app_run_terminal_status(run_id: &str) -> Option<(RunStatus, Option<String>)> {
    storage::runs::get_run(run_id).and_then(|meta| map_app_run_terminal(&meta))
}

struct FinalizeTaskRunOptions {
    notify_on_completion: bool,
    task_name: Option<String>,
    auto_disable_one_time: bool,
}

/// Persist terminal status on a scheduler task run and refresh parent task metadata.
fn finalize_task_run(
    task_run: &mut ScheduledTaskRun,
    status: RunStatus,
    error: Option<String>,
    opts: FinalizeTaskRunOptions,
) {
    let ended_at = Utc::now().to_rfc3339();
    task_run.status = status.clone();
    task_run.error = error;
    task_run.ended_at = Some(ended_at.clone());
    let _ = store::save_run(task_run);

    if let Some(mut task) = store::load_task(&task_run.task_id) {
        task.last_run_at = Some(ended_at);
        task.updated_at = Utc::now().to_rfc3339();
        if opts.auto_disable_one_time
            && task.schedule.schedule_type == super::model::ScheduleType::OneTime
        {
            task.enabled = false;
            log::info!(
                "[scheduler] one-time task {} auto-disabled after completion",
                task.name
            );
        }
        let _ = store::save_task(&task);
    }

    if opts.notify_on_completion {
        if let Some(ref name) = opts.task_name {
            send_feishu_schedule_notification(name, status);
        }
    }
}

/// Reconcile scheduler runs still marked running/queued whose MiWarp run already
/// finished (e.g. monitor died on app restart while `reconcile_orphaned_runs`
/// marked the underlying run Stopped).
pub fn reconcile_stale_runs() -> u32 {
    let mut reconciled = 0u32;
    for mut task_run in store::load_all_runs(Some(500)) {
        if !matches!(task_run.status, RunStatus::Running | RunStatus::Queued) {
            continue;
        }
        let Some(ref miwarp_run_id) = task_run.run_id else {
            continue;
        };
        let Some((status, error)) = app_run_terminal_status(miwarp_run_id) else {
            continue;
        };
        log::info!(
            "[scheduler] reconciled stale task run {} (miwarp {miwarp_run_id}) -> {status:?}",
            task_run.id
        );
        let task_name = store::load_task(&task_run.task_id).map(|t| t.name);
        finalize_task_run(
            &mut task_run,
            status,
            error,
            FinalizeTaskRunOptions {
                notify_on_completion: false,
                task_name,
                auto_disable_one_time: true,
            },
        );
        reconciled += 1;
    }
    reconciled
}

fn reconcile_stale_runs_for_task(task_id: &str) {
    for mut task_run in store::load_runs_for_task(task_id, Some(10)) {
        if !matches!(task_run.status, RunStatus::Running | RunStatus::Queued) {
            continue;
        }
        let Some(ref miwarp_run_id) = task_run.run_id else {
            continue;
        };
        let Some((status, error)) = app_run_terminal_status(miwarp_run_id) else {
            continue;
        };
        log::info!(
            "[scheduler] reconciled stale task run {} (miwarp {miwarp_run_id}) -> {status:?}",
            task_run.id
        );
        let task_name = store::load_task(&task_run.task_id).map(|t| t.name);
        finalize_task_run(
            &mut task_run,
            status,
            error,
            FinalizeTaskRunOptions {
                notify_on_completion: false,
                task_name,
                auto_disable_one_time: true,
            },
        );
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

        let terminal = app_run_terminal_status(run_id);

        if let Some((status, error)) = terminal {
            log::info!("[scheduler] run {run_id} finished with status {status:?}");
            if let Some(mut task_run) = store::load_run(task_run_id) {
                finalize_task_run(
                    &mut task_run,
                    status,
                    error,
                    FinalizeTaskRunOptions {
                        notify_on_completion,
                        task_name: Some(task_name.to_string()),
                        auto_disable_one_time: true,
                    },
                );
            }
            return;
        }

        // Hit the hard deadline. Do one final check so runs that just finished
        // in the last `MONITOR_GRACE_PERIOD_SECS` are recorded correctly
        // rather than being misclassified as "Timed out".
        if started_at.elapsed() + Duration::from_secs(poll_secs)
            >= Duration::from_secs(MONITOR_TIMEOUT_SECS)
        {
            let final_check = app_run_terminal_status(run_id);
            if let Some((status, error)) = final_check {
                log::warn!(
                    "[scheduler] run {run_id} hit 24h deadline but finished with {status:?} — recording real status"
                );
                if let Some(mut task_run) = store::load_run(task_run_id) {
                    finalize_task_run(
                        &mut task_run,
                        status,
                        error,
                        FinalizeTaskRunOptions {
                            notify_on_completion,
                            task_name: Some(task_name.to_string()),
                            auto_disable_one_time: true,
                        },
                    );
                }
            } else {
                log::warn!("[scheduler] monitor timeout for run {run_id}, marking as failed");
                if let Some(mut task_run) = store::load_run(task_run_id) {
                    finalize_task_run(
                        &mut task_run,
                        RunStatus::Failed,
                        Some("Timed out after 24 hours".into()),
                        FinalizeTaskRunOptions {
                            notify_on_completion,
                            task_name: Some(task_name.to_string()),
                            auto_disable_one_time: true,
                        },
                    );
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
    reconcile_stale_runs_for_task(task_id);
    store::load_runs_for_task(task_id, Some(5))
        .iter()
        .any(|r| matches!(r.status, RunStatus::Running | RunStatus::Queued))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ExecutionPath, RunMeta, RunSource, RunStatus as AppRunStatus};

    fn sample_meta(status: AppRunStatus, error: Option<&str>) -> RunMeta {
        RunMeta {
            id: "run-1".to_string(),
            prompt: "p".to_string(),
            cwd: "/tmp".to_string(),
            agent: "claude".to_string(),
            auth_mode: "default".to_string(),
            status,
            started_at: "2024-01-01T00:00:00Z".to_string(),
            ended_at: None,
            exit_code: None,
            error_message: error.map(str::to_string),
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
            source: Some(RunSource::Native),
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
            execution_path: Some(ExecutionPath::SessionActor),
            conversation_ref: None,
            scheduled_task_id: None,
            scheduled_task_run_id: None,
            runtime_kind: None,
            protocol_kind: None,
        }
    }

    #[test]
    fn map_app_run_terminal_completed() {
        let (status, err) =
            map_app_run_terminal(&sample_meta(AppRunStatus::Completed, None)).unwrap();
        assert_eq!(status, RunStatus::Completed);
        assert!(err.is_none());
    }

    #[test]
    fn map_app_run_terminal_stopped_preserves_error() {
        let (status, err) = map_app_run_terminal(&sample_meta(
            AppRunStatus::Stopped,
            Some("Recovered after app restart"),
        ))
        .unwrap();
        assert_eq!(status, RunStatus::Cancelled);
        assert_eq!(err.as_deref(), Some("Recovered after app restart"));
    }

    #[test]
    fn map_app_run_terminal_pending_is_none() {
        assert!(map_app_run_terminal(&sample_meta(AppRunStatus::Pending, None)).is_none());
    }
}
