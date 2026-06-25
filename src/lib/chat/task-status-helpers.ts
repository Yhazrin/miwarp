import type { MessageKey } from "$lib/i18n/types";
import type {
  QualityGateVerdict,
  ReviewOutcome,
  TaskMergeDecisionKind,
  TaskPriority,
  TaskStatus,
} from "$lib/types/task";

export interface StatusDescriptor {
  key: MessageKey;
  tone: "neutral" | "info" | "warning" | "success" | "danger";
}

export const STATUS_KEYS: Record<TaskStatus, MessageKey> = {
  draft: "tasks_status_draft",
  ready: "tasks_status_ready",
  running: "tasks_status_running",
  needs_attention: "tasks_status_needs_attention",
  verifying: "tasks_status_verifying",
  review: "tasks_status_review",
  done: "tasks_status_done",
  failed: "tasks_status_failed",
  archived: "tasks_status_archived",
};

export const STATUS_TONE: Record<TaskStatus, StatusDescriptor["tone"]> = {
  draft: "neutral",
  ready: "info",
  running: "info",
  needs_attention: "warning",
  verifying: "info",
  review: "info",
  done: "success",
  failed: "danger",
  archived: "neutral",
};

export const PRIORITY_KEYS: Record<TaskPriority, MessageKey> = {
  low: "tasks_priority_low",
  medium: "tasks_priority_medium",
  high: "tasks_priority_high",
  critical: "tasks_priority_critical",
};

export const VERDICT_KEYS: Record<QualityGateVerdict, MessageKey> = {
  pending: "tasks_merge_pending",
  pass: "tasks_review_approve",
  warn: "tasks_status_needs_attention",
  fail: "tasks_review_reject",
};

export const REVIEW_KEYS: Record<ReviewOutcome, MessageKey> = {
  pending: "tasks_merge_pending",
  approved: "tasks_review_approve",
  changes_requested: "tasks_review_changes",
  rejected: "tasks_review_reject",
};

export const MERGE_DECISION_KEYS: Record<TaskMergeDecisionKind, MessageKey> = {
  pending: "tasks_merge_pending",
  merge: "tasks_merge_merge",
  keep_branch: "tasks_merge_keep_branch",
  discard: "tasks_merge_discard",
};

export function isActiveStatus(status: TaskStatus): boolean {
  return (
    status === "running" ||
    status === "needs_attention" ||
    status === "verifying" ||
    status === "review"
  );
}
