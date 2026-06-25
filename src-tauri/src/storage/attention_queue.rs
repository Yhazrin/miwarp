//! Durable Attention Queue persistence — single global aggregate.
//!
//! ```text
//! ~/.miwarp/attention/queue.json
//! ~/.miwarp/attention/events.jsonl
//! ~/.miwarp/attention/mutation.json
//! ```

use super::durable_io::{
    append_json_line, remove_file_durable, repair_jsonl_tail, write_json_atomic,
};
use crate::attention_core::{
    apply_acknowledge, apply_resolve, apply_source_cleared, init_snapshot, make_event,
    upsert_signal, ApplyOutcome, AttentionAction, AttentionEvent, AttentionEventKind,
    AttentionItem, AttentionKind, AttentionQueueSnapshot, AttentionReconcileReport,
};
use crate::models::now_iso;
use crate::task_core::{TaskEventKind, TaskEventSource, TaskStatus};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

static QUEUE_LOCK: Lazy<Arc<Mutex<()>>> = Lazy::new(|| Arc::new(Mutex::new(())));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PendingAttentionMutation {
    snapshot: AttentionQueueSnapshot,
    event: AttentionEvent,
}

mod reconcile;
pub use reconcile::{collect_all_signals, reconcile, sync_run, sync_task};

#[cfg(test)]
mod tests;

pub fn attention_root() -> PathBuf {
    super::data_dir().join("attention")
}

fn queue_file(root: &Path) -> PathBuf {
    root.join("queue.json")
}

fn events_file(root: &Path) -> PathBuf {
    root.join("events.jsonl")
}

fn pending_file(root: &Path) -> PathBuf {
    root.join("mutation.json")
}

pub(crate) fn with_lock<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce(&Path) -> Result<T, String>,
{
    with_lock_recovery(|root, _| f(root))
}

pub(crate) fn with_lock_recovery<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce(&Path, bool) -> Result<T, String>,
{
    let lock = QUEUE_LOCK.clone();
    let _guard = lock
        .lock()
        .map_err(|e| format!("attention queue lock: {e}"))?;
    let root = attention_root();
    if let Some(parent) = root.parent() {
        super::ensure_dir(parent).map_err(|e| e.to_string())?;
    }
    super::ensure_dir(&root).map_err(|e| e.to_string())?;
    let recovered_pending = pending_file(&root).exists();
    recover_pending(&root)?;
    f(&root, recovered_pending)
}

pub(crate) fn get_raw_in(root: &Path) -> Option<AttentionQueueSnapshot> {
    let path = queue_file(root);
    let content = fs::read_to_string(&path).ok()?;
    match serde_json::from_str::<AttentionQueueSnapshot>(&content) {
        Ok(snapshot) => Some(snapshot),
        Err(error) => {
            log::warn!(
                "[attention-queue] parse error {}: {}",
                path.display(),
                error
            );
            None
        }
    }
}

pub(crate) fn save_snapshot(root: &Path, snapshot: &AttentionQueueSnapshot) -> Result<(), String> {
    write_json_atomic(&queue_file(root), snapshot)
}

fn repair_partial_tail(path: &Path) -> Result<(), String> {
    repair_jsonl_tail::<AttentionEvent>(path)
}

fn list_events_raw(path: &Path, since_seq: u64) -> Vec<AttentionEvent> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };
    let mut events: Vec<AttentionEvent> = content
        .lines()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty())
        .filter_map(
            |(index, line)| match serde_json::from_str::<AttentionEvent>(line) {
                Ok(event) => Some(event),
                Err(error) => {
                    log::warn!(
                        "[attention-queue] ignored malformed event at line {}: {}",
                        index + 1,
                        error
                    );
                    None
                }
            },
        )
        .filter(|event| event.seq > since_seq)
        .collect();
    events.sort_by_key(|event| event.seq);
    events.dedup_by_key(|event| event.seq);
    events
}

fn append_event_idempotent(root: &Path, event: &AttentionEvent) -> Result<(), String> {
    let path = events_file(root);
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
            "attention queue sequence {} already belongs to another event",
            event.seq
        ));
    }

    append_json_line(&path, event)
}

