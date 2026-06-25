//! Thin Tauri boundary for the durable Attention Queue.
//!
//! Mutation commands emit an `attention_queue_changed` realtime event so the
//! frontend store can incrementally refresh without polling, and a typed
//! `BusEvent::AttentionChanged` A-class event for replay/audit. The shared
//! emitter helper is used so both Tauri command dispatch and the embedded
//! web server dispatcher behave identically.

use crate::attention_core::{
    AttentionAction, AttentionEvent, AttentionQueueSnapshot, AttentionReconcileReport,
    AttentionStatus,
};
use crate::models::BusEvent;
use crate::storage;
use crate::web_server::broadcaster::BroadcastEmitter;

/// Emit both the lossy realtime hint and the typed A-class BusEvent.
/// `last_changed_key` is propagated when the snapshot's last item is known
/// (acknowledge / resolve) so the frontend can correlate without refetching
/// the full snapshot in the common case.
pub(crate) fn emit_changed(
    emitter: &BroadcastEmitter,
    snapshot: &AttentionQueueSnapshot,
    last_changed_key: Option<String>,
) {
    let mut open_count: u32 = 0;
    let mut acknowledged_count: u32 = 0;
    let mut resolved_count: u32 = 0;
    for item in &snapshot.items {
        match item.status {
            AttentionStatus::Open => open_count += 1,
            AttentionStatus::Acknowledged => acknowledged_count += 1,
            AttentionStatus::Resolved => resolved_count += 1,
        }
    }

    let event = BusEvent::AttentionChanged {
        revision: snapshot.revision,
        last_event_seq: snapshot.last_event_seq,
        open_count,
        acknowledged_count,
        resolved_count,
        last_changed_key,
    };

    // A-class: persist for replay / audit.
    emitter.persist_and_emit(&format!("attention:{}", snapshot.revision), &event);
    // B-class: lightweight realtime hint for fast UI refresh.
    emitter.emit_realtime(
        "attention_queue_changed",
        &serde_json::json!({
            "revision": snapshot.revision,
            "last_event_seq": snapshot.last_event_seq,
        }),
        None,
    );
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
    let snapshot = storage::attention_queue::acknowledge(&id, actor.clone())?;
    emit_changed(&emitter, &snapshot, Some(id.clone()));
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
    emit_changed(&emitter, &snapshot, Some(id.clone()));
    Ok(snapshot)
}

#[tauri::command]
pub fn attention_queue_reconcile(
    emitter: tauri::State<'_, BroadcastEmitter>,
) -> Result<AttentionReconcileReport, String> {
    let report = storage::attention_queue::reconcile()?;
    // Reconcile returns a report, not a snapshot. Refetch the snapshot to
    // emit a typed AttentionChanged event with the latest counts.
    if let Ok(snapshot) = storage::attention_queue::get() {
        emit_changed(&emitter, &snapshot, None);
    } else {
        // Fallback to the lossy realtime hint so the frontend can still
        // refresh; the A-class event is best-effort here.
        emitter.emit_realtime("attention_queue_changed", &serde_json::json!({}), None);
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::attention_core::{
        AttentionAction, AttentionItem, AttentionKind, AttentionQueueSnapshot, AttentionSeverity,
        AttentionStatus,
    };
    use crate::models::now_epoch_ms;

    fn fake_item(key: &str, status: AttentionStatus) -> AttentionItem {
        AttentionItem {
            id: format!("id-{key}"),
            stable_key: key.to_string(),
            kind: AttentionKind::PendingApproval,
            severity: AttentionSeverity::Warning,
            title: "t".to_string(),
            summary: "s".to_string(),
            task_id: None,
            run_id: None,
            request_id: None,
            action_id: None,
            status,
            source_revision: 0,
            allowed_actions: vec![AttentionAction::Acknowledge],
            generation: 0,
            resolution: None,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
            last_seen_at: "now".to_string(),
        }
    }

    fn empty_snapshot() -> AttentionQueueSnapshot {
        AttentionQueueSnapshot {
            schema_version: 1,
            items: Vec::new(),
            revision: 1,
            last_event_seq: 1,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        }
    }

    #[test]
    fn attention_changed_counts_match_snapshot_items() {
        let snap = AttentionQueueSnapshot {
            items: vec![
                fake_item("open-1", AttentionStatus::Open),
                fake_item("open-2", AttentionStatus::Open),
                fake_item("ack-1", AttentionStatus::Acknowledged),
                fake_item("res-1", AttentionStatus::Resolved),
            ],
            ..empty_snapshot()
        };
        let mut open = 0;
        let mut ack = 0;
        let mut res = 0;
        for item in &snap.items {
            match item.status {
                AttentionStatus::Open => open += 1,
                AttentionStatus::Acknowledged => ack += 1,
                AttentionStatus::Resolved => res += 1,
            }
        }
        assert_eq!(open, 2);
        assert_eq!(ack, 1);
        assert_eq!(res, 1);
    }

    #[test]
    fn attention_changed_payload_carries_revision_and_seq() {
        let snap = AttentionQueueSnapshot {
            revision: 42,
            last_event_seq: 99,
            ..empty_snapshot()
        };
        let event = BusEvent::AttentionChanged {
            revision: snap.revision,
            last_event_seq: snap.last_event_seq,
            open_count: 0,
            acknowledged_count: 0,
            resolved_count: 0,
            last_changed_key: Some("k".to_string()),
        };
        if let BusEvent::AttentionChanged {
            revision,
            last_event_seq,
            last_changed_key,
            ..
        } = event
        {
            assert_eq!(revision, 42);
            assert_eq!(last_event_seq, 99);
            assert_eq!(last_changed_key.as_deref(), Some("k"));
        } else {
            panic!("wrong variant");
        }
    }

    #[test]
    fn now_epoch_ms_returns_recent_unix_ms() {
        let ms = now_epoch_ms();
        let now = chrono::Utc::now().timestamp_millis() as u64;
        assert!(ms <= now);
        assert!(now - ms < 5_000);
    }
}
