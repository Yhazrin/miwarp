export type TaskStatus =
  | "draft"
  | "ready"
  | "running"
  | "needs_attention"
  | "verifying"
  | "review"
  | "done"
  | "failed"
  | "archived";

export type TaskRunRole = "primary" | "worktree" | "verification" | "review" | "followup";

export type TaskEventSource = "user" | "runtime" | "system";

export type TaskEventKind =
  | { type: "created" }
  | { type: "status_transition"; from: TaskStatus; to: TaskStatus }
  | { type: "run_linked"; run_id: string; role: TaskRunRole }
  | { type: "run_unlinked"; run_id: string }
  | { type: "artifact_linked"; artifact_id: string; kind: string; run_id?: string | null }
  | { type: "artifact_unlinked"; artifact_id: string }
  | { type: "quality_gate_updated"; verdict: QualityGateVerdict }
  | { type: "review_updated"; outcome: ReviewOutcome }
  | { type: "merge_decision_updated"; decision: TaskMergeDecisionKind }
  | { type: "worktree_updated"; path: string; branch: string }
  | { type: "changed_file_tracked"; path: string }
  | {
      type: "restart_reconciled";
      from: TaskStatus;
      to: TaskStatus;
      reason: string;
    };

export interface TaskEvent {
  id: string;
  task_id: string;
  seq: number;
  source: TaskEventSource;
  event: TaskEventKind;
  timestamp: string;
}

export interface TaskReconcileReport {
  scanned: number;
  recovered_pending_mutations: number;
  moved_to_needs_attention: number;
  unchanged: number;
  failures: string[];
}

export type QualityGateVerdict = "pending" | "pass" | "warn" | "fail";

export type ReviewOutcome = "pending" | "approved" | "changes_requested" | "rejected";

export type TaskPriority = "low" | "medium" | "high" | "critical";

export type TaskMergeDecisionKind = "pending" | "merge" | "keep_branch" | "discard";

export interface TaskRunLink {
  run_id: string;
  role: TaskRunRole;
  linked_at: string;
}

export interface TaskArtifactLink {
  artifact_id: string;
  kind: string;
  run_id?: string | null;
  content_hash?: string | null;
  linked_at: string;
}

export interface TaskCheckpointRef {
  checkpoint_id: string;
  run_id?: string | null;
  created_at: string;
}

export interface TaskVerificationCommand {
  command: string;
  cwd?: string | null;
}

export interface TaskVerificationResult {
  command: string;
  status: QualityGateVerdict;
  artifact_id?: string | null;
  completed_at: string;
}

export interface TaskDevServerRef {
  id: string;
  url?: string | null;
  port?: number | null;
  pid?: number | null;
  started_at?: string | null;
}

export interface TaskQualityGate {
  profile?: string | null;
  verdict: QualityGateVerdict;
  checks: string[];
  last_run_at?: string | null;
  notes?: string | null;
}

export interface TaskReviewDecision {
  reviewer?: string | null;
  outcome: ReviewOutcome;
  notes?: string | null;
  decided_at?: string | null;
}

export interface TaskMergeDecision {
  decision: TaskMergeDecisionKind;
  decided_at?: string | null;
  notes?: string | null;
}

export interface TaskRecord {
  id: string;
  title: string;
  objective?: string;
  description: string;
  constraints: string[];
  workspace_cwd?: string | null;
  branch?: string | null;
  worktree_path?: string | null;
  worktree_branch?: string | null;
  agent?: string | null;
  model?: string | null;
  permission_mode?: string | null;
  max_changed_files?: number | null;
  allowed_dirs: string[];
  verification_commands: TaskVerificationCommand[];
  verification_results: TaskVerificationResult[];
  changed_files: string[];
  checkpoints: TaskCheckpointRef[];
  dev_servers: TaskDevServerRef[];
  status: TaskStatus;
  priority: TaskPriority;
  owner?: string | null;
  tags: string[];
  run_links: TaskRunLink[];
  artifact_links: TaskArtifactLink[];
  quality_gate: TaskQualityGate;
  review: TaskReviewDecision;
  merge_decision: TaskMergeDecision;
  revision: number;
  last_event_seq: number;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface TaskCreateInput {
  id?: string | null;
  title?: string;
  objective?: string;
  description?: string;
  constraints?: string[];
  workspace_cwd?: string | null;
  branch?: string | null;
  worktree_path?: string | null;
  worktree_branch?: string | null;
  agent?: string | null;
  model?: string | null;
  permission_mode?: string | null;
  max_changed_files?: number | null;
  allowed_dirs?: string[];
  verification_commands?: TaskVerificationCommand[];
  owner?: string | null;
  priority?: TaskPriority | null;
  tags?: string[];
}

export interface TaskLinkRunInput {
  task_id: string;
  run_id: string;
  role?: TaskRunRole | null;
}

export interface TaskLinkArtifactInput {
  task_id: string;
  artifact_id: string;
  kind: string;
  run_id?: string | null;
  content_hash?: string | null;
}
