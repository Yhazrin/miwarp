use super::events::{RunJournalEvent, RunJournalEventKind};
use super::{
    AcceptedUserMessage, RecoveryAssessment, RecoveryAssessmentKind, RecoveryCursor,
    RunActionStatus, RunJournalSnapshot, RunStage, MAX_ACCEPTED_MESSAGES, MAX_ACTIONS,
    MAX_CHECKPOINTS, MAX_PENDING_APPROVALS, RUN_JOURNAL_SCHEMA_VERSION,
};
use crate::models::RunStatus;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplyOutcome {
    Changed,
    NoOp,
}

pub fn stage_for_run_status(status: RunStatus) -> RunStage {
    match status {
        RunStatus::Pending => RunStage::Starting,
        RunStatus::Running => RunStage::Executing,
        RunStatus::Idle => RunStage::Waiting,
        RunStatus::Completed => RunStage::Completed,
        RunStatus::Failed => RunStage::Failed,
        RunStatus::Stopped => RunStage::Stopped,
    }
}

pub fn init_snapshot(
    run_id: impl Into<String>,
    objective: impl Into<String>,
    stage: RunStage,
    now: impl Into<String>,
) -> RunJournalSnapshot {
    let now = now.into();
    let run_id = run_id.into();
    RunJournalSnapshot {
        schema_version: RUN_JOURNAL_SCHEMA_VERSION,
        run_id: run_id.clone(),
        objective: objective.into(),
        stage,
        plan_revision: 0,
        accepted_messages: Vec::new(),
        actions: Vec::new(),
        pending_approvals: Vec::new(),
        checkpoints: Vec::new(),
        recovery_cursor: RecoveryCursor::default(),
        recovery_assessment: RecoveryAssessment {
            kind: RecoveryAssessmentKind::NoAction,
            reason: "initialized".to_string(),
            assessed_at: now.clone(),
        },
        journal_degraded: false,
        revision: 0,
        last_journal_seq: 0,
        last_projected_bus_seq: None,
        created_at: now.clone(),
        updated_at: now,
    }
}

pub fn legal_stage_transition(from: RunStage, to: RunStage) -> bool {
    if from == to {
        return false;
    }
    match from {
        RunStage::Starting => matches!(
            to,
            RunStage::Understanding
                | RunStage::Planning
                | RunStage::Executing
                | RunStage::Completed
                | RunStage::Failed
                | RunStage::Stopped
        ),
        RunStage::Understanding => matches!(
            to,
            RunStage::Planning
                | RunStage::Executing
                | RunStage::Waiting
                | RunStage::Completed
                | RunStage::Failed
                | RunStage::Stopped
        ),
        RunStage::Planning => matches!(
            to,
            RunStage::Executing
                | RunStage::Waiting
                | RunStage::Verifying
                | RunStage::Completed
                | RunStage::Failed
                | RunStage::Stopped
        ),
        RunStage::Executing => matches!(
            to,
            RunStage::Waiting
                | RunStage::Verifying
                | RunStage::Completed
                | RunStage::Failed
                | RunStage::Stopped
        ),
        RunStage::Waiting => matches!(
            to,
            RunStage::Executing
                | RunStage::Understanding
                | RunStage::Verifying
                | RunStage::Completed
                | RunStage::Failed
                | RunStage::Stopped
        ),
        RunStage::Verifying => matches!(
            to,
            RunStage::Completed | RunStage::Executing | RunStage::Failed | RunStage::Stopped
        ),
        RunStage::Completed | RunStage::Failed | RunStage::Stopped => false,
    }
}

