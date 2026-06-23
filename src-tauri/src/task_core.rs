//! Task Core — pure domain model for the v1.1.0 Task Core layer.
//!
//! This module is intentionally side-effect free. It defines the shapes
//! (`TaskRecord`, `TaskStatus`, `TaskRunLink`, …) and the invariants
//! (status transition graph, run/artifact link dedup, `updated_at` touch)
//! that downstream surfaces (commands, storage, future Worktree Task Lab,
//! Quality Gate, Artifact Center, Attention Queue) all share.
//!
//! Persistence and IPC live in `crate::storage::tasks` and
//! `crate::commands::tasks` respectively. The split keeps this file cheap
//! to test and easy to reason about: the domain types don't depend on
//! `tauri`, `serde_json::Value` in a hot path, or the filesystem.

use serde::{Deserialize, Serialize};

// ── Status ──

/// Lifecycle status for a Task. `Archived` is terminal — once archived,
/// a task cannot transition back to an active state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Draft,
    Ready,
    Running,
    NeedsAttention,
    Verifying,
    Review,
    Done,
    Failed,
    Archived,
}

impl std::fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            TaskStatus::Draft => "draft",
            TaskStatus::Ready => "ready",
            TaskStatus::Running => "running",
            TaskStatus::NeedsAttention => "needs_attention",
            TaskStatus::Verifying => "verifying",
            TaskStatus::Review => "review",
            TaskStatus::Done => "done",
            TaskStatus::Failed => "failed",
            TaskStatus::Archived => "archived",
        };
        f.write_str(s)
    }
}

impl TaskStatus {
    /// True when the status represents a terminal/long-lived state from
    /// which a task may still be revived via explicit operator action.
    /// `Archived` is the only truly terminal state.
    pub fn is_terminal(self) -> bool {
        matches!(self, TaskStatus::Archived)
    }

    /// Pure check: is `to` reachable from `self`? `Archived` has no
    /// outgoing edges; `Done`/`Failed` can still be archived.
    pub fn can_transition_to(self, to: TaskStatus) -> bool {
        if self == to {
            return false;
        }
        match self {
            TaskStatus::Draft => matches!(to, TaskStatus::Ready | TaskStatus::Archived),
            TaskStatus::Ready => matches!(
                to,
                TaskStatus::Running | TaskStatus::Draft | TaskStatus::Failed | TaskStatus::Archived
            ),
            TaskStatus::Running => matches!(
                to,
                TaskStatus::NeedsAttention
                    | TaskStatus::Verifying
                    | TaskStatus::Ready
                    | TaskStatus::Failed
            ),
            TaskStatus::NeedsAttention => matches!(
                to,
                TaskStatus::Ready | TaskStatus::Running | TaskStatus::Failed
            ),
            TaskStatus::Verifying => matches!(
                to,
                TaskStatus::Review
                    | TaskStatus::NeedsAttention
                    | TaskStatus::Failed
                    | TaskStatus::Ready
            ),
            TaskStatus::Review => matches!(
                to,
                TaskStatus::Done
                    | TaskStatus::Verifying
                    | TaskStatus::NeedsAttention
                    | TaskStatus::Failed
            ),
            TaskStatus::Done => matches!(to, TaskStatus::Archived),
            TaskStatus::Failed => matches!(to, TaskStatus::Ready | TaskStatus::Archived),
            TaskStatus::Archived => false,
        }
    }
}

// ── Durable lifecycle events ──

mod events;
pub use events::*;

// ── Linked entities ──

/// Why a run is attached to a task. Free-form string for now — future
/// Worktree Task Lab will constrain this enum.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskRunRole {
    Primary,
    Worktree,
    Verification,
    Review,
    Followup,
}

