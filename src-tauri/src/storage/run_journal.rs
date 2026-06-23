//! Durable Run Journal persistence — per-run WAL separate from chat replay.
//!
//! ```text
//! ~/.miwarp/runs/<run_id>/run-journal.json
//! ~/.miwarp/runs/<run_id>/run-journal-events.jsonl
//! ~/.miwarp/runs/<run_id>/run-journal-mutation.json
//! ```

use super::durable_io::{
    append_json_line, remove_file_durable, repair_jsonl_tail, write_json_atomic,
};
use crate::models::{now_iso, BusEvent, RunMeta, RunStatus};
use crate::run_core::projector::{finish_projection, plan_projection, ProjectOutcome};
use crate::run_core::{
    apply_event, init_snapshot, make_event, snapshot_has_accepted_message, stage_for_run_status,
    ApplyOutcome, RunJournalEvent, RunJournalEventKind,
};
use crate::run_core::{
    RecoveryAssessmentKind, RunCheckpoint, RunJournalReconcileReport, RunJournalSnapshot, RunStage,
    AMBIGUOUS_ACCEPTANCE_PREFIX,
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

static JOURNAL_LOCKS: Lazy<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn validate_run_id(run_id: &str) -> Result<(), String> {
    let trimmed = run_id.trim();
    if trimmed.is_empty() {
        return Err("run_id is required".to_string());
    }
    if trimmed.len() > 128 {
        return Err("run_id is too long".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("run_id may only contain ASCII letters, numbers, '-' and '_'".to_string());
    }
    Ok(())
}

fn validate_client_message_id(client_message_id: &str) -> Result<(), String> {
    let trimmed = client_message_id.trim();
    if trimmed.is_empty() {
        return Err("client_message_id is required".to_string());
    }
    if trimmed.len() > 256 {
        return Err("client_message_id is too long".to_string());
    }
    Ok(())
}

fn lock_for(run_id: &str) -> Arc<Mutex<()>> {
    let mut map = JOURNAL_LOCKS.lock().unwrap_or_else(|e| e.into_inner());
    map.retain(|_, value| Arc::strong_count(value) > 1);
    map.entry(run_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PendingRunJournalMutation {
    snapshot: RunJournalSnapshot,
    event: RunJournalEvent,
}

fn journal_file(run_dir: &Path) -> PathBuf {
    run_dir.join("run-journal.json")
}

fn events_file(run_dir: &Path) -> PathBuf {
    run_dir.join("run-journal-events.jsonl")
}

fn pending_file(run_dir: &Path) -> PathBuf {
    run_dir.join("run-journal-mutation.json")
}

fn repair_partial_tail(path: &Path) -> Result<(), String> {
    repair_jsonl_tail::<RunJournalEvent>(path)
}

fn list_events_raw(path: &Path, since_seq: u64) -> Vec<RunJournalEvent> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };
    let mut events: Vec<RunJournalEvent> = content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<RunJournalEvent>(line).ok())
        .filter(|event| event.seq > since_seq)
        .collect();
    events.sort_by_key(|event| event.seq);
    events.dedup_by_key(|event| event.seq);
    events
}

fn event_log_has_accepted_message(run_dir: &Path, client_message_id: &str) -> bool {
    list_events_raw(&events_file(run_dir), 0)
        .iter()
        .any(|event| {
            matches!(
                &event.event,
                RunJournalEventKind::UserMessageAccepted {
                    client_message_id: accepted_id,
                    ..
                } if accepted_id == client_message_id
            )
        })
}

fn journal_has_accepted_message(
    run_dir: &Path,
    snapshot: &RunJournalSnapshot,
    client_message_id: &str,
) -> bool {
    snapshot_has_accepted_message(snapshot, client_message_id)
        || event_log_has_accepted_message(run_dir, client_message_id)
}

fn message_acceptance_status(
    run_dir: &Path,
    snapshot: &RunJournalSnapshot,
    client_message_id: &str,
) -> Result<bool, String> {
    if journal_has_accepted_message(run_dir, snapshot, client_message_id) {
        return Ok(true);
    }
    if snapshot.journal_degraded {
        return Err(format!(
            "run journal is degraded and cannot prove whether client_message_id={client_message_id} was accepted: {}",
            snapshot.recovery_assessment.reason
        ));
    }
    Ok(false)
}

fn append_event_idempotent(run_dir: &Path, event: &RunJournalEvent) -> Result<(), String> {
    let path = events_file(run_dir);
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
            "run {} journal sequence {} already belongs to another event",
            event.run_id, event.seq
        ));
    }

    append_json_line(&path, event)
}

fn remove_pending(run_dir: &Path) -> Result<(), String> {
    remove_file_durable(&pending_file(run_dir))
}

fn save_snapshot(run_dir: &Path, snapshot: &RunJournalSnapshot) -> Result<(), String> {
    write_json_atomic(&journal_file(run_dir), snapshot)
}

