//! Durable Task Core persistence.
//!
//! Each task owns a compact snapshot, an append-only lifecycle journal, and
//! at most one pending mutation:
//!
//! ```text
//! ~/.miwarp/tasks/<task_id>/task.json
//! ~/.miwarp/tasks/<task_id>/events.jsonl
//! ~/.miwarp/tasks/<task_id>/mutation.json
//! ```
//!
//! A mutation writes `mutation.json` first, then appends the event
//! idempotently, atomically replaces the snapshot, and finally removes the
//! pending file. Any later read or mutation replays an interrupted pending
//! mutation before proceeding.

use super::durable_io::{
    append_json_line, remove_file_durable, repair_jsonl_tail, write_json_atomic,
};
use crate::models::{now_iso, RunStatus};
use crate::task_core::{
    TaskEvent, TaskEventKind, TaskEventSource, TaskReconcileReport, TaskRecord, TaskStatus,
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

static TASK_LOCKS: Lazy<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn lock_for(id: &str) -> Arc<Mutex<()>> {
    let mut map = TASK_LOCKS.lock().unwrap_or_else(|e| e.into_inner());
    map.retain(|_, value| Arc::strong_count(value) > 1);
    map.entry(id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

#[derive(Debug)]
pub struct TaskMutation<T> {
    pub result: T,
    pub event: Option<TaskEventKind>,
}

impl<T> TaskMutation<T> {
    pub fn changed(result: T, event: TaskEventKind) -> Self {
        Self {
            result,
            event: Some(event),
        }
    }

    pub fn unchanged(result: T) -> Self {
        Self {
            result,
            event: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PendingTaskMutation {
    snapshot: TaskRecord,
    event: TaskEvent,
}

fn validate_task_id(id: &str) -> Result<(), String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err("task id is required".to_string());
    }
    if trimmed.len() > 128 {
        return Err("task id is too long".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("task id may only contain ASCII letters, numbers, '-' and '_'".to_string());
    }
    Ok(())
}

pub fn tasks_root() -> PathBuf {
    super::data_dir().join("tasks")
}

fn task_dir(root: &Path, id: &str) -> PathBuf {
    root.join(id)
}

fn task_file(root: &Path, id: &str) -> PathBuf {
    task_dir(root, id).join("task.json")
}

fn events_file(root: &Path, id: &str) -> PathBuf {
    task_dir(root, id).join("events.jsonl")
}

fn pending_file(root: &Path, id: &str) -> PathBuf {
    task_dir(root, id).join("mutation.json")
}

fn get_raw_in(root: &Path, id: &str) -> Option<TaskRecord> {
    let path = task_file(root, id);
    let content = fs::read_to_string(&path).ok()?;
    match serde_json::from_str::<TaskRecord>(&content) {
        Ok(task) => Some(task),
        Err(error) => {
            log::warn!("[storage/tasks] parse error {}: {}", path.display(), error);
            None
        }
    }
}

fn repair_partial_tail(path: &Path) -> Result<(), String> {
    repair_jsonl_tail::<TaskEvent>(path)
}

fn list_events_raw(path: &Path, since_seq: u64) -> Vec<TaskEvent> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };
    let mut events: Vec<TaskEvent> = content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<TaskEvent>(line).ok())
        .filter(|event| event.seq > since_seq)
        .collect();
    events.sort_by_key(|event| event.seq);
    events.dedup_by_key(|event| event.seq);
    events
}

fn append_event_idempotent(root: &Path, event: &TaskEvent) -> Result<(), String> {
    let path = events_file(root, &event.task_id);
    if let Some(parent) = path.parent() {
        super::ensure_dir(parent).map_err(|e| e.to_string())?;
    }
    repair_partial_tail(&path)?;

    if let Some(existing) = list_events_raw(&path, event.seq.saturating_sub(1))
        .into_iter()
        .find(|candidate| candidate.seq == event.seq)
    {
        if existing == *event {
            return Ok(());
        }
        return Err(format!(
            "task {} journal sequence {} already belongs to another event",
            event.task_id, event.seq
        ));
    }

    append_json_line(&path, event)
}

fn remove_pending(root: &Path, id: &str) -> Result<(), String> {
    remove_file_durable(&pending_file(root, id))
}

fn persist_pending_in(root: &Path, pending: &PendingTaskMutation) -> Result<(), String> {
    write_json_atomic(&pending_file(root, &pending.snapshot.id), pending)?;
    append_event_idempotent(root, &pending.event)?;
    save_to(root, &pending.snapshot)?;
    remove_pending(root, &pending.snapshot.id)
}

fn recover_pending_in(root: &Path, id: &str) -> Result<(), String> {
    let path = pending_file(root, id);
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("read pending task mutation {}: {e}", path.display()))?;
    let pending: PendingTaskMutation = serde_json::from_str(&content)
        .map_err(|e| format!("parse pending task mutation {}: {e}", path.display()))?;
    if pending.snapshot.id != id || pending.event.task_id != id {
        return Err(format!("pending mutation identity mismatch for task {id}"));
    }

    append_event_idempotent(root, &pending.event)?;
    let current = get_raw_in(root, id);
    if current
        .as_ref()
        .is_none_or(|task| task.revision < pending.snapshot.revision)
    {
        save_to(root, &pending.snapshot)?;
    }
    remove_pending(root, id)
}

fn make_event(
    task: &mut TaskRecord,
    source: TaskEventSource,
    event: TaskEventKind,
    timestamp: String,
) -> TaskEvent {
    task.revision = task.revision.saturating_add(1);
    task.last_event_seq = task.last_event_seq.saturating_add(1);
    TaskEvent {
        id: uuid::Uuid::new_v4().to_string(),
        task_id: task.id.clone(),
        seq: task.last_event_seq,
        source,
        event,
        timestamp,
    }
}

pub fn create(mut task: TaskRecord, source: TaskEventSource) -> Result<TaskRecord, String> {
    create_in(&tasks_root(), &mut task, source)
}

fn create_in(
    root: &Path,
    task: &mut TaskRecord,
    source: TaskEventSource,
) -> Result<TaskRecord, String> {
    validate_task_id(&task.id)?;
    let lock = lock_for(&task.id);
    let _guard = lock.lock().map_err(|e| format!("task lock: {e}"))?;
    recover_pending_in(root, &task.id)?;
    if task_file(root, &task.id).exists() {
        return Err(format!("Task {} already exists", task.id));
    }

    let created_at = task.created_at.clone();
    let event = make_event(task, source, TaskEventKind::Created, created_at);
    persist_pending_in(
        root,
        &PendingTaskMutation {
            snapshot: task.clone(),
            event,
        },
    )?;
    Ok(task.clone())
}

pub fn mutate<T, F>(id: &str, source: TaskEventSource, f: F) -> Result<(T, TaskRecord), String>
where
    F: FnOnce(&mut TaskRecord) -> Result<TaskMutation<T>, String>,
{
    mutate_in(&tasks_root(), id, source, f)
}

fn mutate_in<T, F>(
    root: &Path,
    id: &str,
    source: TaskEventSource,
    f: F,
) -> Result<(T, TaskRecord), String>
where
    F: FnOnce(&mut TaskRecord) -> Result<TaskMutation<T>, String>,
{
    validate_task_id(id)?;
    let lock = lock_for(id);
    let _guard = lock.lock().map_err(|e| format!("task lock: {e}"))?;
    recover_pending_in(root, id)?;
    let mut task = get_raw_in(root, id).ok_or_else(|| format!("Task {id} not found"))?;
    let mutation = f(&mut task)?;
    if let Some(kind) = mutation.event {
        let updated_at = task.updated_at.clone();
        let event = make_event(&mut task, source, kind, updated_at);
        persist_pending_in(
            root,
            &PendingTaskMutation {
                snapshot: task.clone(),
                event,
            },
        )?;
    }
    Ok((mutation.result, task))
}

pub fn get(id: &str) -> Option<TaskRecord> {
    get_in(&tasks_root(), id)
}

pub(crate) fn get_in(root: &Path, id: &str) -> Option<TaskRecord> {
    if let Err(error) = validate_task_id(id) {
        log::warn!("[storage/tasks] invalid task id in get: {error}");
        return None;
    }
    let lock = lock_for(id);
    let _guard = match lock.lock() {
        Ok(guard) => guard,
        Err(error) => {
            log::warn!("[storage/tasks] task lock poisoned for {id}: {error}");
            return None;
        }
    };
    if let Err(error) = recover_pending_in(root, id) {
        log::warn!("[storage/tasks] recovery failed for {id}: {error}");
        return None;
    }
    get_raw_in(root, id)
}

pub fn save(task: &TaskRecord) -> Result<(), String> {
    save_to(&tasks_root(), task)
}

pub(crate) fn save_to(root: &Path, task: &TaskRecord) -> Result<(), String> {
    validate_task_id(&task.id)?;
    write_json_atomic(&task_file(root, &task.id), task)
}

pub fn list() -> Vec<TaskRecord> {
    list_in(&tasks_root())
}

pub(crate) fn list_in(root: &Path) -> Vec<TaskRecord> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) => {
            log::debug!(
                "[storage/tasks] cannot read tasks dir {}: {}",
                root.display(),
                error
            );
            return Vec::new();
        }
    };

    let mut tasks = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(id) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if validate_task_id(id).is_err() {
            continue;
        }
        let lock = lock_for(id);
        let Ok(_guard) = lock.lock() else {
            continue;
        };
        if let Err(error) = recover_pending_in(root, id) {
            log::warn!("[storage/tasks] skipping task {id}; recovery failed: {error}");
            continue;
        }
        if let Some(task) = get_raw_in(root, id) {
            tasks.push(task);
        }
    }
    tasks.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    tasks
}

