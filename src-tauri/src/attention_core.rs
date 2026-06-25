//! Attention Queue — pure domain model for durable HITL attention items.
//!
//! Side-effect free types, stable keys, signal projection, and apply logic.
//! Persistence lives in `crate::storage::attention_queue`; IPC in
//! `crate::commands::attention_queue`.

use serde::{Deserialize, Serialize};

pub const ATTENTION_QUEUE_SCHEMA_VERSION: u32 = 1;
pub const MAX_ATTENTION_ITEMS: usize = 4096;

mod events;
#[cfg(test)]
mod tests;

pub use events::{
    apply_acknowledge, apply_event, apply_resolve, apply_source_cleared, init_snapshot, make_event,
    upsert_signal, ApplyOutcome, AttentionEvent, AttentionEventKind,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "snake_case")]
pub enum AttentionKind {
    TaskAttention,
    PendingApproval,
    ManualConfirmation,
    ImpossibleResume,
    JournalDegraded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "snake_case")]
pub enum AttentionSeverity {
    Warning,
    Blocking,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "snake_case")]
pub enum AttentionStatus {
    Open,
    Acknowledged,
    Resolved,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "snake_case")]
pub enum AttentionAction {
    Acknowledge,
    RetryTask,
    MarkTaskFailed,
    ConfirmCompleted,
    ConfirmNotCompleted,
    AcceptRisk,
    Dismiss,
    SourceCleared,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AttentionResolution {
    pub action: AttentionAction,
    pub actor: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub source_revision: u64,
    pub resolved_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AttentionItem {
    pub id: String,
    pub stable_key: String,
    pub kind: AttentionKind,
    pub severity: AttentionSeverity,
    pub status: AttentionStatus,
    pub title: String,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_id: Option<String>,
    pub source_revision: u64,
    pub allowed_actions: Vec<AttentionAction>,
    pub generation: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution: Option<AttentionResolution>,
    pub created_at: String,
    pub updated_at: String,
    pub last_seen_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AttentionQueueSnapshot {
    pub schema_version: u32,
    pub items: Vec<AttentionItem>,
    pub revision: u64,
    pub last_event_seq: u64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AttentionSignal {
    pub stable_key: String,
    pub kind: AttentionKind,
    pub severity: AttentionSeverity,
    pub title: String,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_id: Option<String>,
    pub source_revision: u64,
    pub allowed_actions: Vec<AttentionAction>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct AttentionReconcileReport {
    pub scanned_tasks: u32,
    pub scanned_runs: u32,
    pub raised: u32,
    pub refreshed: u32,
    pub reopened: u32,
    pub auto_resolved: u32,
    pub recovered_pending_mutations: u32,
    pub failures: Vec<String>,
}

pub fn stable_key_task(task_id: &str) -> String {
    format!("task_attention:task:{task_id}")
}

pub fn stable_key_pending_approval(run_id: &str, request_id: &str) -> String {
    format!("pending_approval:run:{run_id}:request:{request_id}")
}

pub fn stable_key_manual_confirmation(run_id: &str) -> String {
    format!("manual_confirmation:run:{run_id}")
}

pub fn stable_key_impossible_resume(run_id: &str) -> String {
    format!("impossible_resume:run:{run_id}")
}

pub fn stable_key_journal_degraded(run_id: &str) -> String {
    format!("journal_degraded:run:{run_id}")
}

pub fn allowed_actions_for(kind: AttentionKind, task_id: Option<&str>) -> Vec<AttentionAction> {
    match kind {
        AttentionKind::TaskAttention => vec![
            AttentionAction::Acknowledge,
            AttentionAction::RetryTask,
            AttentionAction::MarkTaskFailed,
        ],
        AttentionKind::PendingApproval => vec![AttentionAction::Acknowledge],
        AttentionKind::ManualConfirmation => vec![
            AttentionAction::Acknowledge,
            AttentionAction::ConfirmCompleted,
            AttentionAction::ConfirmNotCompleted,
        ],
        AttentionKind::ImpossibleResume => {
            let mut actions = vec![AttentionAction::Acknowledge, AttentionAction::AcceptRisk];
            if task_id.is_some() {
                actions.push(AttentionAction::MarkTaskFailed);
            }
            actions
        }
        AttentionKind::JournalDegraded => {
            vec![AttentionAction::Acknowledge, AttentionAction::AcceptRisk]
        }
    }
}

pub fn is_user_resolve_action(action: AttentionAction) -> bool {
    !matches!(
        action,
        AttentionAction::Acknowledge | AttentionAction::SourceCleared
    )
}

pub fn pending_approval_blocks_resolve(kind: AttentionKind, action: AttentionAction) -> bool {
    kind == AttentionKind::PendingApproval && is_user_resolve_action(action)
}
