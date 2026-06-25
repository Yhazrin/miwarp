use super::{
    AttentionAction, AttentionItem, AttentionQueueSnapshot, AttentionResolution, AttentionSignal,
    AttentionStatus, ATTENTION_QUEUE_SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AttentionEvent {
    pub id: String,
    pub seq: u64,
    pub event: AttentionEventKind,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[allow(clippy::large_enum_variant)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AttentionEventKind {
    Raised {
        item: AttentionItem,
    },
    Refreshed {
        item: AttentionItem,
    },
    Acknowledged {
        item_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        actor: Option<String>,
    },
    Resolved {
        item_id: String,
        resolution: AttentionResolution,
    },
    Reopened {
        item: AttentionItem,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplyOutcome {
    Changed,
    NoOp,
}

pub fn init_snapshot(now: impl Into<String>) -> AttentionQueueSnapshot {
    let now = now.into();
    AttentionQueueSnapshot {
        schema_version: ATTENTION_QUEUE_SCHEMA_VERSION,
        items: Vec::new(),
        revision: 0,
        last_event_seq: 0,
        created_at: now.clone(),
        updated_at: now,
    }
}

pub fn make_event(
    snapshot: &mut AttentionQueueSnapshot,
    kind: AttentionEventKind,
    timestamp: String,
) -> AttentionEvent {
    snapshot.revision = snapshot.revision.saturating_add(1);
    snapshot.last_event_seq = snapshot.last_event_seq.saturating_add(1);
    snapshot.updated_at = timestamp.clone();
    AttentionEvent {
        id: uuid::Uuid::new_v4().to_string(),
        seq: snapshot.last_event_seq,
        event: kind,
        timestamp,
    }
}

fn find_item_index(snapshot: &AttentionQueueSnapshot, stable_key: &str) -> Option<usize> {
    snapshot
        .items
        .iter()
        .position(|item| item.stable_key == stable_key)
}

fn find_item_index_by_id(snapshot: &AttentionQueueSnapshot, item_id: &str) -> Option<usize> {
    snapshot.items.iter().position(|item| item.id == item_id)
}

fn signal_matches_item(item: &AttentionItem, signal: &AttentionSignal) -> bool {
    item.source_revision == signal.source_revision
        && item.title == signal.title
        && item.summary == signal.summary
        && item.allowed_actions == signal.allowed_actions
        && item.severity == signal.severity
        && item.kind == signal.kind
}

pub fn upsert_signal(
    snapshot: &mut AttentionQueueSnapshot,
    signal: AttentionSignal,
    now: String,
) -> Result<(ApplyOutcome, Option<AttentionEventKind>), String> {
    if let Some(index) = find_item_index(snapshot, &signal.stable_key) {
        let item = &snapshot.items[index];
        match item.status {
            AttentionStatus::Open | AttentionStatus::Acknowledged => {
                if signal.source_revision < item.source_revision
                    || signal_matches_item(item, &signal)
                {
                    return Ok((ApplyOutcome::NoOp, None));
                }
                {
                    let item = &mut snapshot.items[index];
                    item.kind = signal.kind;
                    item.severity = signal.severity;
                    item.title = signal.title;
                    item.summary = signal.summary;
                    item.task_id = signal.task_id;
                    item.run_id = signal.run_id;
                    item.request_id = signal.request_id;
                    item.action_id = signal.action_id;
                    item.source_revision = signal.source_revision;
                    item.allowed_actions = signal.allowed_actions;
                    item.updated_at = now.clone();
                    item.last_seen_at = now;
                }
                return Ok((
                    ApplyOutcome::Changed,
                    Some(AttentionEventKind::Refreshed {
                        item: snapshot.items[index].clone(),
                    }),
                ));
            }
            AttentionStatus::Resolved => {
                let resolution_revision = item
                    .resolution
                    .as_ref()
                    .map(|resolution| resolution.source_revision)
                    .unwrap_or(0);
                if signal.source_revision <= resolution_revision {
                    return Ok((ApplyOutcome::NoOp, None));
                }
                let generation = item.generation.saturating_add(1);
                {
                    let item = &mut snapshot.items[index];
                    item.kind = signal.kind;
                    item.severity = signal.severity;
                    item.title = signal.title;
                    item.summary = signal.summary;
                    item.task_id = signal.task_id;
                    item.run_id = signal.run_id;
                    item.request_id = signal.request_id;
                    item.action_id = signal.action_id;
                    item.source_revision = signal.source_revision;
                    item.allowed_actions = signal.allowed_actions;
                    item.status = AttentionStatus::Open;
                    item.generation = generation;
                    item.resolution = None;
                    item.updated_at = now.clone();
                    item.last_seen_at = now;
                }
                return Ok((
                    ApplyOutcome::Changed,
                    Some(AttentionEventKind::Reopened {
                        item: snapshot.items[index].clone(),
                    }),
                ));
            }
        }
    }

    let active_items = snapshot
        .items
        .iter()
        .filter(|item| item.status != AttentionStatus::Resolved)
        .count();
    if active_items >= super::MAX_ATTENTION_ITEMS {
        return Err(format!(
            "attention queue active capacity exhausted at {} items",
            super::MAX_ATTENTION_ITEMS
        ));
    }

    let item = AttentionItem {
        id: uuid::Uuid::new_v4().to_string(),
        stable_key: signal.stable_key.clone(),
        kind: signal.kind,
        severity: signal.severity,
        status: AttentionStatus::Open,
        title: signal.title.clone(),
        summary: signal.summary.clone(),
        task_id: signal.task_id.clone(),
        run_id: signal.run_id.clone(),
        request_id: signal.request_id.clone(),
        action_id: signal.action_id.clone(),
        source_revision: signal.source_revision,
        allowed_actions: signal.allowed_actions.clone(),
        generation: 1,
        resolution: None,
        created_at: now.clone(),
        updated_at: now.clone(),
        last_seen_at: now,
    };
    snapshot.items.push(item.clone());
    Ok((
        ApplyOutcome::Changed,
        Some(AttentionEventKind::Raised { item }),
    ))
}

pub fn apply_source_cleared(
    snapshot: &mut AttentionQueueSnapshot,
    stable_key: &str,
    now: String,
) -> Result<(ApplyOutcome, Option<AttentionEventKind>), String> {
    let Some(index) = find_item_index(snapshot, stable_key) else {
        return Ok((ApplyOutcome::NoOp, None));
    };
    let item = &snapshot.items[index];
    if !matches!(
        item.status,
        AttentionStatus::Open | AttentionStatus::Acknowledged
    ) {
        return Ok((ApplyOutcome::NoOp, None));
    }
    let item_id = item.id.clone();
    let source_revision = item.source_revision;
    let resolution = AttentionResolution {
        action: AttentionAction::SourceCleared,
        actor: "system".to_string(),
        note: Some("attention source no longer present".to_string()),
        source_revision,
        resolved_at: now.clone(),
    };
    {
        let item = &mut snapshot.items[index];
        item.status = AttentionStatus::Resolved;
        item.resolution = Some(resolution.clone());
        item.updated_at = now;
    }
    Ok((
        ApplyOutcome::Changed,
        Some(AttentionEventKind::Resolved {
            item_id,
            resolution,
        }),
    ))
}

pub fn apply_acknowledge(
    snapshot: &mut AttentionQueueSnapshot,
    item_id: &str,
    actor: Option<String>,
    now: String,
) -> Result<(ApplyOutcome, Option<AttentionEventKind>), String> {
    let Some(index) = find_item_index_by_id(snapshot, item_id) else {
        return Err(format!("Attention item {item_id} not found"));
    };
    let item = &snapshot.items[index];
    if !item.allowed_actions.contains(&AttentionAction::Acknowledge) {
        return Err(format!(
            "Attention item {item_id} does not allow acknowledge"
        ));
    }
    if item.status == AttentionStatus::Acknowledged {
        return Ok((ApplyOutcome::NoOp, None));
    }
    if item.status == AttentionStatus::Resolved {
        return Err(format!("Attention item {item_id} is already resolved"));
    }
    {
        let item = &mut snapshot.items[index];
        item.status = AttentionStatus::Acknowledged;
        item.updated_at = now.clone();
    }
    Ok((
        ApplyOutcome::Changed,
        Some(AttentionEventKind::Acknowledged {
            item_id: item_id.to_string(),
            actor,
        }),
    ))
}

pub fn apply_resolve(
    snapshot: &mut AttentionQueueSnapshot,
    item_id: &str,
    action: AttentionAction,
    actor: String,
    note: Option<String>,
    now: String,
) -> Result<(ApplyOutcome, Option<AttentionEventKind>), String> {
    let Some(index) = find_item_index_by_id(snapshot, item_id) else {
        return Err(format!("Attention item {item_id} not found"));
    };
    let item = &snapshot.items[index];
    if item.status == AttentionStatus::Resolved {
        if item
            .resolution
            .as_ref()
            .is_some_and(|resolution| resolution.action == action)
        {
            return Ok((ApplyOutcome::NoOp, None));
        }
        return Err(format!(
            "Attention item {item_id} was already resolved with another action"
        ));
    }
    if !item.allowed_actions.contains(&action) {
        return Err(format!(
            "Action {:?} is not allowed for attention item {item_id}",
            action
        ));
    }
    if matches!(
        action,
        AttentionAction::Acknowledge | AttentionAction::SourceCleared
    ) {
        return Err(format!(
            "Action {:?} must use the dedicated attention path",
            action
        ));
    }
    if super::pending_approval_blocks_resolve(item.kind, action) {
        return Err(
            "Pending approval items cannot be resolved manually; acknowledge only".to_string(),
        );
    }
    let source_revision = item.source_revision;
    let resolution = AttentionResolution {
        action,
        actor,
        note,
        source_revision,
        resolved_at: now.clone(),
    };
    {
        let item = &mut snapshot.items[index];
        item.status = AttentionStatus::Resolved;
        item.resolution = Some(resolution.clone());
        item.updated_at = now;
    }
    Ok((
        ApplyOutcome::Changed,
        Some(AttentionEventKind::Resolved {
            item_id: item_id.to_string(),
            resolution,
        }),
    ))
}

pub fn apply_event(
    snapshot: &mut AttentionQueueSnapshot,
    kind: &AttentionEventKind,
    timestamp: String,
) -> Result<ApplyOutcome, String> {
    match kind {
        AttentionEventKind::Raised { item } => {
            if find_item_index(snapshot, &item.stable_key).is_some() {
                return Ok(ApplyOutcome::NoOp);
            }
            snapshot.items.push(item.clone());
            snapshot.updated_at = timestamp;
            Ok(ApplyOutcome::Changed)
        }
        AttentionEventKind::Refreshed { item } => {
            let Some(index) = find_item_index(snapshot, &item.stable_key) else {
                return Ok(ApplyOutcome::NoOp);
            };
            snapshot.items[index] = item.clone();
            snapshot.updated_at = timestamp;
            Ok(ApplyOutcome::Changed)
        }
        AttentionEventKind::Acknowledged { item_id, .. } => {
            let Some(index) = find_item_index_by_id(snapshot, item_id) else {
                return Ok(ApplyOutcome::NoOp);
            };
            snapshot.items[index].status = AttentionStatus::Acknowledged;
            snapshot.items[index].updated_at = timestamp.clone();
            snapshot.updated_at = timestamp;
            Ok(ApplyOutcome::Changed)
        }
        AttentionEventKind::Resolved {
            item_id,
            resolution,
        } => {
            let Some(index) = find_item_index_by_id(snapshot, item_id) else {
                return Ok(ApplyOutcome::NoOp);
            };
            snapshot.items[index].status = AttentionStatus::Resolved;
            snapshot.items[index].resolution = Some(resolution.clone());
            snapshot.items[index].updated_at = timestamp.clone();
            snapshot.updated_at = timestamp;
            Ok(ApplyOutcome::Changed)
        }
        AttentionEventKind::Reopened { item } => {
            let Some(index) = find_item_index(snapshot, &item.stable_key) else {
                return Ok(ApplyOutcome::NoOp);
            };
            snapshot.items[index] = item.clone();
            snapshot.updated_at = timestamp;
            Ok(ApplyOutcome::Changed)
        }
    }
}