fn get_raw_in(run_dir: &Path) -> Option<RunJournalSnapshot> {
    let path = journal_file(run_dir);
    let content = fs::read_to_string(&path).ok()?;
    match serde_json::from_str::<RunJournalSnapshot>(&content) {
        Ok(snapshot) => Some(snapshot),
        Err(error) => {
            log::warn!("[run-journal] parse error {}: {}", path.display(), error);
            None
        }
    }
}

fn persist_pending(run_dir: &Path, pending: &PendingRunJournalMutation) -> Result<(), String> {
    write_json_atomic(&pending_file(run_dir), pending)?;
    append_event_idempotent(run_dir, &pending.event)?;
    save_snapshot(run_dir, &pending.snapshot)?;
    remove_pending(run_dir)
}

fn recover_pending(run_dir: &Path, run_id: &str) -> Result<(), String> {
    let path = pending_file(run_dir);
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("read pending run journal mutation {}: {e}", path.display()))?;
    let pending: PendingRunJournalMutation = serde_json::from_str(&content)
        .map_err(|e| format!("parse pending run journal mutation {}: {e}", path.display()))?;
    if pending.snapshot.run_id != run_id || pending.event.run_id != run_id {
        return Err(format!(
            "pending mutation identity mismatch for run {run_id}"
        ));
    }

    append_event_idempotent(run_dir, &pending.event)?;
    let current = get_raw_in(run_dir);
    if current
        .as_ref()
        .is_none_or(|snapshot| snapshot.revision < pending.snapshot.revision)
    {
        save_snapshot(run_dir, &pending.snapshot)?;
    }
    remove_pending(run_dir)
}

fn run_dir_for(run_id: &str) -> PathBuf {
    super::run_dir(run_id)
}

fn with_lock<T, F>(run_id: &str, f: F) -> Result<T, String>
where
    F: FnOnce(&Path) -> Result<T, String>,
{
    validate_run_id(run_id)?;
    let lock = lock_for(run_id);
    let _guard = lock.lock().map_err(|e| format!("run journal lock: {e}"))?;
    let run_dir = run_dir_for(run_id);
    recover_pending(&run_dir, run_id)?;
    f(&run_dir)
}

fn commit_mutation(
    run_dir: &Path,
    snapshot: &mut RunJournalSnapshot,
    kind: RunJournalEventKind,
    timestamp: String,
) -> Result<ApplyOutcome, String> {
    let mut working = snapshot.clone();
    let outcome = apply_event(&mut working, &kind, timestamp.clone())?;
    if outcome == ApplyOutcome::NoOp {
        return Ok(ApplyOutcome::NoOp);
    }
    let run_id = working.run_id.clone();
    let event = make_event(&mut working, &run_id, kind, timestamp);
    persist_pending(
        run_dir,
        &PendingRunJournalMutation {
            snapshot: working.clone(),
            event,
        },
    )?;
    *snapshot = working;
    Ok(ApplyOutcome::Changed)
}

fn load_existing_journal(
    run_dir: &Path,
    run_id: &str,
) -> Result<Option<RunJournalSnapshot>, String> {
    if let Some(snapshot) = get_raw_in(run_dir) {
        return Ok(Some(snapshot));
    }
    if journal_file(run_dir).exists() {
        return Err(format!(
            "run journal for {run_id} exists but is corrupt or unreadable"
        ));
    }
    Ok(None)
}

pub fn init_from_run_meta(meta: &RunMeta) -> Result<RunJournalSnapshot, String> {
    with_lock(&meta.id, |run_dir| {
        if let Some(existing) = load_existing_journal(run_dir, &meta.id)? {
            return Ok(existing);
        }
        let now = now_iso();
        let stage = stage_for_run_status(meta.status.clone());
        let mut snapshot = init_snapshot(&meta.id, &meta.prompt, stage, now.clone());
        let kind = RunJournalEventKind::Initialized {
            objective: meta.prompt.clone(),
            stage,
        };
        commit_mutation(run_dir, &mut snapshot, kind, now)?;
        Ok(snapshot)
    })
}

pub fn get_or_init(run_id: &str) -> Result<RunJournalSnapshot, String> {
    with_lock(run_id, |run_dir| {
        if let Some(snapshot) = load_existing_journal(run_dir, run_id)? {
            return Ok(snapshot);
        }
        let meta = super::runs::get_run(run_id)
            .ok_or_else(|| format!("Run {run_id} not found for journal lazy init"))?;
        let now = now_iso();
        let stage = stage_for_run_status(meta.status.clone());
        let mut snapshot = init_snapshot(run_id, &meta.prompt, stage, now.clone());
        let kind = RunJournalEventKind::Initialized {
            objective: meta.prompt.clone(),
            stage,
        };
        commit_mutation(run_dir, &mut snapshot, kind, now)?;
        Ok(snapshot)
    })
}

pub fn list_events(run_id: &str, since_seq: u64) -> Result<Vec<RunJournalEvent>, String> {
    let _ = get_or_init(run_id)?;
    with_lock(run_id, |run_dir| {
        let path = events_file(run_dir);
        repair_partial_tail(&path)?;
        Ok(list_events_raw(&path, since_seq))
    })
}