fn remove_pending(root: &Path) -> Result<(), String> {
    remove_file_durable(&pending_file(root))
}

fn persist_pending(root: &Path, pending: &PendingAttentionMutation) -> Result<(), String> {
    write_json_atomic(&pending_file(root), pending)?;
    append_event_idempotent(root, &pending.event)?;
    save_snapshot(root, &pending.snapshot)?;
    remove_pending(root)
}

pub(crate) fn recover_pending(root: &Path) -> Result<(), String> {
    let path = pending_file(root);
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("read pending attention mutation {}: {e}", path.display()))?;
    let pending: PendingAttentionMutation = serde_json::from_str(&content)
        .map_err(|e| format!("parse pending attention mutation {}: {e}", path.display()))?;

    append_event_idempotent(root, &pending.event)?;
    let current = get_raw_in(root);
    if current
        .as_ref()
        .is_none_or(|snapshot| snapshot.revision < pending.snapshot.revision)
    {
        save_snapshot(root, &pending.snapshot)?;
    }
    remove_pending(root)
}

pub(crate) fn ensure_initialized(root: &Path) -> Result<AttentionQueueSnapshot, String> {
    if let Some(snapshot) = get_raw_in(root) {
        return Ok(snapshot);
    }
    if queue_file(root).exists() {
        return Err("attention queue exists but is corrupt or unreadable".to_string());
    }
    let now = now_iso();
    let snapshot = init_snapshot(now);
    save_snapshot(root, &snapshot)?;
    Ok(snapshot)
}

fn commit_event(
    root: &Path,
    snapshot: &mut AttentionQueueSnapshot,
    kind: AttentionEventKind,
    timestamp: String,
) -> Result<ApplyOutcome, String> {
    let event = make_event(snapshot, kind, timestamp);
    persist_pending(
        root,
        &PendingAttentionMutation {
            snapshot: snapshot.clone(),
            event,
        },
    )?;
    Ok(ApplyOutcome::Changed)
}

fn apply_mutation<F>(mutator: F) -> Result<AttentionQueueSnapshot, String>
where
    F: FnOnce(&Path, &mut AttentionQueueSnapshot) -> Result<ApplyOutcome, String>,
{
    with_lock(|root| {
        let mut snapshot = ensure_initialized(root)?;
        let outcome = mutator(root, &mut snapshot)?;
        if outcome == ApplyOutcome::NoOp {
            return Ok(snapshot);
        }
        Ok(snapshot)
    })
}

pub fn get() -> Result<AttentionQueueSnapshot, String> {
    with_lock(ensure_initialized)
}

pub fn list_events(since_seq: u64) -> Result<Vec<AttentionEvent>, String> {
    with_lock(|root| {
        let _ = ensure_initialized(root)?;
        let path = events_file(root);
        repair_partial_tail(&path)?;
        Ok(list_events_raw(&path, since_seq))
    })
}

pub fn acknowledge(item_id: &str, actor: Option<String>) -> Result<AttentionQueueSnapshot, String> {
    let item_id = item_id.trim();
    if item_id.is_empty() || item_id.len() > 128 {
        return Err("attention item id must be 1..=128 bytes".to_string());
    }
    let item_id = item_id.to_string();
    let actor = actor
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if actor.as_ref().is_some_and(|value| value.len() > 128) {
        return Err("attention actor must be at most 128 bytes".to_string());
    }
    apply_mutation(|root, snapshot| {
        let now = now_iso();
        let (outcome, kind) = apply_acknowledge(snapshot, &item_id, actor, now.clone())?;
        if outcome == ApplyOutcome::NoOp {
            return Ok(ApplyOutcome::NoOp);
        }
        let Some(kind) = kind else {
            return Ok(ApplyOutcome::NoOp);
        };
        commit_event(root, snapshot, kind, now)?;
        Ok(ApplyOutcome::Changed)
    })
}

