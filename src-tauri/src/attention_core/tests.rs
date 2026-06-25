use super::{
    allowed_actions_for, stable_key_task, AttentionAction, AttentionKind, AttentionSeverity,
    AttentionSignal, AttentionStatus, ATTENTION_QUEUE_SCHEMA_VERSION, MAX_ATTENTION_ITEMS,
};
use crate::attention_core::{
    apply_acknowledge, apply_event, apply_resolve, apply_source_cleared, init_snapshot,
    upsert_signal, ApplyOutcome,
};

#[test]
fn schema_version_is_one() {
    assert_eq!(ATTENTION_QUEUE_SCHEMA_VERSION, 1);
}

#[test]
fn stable_key_task_format() {
    assert_eq!(stable_key_task("abc"), "task_attention:task:abc");
}

#[test]
fn allowed_actions_for_task_attention() {
    let actions = allowed_actions_for(AttentionKind::TaskAttention, Some("t1"));
    assert!(actions.contains(&AttentionAction::RetryTask));
    assert!(actions.contains(&AttentionAction::MarkTaskFailed));
}

#[test]
fn pending_approval_only_allows_acknowledge() {
    let actions = allowed_actions_for(AttentionKind::PendingApproval, None);
    assert_eq!(actions, vec![AttentionAction::Acknowledge]);
}

#[test]
fn duplicate_raise_is_refresh_not_duplicate_item() {
    let mut snapshot = init_snapshot("2026-01-01T00:00:00.000Z");
    let signal = AttentionSignal {
        stable_key: stable_key_task("task-1"),
        kind: AttentionKind::TaskAttention,
        severity: AttentionSeverity::Warning,
        title: "Needs attention".to_string(),
        summary: "Task stalled".to_string(),
        task_id: Some("task-1".to_string()),
        run_id: None,
        request_id: None,
        action_id: None,
        source_revision: 1,
        allowed_actions: allowed_actions_for(AttentionKind::TaskAttention, Some("task-1")),
    };
    let (outcome, _) = upsert_signal(
        &mut snapshot,
        signal.clone(),
        "2026-01-01T00:00:01.000Z".to_string(),
    )
    .unwrap();
    assert_eq!(outcome, ApplyOutcome::Changed);
    assert_eq!(snapshot.items.len(), 1);

    let (outcome, event) = upsert_signal(
        &mut snapshot,
        signal,
        "2026-01-01T00:00:02.000Z".to_string(),
    )
    .unwrap();
    assert_eq!(outcome, ApplyOutcome::NoOp);
    assert!(event.is_none());
    assert_eq!(snapshot.items.len(), 1);
}

#[test]
fn refresh_when_source_revision_changes() {
    let mut snapshot = init_snapshot("2026-01-01T00:00:00.000Z");
    let mut signal = AttentionSignal {
        stable_key: stable_key_task("task-1"),
        kind: AttentionKind::TaskAttention,
        severity: AttentionSeverity::Warning,
        title: "Needs attention".to_string(),
        summary: "Task stalled".to_string(),
        task_id: Some("task-1".to_string()),
        run_id: None,
        request_id: None,
        action_id: None,
        source_revision: 1,
        allowed_actions: allowed_actions_for(AttentionKind::TaskAttention, Some("task-1")),
    };
    upsert_signal(
        &mut snapshot,
        signal.clone(),
        "2026-01-01T00:00:01.000Z".to_string(),
    )
    .unwrap();
    signal.source_revision = 2;
    signal.summary = "Updated reason".to_string();
    let (outcome, event) = upsert_signal(
        &mut snapshot,
        signal,
        "2026-01-01T00:00:02.000Z".to_string(),
    )
    .unwrap();
    assert_eq!(outcome, ApplyOutcome::Changed);
    assert!(event.is_some());
    assert_eq!(snapshot.items[0].source_revision, 2);
}

