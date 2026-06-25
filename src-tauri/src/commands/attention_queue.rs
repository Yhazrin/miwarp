//! Thin Tauri boundary for the durable Attention Queue.
//!
//! Mutation commands emit an `attention_queue_changed` realtime event so the
//! frontend store can incrementally refresh without polling. The shared
//! emitter helper is used so both Tauri command dispatch and the embedded
//! web server dispatcher behave identically.

use crate::attention_core::AttentionEvent;
use crate::attention_core::{AttentionAction, AttentionQueueSnapshot, AttentionReconcileReport};
use crate::storage;
use crate::web_server::broadcaster::BroadcastEmitter;

pub(crate) fn emit_changed(emitter: &BroadcastEmitter) {
    emitter.emit_realtime("attention_queue_changed", &serde_json::json!({}), None);
}

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
    emitter: tauri::State<'_, BroadcastEmitter>,
) -> Result<AttentionQueueSnapshot, String> {
    let snapshot = storage::attention_queue::acknowledge(&id, actor)?;
    emit_changed(&emitter);
    Ok(snapshot)
}

#[tauri::command]
pub fn attention_queue_resolve(
    id: String,
    action: AttentionAction,
    actor: Option<String>,
    note: Option<String>,
    emitter: tauri::State<'_, BroadcastEmitter>,
) -> Result<AttentionQueueSnapshot, String> {
    let snapshot = storage::attention_queue::resolve(&id, action, actor, note)?;
    emit_changed(&emitter);
    Ok(snapshot)
}

#[tauri::command]
pub fn attention_queue_reconcile(
    emitter: tauri::State<'_, BroadcastEmitter>,
) -> Result<AttentionReconcileReport, String> {
    let report = storage::attention_queue::reconcile()?;
    emit_changed(&emitter);
    Ok(report)
}
