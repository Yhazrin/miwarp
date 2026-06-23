use super::apply::{
    apply_event, init_snapshot, is_message_accepted, legal_stage_transition, make_event,
    stage_for_run_status, ApplyOutcome,
};
use super::idempotency::classify_tool_idempotency;
use super::{
    PendingApproval, RecoveryAssessmentKind, RunActionRecord, RunActionStatus, RunCheckpoint,
    RunIdempotencyClass, RunJournalEventKind, RunStage, MAX_ACCEPTED_MESSAGES, MAX_ACTIONS,
    MAX_PENDING_APPROVALS,
};
use crate::models::RunStatus;

#[test]
fn stage_transition_validation() {
    assert!(legal_stage_transition(
        RunStage::Starting,
        RunStage::Executing
    ));
    assert!(!legal_stage_transition(
        RunStage::Completed,
        RunStage::Executing
    ));
    assert!(!legal_stage_transition(
        RunStage::Executing,
        RunStage::Executing
    ));
    for active in [
        RunStage::Starting,
        RunStage::Understanding,
        RunStage::Planning,
        RunStage::Executing,
        RunStage::Waiting,
        RunStage::Verifying,
    ] {
        assert!(
            legal_stage_transition(active, RunStage::Completed),
            "active stage {active} must be able to observe fast completion"
        );
    }
}

#[test]
fn stage_for_run_status_maps_terminal_states() {
    assert_eq!(stage_for_run_status(RunStatus::Idle), RunStage::Waiting);
    assert_eq!(stage_for_run_status(RunStatus::Failed), RunStage::Failed);
}

#[test]
fn accepted_message_dedupe_is_no_op() {
    let mut snapshot = init_snapshot("run-1", "obj", RunStage::Starting, "t0");
    let kind = RunJournalEventKind::UserMessageAccepted {
        client_message_id: "cid-1".to_string(),
        text_preview: None,
    };
    assert_eq!(
        apply_event(&mut snapshot, &kind, "t1").unwrap(),
        ApplyOutcome::Changed
    );
    let revision = snapshot.revision;
    let seq = snapshot.last_journal_seq;
    assert_eq!(
        apply_event(&mut snapshot, &kind, "t2").unwrap(),
        ApplyOutcome::NoOp
    );
    assert_eq!(snapshot.revision, revision);
    assert_eq!(snapshot.last_journal_seq, seq);
    assert!(is_message_accepted(&snapshot, "cid-1"));
}

#[test]
fn action_start_dedupe_is_no_op() {
    let mut snapshot = init_snapshot("run-1", "obj", RunStage::Executing, "t0");
    let action = RunActionRecord {
        action_id: "a1".to_string(),
        tool_name: "Read".to_string(),
        tool_use_id: "a1".to_string(),
        idempotency_class: RunIdempotencyClass::ReadOnly,
        status: RunActionStatus::Started,
        bus_seq_start: Some(1),
        started_at: "t0".to_string(),
        completed_at: None,
        error: None,
    };
    let kind = RunJournalEventKind::ActionStarted { action };
    assert_eq!(
        apply_event(&mut snapshot, &kind, "t1").unwrap(),
        ApplyOutcome::Changed
    );
    let revision = snapshot.revision;
    assert_eq!(
        apply_event(&mut snapshot, &kind, "t2").unwrap(),
        ApplyOutcome::NoOp
    );
    assert_eq!(snapshot.revision, revision);
}

#[test]
fn conservative_idempotency_classification() {
    assert_eq!(
        classify_tool_idempotency("Read"),
        RunIdempotencyClass::ReadOnly
    );
    assert_eq!(
        classify_tool_idempotency("Write"),
        RunIdempotencyClass::IdempotentWrite
    );
    assert_eq!(
        classify_tool_idempotency("Bash"),
        RunIdempotencyClass::NonIdempotent
    );
    assert_eq!(
        classify_tool_idempotency("Edit"),
        RunIdempotencyClass::NonIdempotent
    );
    assert_eq!(
        classify_tool_idempotency("Task"),
        RunIdempotencyClass::NonIdempotent
    );
    assert_eq!(
        classify_tool_idempotency("unknown_tool"),
        RunIdempotencyClass::NonIdempotent
    );
}

