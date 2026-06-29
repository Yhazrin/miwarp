use super::{
    ClientMessageState, PendingApproval, RecoveryAssessmentKind, RunActionRecord, RunActionStatus,
    RunCheckpoint, RunStage,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunJournalEvent {
    pub id: String,
    pub run_id: String,
    pub seq: u64,
    pub event: RunJournalEventKind,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RunJournalEventKind {
    Initialized {
        objective: String,
        stage: RunStage,
    },
    UserMessagePrepared {
        client_message_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text_preview: Option<String>,
    },
    UserMessageAccepted {
        client_message_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text_preview: Option<String>,
    },
    /// State transition event for a previously-recorded cid. Used by
    /// the P0-3 crash-aware state machine: a `Prepared` row is
    /// promoted to `Dispatched` on successful spawn, or to
    /// `Terminal{reason}` on spawn failure / completion / user stop.
    /// This event is independent of the `Prepared` event so future
    /// events (e.g. retry counters) can stay additive.
    UserMessageStateChanged {
        client_message_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        preview: Option<String>,
        state: ClientMessageState,
    },
    StageChanged {
        from: RunStage,
        to: RunStage,
    },
    ActionStarted {
        action: RunActionRecord,
    },
    ActionCompleted {
        action_id: String,
        status: RunActionStatus,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    ActionMarkedUncertain {
        action_id: String,
        reason: String,
    },
    ApprovalRequired {
        approval: PendingApproval,
    },
    ApprovalResolved {
        request_id: String,
        approved: bool,
    },
    CheckpointCreated {
        checkpoint: RunCheckpoint,
    },
    RecoveryCursorAdvanced {
        cursor_seq: u64,
        last_bus_seq: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        last_checkpoint_id: Option<String>,
    },
    RestartReconciled {
        from_stage: RunStage,
        to_stage: RunStage,
        assessment: RecoveryAssessmentKind,
        reason: String,
    },
    Degraded {
        reason: String,
    },
}