#[test]
fn resolved_old_revision_does_not_reopen() {
    let mut snapshot = init_snapshot("2026-01-01T00:00:00.000Z");
    let signal = AttentionSignal {
        stable_key: stable_key_task("task-1"),
        kind: AttentionKind::TaskAttention,
        severity: AttentionSeverity::Warning,
        title: "Needs attention".to_string(),
        summary: "Task stalled".to_string(),
        task_id: Some("task-1".to_string()),
        run_id: None,
        request_id: None,
        action_id: None,
        source_revision: 5,
        allowed_actions: allowed_actions_for(AttentionKind::TaskAttention, Some("task-1")),
    };
    upsert_signal(
        &mut snapshot,
        signal.clone(),
        "2026-01-01T00:00:01.000Z".to_string(),
    )
    .unwrap();
    let item_id = snapshot.items[0].id.clone();
    apply_resolve(
        &mut snapshot,
        &item_id,
        AttentionAction::RetryTask,
        "user".to_string(),
        None,
        "2026-01-01T00:00:02.000Z".to_string(),
    )
    .unwrap();
    assert_eq!(snapshot.items[0].status, AttentionStatus::Resolved);

    let stale = AttentionSignal {
        source_revision: 5,
        ..signal
    };
    let (outcome, _) =
        upsert_signal(&mut snapshot, stale, "2026-01-01T00:00:03.000Z".to_string()).unwrap();
    assert_eq!(outcome, ApplyOutcome::NoOp);
    assert_eq!(snapshot.items[0].status, AttentionStatus::Resolved);
}

#[test]
fn repeated_resolution_is_idempotent_but_conflicting_action_is_rejected() {
    let mut snapshot = init_snapshot("2026-01-01T00:00:00.000Z");
    let signal = AttentionSignal {
        stable_key: stable_key_task("task-1"),
        kind: AttentionKind::TaskAttention,
        severity: AttentionSeverity::Warning,
        title: "Needs attention".to_string(),
        summary: "Task stalled".to_string(),
        task_id: Some("task-1".to_string()),
        run_id: None,
        request_id: None,
        action_id: None,
        source_revision: 5,
        allowed_actions: allowed_actions_for(AttentionKind::TaskAttention, Some("task-1")),
    };
    upsert_signal(
        &mut snapshot,
        signal,
        "2026-01-01T00:00:01.000Z".to_string(),
    )
    .unwrap();
    let item_id = snapshot.items[0].id.clone();
    apply_resolve(
        &mut snapshot,
        &item_id,
        AttentionAction::RetryTask,
        "user".to_string(),
        None,
        "2026-01-01T00:00:02.000Z".to_string(),
    )
    .unwrap();

    let (outcome, event) = apply_resolve(
        &mut snapshot,
        &item_id,
        AttentionAction::RetryTask,
        "user".to_string(),
        None,
        "2026-01-01T00:00:03.000Z".to_string(),
    )
    .unwrap();
    assert_eq!(outcome, ApplyOutcome::NoOp);
    assert!(event.is_none());

    let error = apply_resolve(
        &mut snapshot,
        &item_id,
        AttentionAction::MarkTaskFailed,
        "user".to_string(),
        None,
        "2026-01-01T00:00:04.000Z".to_string(),
    )
    .unwrap_err();
    assert!(error.contains("another action"));
}

#[test]
fn resolved_new_revision_reopens_with_generation_bump() {
    let mut snapshot = init_snapshot("2026-01-01T00:00:00.000Z");
    let signal = AttentionSignal {
        stable_key: stable_key_task("task-1"),
        kind: AttentionKind::TaskAttention,
        severity: AttentionSeverity::Warning,
        title: "Needs attention".to_string(),
        summary: "Task stalled".to_string(),
        task_id: Some("task-1".to_string()),
        run_id: None,
        request_id: None,
        action_id: None,
        source_revision: 5,
        allowed_actions: allowed_actions_for(AttentionKind::TaskAttention, Some("task-1")),
    };
    upsert_signal(
        &mut snapshot,
        signal.clone(),
        "2026-01-01T00:00:01.000Z".to_string(),
    )
    .unwrap();
    let item_id = snapshot.items[0].id.clone();
    apply_resolve(
        &mut snapshot,
        &item_id,
        AttentionAction::RetryTask,
        "user".to_string(),
        None,
        "2026-01-01T00:00:02.000Z".to_string(),
    )
    .unwrap();

    let newer = AttentionSignal {
        source_revision: 6,
        ..signal
    };
    let (outcome, _) =
        upsert_signal(&mut snapshot, newer, "2026-01-01T00:00:03.000Z".to_string()).unwrap();
    assert_eq!(outcome, ApplyOutcome::Changed);
    assert_eq!(snapshot.items[0].status, AttentionStatus::Open);
    assert_eq!(snapshot.items[0].generation, 2);
    assert!(snapshot.items[0].resolution.is_none());
}

