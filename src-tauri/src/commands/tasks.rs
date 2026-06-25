//! Thin Tauri boundary for the durable Task Core.

use crate::models::now_iso;
use crate::storage;
use crate::storage::tasks::TaskMutation;
use crate::task_core::{
    TaskArtifactLink, TaskCreateInput, TaskEvent, TaskEventKind, TaskEventSource,
    TaskMergeDecision, TaskQualityGate, TaskReconcileReport, TaskRecord, TaskReviewDecision,
    TaskRunLink, TaskRunRole, TaskStatus,
};
use uuid::Uuid;

#[derive(Debug, serde::Deserialize)]
pub struct TaskLinkRunInput {
    pub task_id: String,
    pub run_id: String,
    pub role: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct TaskLinkArtifactInput {
    pub task_id: String,
    pub artifact_id: String,
    pub kind: String,
    pub run_id: Option<String>,
    pub content_hash: Option<String>,
}

fn parse_run_role(role: Option<&str>) -> Result<TaskRunRole, String> {
    match role {
        Some("primary") | None => Ok(TaskRunRole::Primary),
        Some("worktree") => Ok(TaskRunRole::Worktree),
        Some("verification") => Ok(TaskRunRole::Verification),
        Some("review") => Ok(TaskRunRole::Review),
        Some("followup") => Ok(TaskRunRole::Followup),
        Some(other) => Err(format!(
            "unknown run role '{other}': expected primary|worktree|verification|review|followup"
        )),
    }
}

#[tauri::command]
pub fn task_create(input: TaskCreateInput) -> Result<TaskRecord, String> {
    let title = if input.title.trim().is_empty() {
        input.objective.trim().to_string()
    } else {
        input.title.trim().to_string()
    };
    if title.is_empty() {
        return Err("task title or objective is required".to_string());
    }

    let id = input
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut task = TaskRecord::new(
        id,
        title,
        input.description,
        input.owner,
        input.priority.unwrap_or_default(),
        now_iso(),
    );
    task.objective = if input.objective.trim().is_empty() {
        task.title.clone()
    } else {
        input.objective
    };
    task.constraints = input.constraints;
    task.workspace_cwd = input.workspace_cwd;
    task.branch = input.branch;
    task.worktree_path = input.worktree_path;
    task.worktree_branch = input.worktree_branch;
    task.agent = input.agent;
    task.model = input.model;
    task.permission_mode = input.permission_mode;
    task.max_changed_files = input.max_changed_files;
    task.allowed_dirs = input.allowed_dirs;
    task.verification_commands = input.verification_commands;
    task.tags = input.tags;

    let task = storage::tasks::create(task, TaskEventSource::User)?;
    log::debug!(
        "[tasks] task_create: id={} revision={}",
        task.id,
        task.revision
    );
    Ok(task)
}

#[tauri::command]
pub fn task_get(id: String) -> Result<TaskRecord, String> {
    storage::tasks::get(&id).ok_or_else(|| format!("Task {id} not found"))
}

#[tauri::command]
pub fn task_list() -> Result<Vec<TaskRecord>, String> {
    Ok(storage::tasks::list())
}

#[tauri::command]
pub fn task_list_events(id: String, since_seq: Option<u64>) -> Result<Vec<TaskEvent>, String> {
    storage::tasks::list_events(&id, since_seq.unwrap_or(0))
}

#[tauri::command]
pub fn task_update_status(id: String, status: TaskStatus) -> Result<TaskRecord, String> {
    let now = now_iso();
    let (_, task) = storage::tasks::mutate(&id, TaskEventSource::User, |task| {
        let from = task.status;
        task.transition(status, now.clone())?;
        Ok(TaskMutation::changed(
            (),
            TaskEventKind::StatusTransition { from, to: status },
        ))
    })?;
    if let Err(error) = storage::attention_queue::sync_task(&id) {
        log::debug!("[attention-queue] sync_task after status update failed for {id}: {error}");
    }
    Ok(task)
}

#[tauri::command]
pub fn task_link_run(input: TaskLinkRunInput) -> Result<TaskRecord, String> {
    if input.run_id.trim().is_empty() {
        return Err("run_id is required".to_string());
    }
    let role = parse_run_role(input.role.as_deref())?;
    let now = now_iso();
    let run_id = input.run_id.clone();
    let event_role = role.clone();
    let (added, task) = storage::tasks::mutate(&input.task_id, TaskEventSource::User, |task| {
        let added = task.link_run(
            TaskRunLink {
                run_id: run_id.clone(),
                role: role.clone(),
                linked_at: now.clone(),
            },
            now.clone(),
        );
        Ok(if added {
            TaskMutation::changed(
                true,
                TaskEventKind::RunLinked {
                    run_id: run_id.clone(),
                    role: event_role.clone(),
                },
            )
        } else {
            TaskMutation::unchanged(false)
        })
    })?;
    log::debug!(
        "[tasks] task_link_run: task={} run={} added={}",
        input.task_id,
        input.run_id,
        added
    );
    Ok(task)
}

#[tauri::command]
pub fn task_link_artifact(input: TaskLinkArtifactInput) -> Result<TaskRecord, String> {
    if input.artifact_id.trim().is_empty() {
        return Err("artifact_id is required".to_string());
    }
    if input.kind.trim().is_empty() {
        return Err("artifact kind is required".to_string());
    }

    let now = now_iso();
    let artifact_id = input.artifact_id.clone();
    let kind = input.kind.clone();
    let run_id = input.run_id.clone();
    let (added, task) = storage::tasks::mutate(&input.task_id, TaskEventSource::User, |task| {
        let added = task.link_artifact(
            TaskArtifactLink {
                artifact_id: artifact_id.clone(),
                kind: kind.clone(),
                run_id: run_id.clone(),
                content_hash: input.content_hash.clone(),
                linked_at: now.clone(),
            },
            now.clone(),
        );
        Ok(if added {
            TaskMutation::changed(
                true,
                TaskEventKind::ArtifactLinked {
                    artifact_id: artifact_id.clone(),
                    kind: kind.clone(),
                    run_id: run_id.clone(),
                },
            )
        } else {
            TaskMutation::unchanged(false)
        })
    })?;
    log::debug!(
        "[tasks] task_link_artifact: task={} artifact={} added={}",
        input.task_id,
        input.artifact_id,
        added
    );
    Ok(task)
}

#[tauri::command]
pub fn task_set_quality_gate(id: String, gate: TaskQualityGate) -> Result<TaskRecord, String> {
    let now = now_iso();
    let verdict = gate.verdict;
    let (_, task) = storage::tasks::mutate(&id, TaskEventSource::User, |task| {
        if task.quality_gate == gate {
            return Ok(TaskMutation::unchanged(()));
        }
        task.set_quality_gate(gate, now.clone());
        Ok(TaskMutation::changed(
            (),
            TaskEventKind::QualityGateUpdated { verdict },
        ))
    })?;
    Ok(task)
}

#[tauri::command]
pub fn task_set_review_decision(
    id: String,
    decision: TaskReviewDecision,
) -> Result<TaskRecord, String> {
    let now = now_iso();
    let outcome = decision.outcome;
    let (_, task) = storage::tasks::mutate(&id, TaskEventSource::User, |task| {
        if task.review == decision {
            return Ok(TaskMutation::unchanged(()));
        }
        task.set_review_decision(decision, now.clone());
        Ok(TaskMutation::changed(
            (),
            TaskEventKind::ReviewUpdated { outcome },
        ))
    })?;
    Ok(task)
}

#[tauri::command]
pub fn task_set_merge_decision(
    id: String,
    decision: TaskMergeDecision,
) -> Result<TaskRecord, String> {
    let now = now_iso();
    let decision_kind = decision.decision;
    let (_, task) = storage::tasks::mutate(&id, TaskEventSource::User, |task| {
        if task.merge_decision == decision {
            return Ok(TaskMutation::unchanged(()));
        }
        task.set_merge_decision(decision, now.clone());
        Ok(TaskMutation::changed(
            (),
            TaskEventKind::MergeDecisionUpdated {
                decision: decision_kind,
            },
        ))
    })?;
    Ok(task)
}

#[tauri::command]
pub fn task_reconcile_after_restart() -> Result<TaskReconcileReport, String> {
    Ok(storage::tasks::reconcile_after_restart())
}

#[tauri::command]
pub fn task_set_worktree(
    id: String,
    worktree_path: String,
    worktree_branch: String,
) -> Result<TaskRecord, String> {
    if worktree_path.trim().is_empty() {
        return Err("worktree_path is required".to_string());
    }
    if worktree_branch.trim().is_empty() {
        return Err("worktree_branch is required".to_string());
    }

    let now = now_iso();
    let path_for_event = worktree_path.clone();
    let branch_for_event = worktree_branch.clone();
    let (_, task) = storage::tasks::mutate(&id, TaskEventSource::User, |task| {
        if task.worktree_path.as_deref() == Some(worktree_path.as_str())
            && task.worktree_branch.as_deref() == Some(worktree_branch.as_str())
        {
            return Ok(TaskMutation::unchanged(()));
        }
        task.set_worktree(worktree_path.clone(), worktree_branch.clone(), now.clone());
        Ok(TaskMutation::changed(
            (),
            TaskEventKind::WorktreeUpdated {
                path: path_for_event.clone(),
                branch: branch_for_event.clone(),
            },
        ))
    })?;
    Ok(task)
}

#[tauri::command]
pub fn task_track_changed_file(id: String, path: String) -> Result<TaskRecord, String> {
    if path.trim().is_empty() {
        return Err("changed file path is required".to_string());
    }

    let now = now_iso();
    let path_for_event = path.clone();
    let (_, task) = storage::tasks::mutate(&id, TaskEventSource::Runtime, |task| {
        let added = task.track_changed_file(path.clone(), now.clone());
        Ok(if added {
            TaskMutation::changed(
                (),
                TaskEventKind::ChangedFileTracked {
                    path: path_for_event.clone(),
                },
            )
        } else {
            TaskMutation::unchanged(())
        })
    })?;
    Ok(task)
}