pub fn is_message_accepted(run_id: &str, client_message_id: &str) -> Result<bool, String> {
    validate_client_message_id(client_message_id)?;
    // Legacy runs lazily acquire a journal before deduplication. A read or
    // recovery failure is returned to the caller so dispatch can fail closed.
    let _ = get_or_init(run_id)?;
    with_lock(run_id, |run_dir| {
        let snapshot = get_raw_in(run_dir)
            .ok_or_else(|| format!("run journal snapshot unavailable for {run_id}"))?;
        message_acceptance_status(run_dir, &snapshot, client_message_id)
    })
}

pub fn record_accepted_message(
    run_id: &str,
    client_message_id: &str,
    text_preview: Option<&str>,
) -> Result<(), String> {
    validate_client_message_id(client_message_id)?;
    with_lock(run_id, |run_dir| {
        let mut snapshot = get_raw_in(run_dir)
            .ok_or_else(|| format!("run journal missing for {run_id}; call get_or_init first"))?;
        if journal_has_accepted_message(run_dir, &snapshot, client_message_id) {
            return Ok(());
        }
        let kind = RunJournalEventKind::UserMessageAccepted {
            client_message_id: client_message_id.to_string(),
            text_preview: text_preview.map(str::to_string),
        };
        match commit_mutation(run_dir, &mut snapshot, kind, now_iso()) {
            Ok(ApplyOutcome::Changed) | Ok(ApplyOutcome::NoOp) => Ok(()),
            Err(error) => Err(format!(
                "{AMBIGUOUS_ACCEPTANCE_PREFIX}: stdin already delivered for client_message_id={client_message_id}; journal persistence failed: {error}"
            )),
        }
    })
}

pub fn project_bus_event(run_id: &str, bus_seq: u64, event: &BusEvent) -> Result<(), String> {
    let result = get_or_init(run_id).and_then(|_| {
        with_lock(run_id, |run_dir| {
            let mut snapshot = match get_raw_in(run_dir) {
                Some(snapshot) => snapshot,
                None => return Ok(()),
            };
            let now = now_iso();
            let (outcome, kind) = plan_projection(&snapshot, bus_seq, event, &now)?;
            if outcome != ProjectOutcome::Applied {
                return Ok(());
            }
            let Some(kind) = kind else {
                return Ok(());
            };
            let apply_result = apply_event(&mut snapshot, &kind, now.clone())?;
            if apply_result == ApplyOutcome::NoOp {
                return Ok(());
            }
            finish_projection(&mut snapshot, bus_seq);
            let journal_event = make_event(&mut snapshot, run_id, kind, now);
            persist_pending(
                run_dir,
                &PendingRunJournalMutation {
                    snapshot: snapshot.clone(),
                    event: journal_event,
                },
            )?;
            Ok(())
        })
    });
    if let Err(error) = result {
        log::warn!(
            "[run-journal] projection failed for run_id={run_id} bus_seq={bus_seq}: {error}"
        );
        let degradation = mark_degraded(run_id, &format!("projection failed: {error}"));
        return match degradation {
            Ok(()) => Err(error),
            Err(degraded_error) => Err(format!(
                "{error}; additionally failed to mark journal degraded: {degraded_error}"
            )),
        };
    }
    Ok(())
}

pub fn create_checkpoint(run_id: &str, label: Option<String>) -> Result<RunCheckpoint, String> {
    let _ = get_or_init(run_id)?;
    with_lock(run_id, |run_dir| {
        let mut snapshot =
            get_raw_in(run_dir).ok_or_else(|| format!("run journal missing for {run_id}"))?;
        let now = now_iso();
        let cursor_seq = snapshot.recovery_cursor.cursor_seq.saturating_add(1);
        let checkpoint = RunCheckpoint {
            checkpoint_id: uuid::Uuid::new_v4().to_string(),
            cursor_seq,
            stage: snapshot.stage,
            plan_revision: snapshot.plan_revision,
            label,
            created_at: now.clone(),
        };
        let kind = RunJournalEventKind::CheckpointCreated {
            checkpoint: checkpoint.clone(),
        };
        commit_mutation(run_dir, &mut snapshot, kind, now)?;
        Ok(checkpoint)
    })
}

pub fn mark_degraded(run_id: &str, reason: &str) -> Result<(), String> {
    let _ = get_or_init(run_id)?;
    with_lock(run_id, |run_dir| {
        let mut snapshot =
            get_raw_in(run_dir).ok_or_else(|| format!("run journal missing for {run_id}"))?;
        let kind = RunJournalEventKind::Degraded {
            reason: reason.to_string(),
        };
        match commit_mutation(run_dir, &mut snapshot, kind, now_iso())? {
            ApplyOutcome::Changed | ApplyOutcome::NoOp => Ok(()),
        }
    })
}

mod reconcile;
pub use reconcile::reconcile_after_restart;
#[cfg(test)]
use reconcile::reconcile_in;

#[cfg(test)]
mod tests;