#[test]
fn source_cleared_resolves_open_items() {
    let mut snapshot = init_snapshot("2026-01-01T00:00:00.000Z");
    let signal = AttentionSignal {
        stable_key: stable_key_task("task-1"),
        kind: AttentionKind::TaskAttention,
        severity: AttentionSeverity::Warning,
        title: "Needs attention".to_string(),
        summary: "Task stalled".to_string(),
        task_id: Some("task-1".to_string()),
        run_id: None,
        request_id: None,
        action_id: None,
        source_revision: 1,
        allowed_actions: allowed_actions_for(AttentionKind::TaskAttention, Some("task-1")),
    };
    upsert_signal(
        &mut snapshot,
        signal,
        "2026-01-01T00:00:01.000Z".to_string(),
    )
    .unwrap();
    let key = stable_key_task("task-1");
    let (outcome, _) =
        apply_source_cleared(&mut snapshot, &key, "2026-01-01T00:00:02.000Z".to_string()).unwrap();
    assert_eq!(outcome, ApplyOutcome::Changed);
    assert_eq!(snapshot.items[0].status, AttentionStatus::Resolved);
    assert_eq!(
        snapshot.items[0].resolution.as_ref().unwrap().action,
        AttentionAction::SourceCleared
    );
}

#[test]
fn acknowledge_is_idempotent() {
    let mut snapshot = init_snapshot("2026-01-01T00:00:00.000Z");
    let signal = AttentionSignal {
        stable_key: stable_key_task("task-1"),
        kind: AttentionKind::TaskAttention,
        severity: AttentionSeverity::Warning,
        title: "Needs attention".to_string(),
        summary: "Task stalled".to_string(),
        task_id: Some("task-1".to_string()),
        run_id: None,
        request_id: None,
        action_id: None,
        source_revision: 1,
        allowed_actions: allowed_actions_for(AttentionKind::TaskAttention, Some("task-1")),
    };
    upsert_signal(
        &mut snapshot,
        signal,
        "2026-01-01T00:00:01.000Z".to_string(),
    )
    .unwrap();
    let item_id = snapshot.items[0].id.clone();
    let (outcome, _) = apply_acknowledge(
        &mut snapshot,
        &item_id,
        Some("operator".to_string()),
        "2026-01-01T00:00:02.000Z".to_string(),
    )
    .unwrap();
    assert_eq!(outcome, ApplyOutcome::Changed);
    let (outcome, _) = apply_acknowledge(
        &mut snapshot,
        &item_id,
        Some("operator".to_string()),
        "2026-01-01T00:00:03.000Z".to_string(),
    )
    .unwrap();
    assert_eq!(outcome, ApplyOutcome::NoOp);
}

#[test]
fn pending_approval_rejects_manual_resolve() {
    let mut snapshot = init_snapshot("2026-01-01T00:00:00.000Z");
    let signal = AttentionSignal {
        stable_key: "pending_approval:run:r1:request:req1".to_string(),
        kind: AttentionKind::PendingApproval,
        severity: AttentionSeverity::Blocking,
        title: "Approval required".to_string(),
        summary: "Tool needs approval".to_string(),
        task_id: None,
        run_id: Some("r1".to_string()),
        request_id: Some("req1".to_string()),
        action_id: Some("act1".to_string()),
        source_revision: 1,
        allowed_actions: allowed_actions_for(AttentionKind::PendingApproval, None),
    };
    upsert_signal(
        &mut snapshot,
        signal,
        "2026-01-01T00:00:01.000Z".to_string(),
    )
    .unwrap();
    let item_id = snapshot.items[0].id.clone();
    let error = apply_resolve(
        &mut snapshot,
        &item_id,
        AttentionAction::Dismiss,
        "user".to_string(),
        None,
        "2026-01-01T00:00:02.000Z".to_string(),
    )
    .unwrap_err();
    assert!(error.contains("not allowed"));
}

