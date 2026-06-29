//! Run Core — pure domain model for the v1.1.0 Durable Run Journal.
//!
//! Side-effect free types, invariants, and apply logic. Persistence lives in
//! `crate::storage::run_journal`; IPC in `crate::commands::run_journal`.

use serde::{Deserialize, Serialize};

pub const RUN_JOURNAL_SCHEMA_VERSION: u32 = 1;
pub const MAX_ACCEPTED_MESSAGES: usize = 1024;
pub const MAX_ACTIONS: usize = 512;
pub const MAX_CHECKPOINTS: usize = 64;
pub const MAX_PENDING_APPROVALS: usize = 32;

mod apply;
mod events;
mod idempotency;
pub mod projector;
#[cfg(test)]
mod tests;

pub use apply::{
    apply_event, init_snapshot, is_message_accepted as snapshot_has_accepted_message,
    is_terminal_client_message, legal_stage_transition, lookup_client_message_state, make_event,
    stage_for_run_status, ApplyOutcome,
};
pub use events::{RunJournalEvent, RunJournalEventKind};
pub use idempotency::classify_tool_idempotency;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStage {
    Starting,
    Understanding,
    Planning,
    Executing,
    Waiting,
    Verifying,
    Completed,
    Failed,
    Stopped,
}

impl std::fmt::Display for RunStage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            RunStage::Starting => "starting",
            RunStage::Understanding => "understanding",
            RunStage::Planning => "planning",
            RunStage::Executing => "executing",
            RunStage::Waiting => "waiting",
            RunStage::Verifying => "verifying",
            RunStage::Completed => "completed",
            RunStage::Failed => "failed",
            RunStage::Stopped => "stopped",
        };
        f.write_str(s)
    }
}

impl RunStage {
    pub fn is_active(self) -> bool {
        matches!(
            self,
            RunStage::Starting
                | RunStage::Understanding
                | RunStage::Planning
                | RunStage::Executing
                | RunStage::Waiting
                | RunStage::Verifying
        )
    }

    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            RunStage::Completed | RunStage::Failed | RunStage::Stopped
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunActionStatus {
    Started,
    Completed,
    Failed,
    Uncertain,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunIdempotencyClass {
    ReadOnly,
    IdempotentWrite,
    NonIdempotent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryAssessmentKind {
    NoAction,
    SafeRetry,
    ManualConfirmation,
    ImpossibleResume,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunActionRecord {
    pub action_id: String,
    pub tool_name: String,
    pub tool_use_id: String,
    pub idempotency_class: RunIdempotencyClass,
    pub status: RunActionStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bus_seq_start: Option<u64>,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Lifecycle state of a `client_message_id` within a run.
///
/// This is the three-state machine that replaced the single
/// `AcceptedUserMessage` row in v1.1.0 P0-3. Transitions:
///
/// * `None` — the cid has never been recorded in the journal.
/// * `Prepared` — we durably recorded the user request *before* the
///   child was spawned. From here the dispatcher must finish the
///   transition (`record_dispatched` or `record_terminal`) — leaving a
///   `Prepared` row dangling is the crash-aware equivalent of "did the
///   spawn actually happen?".
/// * `Dispatched` — the CLI child was successfully spawned. Retries
///   resolve as accepted (idempotent re-send).
/// * `Terminal` — the request reached a final state — completed
///   naturally, was stopped by the user, or the spawn itself failed.
///   Retries MUST NOT re-spawn; the caller must inspect
///   `TerminalReason` to decide how to recover (e.g. re-send with a
///   new cid, surface the failure to the user).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ClientMessageState {
    Prepared,
    Dispatched,
    Terminal { reason: TerminalReason },
}

/// Reason a `client_message_id` reached its terminal state.
///
/// The dispatcher used to choose between Completed, UserStopped, and
/// SpawnFailed based on this enum. The actor path (session_actor) and
/// the pipe path (commands::chat::send_chat_message) MUST converge on
/// the same vocabulary so the frontend can render a stable copy.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TerminalReason {
    Completed,
    UserStopped,
    SpawnFailed { message: String },
}

impl TerminalReason {
    /// Stable string used in the typed error prefix.
    pub fn as_str(&self) -> &'static str {
        match self {
            TerminalReason::Completed => "completed",
            TerminalReason::UserStopped => "user_stopped",
            TerminalReason::SpawnFailed { .. } => "spawn_failed",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AcceptedUserMessage {
    pub client_message_id: String,
    pub accepted_at: String,
    /// Lifecycle state of this cid. Pre-P0-3 journals (without a
    /// `state` field) deserialize as `ClientMessageState::Dispatched`
    /// because the historical `record_accepted_message` only fired
    /// *after* the actor confirmed the spawn — which matches the
    /// `Dispatched` semantics, not `Prepared`.
    #[serde(default = "legacy_default_dispatched")]
    pub state: ClientMessageState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_preview: Option<String>,
}

fn legacy_default_dispatched() -> ClientMessageState {
    // Old P0-5 journals only ever persisted a cid once stdin / spawn
    // had been confirmed, which semantically maps to Dispatched. New
    // writes stamp the explicit state, so this default is only
    // consulted when reading pre-P0-3 snapshots.
    ClientMessageState::Dispatched
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct RecoveryCursor {
    pub cursor_seq: u64,
    pub last_bus_seq: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_checkpoint_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunCheckpoint {
    pub checkpoint_id: String,
    pub cursor_seq: u64,
    pub stage: RunStage,
    pub plan_revision: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PendingApproval {
    pub request_id: String,
    pub tool_name: String,
    pub tool_use_id: String,
    pub action_id: String,
    pub raised_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecoveryAssessment {
    pub kind: RecoveryAssessmentKind,
    pub reason: String,
    pub assessed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunJournalSnapshot {
    pub schema_version: u32,
    pub run_id: String,
    pub objective: String,
    pub stage: RunStage,
    pub plan_revision: u32,
    #[serde(default)]
    pub accepted_messages: Vec<AcceptedUserMessage>,
    #[serde(default)]
    pub actions: Vec<RunActionRecord>,
    #[serde(default)]
    pub pending_approvals: Vec<PendingApproval>,
    #[serde(default)]
    pub checkpoints: Vec<RunCheckpoint>,
    pub recovery_cursor: RecoveryCursor,
    pub recovery_assessment: RecoveryAssessment,
    pub journal_degraded: bool,
    pub revision: u64,
    pub last_journal_seq: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_projected_bus_seq: Option<u64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunJournalReconcileReport {
    pub scanned: u32,
    pub recovered_pending_mutations: u32,
    pub restart_reconciled: u32,
    pub marked_uncertain: u32,
    pub impossible_resume: u32,
    pub unchanged: u32,
    pub failures: Vec<String>,
}

/// Structured error prefix when stdin succeeded but journal persistence failed.
pub const AMBIGUOUS_ACCEPTANCE_PREFIX: &str = "AMBIGUOUS_ACCEPTANCE";
/// Stable fail-closed error prefix when durable deduplication cannot be read.
pub const JOURNAL_DEDUPE_UNAVAILABLE_PREFIX: &str = "JOURNAL_DEDUPE_UNAVAILABLE";
