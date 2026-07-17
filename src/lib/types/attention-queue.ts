export type AttentionKind =
  | "task_attention"
  | "pending_approval"
  | "manual_confirmation"
  | "impossible_resume"
  | "journal_degraded";

export type AttentionSeverity = "warning" | "blocking";

export type AttentionStatus = "open" | "acknowledged" | "resolved";

export type AttentionAction =
  | "acknowledge"
  | "retry_task"
  | "mark_task_failed"
  | "confirm_completed"
  | "confirm_not_completed"
  | "accept_risk"
  | "dismiss"
  | "source_cleared";

export interface AttentionResolution {
  action: AttentionAction;
  actor: string;
  note?: string | null;
  source_revision: number;
  resolved_at: string;
}

export interface AttentionItem {
  id: string;
  stable_key: string;
  kind: AttentionKind;
  severity: AttentionSeverity;
  status: AttentionStatus;
  title: string;
  summary: string;
  task_id?: string | null;
  run_id?: string | null;
  request_id?: string | null;
  action_id?: string | null;
  source_revision: number;
  allowed_actions: AttentionAction[];
  generation: number;
  resolution?: AttentionResolution | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

export interface AttentionQueueSnapshot {
  schema_version: number;
  items: AttentionItem[];
  revision: number;
  last_event_seq: number;
  created_at: string;
  updated_at: string;
}

export type AttentionEventKind =
  | { type: "raised"; item: AttentionItem }
  | { type: "refreshed"; item: AttentionItem }
  | { type: "acknowledged"; item_id: string; actor?: string | null }
  | { type: "resolved"; item_id: string; resolution: AttentionResolution }
  | { type: "reopened"; item: AttentionItem };

export interface AttentionEvent {
  id: string;
  seq: number;
  event: AttentionEventKind;
  timestamp: string;
}

export interface AttentionReconcileReport {
  scanned_tasks: number;
  scanned_runs: number;
  raised: number;
  refreshed: number;
  reopened: number;
  auto_resolved: number;
  recovered_pending_mutations: number;
  failures: string[];
}