#[test]
fn serde_roundtrip_snapshot_and_event() {
    let mut snapshot = init_snapshot("2026-01-01T00:00:00.000Z");
    let signal = AttentionSignal {
        stable_key: stable_key_task("task-1"),
        kind: AttentionKind::TaskAttention,
        severity: AttentionSeverity::Warning,
        title: "Needs attention".to_string(),
        summary: "Task stalled".to_string(),
        task_id: Some("task-1".to_string()),
        run_id: None,
        request_id: None,
        action_id: None,
        source_revision: 1,
        allowed_actions: allowed_actions_for(AttentionKind::TaskAttention, Some("task-1")),
    };
    upsert_signal(
        &mut snapshot,
        signal,
        "2026-01-01T00:00:01.000Z".to_string(),
    )
    .unwrap();
    let json = serde_json::to_string(&snapshot).unwrap();
    let decoded: crate::attention_core::AttentionQueueSnapshot =
        serde_json::from_str(&json).unwrap();
    assert_eq!(decoded, snapshot);
}

#[test]
fn older_signal_cannot_downgrade_open_item() {
    let mut snapshot = init_snapshot("2026-01-01T00:00:00.000Z");
    let current = AttentionSignal {
        stable_key: stable_key_task("task-1"),
        kind: AttentionKind::TaskAttention,
        severity: AttentionSeverity::Warning,
        title: "Current".to_string(),
        summary: "Current reason".to_string(),
        task_id: Some("task-1".to_string()),
        run_id: None,
        request_id: None,
        action_id: None,
        source_revision: 5,
        allowed_actions: allowed_actions_for(AttentionKind::TaskAttention, Some("task-1")),
    };
    upsert_signal(
        &mut snapshot,
        current.clone(),
        "2026-01-01T00:00:01.000Z".to_string(),
    )
    .unwrap();
    let older = AttentionSignal {
        source_revision: 4,
        title: "Stale".to_string(),
        summary: "Stale reason".to_string(),
        ..current
    };
    let (outcome, event) =
        upsert_signal(&mut snapshot, older, "2026-01-01T00:00:02.000Z".to_string()).unwrap();
    assert_eq!(outcome, ApplyOutcome::NoOp);
    assert!(event.is_none());
    assert_eq!(snapshot.items[0].source_revision, 5);
    assert_eq!(snapshot.items[0].title, "Current");
}

#[test]
fn refreshed_event_replays_complete_item_state() {
    let mut live = init_snapshot("2026-01-01T00:00:00.000Z");
    let original = AttentionSignal {
        stable_key: stable_key_task("task-1"),
        kind: AttentionKind::TaskAttention,
        severity: AttentionSeverity::Warning,
        title: "Original".to_string(),
        summary: "Original reason".to_string(),
        task_id: Some("task-1".to_string()),
        run_id: None,
        request_id: None,
        action_id: None,
        source_revision: 1,
        allowed_actions: allowed_actions_for(AttentionKind::TaskAttention, Some("task-1")),
    };
    upsert_signal(
        &mut live,
        original.clone(),
        "2026-01-01T00:00:01.000Z".to_string(),
    )
    .unwrap();
    let mut replay = live.clone();
    let refreshed = AttentionSignal {
        severity: AttentionSeverity::Blocking,
        title: "Updated".to_string(),
        summary: "Updated reason".to_string(),
        run_id: Some("run-1".to_string()),
        action_id: Some("action-1".to_string()),
        source_revision: 2,
        ..original
    };
    let (_, event) =
        upsert_signal(&mut live, refreshed, "2026-01-01T00:00:02.000Z".to_string()).unwrap();
    apply_event(
        &mut replay,
        &event.unwrap(),
        "2026-01-01T00:00:02.000Z".to_string(),
    )
    .unwrap();
    assert_eq!(replay.items, live.items);
}

