//! Tauri boundary for the Durable Run Journal.

use crate::run_core::RunJournalEvent;
use crate::run_core::{RunCheckpoint, RunJournalReconcileReport, RunJournalSnapshot};
use crate::storage;

#[tauri::command]
pub fn run_journal_get(run_id: String) -> Result<RunJournalSnapshot, String> {
    storage::run_journal::get_or_init(&run_id)
}

#[tauri::command]
pub fn run_journal_list_events(
    run_id: String,
    since_seq: Option<u64>,
) -> Result<Vec<RunJournalEvent>, String> {
    storage::run_journal::list_events(&run_id, since_seq.unwrap_or(0))
}

#[tauri::command]
pub fn run_checkpoint_create(
    run_id: String,
    label: Option<String>,
) -> Result<RunCheckpoint, String> {
    let label = label
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if label.as_ref().is_some_and(|value| value.len() > 256) {
        return Err("checkpoint label is too long".to_string());
    }
    storage::run_journal::create_checkpoint(&run_id, label)
}

#[tauri::command]
pub fn run_journal_reconcile() -> Result<RunJournalReconcileReport, String> {
    Ok(storage::run_journal::reconcile_after_restart())
}
