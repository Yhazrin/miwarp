type RunStage
  | "starting"
  | "understanding"
  | "planning"
  | "executing"
  | "waiting"
  | "verifying"
  | "completed"
  | "failed"
  | "stopped";

type RunActionStatus "started" | "completed" | "failed" | "uncertain";

type RunIdempotencyClass "read_only" | "idempotent_write" | "non_idempotent";

type RecoveryAssessmentKind
  | "no_action"
  | "safe_retry"
  | "manual_confirmation"
  | "impossible_resume";

interface RunActionRecord {
  action_id: string;
  tool_name: string;
  tool_use_id: string;
  idempotency_class: RunIdempotencyClass;
  status: RunActionStatus;
  bus_seq_start?: number | null;
  started_at: string;
  completed_at?: string | null;
  error?: string | null;
}

interface AcceptedUserMessage {
  client_message_id: string;
  accepted_at: string;
  text_preview?: string | null;
}

interface RecoveryCursor {
  cursor_seq: number;
  last_bus_seq: number;
  last_checkpoint_id?: string | null;
}

export interface RunCheckpoint {
  checkpoint_id: string;
  cursor_seq: number;
  stage: RunStage;
  plan_revision: number;
  label?: string | null;
  created_at: string;
}

interface PendingApproval {
  request_id: string;
  tool_name: string;
  tool_use_id: string;
  action_id: string;
  raised_at: string;
}

interface RecoveryAssessment {
  kind: RecoveryAssessmentKind;
  reason: string;
  assessed_at: string;
}

export interface RunJournalSnapshot {
  schema_version: number;
  run_id: string;
  objective: string;
  stage: RunStage;
  plan_revision: number;
  accepted_messages: AcceptedUserMessage[];
  actions: RunActionRecord[];
  pending_approvals: PendingApproval[];
  checkpoints: RunCheckpoint[];
  recovery_cursor: RecoveryCursor;
  recovery_assessment: RecoveryAssessment;
  journal_degraded: boolean;
  revision: number;
  last_journal_seq: number;
  last_projected_bus_seq?: number | null;
  created_at: string;
  updated_at: string;
}

type RunJournalEventKind
  | { type: "initialized"; objective: string; stage: RunStage }
  | {
      type: "user_message_accepted";
      client_message_id: string;
      text_preview?: string | null;
    }
  | { type: "stage_changed"; from: RunStage; to: RunStage }
  | { type: "action_started"; action: RunActionRecord }
  | {
      type: "action_completed";
      action_id: string;
      status: RunActionStatus;
      error?: string | null;
    }
  | { type: "action_marked_uncertain"; action_id: string; reason: string }
  | { type: "approval_required"; approval: PendingApproval }
  | { type: "approval_resolved"; request_id: string; approved: boolean }
  | { type: "checkpoint_created"; checkpoint: RunCheckpoint }
  | {
      type: "recovery_cursor_advanced";
      cursor_seq: number;
      last_bus_seq: number;
      last_checkpoint_id?: string | null;
    }
  | {
      type: "restart_reconciled";
      from_stage: RunStage;
      to_stage: RunStage;
      assessment: RecoveryAssessmentKind;
      reason: string;
    }
  | { type: "degraded"; reason: string };

export interface RunJournalEvent {
  id: string;
  run_id: string;
  seq: number;
  event: RunJournalEventKind;
  timestamp: string;
}

export interface RunJournalReconcileReport {
  scanned: number;
  recovered_pending_mutations: number;
  restart_reconciled: number;
  marked_uncertain: number;
  impossible_resume: number;
  unchanged: number;
  failures: string[];
}
