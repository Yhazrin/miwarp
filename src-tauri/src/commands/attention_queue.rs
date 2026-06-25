//! Thin Tauri boundary for the durable Attention Queue.

use crate::attention_core::AttentionEvent;
use crate::attention_core::{AttentionAction, AttentionQueueSnapshot, AttentionReconcileReport};
use crate::storage;

#[tauri::command]
pub fn attention_queue_get() -> Result<AttentionQueueSnapshot, String> {
    storage::attention_queue::get()
}

#[tauri::command]
pub fn attention_queue_list_events(since_seq: Option<u64>) -> Result<Vec<AttentionEvent>, String> {
    storage::attention_queue::list_events(since_seq.unwrap_or(0))
}

#[tauri::command]
pub fn attention_queue_acknowledge(
    id: String,
    actor: Option<String>,
) -> Result<AttentionQueueSnapshot, String> {
    storage::attention_queue::acknowledge(&id, actor)
}

#[tauri::command]
pub fn attention_queue_resolve(
    id: String,
    action: AttentionAction,
    actor: Option<String>,
    note: Option<String>,
) -> Result<AttentionQueueSnapshot, String> {
    storage::attention_queue::resolve(&id, action, actor, note)
}

#[tauri::command]
pub fn attention_queue_reconcile() -> Result<AttentionReconcileReport, String> {
    storage::attention_queue::reconcile()
}
