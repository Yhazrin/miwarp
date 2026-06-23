use crate::models::BusEvent;
use crate::run_core::projector::{plan_projection, ProjectOutcome};
use crate::run_core::{
    init_snapshot, PendingApproval, RunActionStatus, RunIdempotencyClass, RunJournalEventKind,
    RunStage,
};
use serde_json::json;

#[test]
fn ignores_message_and_thinking_deltas() {
    let snapshot = init_snapshot("run-1", "obj", RunStage::Executing, "t0");
    let event = BusEvent::MessageDelta {
        run_id: "run-1".to_string(),
        text: "hello".to_string(),
        parent_tool_use_id: None,
    };
    let (outcome, kind) = plan_projection(&snapshot, 1, &event, "t1").unwrap();
    assert_eq!(outcome, ProjectOutcome::Ignored);
    assert!(kind.is_none());

    let thinking = BusEvent::ThinkingDelta {
        run_id: "run-1".to_string(),
        text: "hmm".to_string(),
        parent_tool_use_id: None,
    };
    let (outcome, _) = plan_projection(&snapshot, 2, &thinking, "t2").unwrap();
    assert_eq!(outcome, ProjectOutcome::Ignored);
}

#[test]
fn projects_tool_start_and_end() {
    let snapshot = init_snapshot("run-1", "obj", RunStage::Executing, "t0");
    let start = BusEvent::ToolStart {
        run_id: "run-1".to_string(),
        tool_use_id: "tool-1".to_string(),
        tool_name: "Read".to_string(),
        input: json!({}),
        parent_tool_use_id: None,
    };
    let (outcome, kind) = plan_projection(&snapshot, 5, &start, "t1").unwrap();
    assert_eq!(outcome, ProjectOutcome::Applied);
    assert!(matches!(
        kind,
        Some(RunJournalEventKind::ActionStarted { .. })
    ));

    let mut after_start = snapshot.clone();
    if let Some(RunJournalEventKind::ActionStarted { action }) = kind {
        after_start.actions.push(action);
    }
    let end = BusEvent::ToolEnd {
        run_id: "run-1".to_string(),
        tool_use_id: "tool-1".to_string(),
        tool_name: "Read".to_string(),
        output: json!({}),
        status: "success".to_string(),
        duration_ms: Some(10),
        parent_tool_use_id: None,
        tool_use_result: None,
    };
    let (outcome, kind) = plan_projection(&after_start, 6, &end, "t2").unwrap();
    assert_eq!(outcome, ProjectOutcome::Applied);
    assert!(matches!(
        kind,
        Some(RunJournalEventKind::ActionCompleted { .. })
    ));
}

#[test]
fn duplicate_bus_seq_is_no_op() {
    let mut snapshot = init_snapshot("run-1", "obj", RunStage::Executing, "t0");
    snapshot.last_projected_bus_seq = Some(10);
    let event = BusEvent::RunState {
        run_id: "run-1".to_string(),
        state: "idle".to_string(),
        exit_code: None,
        error: None,
    };
    let (outcome, _) = plan_projection(&snapshot, 10, &event, "t1").unwrap();
    assert_eq!(outcome, ProjectOutcome::Duplicate);
    let (outcome, _) = plan_projection(&snapshot, 9, &event, "t1").unwrap();
    assert_eq!(outcome, ProjectOutcome::Duplicate);
}

#[test]
fn read_only_tool_classified_conservatively() {
    let snapshot = init_snapshot("run-1", "obj", RunStage::Executing, "t0");
    let start = BusEvent::ToolStart {
        run_id: "run-1".to_string(),
        tool_use_id: "tool-2".to_string(),
        tool_name: "Grep".to_string(),
        input: json!({}),
        parent_tool_use_id: None,
    };
    let (_, kind) = plan_projection(&snapshot, 1, &start, "t1").unwrap();
    if let Some(RunJournalEventKind::ActionStarted { action }) = kind {
        assert_eq!(action.idempotency_class, RunIdempotencyClass::ReadOnly);
        assert_eq!(action.status, RunActionStatus::Started);
    } else {
        panic!("expected action started");
    }
}

#[test]
fn permission_denied_resolves_the_original_request_id() {
    let mut snapshot = init_snapshot("run-1", "obj", RunStage::Executing, "t0");
    snapshot.pending_approvals.push(PendingApproval {
        request_id: "request-1".to_string(),
        tool_name: "Bash".to_string(),
        tool_use_id: "tool-1".to_string(),
        action_id: "tool-1".to_string(),
        raised_at: "t0".to_string(),
    });
    let event = BusEvent::PermissionDenied {
        run_id: "run-1".to_string(),
        tool_name: "Bash".to_string(),
        tool_use_id: "tool-1".to_string(),
        tool_input: json!({}),
    };

    let (outcome, kind) = plan_projection(&snapshot, 2, &event, "t1").unwrap();
    assert_eq!(outcome, ProjectOutcome::Applied);
    assert!(matches!(
        kind,
        Some(RunJournalEventKind::ApprovalResolved {
            request_id,
            approved: false,
        }) if request_id == "request-1"
    ));
}

#[test]
fn session_init_moves_to_understanding_when_legal() {
    let snapshot = init_snapshot("run-1", "obj", RunStage::Starting, "t0");
    let event = BusEvent::SessionInit {
        run_id: "run-1".to_string(),
        session_id: None,
        model: None,
        tools: vec![],
        cwd: "/tmp".to_string(),
        slash_commands: vec![],
        mcp_servers: vec![],
        permission_mode: None,
        api_key_source: None,
        claude_code_version: None,
        output_style: None,
        agents: vec![],
        skills: vec![],
        plugins: vec![],
        plugin_errors: vec![],
        fast_mode_state: None,
    };
    let (outcome, kind) = plan_projection(&snapshot, 1, &event, "t1").unwrap();
    assert_eq!(outcome, ProjectOutcome::Applied);
    assert!(matches!(
        kind,
        Some(RunJournalEventKind::StageChanged {
            to: RunStage::Understanding,
            ..
        })
    ));
}
