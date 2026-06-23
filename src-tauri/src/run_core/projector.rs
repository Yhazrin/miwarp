//! Projects coarse semantic `BusEvent` values into run journal event kinds.

use super::apply::{apply_event, legal_stage_transition, ApplyOutcome};
use super::events::RunJournalEventKind;
use super::idempotency::classify_tool_idempotency;
use super::{PendingApproval, RunActionRecord, RunActionStatus, RunJournalSnapshot, RunStage};
use crate::models::BusEvent;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectOutcome {
    Applied,
    Ignored,
    Duplicate,
}

pub fn plan_projection(
    snapshot: &RunJournalSnapshot,
    bus_seq: u64,
    event: &BusEvent,
    now: &str,
) -> Result<(ProjectOutcome, Option<RunJournalEventKind>), String> {
    if snapshot
        .last_projected_bus_seq
        .is_some_and(|last| bus_seq <= last)
    {
        return Ok((ProjectOutcome::Duplicate, None));
    }

    let kind = match event {
        BusEvent::SessionInit { .. } => {
            if !legal_stage_transition(snapshot.stage, RunStage::Understanding) {
                return Ok((ProjectOutcome::Ignored, None));
            }
            Some(RunJournalEventKind::StageChanged {
                from: snapshot.stage,
                to: RunStage::Understanding,
            })
        }
        BusEvent::RunState { state, .. } => map_run_state(snapshot, state),
        BusEvent::ToolStart {
            tool_use_id,
            tool_name,
            ..
        } => {
            if snapshot.actions.iter().any(|a| a.action_id == *tool_use_id) {
                return Ok((ProjectOutcome::Duplicate, None));
            }
            Some(RunJournalEventKind::ActionStarted {
                action: RunActionRecord {
                    action_id: tool_use_id.clone(),
                    tool_name: tool_name.clone(),
                    tool_use_id: tool_use_id.clone(),
                    idempotency_class: classify_tool_idempotency(tool_name),
                    status: RunActionStatus::Started,
                    bus_seq_start: Some(bus_seq),
                    started_at: now.to_string(),
                    completed_at: None,
                    error: None,
                },
            })
        }
        BusEvent::ToolEnd {
            tool_use_id,
            status,
            ..
        } => {
            let mapped = if status == "error" {
                RunActionStatus::Failed
            } else {
                RunActionStatus::Completed
            };
            Some(RunJournalEventKind::ActionCompleted {
                action_id: tool_use_id.clone(),
                status: mapped,
                error: None,
            })
        }
        BusEvent::PermissionPrompt {
            request_id,
            tool_name,
            tool_use_id,
            ..
        } => Some(RunJournalEventKind::ApprovalRequired {
            approval: PendingApproval {
                request_id: request_id.clone(),
                tool_name: tool_name.clone(),
                tool_use_id: tool_use_id.clone(),
                action_id: tool_use_id.clone(),
                raised_at: now.to_string(),
            },
        }),
        BusEvent::PermissionDenied { tool_use_id, .. } => {
            let request_id = snapshot
                .pending_approvals
                .iter()
                .find(|approval| approval.tool_use_id == *tool_use_id)
                .map(|approval| approval.request_id.clone())
                .unwrap_or_else(|| tool_use_id.clone());
            Some(RunJournalEventKind::ApprovalResolved {
                request_id,
                approved: false,
            })
        }
        BusEvent::ControlCancelled { request_id, .. } => {
            Some(RunJournalEventKind::ApprovalResolved {
                request_id: request_id.clone(),
                approved: false,
            })
        }
        BusEvent::FilesPersisted { .. } => None,
        BusEvent::SessionRecovering { .. } => stage_change(snapshot, RunStage::Waiting),
        BusEvent::SessionRecovered { ok, .. } => stage_change(
            snapshot,
            if *ok {
                RunStage::Executing
            } else {
                RunStage::Failed
            },
        ),
        BusEvent::SessionLifecycle { phase, .. } => match phase.as_str() {
            "starting" => stage_change(snapshot, RunStage::Starting),
            "ready" => stage_change(snapshot, RunStage::Waiting),
            "crashed" | "respawning" => stage_change(snapshot, RunStage::Waiting),
            "stopped" | "disposed" => stage_change(snapshot, RunStage::Stopped),
            _ => None,
        },
        BusEvent::MessageDelta { .. }
        | BusEvent::MessageComplete { .. }
        | BusEvent::ThinkingDelta { .. }
        | BusEvent::ToolInputDelta { .. }
        | BusEvent::UserMessage { .. }
        | BusEvent::UsageUpdate { .. }
        | BusEvent::Raw { .. }
        | BusEvent::CompactBoundary { .. }
        | BusEvent::SystemStatus { .. }
        | BusEvent::HookStarted { .. }
        | BusEvent::HookProgress { .. }
        | BusEvent::HookResponse { .. }
        | BusEvent::TaskNotification { .. }
        | BusEvent::ToolProgress { .. }
        | BusEvent::ToolUseSummary { .. }
        | BusEvent::AuthStatus { .. }
        | BusEvent::HookCallback { .. }
        | BusEvent::CommandOutput { .. }
        | BusEvent::ElicitationPrompt { .. }
        | BusEvent::RateLimitEvent { .. }
        | BusEvent::RalphStarted { .. }
        | BusEvent::RalphIteration { .. }
        | BusEvent::RalphComplete { .. }
        | BusEvent::ProtocolDesync { .. } => return Ok((ProjectOutcome::Ignored, None)),
    };

    let Some(kind) = kind else {
        return Ok((ProjectOutcome::Ignored, None));
    };

    let mut probe = snapshot.clone();
    match apply_event(&mut probe, &kind, now) {
        Ok(ApplyOutcome::NoOp) => Ok((ProjectOutcome::Duplicate, None)),
        Ok(ApplyOutcome::Changed) => Ok((ProjectOutcome::Applied, Some(kind))),
        Err(error) => {
            log::debug!(
                "[run-journal/projector] skip bus_seq={bus_seq} for run {}: {error}",
                snapshot.run_id
            );
            Ok((ProjectOutcome::Ignored, None))
        }
    }
}

pub fn finish_projection(snapshot: &mut RunJournalSnapshot, bus_seq: u64) {
    snapshot.last_projected_bus_seq = Some(bus_seq);
    snapshot.recovery_cursor.last_bus_seq = bus_seq;
}

fn stage_change(snapshot: &RunJournalSnapshot, to: RunStage) -> Option<RunJournalEventKind> {
    if snapshot.stage == to || !legal_stage_transition(snapshot.stage, to) {
        return None;
    }
    Some(RunJournalEventKind::StageChanged {
        from: snapshot.stage,
        to,
    })
}

fn map_run_state(snapshot: &RunJournalSnapshot, state: &str) -> Option<RunJournalEventKind> {
    let to = match state {
        "pending" | "spawning" => RunStage::Starting,
        "running" => RunStage::Executing,
        "idle" => RunStage::Waiting,
        "completed" => RunStage::Completed,
        "failed" => RunStage::Failed,
        "stopped" => RunStage::Stopped,
        _ => return None,
    };
    stage_change(snapshot, to)
}

#[cfg(test)]
mod tests;