pub fn reconcile_after_restart() -> TaskReconcileReport {
    reconcile_in(&tasks_root(), |run_id| {
        super::runs::get_run(run_id).map(|run| run.status)
    })
}

fn reconcile_in<F>(root: &Path, mut run_status: F) -> TaskReconcileReport
where
    F: FnMut(&str) -> Option<RunStatus>,
{
    let pending_ids: Vec<String> = fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let id = path.file_name()?.to_str()?.to_string();
            pending_file(root, &id).exists().then_some(id)
        })
        .collect();

    let tasks = list_in(root);
    let mut report = TaskReconcileReport {
        scanned: tasks.len() as u32,
        ..TaskReconcileReport::default()
    };
    for id in pending_ids {
        if pending_file(root, &id).exists() {
            report
                .failures
                .push(format!("Task {id}: pending mutation recovery failed"));
        } else {
            report.recovered_pending_mutations += 1;
        }
    }

    for snapshot in tasks {
        if !matches!(
            snapshot.status,
            TaskStatus::Running | TaskStatus::Verifying | TaskStatus::Review
        ) {
            report.unchanged += 1;
            continue;
        }

        let reason = if snapshot.run_links.is_empty() {
            Some("active task has no linked run".to_string())
        } else {
            let statuses: Vec<RunStatus> = snapshot
                .run_links
                .iter()
                .filter_map(|link| run_status(&link.run_id))
                .collect();
            if statuses.iter().any(|status| {
                matches!(
                    status,
                    RunStatus::Pending | RunStatus::Running | RunStatus::Idle
                )
            }) {
                None
            } else if statuses.is_empty() {
                Some("all linked runs are missing".to_string())
            } else {
                Some("no linked run remains active after restart".to_string())
            }
        };

        let Some(reason) = reason else {
            report.unchanged += 1;
            continue;
        };
        let now = now_iso();
        let task_id = snapshot.id.clone();
        let result = mutate_in(root, &task_id, TaskEventSource::System, |task| {
            if !matches!(
                task.status,
                TaskStatus::Running | TaskStatus::Verifying | TaskStatus::Review
            ) {
                return Ok(TaskMutation::unchanged(false));
            }
            let from = task.status;
            task.transition(TaskStatus::NeedsAttention, now.clone())?;
            Ok(TaskMutation::changed(
                true,
                TaskEventKind::RestartReconciled {
                    from,
                    to: TaskStatus::NeedsAttention,
                    reason: reason.clone(),
                },
            ))
        });
        match result {
            Ok((true, _)) => report.moved_to_needs_attention += 1,
            Ok((false, _)) => report.unchanged += 1,
            Err(error) => report.failures.push(format!("Task {task_id}: {error}")),
        }
    }
    report
}

pub fn list_events(id: &str, since_seq: u64) -> Result<Vec<TaskEvent>, String> {
    list_events_in(&tasks_root(), id, since_seq)
}

fn list_events_in(root: &Path, id: &str, since_seq: u64) -> Result<Vec<TaskEvent>, String> {
    validate_task_id(id)?;
    let lock = lock_for(id);
    let _guard = lock.lock().map_err(|e| format!("task lock: {e}"))?;
    recover_pending_in(root, id)?;
    if !task_file(root, id).exists() {
        return Err(format!("Task {id} not found"));
    }
    Ok(list_events_raw(&events_file(root, id), since_seq))
}

pub fn delete(id: &str) -> Result<(), String> {
    delete_in(&tasks_root(), id)
}

pub(crate) fn delete_in(root: &Path, id: &str) -> Result<(), String> {
    validate_task_id(id)?;
    let lock = lock_for(id);
    let _guard = lock.lock().map_err(|e| format!("task lock: {e}"))?;
    let dir = task_dir(root, id);
    if !dir.exists() {
        return Ok(());
    }
    fs::remove_dir_all(&dir)
        .map_err(|e| format!("Failed to remove task dir {}: {e}", dir.display()))
}

#[cfg(test)]
mod tests;