#[test]
fn bounded_accepted_messages_evicts_oldest() {
    let mut snapshot = init_snapshot("run-1", "obj", RunStage::Executing, "t0");
    for i in 0..=MAX_ACCEPTED_MESSAGES {
        let kind = RunJournalEventKind::UserMessageAccepted {
            client_message_id: format!("cid-{i}"),
            text_preview: None,
        };
        let _ = apply_event(&mut snapshot, &kind, format!("t{i}"));
    }
    assert_eq!(snapshot.accepted_messages.len(), MAX_ACCEPTED_MESSAGES);
    assert!(!is_message_accepted(&snapshot, "cid-0"));
    assert!(is_message_accepted(
        &snapshot,
        &format!("cid-{MAX_ACCEPTED_MESSAGES}")
    ));
}

#[test]
fn bounded_actions_evicts_oldest_completed_action() {
    let mut snapshot = init_snapshot("run-1", "obj", RunStage::Executing, "t0");
    for i in 0..MAX_ACTIONS {
        let action_id = format!("a{i}");
        apply_event(
            &mut snapshot,
            &RunJournalEventKind::ActionStarted {
                action: RunActionRecord {
                    action_id: action_id.clone(),
                    tool_name: "Read".to_string(),
                    tool_use_id: action_id.clone(),
                    idempotency_class: RunIdempotencyClass::ReadOnly,
                    status: RunActionStatus::Started,
                    bus_seq_start: Some(i as u64),
                    started_at: "t0".to_string(),
                    completed_at: None,
                    error: None,
                },
            },
            format!("t{i}"),
        )
        .unwrap();
        apply_event(
            &mut snapshot,
            &RunJournalEventKind::ActionCompleted {
                action_id,
                status: RunActionStatus::Completed,
                error: None,
            },
            format!("done-{i}"),
        )
        .unwrap();
    }

    let newest = RunJournalEventKind::ActionStarted {
        action: RunActionRecord {
            action_id: "newest".to_string(),
            tool_name: "Read".to_string(),
            tool_use_id: "newest".to_string(),
            idempotency_class: RunIdempotencyClass::ReadOnly,
            status: RunActionStatus::Started,
            bus_seq_start: None,
            started_at: "new".to_string(),
            completed_at: None,
            error: None,
        },
    };
    apply_event(&mut snapshot, &newest, "new").unwrap();
    assert_eq!(snapshot.actions.len(), MAX_ACTIONS);
    assert!(!snapshot
        .actions
        .iter()
        .any(|action| action.action_id == "a0"));
    assert!(snapshot
        .actions
        .iter()
        .any(|action| action.action_id == "newest"));
}

#[test]
fn active_actions_are_never_evicted_at_capacity() {
    let mut snapshot = init_snapshot("run-1", "obj", RunStage::Executing, "t0");
    for i in 0..MAX_ACTIONS {
        snapshot.actions.push(RunActionRecord {
            action_id: format!("active-{i}"),
            tool_name: "Read".to_string(),
            tool_use_id: format!("active-{i}"),
            idempotency_class: RunIdempotencyClass::ReadOnly,
            status: RunActionStatus::Started,
            bus_seq_start: None,
            started_at: "t0".to_string(),
            completed_at: None,
            error: None,
        });
    }
    let error = apply_event(
        &mut snapshot,
        &RunJournalEventKind::ActionStarted {
            action: RunActionRecord {
                action_id: "overflow".to_string(),
                tool_name: "Read".to_string(),
                tool_use_id: "overflow".to_string(),
                idempotency_class: RunIdempotencyClass::ReadOnly,
                status: RunActionStatus::Started,
                bus_seq_start: None,
                started_at: "t1".to_string(),
                completed_at: None,
                error: None,
            },
        },
        "t1",
    )
    .unwrap_err();
    assert!(error.contains("active actions"));
    assert_eq!(snapshot.actions.len(), MAX_ACTIONS);
    assert_eq!(snapshot.actions[0].action_id, "active-0");
}

#[test]
fn pending_approvals_are_never_silently_evicted() {
    let mut snapshot = init_snapshot("run-1", "obj", RunStage::Executing, "t0");
    for i in 0..MAX_PENDING_APPROVALS {
        snapshot.pending_approvals.push(PendingApproval {
            request_id: format!("request-{i}"),
            tool_name: "Bash".to_string(),
            tool_use_id: format!("tool-{i}"),
            action_id: format!("tool-{i}"),
            raised_at: "t0".to_string(),
        });
    }
    let error = apply_event(
        &mut snapshot,
        &RunJournalEventKind::ApprovalRequired {
            approval: PendingApproval {
                request_id: "overflow".to_string(),
                tool_name: "Bash".to_string(),
                tool_use_id: "overflow-tool".to_string(),
                action_id: "overflow-tool".to_string(),
                raised_at: "t1".to_string(),
            },
        },
        "t1",
    )
    .unwrap_err();
    assert!(error.contains("pending approval capacity"));
    assert_eq!(snapshot.pending_approvals.len(), MAX_PENDING_APPROVALS);
    assert_eq!(snapshot.pending_approvals[0].request_id, "request-0");
}