pub fn apply_event(
    snapshot: &mut RunJournalSnapshot,
    event: &RunJournalEventKind,
    now: impl Into<String>,
) -> Result<ApplyOutcome, String> {
    let now = now.into();
    match event {
        RunJournalEventKind::Initialized { .. } => {
            if snapshot.revision > 0 {
                return Ok(ApplyOutcome::NoOp);
            }
            touch(snapshot, now);
            Ok(ApplyOutcome::Changed)
        }
        RunJournalEventKind::UserMessageAccepted {
            client_message_id,
            text_preview,
        } => {
            if client_message_id.trim().is_empty() {
                return Err("client_message_id is required".to_string());
            }
            if snapshot
                .accepted_messages
                .iter()
                .any(|m| m.client_message_id == *client_message_id)
            {
                return Ok(ApplyOutcome::NoOp);
            }
            push_bounded(
                &mut snapshot.accepted_messages,
                MAX_ACCEPTED_MESSAGES,
                AcceptedUserMessage {
                    client_message_id: client_message_id.clone(),
                    accepted_at: now.clone(),
                    text_preview: text_preview.clone(),
                },
            );
            touch(snapshot, now);
            Ok(ApplyOutcome::Changed)
        }
        RunJournalEventKind::StageChanged { from, to } => {
            if snapshot.stage != *from {
                return Err(format!(
                    "stage mismatch: snapshot is {} but event says from {}",
                    snapshot.stage, from
                ));
            }
            if !legal_stage_transition(*from, *to) {
                return Err(format!("illegal stage transition: {from} -> {to}"));
            }
            snapshot.stage = *to;
            touch(snapshot, now);
            Ok(ApplyOutcome::Changed)
        }
        RunJournalEventKind::ActionStarted { action } => {
            if action.action_id.trim().is_empty()
                || action.tool_use_id.trim().is_empty()
                || action.tool_name.trim().is_empty()
            {
                return Err("action_id, tool_use_id and tool_name are required".to_string());
            }
            if action.status != RunActionStatus::Started {
                return Err("ActionStarted requires status=started".to_string());
            }
            if snapshot
                .actions
                .iter()
                .any(|a| a.action_id == action.action_id)
            {
                return Ok(ApplyOutcome::NoOp);
            }
            if snapshot.actions.len() >= MAX_ACTIONS {
                if let Some(index) = snapshot
                    .actions
                    .iter()
                    .position(|existing| existing.status != RunActionStatus::Started)
                {
                    snapshot.actions.remove(index);
                } else {
                    return Err(format!(
                        "action snapshot capacity exhausted by {MAX_ACTIONS} active actions"
                    ));
                }
            }
            snapshot.actions.push(action.clone());
            touch(snapshot, now);
            Ok(ApplyOutcome::Changed)
        }
        RunJournalEventKind::ActionCompleted {
            action_id,
            status,
            error,
        } => {
            let Some(record) = snapshot
                .actions
                .iter_mut()
                .find(|a| a.action_id == *action_id)
            else {
                return Err(format!("unknown action_id {action_id}"));
            };
            if record.status != RunActionStatus::Started {
                return Ok(ApplyOutcome::NoOp);
            }
            record.status = *status;
            record.completed_at = Some(now.clone());
            record.error = error.clone();
            // A completed tool action also resolves any approval record that
            // was guarding the same action, including approved prompts for
            // which the protocol has no dedicated approval-resolved event.
            snapshot
                .pending_approvals
                .retain(|approval| approval.action_id != *action_id);
            touch(snapshot, now);
            Ok(ApplyOutcome::Changed)
        }
        RunJournalEventKind::ActionMarkedUncertain { action_id, reason } => {
            let Some(record) = snapshot
                .actions
                .iter_mut()
                .find(|a| a.action_id == *action_id)
            else {
                return Err(format!("unknown action_id {action_id}"));
            };
            if record.status == RunActionStatus::Uncertain {
                return Ok(ApplyOutcome::NoOp);
            }
            record.status = RunActionStatus::Uncertain;
            record.error = Some(reason.clone());
            record.completed_at = Some(now.clone());
            touch(snapshot, now);
            Ok(ApplyOutcome::Changed)
        }
        RunJournalEventKind::ApprovalRequired { approval } => {
            if approval.request_id.trim().is_empty()
                || approval.tool_use_id.trim().is_empty()
                || approval.action_id.trim().is_empty()
            {
                return Err(
                    "approval request_id, tool_use_id and action_id are required".to_string(),
                );
            }
            if snapshot
                .pending_approvals
                .iter()
                .any(|a| a.request_id == approval.request_id)
            {
                return Ok(ApplyOutcome::NoOp);
            }
            if snapshot.pending_approvals.len() >= MAX_PENDING_APPROVALS {
                return Err(format!(
                    "pending approval capacity exhausted at {MAX_PENDING_APPROVALS} items"
                ));
            }
            snapshot.pending_approvals.push(approval.clone());
            touch(snapshot, now);
            Ok(ApplyOutcome::Changed)
        }
        RunJournalEventKind::ApprovalResolved {
            request_id,
            approved: _,
        } => {
            let before = snapshot.pending_approvals.len();
            snapshot
                .pending_approvals
                .retain(|a| a.request_id != *request_id);
            if snapshot.pending_approvals.len() == before {
                return Ok(ApplyOutcome::NoOp);
            }
            touch(snapshot, now);
            Ok(ApplyOutcome::Changed)
        }
        RunJournalEventKind::CheckpointCreated { checkpoint } => {
            if checkpoint.checkpoint_id.trim().is_empty() {
                return Err("checkpoint_id is required".to_string());
            }
            if snapshot
                .checkpoints
                .iter()
                .any(|c| c.checkpoint_id == checkpoint.checkpoint_id)
            {
                return Ok(ApplyOutcome::NoOp);
            }
            if checkpoint.cursor_seq < snapshot.recovery_cursor.cursor_seq {
                return Err("checkpoint cursor_seq regressed".to_string());
            }
            push_bounded(
                &mut snapshot.checkpoints,
                MAX_CHECKPOINTS,
                checkpoint.clone(),
            );
            snapshot.recovery_cursor.cursor_seq = checkpoint.cursor_seq;
            snapshot.recovery_cursor.last_checkpoint_id = Some(checkpoint.checkpoint_id.clone());
            touch(snapshot, now);
            Ok(ApplyOutcome::Changed)
        }
        RunJournalEventKind::RecoveryCursorAdvanced {
            cursor_seq,
            last_bus_seq,
            last_checkpoint_id,
        } => {
            if *cursor_seq < snapshot.recovery_cursor.cursor_seq {
                return Err("recovery cursor_seq regressed".to_string());
            }
            if *last_bus_seq < snapshot.recovery_cursor.last_bus_seq {
                return Err("recovery last_bus_seq regressed".to_string());
            }
            if snapshot.recovery_cursor.cursor_seq == *cursor_seq
                && snapshot.recovery_cursor.last_bus_seq == *last_bus_seq
                && snapshot.recovery_cursor.last_checkpoint_id == *last_checkpoint_id
            {
                return Ok(ApplyOutcome::NoOp);
            }
            snapshot.recovery_cursor.cursor_seq = *cursor_seq;
            snapshot.recovery_cursor.last_bus_seq = *last_bus_seq;
            snapshot.recovery_cursor.last_checkpoint_id = last_checkpoint_id.clone();
            touch(snapshot, now);
            Ok(ApplyOutcome::Changed)
        }
        RunJournalEventKind::RestartReconciled {
            from_stage,
            to_stage,
            assessment,
            reason,
        } => {
            if snapshot.stage != *from_stage {
                return Err(format!(
                    "restart reconcile stage mismatch: {} vs {}",
                    snapshot.stage, from_stage
                ));
            }
            snapshot.stage = *to_stage;
            snapshot.recovery_assessment = RecoveryAssessment {
                kind: *assessment,
                reason: reason.clone(),
                assessed_at: now.clone(),
            };
            touch(snapshot, now);
            Ok(ApplyOutcome::Changed)
        }
        RunJournalEventKind::Degraded { reason } => {
            if snapshot.journal_degraded {
                return Ok(ApplyOutcome::NoOp);
            }
            snapshot.journal_degraded = true;
            snapshot.recovery_assessment = RecoveryAssessment {
                kind: RecoveryAssessmentKind::ManualConfirmation,
                reason: reason.clone(),
                assessed_at: now.clone(),
            };
            touch(snapshot, now);
            Ok(ApplyOutcome::Changed)
        }
    }
}

fn touch(snapshot: &mut RunJournalSnapshot, now: String) {
    snapshot.revision = snapshot.revision.saturating_add(1);
    snapshot.updated_at = now;
}

fn push_bounded<T>(vec: &mut Vec<T>, cap: usize, item: T) {
    if vec.len() >= cap {
        vec.remove(0);
    }
    vec.push(item);
}

pub fn is_message_accepted(snapshot: &RunJournalSnapshot, client_message_id: &str) -> bool {
    snapshot
        .accepted_messages
        .iter()
        .any(|m| m.client_message_id == client_message_id)
}

pub fn advance_journal_seq(snapshot: &mut RunJournalSnapshot) -> u64 {
    snapshot.last_journal_seq = snapshot.last_journal_seq.saturating_add(1);
    snapshot.last_journal_seq
}

pub fn make_event(
    snapshot: &mut RunJournalSnapshot,
    run_id: &str,
    event: RunJournalEventKind,
    timestamp: String,
) -> RunJournalEvent {
    let seq = advance_journal_seq(snapshot);
    RunJournalEvent {
        id: uuid::Uuid::new_v4().to_string(),
        run_id: run_id.to_string(),
        seq,
        event,
        timestamp,
    }
}
