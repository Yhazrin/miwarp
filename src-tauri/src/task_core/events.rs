use super::{QualityGateVerdict, ReviewOutcome, TaskMergeDecisionKind, TaskRunRole, TaskStatus};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskEventSource {
    User,
    Runtime,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TaskEventKind {
    Created,
    StatusTransition {
        from: TaskStatus,
        to: TaskStatus,
    },
    RunLinked {
        run_id: String,
        role: TaskRunRole,
    },
    RunUnlinked {
        run_id: String,
    },
    ArtifactLinked {
        artifact_id: String,
        kind: String,
        run_id: Option<String>,
    },
    ArtifactUnlinked {
        artifact_id: String,
    },
    QualityGateUpdated {
        verdict: QualityGateVerdict,
    },
    ReviewUpdated {
        outcome: ReviewOutcome,
    },
    MergeDecisionUpdated {
        decision: TaskMergeDecisionKind,
    },
    WorktreeUpdated {
        path: String,
        branch: String,
    },
    ChangedFileTracked {
        path: String,
    },
    RestartReconciled {
        from: TaskStatus,
        to: TaskStatus,
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskEvent {
    pub id: String,
    pub task_id: String,
    pub seq: u64,
    pub source: TaskEventSource,
    pub event: TaskEventKind,
    pub timestamp: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskReconcileReport {
    pub scanned: u32,
    pub recovered_pending_mutations: u32,
    pub moved_to_needs_attention: u32,
    pub unchanged: u32,
    pub failures: Vec<String>,
}