pub fn resolve(
    item_id: &str,
    action: AttentionAction,
    actor: Option<String>,
    note: Option<String>,
) -> Result<AttentionQueueSnapshot, String> {
    let item_id = item_id.trim();
    if item_id.is_empty() || item_id.len() > 128 {
        return Err("attention item id must be 1..=128 bytes".to_string());
    }
    let item_id = item_id.to_string();
    let actor = actor.unwrap_or_else(|| "user".to_string());
    let actor = actor.trim();
    if actor.is_empty() || actor.len() > 128 {
        return Err("attention actor must be 1..=128 bytes".to_string());
    }
    let actor = actor.to_string();
    let note = note
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if note.as_ref().is_some_and(|value| value.len() > 4096) {
        return Err("attention note must be at most 4096 bytes".to_string());
    }

    // Validate under the queue lock, release it before mutating another
    // aggregate, then revalidate the source generation before committing the
    // operator decision. This avoids Attention -> Task nested locking while
    // still detecting a concurrent refresh/reopen of the same incident.
    let current = get()?;
    let mut preview = current.clone();
    let (preview_outcome, _) = apply_resolve(
        &mut preview,
        &item_id,
        action,
        actor.clone(),
        note.clone(),
        now_iso(),
    )?;
    if preview_outcome == ApplyOutcome::NoOp {
        return Ok(current);
    }

    let item = current
        .items
        .iter()
        .find(|candidate| candidate.id == item_id)
        .ok_or_else(|| format!("Attention item {item_id} not found"))?;
    let expected_generation = item.generation;
    let expected_source_revision = item.source_revision;
    let linked_task_id = item.task_id.clone();
    let mut source_task_changed = false;

    if action == AttentionAction::RetryTask || action == AttentionAction::MarkTaskFailed {
        let task_id = linked_task_id
            .as_ref()
            .ok_or_else(|| format!("Attention item {item_id} has no linked task"))?;
        let target = if action == AttentionAction::RetryTask {
            TaskStatus::Ready
        } else {
            TaskStatus::Failed
        };
        let now = now_iso();
        super::tasks::mutate(task_id, TaskEventSource::User, |task| {
            if task.status != TaskStatus::NeedsAttention {
                return Err(format!(
                    "Task {task_id} must be in needs_attention to apply {:?}",
                    action
                ));
            }
            let from = task.status;
            task.transition(target, now.clone())?;
            Ok(super::tasks::TaskMutation::changed(
                (),
                TaskEventKind::StatusTransition { from, to: target },
            ))
        })?;
        source_task_changed = true;
    }

    let result = apply_mutation(|root, snapshot| {
        let current_item = snapshot
            .items
            .iter()
            .find(|candidate| candidate.id == item_id)
            .ok_or_else(|| format!("Attention item {item_id} not found"))?;
        if current_item.status == crate::attention_core::AttentionStatus::Resolved {
            if current_item
                .resolution
                .as_ref()
                .is_some_and(|resolution| resolution.action == action)
            {
                return Ok(ApplyOutcome::NoOp);
            }
            return Err(format!(
                "Attention item {item_id} was resolved concurrently with another action"
            ));
        }
        if current_item.generation != expected_generation
            || current_item.source_revision != expected_source_revision
        {
            return Err(format!(
                "Attention item {item_id} source changed while resolving; retry with the latest item"
            ));
        }

        let now = now_iso();
        let (outcome, kind) = apply_resolve(
            snapshot,
            &item_id,
            action,
            actor.clone(),
            note.clone(),
            now.clone(),
        )?;
        if outcome == ApplyOutcome::NoOp {
            return Ok(ApplyOutcome::NoOp);
        }
        let Some(kind) = kind else {
            return Ok(ApplyOutcome::NoOp);
        };
        commit_event(root, snapshot, kind, now)?;
        Ok(ApplyOutcome::Changed)
    });

    if result.is_err() && source_task_changed {
        if let Some(task_id) = linked_task_id.as_deref() {
            if let Err(sync_error) = sync_task(task_id) {
                log::warn!(
                    "[attention-queue] failed to converge task {task_id} after resolve error: {sync_error}"
                );
            }
        }
    }
    result
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum AttentionSyncScope<'a> {
    All,
    Task(&'a str),
    Run(&'a str),
}

impl AttentionSyncScope<'_> {
    fn contains(self, item: &AttentionItem) -> bool {
        match self {
            Self::All => true,
            Self::Task(task_id) => {
                item.kind == AttentionKind::TaskAttention
                    && item.task_id.as_deref() == Some(task_id)
            }
            Self::Run(run_id) => {
                item.kind != AttentionKind::TaskAttention && item.run_id.as_deref() == Some(run_id)
            }
        }
    }
}

pub(crate) fn apply_signals(
    root: &Path,
    snapshot: &mut AttentionQueueSnapshot,
    signals: &[crate::attention_core::AttentionSignal],
) -> Result<AttentionReconcileReport, String> {
    apply_signals_scoped(root, snapshot, signals, AttentionSyncScope::All)
}

pub(crate) fn apply_signals_scoped(
    root: &Path,
    snapshot: &mut AttentionQueueSnapshot,
    signals: &[crate::attention_core::AttentionSignal],
    scope: AttentionSyncScope<'_>,
) -> Result<AttentionReconcileReport, String> {
    let mut report = AttentionReconcileReport::default();
    let now = now_iso();
    let active_keys: std::collections::HashSet<String> = signals
        .iter()
        .map(|signal| signal.stable_key.clone())
        .collect();

    for signal in signals {
        let (outcome, kind) = upsert_signal(snapshot, signal.clone(), now.clone())?;
        if outcome == ApplyOutcome::Changed {
            if let Some(kind) = kind {
                match &kind {
                    AttentionEventKind::Raised { .. } => report.raised += 1,
                    AttentionEventKind::Refreshed { .. } => report.refreshed += 1,
                    AttentionEventKind::Reopened { .. } => report.reopened += 1,
                    _ => {}
                }
                commit_event(root, snapshot, kind, now.clone())?;
            }
        }
    }

    let stale_keys: Vec<String> = snapshot
        .items
        .iter()
        .filter(|item| {
            matches!(
                item.status,
                crate::attention_core::AttentionStatus::Open
                    | crate::attention_core::AttentionStatus::Acknowledged
            ) && scope.contains(item)
                && !active_keys.contains(&item.stable_key)
        })
        .map(|item| item.stable_key.clone())
        .collect();

    for stable_key in stale_keys {
        let (outcome, kind) = apply_source_cleared(snapshot, &stable_key, now.clone())?;
        if outcome == ApplyOutcome::Changed {
            report.auto_resolved += 1;
            if let Some(kind) = kind {
                commit_event(root, snapshot, kind, now.clone())?;
            }
        }
    }

    Ok(report)
}

pub(crate) fn queue_file_exists(root: &Path) -> bool {
    queue_file(root).exists()
}

#[cfg(test)]
pub(crate) fn pending_file_path(root: &Path) -> PathBuf {
    pending_file(root)
}

#[cfg(test)]
pub(crate) fn events_file_path(root: &Path) -> PathBuf {
    events_file(root)
}

#[cfg(test)]
pub(crate) fn commit_event_for_test(
    root: &Path,
    snapshot: &mut AttentionQueueSnapshot,
    kind: AttentionEventKind,
    timestamp: String,
) -> Result<(), String> {
    commit_event(root, snapshot, kind, timestamp)?;
    Ok(())
}

#[cfg(test)]
pub(crate) fn persist_pending_for_test(
    root: &Path,
    pending: &PendingAttentionMutation,
) -> Result<(), String> {
    write_json_atomic(&pending_file(root), pending)
}

#[cfg(test)]
pub(crate) fn repair_events_tail(root: &Path) -> Result<(), String> {
    repair_partial_tail(&events_file(root))
}

#[cfg(test)]
pub(crate) fn list_events_raw_for_test(path: &Path, since_seq: u64) -> Vec<AttentionEvent> {
    list_events_raw(path, since_seq)
}

#[cfg(test)]
pub(crate) type PendingMutation = PendingAttentionMutation;