impl std::fmt::Display for TaskRunRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            TaskRunRole::Primary => "primary",
            TaskRunRole::Worktree => "worktree",
            TaskRunRole::Verification => "verification",
            TaskRunRole::Review => "review",
            TaskRunRole::Followup => "followup",
        };
        f.write_str(s)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRunLink {
    pub run_id: String,
    pub role: TaskRunRole,
    pub linked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskArtifactLink {
    pub artifact_id: String,
    pub kind: String,
    pub run_id: Option<String>,
    pub content_hash: Option<String>,
    pub linked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskCheckpointRef {
    pub checkpoint_id: String,
    pub run_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskVerificationCommand {
    pub command: String,
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskVerificationResult {
    pub command: String,
    pub status: QualityGateVerdict,
    pub artifact_id: Option<String>,
    pub completed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskDevServerRef {
    pub id: String,
    pub url: Option<String>,
    pub port: Option<u16>,
    pub pid: Option<u32>,
    pub started_at: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskMergeDecisionKind {
    #[default]
    Pending,
    Merge,
    KeepBranch,
    Discard,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct TaskMergeDecision {
    pub decision: TaskMergeDecisionKind,
    pub decided_at: Option<String>,
    pub notes: Option<String>,
}

// ── Quality gate & review ──

/// Outcome a Quality Gate pass can produce.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QualityGateVerdict {
    #[default]
    Pending,
    Pass,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct TaskQualityGate {
    pub profile: Option<String>,
    pub verdict: QualityGateVerdict,
    /// Free-form check names that produced the verdict (e.g. `["lint", "test"]`).
    pub checks: Vec<String>,
    pub last_run_at: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReviewOutcome {
    #[default]
    Pending,
    Approved,
    ChangesRequested,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct TaskReviewDecision {
    pub reviewer: Option<String>,
    pub outcome: ReviewOutcome,
    pub notes: Option<String>,
    pub decided_at: Option<String>,
}

// ── Priority ──

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskPriority {
    Low,
    #[default]
    Medium,
    High,
    Critical,
}

impl std::fmt::Display for TaskPriority {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            TaskPriority::Low => "low",
            TaskPriority::Medium => "medium",
            TaskPriority::High => "high",
            TaskPriority::Critical => "critical",
        };
        f.write_str(s)
    }
}

// ── Core record ──

/// The Task Core aggregate. Storage layer writes one `task.json` per
/// `id` under `~/.miwarp/tasks/<id>/task.json`. Commands mutate via
/// `transition` / `link_run` / `link_artifact` so the invariant-enforcing
/// methods on this struct stay the only way state changes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRecord {
    pub id: String,
    pub title: String,
    /// The engineering objective this task owns. Kept separate from
    /// `title` so the UI can shorten labels without losing intent.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub objective: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub constraints: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_changed_files: Option<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allowed_dirs: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub verification_commands: Vec<TaskVerificationCommand>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub verification_results: Vec<TaskVerificationResult>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub changed_files: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub checkpoints: Vec<TaskCheckpointRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dev_servers: Vec<TaskDevServerRef>,
    pub status: TaskStatus,
    #[serde(default)]
    pub priority: TaskPriority,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub run_links: Vec<TaskRunLink>,
    #[serde(default)]
    pub artifact_links: Vec<TaskArtifactLink>,
    #[serde(default)]
    pub quality_gate: TaskQualityGate,
    #[serde(default)]
    pub review: TaskReviewDecision,
    #[serde(default)]
    pub merge_decision: TaskMergeDecision,
    /// Monotonic snapshot revision. Legacy task files deserialize as revision 0.
    #[serde(default)]
    pub revision: u64,
    /// Sequence of the latest durable lifecycle event included in this snapshot.
    #[serde(default)]
    pub last_event_seq: u64,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
}

impl TaskRecord {
    /// Build a brand-new task. Caller supplies the timestamp string so
    /// the domain layer stays free of `chrono` / clock dependencies.
    pub fn new(
        id: impl Into<String>,
        title: impl Into<String>,
        description: impl Into<String>,
        owner: Option<String>,
        priority: TaskPriority,
        now: impl Into<String>,
    ) -> Self {
        let now = now.into();
        let title = title.into();
        Self {
            id: id.into(),
            objective: title.clone(),
            title,
            description: description.into(),
            constraints: Vec::new(),
            workspace_cwd: None,
            branch: None,
            worktree_path: None,
            worktree_branch: None,
            agent: None,
            model: None,
            permission_mode: None,
            max_changed_files: None,
            allowed_dirs: Vec::new(),
            verification_commands: Vec::new(),
            verification_results: Vec::new(),
            changed_files: Vec::new(),
            checkpoints: Vec::new(),
            dev_servers: Vec::new(),
            status: TaskStatus::Draft,
            priority,
            owner,
            tags: Vec::new(),
            run_links: Vec::new(),
            artifact_links: Vec::new(),
            quality_gate: TaskQualityGate::default(),
            review: TaskReviewDecision::default(),
            merge_decision: TaskMergeDecision::default(),
            revision: 0,
            last_event_seq: 0,
            created_at: now.clone(),
            updated_at: now,
            started_at: None,
            completed_at: None,
        }
    }

    /// Bump `updated_at` to the supplied timestamp.
    pub fn touch(&mut self, now: impl Into<String>) {
        self.updated_at = now.into();
    }

    /// True when the status is a long-lived terminal state (Done/Failed/Archived).
    pub fn is_closed(&self) -> bool {
        matches!(
            self.status,
            TaskStatus::Done | TaskStatus::Failed | TaskStatus::Archived
        )
    }

    /// Pure transition check.
    pub fn can_transition(&self, to: TaskStatus) -> bool {
        self.status.can_transition_to(to)
    }

    /// Apply a status transition. Errors when the move is illegal
    /// (e.g. Archived → Running, or self-transition). On success
    /// `updated_at` is bumped, `started_at` is set the first time the
    /// task moves into `Running`, and `completed_at` is set when the
    /// task reaches a closed status.
    pub fn transition(&mut self, to: TaskStatus, now: impl Into<String>) -> Result<(), String> {
        if !self.status.can_transition_to(to) {
            return Err(format!(
                "Illegal task status transition: {} -> {}",
                self.status, to
            ));
        }
        let now = now.into();
        if matches!(to, TaskStatus::Running) && self.started_at.is_none() {
            self.started_at = Some(now.clone());
        }
        if matches!(
            to,
            TaskStatus::Done | TaskStatus::Failed | TaskStatus::Archived
        ) && self.completed_at.is_none()
        {
            self.completed_at = Some(now.clone());
        }
        // Re-opening a closed task (e.g. Failed → Ready) clears the
        // terminal timestamp so downstream surfaces don't see stale
        // "completed_at" on an in-flight record.
        if self.is_closed()
            && !matches!(
                to,
                TaskStatus::Done | TaskStatus::Failed | TaskStatus::Archived
            )
        {
            self.completed_at = None;
        }
        self.status = to;
        self.updated_at = now;
        Ok(())
    }

    /// Add a run link. Deduplicated by `run_id` — re-linking the same
    /// run under a different role is ignored (the first role wins).
    /// Returns `true` if a new link was added.
    pub fn link_run(&mut self, link: TaskRunLink, now: impl Into<String>) -> bool {
        if self.run_links.iter().any(|l| l.run_id == link.run_id) {
            return false;
        }
        self.run_links.push(link);
        self.updated_at = now.into();
        true
    }

    /// Remove a run link by run id. Returns `true` if a link was removed.
    pub fn unlink_run(&mut self, run_id: &str, now: impl Into<String>) -> bool {
        let before = self.run_links.len();
        self.run_links.retain(|l| l.run_id != run_id);
        let removed = self.run_links.len() != before;
        if removed {
            self.updated_at = now.into();
        }
        removed
    }

    /// Add an artifact link. Deduplicated by `artifact_id`. Returns
    /// `true` if a new link was added.
    pub fn link_artifact(&mut self, link: TaskArtifactLink, now: impl Into<String>) -> bool {
        if self
            .artifact_links
            .iter()
            .any(|l| l.artifact_id == link.artifact_id)
        {
            return false;
        }
        self.artifact_links.push(link);
        self.updated_at = now.into();
        true
    }

    /// Remove an artifact link by artifact id. Returns `true` if removed.
    pub fn unlink_artifact(&mut self, artifact_id: &str, now: impl Into<String>) -> bool {
        let before = self.artifact_links.len();
        self.artifact_links.retain(|l| l.artifact_id != artifact_id);
        let removed = self.artifact_links.len() != before;
        if removed {
            self.updated_at = now.into();
        }
        removed
    }

    /// Replace the quality gate summary and bump `updated_at`.
    pub fn set_quality_gate(&mut self, gate: TaskQualityGate, now: impl Into<String>) {
        self.quality_gate = gate;
        self.updated_at = now.into();
    }

    /// Replace the review decision and bump `updated_at`.
    pub fn set_review_decision(&mut self, decision: TaskReviewDecision, now: impl Into<String>) {
        self.review = decision;
        self.updated_at = now.into();
    }

    pub fn set_merge_decision(&mut self, decision: TaskMergeDecision, now: impl Into<String>) {
        self.merge_decision = decision;
        self.updated_at = now.into();
    }

    pub fn set_worktree(
        &mut self,
        worktree_path: impl Into<String>,
        worktree_branch: impl Into<String>,
        now: impl Into<String>,
    ) {
        self.worktree_path = Some(worktree_path.into());
        self.worktree_branch = Some(worktree_branch.into());
        self.updated_at = now.into();
    }

    pub fn track_changed_file(&mut self, path: impl Into<String>, now: impl Into<String>) -> bool {
        let path = path.into();
        if self.changed_files.iter().any(|p| p == &path) {
            return false;
        }
        self.changed_files.push(path);
        self.updated_at = now.into();
        true
    }
}

// ── Builder inputs ──

/// Minimal input for `TaskRecord::new` via the Tauri command surface.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TaskCreateInput {
    pub id: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub objective: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub constraints: Vec<String>,
    #[serde(default)]
    pub workspace_cwd: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub worktree_path: Option<String>,
    #[serde(default)]
    pub worktree_branch: Option<String>,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub max_changed_files: Option<u32>,
    #[serde(default)]
    pub allowed_dirs: Vec<String>,
    #[serde(default)]
    pub verification_commands: Vec<TaskVerificationCommand>,
    pub owner: Option<String>,
    pub priority: Option<TaskPriority>,
    #[serde(default)]
    pub tags: Vec<String>,
}

// ── Tests ──

#[cfg(test)]
mod tests;
