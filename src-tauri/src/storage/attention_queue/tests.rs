use super::{
    apply_signals, apply_signals_scoped, commit_event_for_test, ensure_initialized,
    events_file_path, get_raw_in, list_events_raw_for_test, pending_file_path,
    persist_pending_for_test, recover_pending, repair_events_tail, save_snapshot,
    AttentionSyncScope, PendingMutation,
};
use crate::attention_core::{
    allowed_actions_for, apply_resolve, init_snapshot, make_event, stable_key_task, ApplyOutcome,
    AttentionAction, AttentionEventKind, AttentionKind, AttentionSeverity, AttentionSignal,
    AttentionStatus,
};
use std::fs;
use std::path::PathBuf;

fn temp_root(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "miwarp-attention-test-{name}-{}",
        uuid::Uuid::new_v4()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn wal_recovers_after_snapshot_stage() {
    let root = temp_root("wal-snapshot");
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
    let (outcome, kind) = crate::attention_core::upsert_signal(
        &mut snapshot,
        signal,
        "2026-01-01T00:00:01.000Z".to_string(),
    )
    .unwrap();
    assert_eq!(outcome, ApplyOutcome::Changed);
    let kind = kind.unwrap();
    let event = make_event(&mut snapshot, kind, "2026-01-01T00:00:01.000Z".to_string());
    persist_pending_for_test(
        &root,
        &PendingMutation {
            snapshot: snapshot.clone(),
            event,
        },
    )
    .unwrap();
    save_snapshot(&root, &snapshot).unwrap();

    recover_pending(&root).unwrap();
    assert!(!pending_file_path(&root).exists());
    let recovered = get_raw_in(&root).unwrap();
    assert_eq!(recovered.items.len(), 1);
    assert_eq!(recovered.last_event_seq, 1);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn wal_recovers_after_event_append_stage() {
    let root = temp_root("wal-event");
    let mut snapshot = init_snapshot("2026-01-01T00:00:00.000Z");
    let kind = AttentionEventKind::Raised {
        item: crate::attention_core::AttentionItem {
            id: "item-1".to_string(),
            stable_key: stable_key_task("task-1"),
            kind: AttentionKind::TaskAttention,
            severity: AttentionSeverity::Warning,
            status: AttentionStatus::Open,
            title: "Needs attention".to_string(),
            summary: "Task stalled".to_string(),
            task_id: Some("task-1".to_string()),
            run_id: None,
            request_id: None,
            action_id: None,
            source_revision: 1,
            allowed_actions: allowed_actions_for(AttentionKind::TaskAttention, Some("task-1")),
            generation: 1,
            resolution: None,
            created_at: "2026-01-01T00:00:01.000Z".to_string(),
            updated_at: "2026-01-01T00:00:01.000Z".to_string(),
            last_seen_at: "2026-01-01T00:00:01.000Z".to_string(),
        },
    };
    let event = make_event(&mut snapshot, kind, "2026-01-01T00:00:01.000Z".to_string());
    persist_pending_for_test(
        &root,
        &PendingMutation {
            snapshot: snapshot.clone(),
            event,
        },
    )
    .unwrap();

    recover_pending(&root).unwrap();
    let events = list_events_raw_for_test(&events_file_path(&root), 0);
    assert_eq!(events.len(), 1);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn bad_jsonl_tail_is_repaired() {
    let root = temp_root("jsonl-tail");
    let path = events_file_path(&root);
    fs::create_dir_all(&root).unwrap();
    fs::write(
        &path,
        b"{\"id\":\"evt\",\"seq\":1,\"timestamp\":\"t\",\"event\":{\"type\":\"acknowledged\",\"item_id\":\"i\"}}\n{\"bad",
    )
    .unwrap();
    repair_events_tail(&root).unwrap();
    let events = list_events_raw_for_test(&path, 0);
    assert_eq!(events.len(), 1);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn apply_signals_auto_source_clears_stale_items() {
    let root = temp_root("source-cleared");
    ensure_initialized(&root).unwrap();
    let mut snapshot = get_raw_in(&root).unwrap();
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
    apply_signals(&root, &mut snapshot, &[signal]).unwrap();
    assert_eq!(snapshot.items.len(), 1);

    let report = apply_signals(&root, &mut snapshot, &[]).unwrap();
    assert_eq!(report.auto_resolved, 1);
    assert_eq!(snapshot.items[0].status, AttentionStatus::Resolved);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn resolve_marks_item_resolved() {
    let root = temp_root("resolve");
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
    apply_signals(&root, &mut snapshot, &[signal]).unwrap();
    let item_id = snapshot.items[0].id.clone();
    let (outcome, kind) = apply_resolve(
        &mut snapshot,
        &item_id,
        AttentionAction::RetryTask,
        "user".to_string(),
        None,
        "2026-01-01T00:00:02.000Z".to_string(),
    )
    .unwrap();
    assert_eq!(outcome, ApplyOutcome::Changed);
    commit_event_for_test(
        &root,
        &mut snapshot,
        kind.unwrap(),
        "2026-01-01T00:00:02.000Z".to_string(),
    )
    .unwrap();
    assert_eq!(snapshot.items[0].status, AttentionStatus::Resolved);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn pending_approval_item_rejects_dismiss_resolve() {
    let root = temp_root("pending");
    let mut snapshot = init_snapshot("2026-01-01T00:00:00.000Z");
    let signal = AttentionSignal {
        stable_key: "pending_approval:run:r1:request:req1".to_string(),
        kind: AttentionKind::PendingApproval,
        severity: AttentionSeverity::Blocking,
        title: "Approval required".to_string(),
        summary: "Waiting".to_string(),
        task_id: None,
        run_id: Some("r1".to_string()),
        request_id: Some("req1".to_string()),
        action_id: Some("act1".to_string()),
        source_revision: 1,
        allowed_actions: allowed_actions_for(AttentionKind::PendingApproval, None),
    };
    apply_signals(&root, &mut snapshot, &[signal]).unwrap();
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
    let _ = fs::remove_dir_all(root);
}

#[test]
fn scoped_run_sync_does_not_clear_unrelated_items() {
    let root = temp_root("scoped-run-sync");
    ensure_initialized(&root).unwrap();
    let mut snapshot = get_raw_in(&root).unwrap();
    let make_signal = |run_id: &str| AttentionSignal {
        stable_key: format!("manual_confirmation:run:{run_id}"),
        kind: AttentionKind::ManualConfirmation,
        severity: AttentionSeverity::Blocking,
        title: format!("Run {run_id}"),
        summary: "Manual confirmation required".to_string(),
        task_id: None,
        run_id: Some(run_id.to_string()),
        request_id: None,
        action_id: None,
        source_revision: 1,
        allowed_actions: allowed_actions_for(AttentionKind::ManualConfirmation, None),
    };
    apply_signals(
        &root,
        &mut snapshot,
        &[make_signal("run-a"), make_signal("run-b")],
    )
    .unwrap();

    let report =
        apply_signals_scoped(&root, &mut snapshot, &[], AttentionSyncScope::Run("run-a")).unwrap();
    assert_eq!(report.auto_resolved, 1);
    assert_eq!(
        snapshot
            .items
            .iter()
            .find(|item| item.run_id.as_deref() == Some("run-a"))
            .unwrap()
            .status,
        AttentionStatus::Resolved
    );
    assert_eq!(
        snapshot
            .items
            .iter()
            .find(|item| item.run_id.as_deref() == Some("run-b"))
            .unwrap()
            .status,
        AttentionStatus::Open
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn scoped_task_sync_does_not_clear_unrelated_items() {
    let root = temp_root("scoped-task-sync");
    ensure_initialized(&root).unwrap();
    let mut snapshot = get_raw_in(&root).unwrap();
    let make_signal = |task_id: &str| AttentionSignal {
        stable_key: stable_key_task(task_id),
        kind: AttentionKind::TaskAttention,
        severity: AttentionSeverity::Warning,
        title: format!("Task {task_id}"),
        summary: "Needs attention".to_string(),
        task_id: Some(task_id.to_string()),
        run_id: None,
        request_id: None,
        action_id: None,
        source_revision: 1,
        allowed_actions: allowed_actions_for(AttentionKind::TaskAttention, Some(task_id)),
    };
    apply_signals(
        &root,
        &mut snapshot,
        &[make_signal("task-a"), make_signal("task-b")],
    )
    .unwrap();

    let report = apply_signals_scoped(
        &root,
        &mut snapshot,
        &[],
        AttentionSyncScope::Task("task-a"),
    )
    .unwrap();
    assert_eq!(report.auto_resolved, 1);
    assert_eq!(
        snapshot
            .items
            .iter()
            .find(|item| item.task_id.as_deref() == Some("task-a"))
            .unwrap()
            .status,
        AttentionStatus::Resolved
    );
    assert_eq!(
        snapshot
            .items
            .iter()
            .find(|item| item.task_id.as_deref() == Some("task-b"))
            .unwrap()
            .status,
        AttentionStatus::Open
    );
    let _ = fs::remove_dir_all(root);
}