#[test]
fn resolved_history_does_not_exhaust_active_capacity() {
    let mut snapshot = init_snapshot("2026-01-01T00:00:00.000Z");
    let seed = AttentionSignal {
        stable_key: stable_key_task("seed"),
        kind: AttentionKind::TaskAttention,
        severity: AttentionSeverity::Warning,
        title: "Seed".to_string(),
        summary: "Seed".to_string(),
        task_id: Some("seed".to_string()),
        run_id: None,
        request_id: None,
        action_id: None,
        source_revision: 1,
        allowed_actions: allowed_actions_for(AttentionKind::TaskAttention, Some("seed")),
    };
    upsert_signal(&mut snapshot, seed, "2026-01-01T00:00:01.000Z".to_string()).unwrap();
    apply_source_cleared(
        &mut snapshot,
        &stable_key_task("seed"),
        "2026-01-01T00:00:02.000Z".to_string(),
    )
    .unwrap();
    let template = snapshot.items[0].clone();
    snapshot.items = (0..MAX_ATTENTION_ITEMS)
        .map(|index| {
            let mut item = template.clone();
            item.id = format!("resolved-{index}");
            item.stable_key = stable_key_task(&format!("resolved-{index}"));
            item
        })
        .collect();

    let next = AttentionSignal {
        stable_key: stable_key_task("next"),
        kind: AttentionKind::TaskAttention,
        severity: AttentionSeverity::Warning,
        title: "Next".to_string(),
        summary: "Next".to_string(),
        task_id: Some("next".to_string()),
        run_id: None,
        request_id: None,
        action_id: None,
        source_revision: 1,
        allowed_actions: allowed_actions_for(AttentionKind::TaskAttention, Some("next")),
    };
    let (outcome, _) =
        upsert_signal(&mut snapshot, next, "2026-01-01T00:00:03.000Z".to_string()).unwrap();
    assert_eq!(outcome, ApplyOutcome::Changed);
    assert_eq!(snapshot.items.len(), MAX_ATTENTION_ITEMS + 1);
}

#[test]
fn active_capacity_fails_closed() {
    let mut snapshot = init_snapshot("2026-01-01T00:00:00.000Z");
    let signal = AttentionSignal {
        stable_key: stable_key_task("seed"),
        kind: AttentionKind::TaskAttention,
        severity: AttentionSeverity::Warning,
        title: "Seed".to_string(),
        summary: "Seed".to_string(),
        task_id: Some("seed".to_string()),
        run_id: None,
        request_id: None,
        action_id: None,
        source_revision: 1,
        allowed_actions: allowed_actions_for(AttentionKind::TaskAttention, Some("seed")),
    };
    upsert_signal(
        &mut snapshot,
        signal.clone(),
        "2026-01-01T00:00:01.000Z".to_string(),
    )
    .unwrap();
    let template = snapshot.items[0].clone();
    snapshot.items = (0..MAX_ATTENTION_ITEMS)
        .map(|index| {
            let mut item = template.clone();
            item.id = format!("active-{index}");
            item.stable_key = stable_key_task(&format!("active-{index}"));
            item
        })
        .collect();
    let error = upsert_signal(
        &mut snapshot,
        AttentionSignal {
            stable_key: stable_key_task("overflow"),
            task_id: Some("overflow".to_string()),
            ..signal
        },
        "2026-01-01T00:00:02.000Z".to_string(),
    )
    .unwrap_err();
    assert!(error.contains("active capacity exhausted"));
}

#[test]
fn pending_approval_rejects_tampered_resolve_actions() {
    let mut snapshot = init_snapshot("2026-01-01T00:00:00.000Z");
    let signal = AttentionSignal {
        stable_key: "pending_approval:run:r1:request:req1".to_string(),
        kind: AttentionKind::PendingApproval,
        severity: AttentionSeverity::Blocking,
        title: "Approval required".to_string(),
        summary: "Tool needs approval".to_string(),
        task_id: None,
        run_id: Some("r1".to_string()),
        request_id: Some("req1".to_string()),
        action_id: Some("act1".to_string()),
        source_revision: 1,
        allowed_actions: vec![AttentionAction::Acknowledge, AttentionAction::Dismiss],
    };
    upsert_signal(
        &mut snapshot,
        signal,
        "2026-01-01T00:00:01.000Z".to_string(),
    )
    .unwrap();
    let item_id = snapshot.items[0].id.clone();
    let error = apply_resolve(
        &mut snapshot,
        &item_id,
        AttentionAction::Dismiss,
        "user".to_string(),
        None,
        "2026-01-01T00:00:02.000Z".to_string(),
    )
    .unwrap_err();
    assert!(error.contains("cannot be resolved manually"));
}