#[test]
fn checkpoint_cursor_monotonicity() {
    let mut snapshot = init_snapshot("run-1", "obj", RunStage::Executing, "t0");
    let cp1 = RunCheckpoint {
        checkpoint_id: "cp1".to_string(),
        cursor_seq: 1,
        stage: RunStage::Executing,
        plan_revision: 0,
        label: None,
        created_at: "t1".to_string(),
    };
    let _ = apply_event(
        &mut snapshot,
        &RunJournalEventKind::CheckpointCreated {
            checkpoint: cp1.clone(),
        },
        "t1",
    );
    let regressed = RunCheckpoint {
        checkpoint_id: "cp0".to_string(),
        cursor_seq: 0,
        stage: RunStage::Executing,
        plan_revision: 0,
        label: None,
        created_at: "t0".to_string(),
    };
    assert!(apply_event(
        &mut snapshot,
        &RunJournalEventKind::CheckpointCreated {
            checkpoint: regressed,
        },
        "t2",
    )
    .is_err());
    let cp2 = RunCheckpoint {
        checkpoint_id: "cp2".to_string(),
        cursor_seq: 2,
        stage: RunStage::Executing,
        plan_revision: 0,
        label: None,
        created_at: "t3".to_string(),
    };
    assert_eq!(
        apply_event(
            &mut snapshot,
            &RunJournalEventKind::CheckpointCreated { checkpoint: cp2 },
            "t3",
        )
        .unwrap(),
        ApplyOutcome::Changed
    );
    assert_eq!(snapshot.recovery_cursor.cursor_seq, 2);
}

#[test]
fn action_completion_resolves_matching_pending_approval() {
    let mut snapshot = init_snapshot("run-1", "obj", RunStage::Executing, "t0");
    snapshot.actions.push(RunActionRecord {
        action_id: "tool-1".to_string(),
        tool_name: "Bash".to_string(),
        tool_use_id: "tool-1".to_string(),
        idempotency_class: RunIdempotencyClass::NonIdempotent,
        status: RunActionStatus::Started,
        bus_seq_start: Some(1),
        started_at: "t0".to_string(),
        completed_at: None,
        error: None,
    });
    snapshot.pending_approvals.push(PendingApproval {
        request_id: "request-1".to_string(),
        tool_name: "Bash".to_string(),
        tool_use_id: "tool-1".to_string(),
        action_id: "tool-1".to_string(),
        raised_at: "t0".to_string(),
    });

    apply_event(
        &mut snapshot,
        &RunJournalEventKind::ActionCompleted {
            action_id: "tool-1".to_string(),
            status: RunActionStatus::Completed,
            error: None,
        },
        "t1",
    )
    .unwrap();

    assert!(snapshot.pending_approvals.is_empty());
}

#[test]
fn serde_roundtrip_snapshot_and_event() {
    let mut snapshot = init_snapshot("run-1", "objective", RunStage::Starting, "t0");
    let event = make_event(
        &mut snapshot,
        "run-1",
        RunJournalEventKind::Initialized {
            objective: "objective".to_string(),
            stage: RunStage::Starting,
        },
        "t0".to_string(),
    );
    let snapshot_json = serde_json::to_string(&snapshot).unwrap();
    let _: super::RunJournalSnapshot = serde_json::from_str(&snapshot_json).unwrap();
    let event_json = serde_json::to_string(&event).unwrap();
    let _: super::events::RunJournalEvent = serde_json::from_str(&event_json).unwrap();
}

#[test]
fn restart_reconciled_updates_assessment() {
    let mut snapshot = init_snapshot("run-1", "obj", RunStage::Executing, "t0");
    let kind = RunJournalEventKind::RestartReconciled {
        from_stage: RunStage::Executing,
        to_stage: RunStage::Waiting,
        assessment: RecoveryAssessmentKind::SafeRetry,
        reason: "test".to_string(),
    };
    apply_event(&mut snapshot, &kind, "t1").unwrap();
    assert_eq!(snapshot.stage, RunStage::Waiting);
    assert_eq!(
        snapshot.recovery_assessment.kind,
        RecoveryAssessmentKind::SafeRetry
    );
}
