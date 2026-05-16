/**
 * Scheduled Task types — mirrors src-tauri/src/scheduler/model.rs
 * Enhanced with dependency and retry support from Claude Code/Cowork design.
 */
import { t } from "$lib/i18n/index.svelte";

export type Agent = "claude" | "codex";
export type ScheduleType = "cron" | "one-time" | "interval";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

// Enhanced retry configuration
export type RetryBackoff = "linear" | "exponential" | "fixed";

export interface RetryConfig {
  maxRetries: number;
  backoff: RetryBackoff;
  initialDelayMs?: number; // Default: 1000
  maxDelayMs?: number; // Default: 60000
}

// Task dependency configuration
export interface TaskDependency {
  taskId: string;
  type: "complete" | "failed" | "any";
}

// Event trigger configuration
export interface TaskEventTrigger {
  type: "file_change" | "task_complete" | "schedule";
  pattern?: string; // File pattern for file_change
  sourceTaskId?: string; // For task_complete
}

export interface WorkspaceInfo {
  cwd: string;
  remoteHostName?: string;
}

export interface ScheduleConfig {
  type: ScheduleType;
  cronExpression?: string;
  fireAt?: string;
  intervalMinutes?: number;
  timezone?: string;
}

export interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  workspace: WorkspaceInfo;
  agent: Agent;
  schedule: ScheduleConfig;
  enabled: boolean;
  permissionMode?: string;
  model?: string;
  provider?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;

  // Enhanced from Claude Code/Cowork design
  dependencies?: TaskDependency[]; // Task dependencies
  triggerOnEvent?: TaskEventTrigger; // Event-based triggers
  retryConfig?: RetryConfig; // Retry configuration
  timeout?: number; // Task timeout in ms
  tags?: string[]; // Task categorization
  notifications?: {
    onStart?: boolean;
    onComplete?: boolean;
    onFailure?: boolean;
  };
}

// Execution statistics for monitoring
export interface TaskExecutionStats {
  taskId: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  averageDuration: number; // ms
  successRate: number; // 0-1
  lastSuccessAt?: string;
  lastFailureAt?: string;
}

export interface ScheduledTaskRun {
  id: string;
  taskId: string;
  runId?: string;
  sessionId?: string;
  startedAt: string;
  endedAt?: string;
  status: RunStatus;
  error?: string;
  summary?: string;
  retryAttempt?: number; // Current retry attempt number
  executionDuration?: number; // ms
}

export interface ScheduledTaskInput {
  name: string;
  description?: string;
  prompt: string;
  workspace: WorkspaceInfo;
  agent?: Agent;
  schedule: ScheduleConfig;
  enabled?: boolean;
  permissionMode?: string;
  model?: string;
  provider?: string;
  // New fields
  dependencies?: TaskDependency[];
  triggerOnEvent?: TaskEventTrigger;
  retryConfig?: RetryConfig;
  timeout?: number;
  tags?: string[];
}

export interface ScheduledTaskPatch {
  name?: string;
  description?: string | null;
  prompt?: string;
  workspace?: WorkspaceInfo;
  agent?: Agent;
  schedule?: ScheduleConfig;
  enabled?: boolean;
  permissionMode?: string | null;
  model?: string | null;
  provider?: string | null;
  // New fields
  dependencies?: TaskDependency[] | null;
  triggerOnEvent?: TaskEventTrigger | null;
  retryConfig?: RetryConfig | null;
  timeout?: number | null;
  tags?: string[] | null;
  notifications?: ScheduledTask["notifications"] | null;
}

export interface CronPreset {
  label: string;
  expression: string;
  description: string;
}

export const CRON_PRESETS: CronPreset[] = [
  { label: "Every minute", expression: "* * * * *", description: "Runs every minute" },
  { label: "Every 5 minutes", expression: "*/5 * * * *", description: "Runs every 5 minutes" },
  { label: "Every 15 minutes", expression: "*/15 * * * *", description: "Runs every 15 minutes" },
  { label: "Every hour", expression: "0 * * * *", description: "Runs at the start of every hour" },
  { label: "Every day at 9am", expression: "0 9 * * *", description: "Runs daily at 9:00 AM" },
  {
    label: "Every weekday at 9am",
    expression: "0 9 * * 1-5",
    description: "Runs weekdays at 9:00 AM",
  },
  {
    label: "Every Monday at 8:30am",
    expression: "30 8 * * 1",
    description: "Runs every Monday at 8:30 AM",
  },
  {
    label: "First of month at midnight",
    expression: "0 0 1 * *",
    description: "Runs on the 1st of every month",
  },
];

export const INTERVAL_PRESETS: { label: string; minutes: number }[] = [
  { label: "Every 5 minutes", minutes: 5 },
  { label: "Every 15 minutes", minutes: 15 },
  { label: "Every 30 minutes", minutes: 30 },
  { label: "Every hour", minutes: 60 },
  { label: "Every 2 hours", minutes: 120 },
  { label: "Every 6 hours", minutes: 360 },
  { label: "Every 12 hours", minutes: 720 },
  { label: "Every 24 hours", minutes: 1440 },
];

/**
 * Calculate delay for retry with backoff.
 */
export function calculateRetryDelay(attempt: number, config: RetryConfig): number {
  const initialDelay = config.initialDelayMs || 1000;
  const maxDelay = config.maxDelayMs || 60000;

  switch (config.backoff) {
    case "linear":
      return Math.min(initialDelay * attempt, maxDelay);
    case "exponential":
      return Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
    case "fixed":
    default:
      return initialDelay;
  }
}

/**
 * Calculate execution statistics from runs.
 */
export function calculateTaskStats(runs: ScheduledTaskRun[]): TaskExecutionStats | null {
  if (runs.length === 0) return null;

  const taskId = runs[0].taskId;
  const completedRuns = runs.filter((r) => r.status === "completed");
  const failedRuns = runs.filter((r) => r.status === "failed");
  const durations = runs
    .filter((r) => r.executionDuration != null)
    .map((r) => r.executionDuration!);

  const avgDuration =
    durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  const lastSuccess = runs
    .filter((r) => r.status === "completed" && r.endedAt)
    .sort((a, b) => (b.endedAt! > a.endedAt! ? 1 : -1))[0];
  const lastFailure = runs
    .filter((r) => r.status === "failed" && r.endedAt)
    .sort((a, b) => (b.endedAt! > a.endedAt! ? 1 : -1))[0];

  return {
    taskId,
    totalRuns: runs.length,
    successfulRuns: completedRuns.length,
    failedRuns: failedRuns.length,
    averageDuration: avgDuration,
    successRate: runs.length > 0 ? completedRuns.length / runs.length : 0,
    lastSuccessAt: lastSuccess?.endedAt,
    lastFailureAt: lastFailure?.endedAt,
  };
}

export const DEFAULT_TASK_TEMPLATES: {
  name: string;
  description: string;
  prompt: string;
  schedule: ScheduleConfig;
}[] = [
  {
    name: t("schedTpl_dailyCheck_name"),
    description: t("schedTpl_dailyCheck_desc"),
    prompt: t("schedTpl_dailyCheck_prompt"),
    schedule: { type: "cron", cronExpression: "0 9 * * *" },
  },
  {
    name: t("schedTpl_weeklyReview_name"),
    description: t("schedTpl_weeklyReview_desc"),
    prompt: t("schedTpl_weeklyReview_prompt"),
    schedule: { type: "cron", cronExpression: "0 10 * * 1" },
  },
  {
    name: t("schedTpl_depCheck_name"),
    description: t("schedTpl_depCheck_desc"),
    prompt: t("schedTpl_depCheck_prompt"),
    schedule: { type: "cron", cronExpression: "0 8 1 * *" },
  },
  {
    name: t("schedTpl_memoryRefresh_name"),
    description: t("schedTpl_memoryRefresh_desc"),
    prompt: t("schedTpl_memoryRefresh_prompt"),
    schedule: { type: "cron", cronExpression: "0 18 * * 5" },
  },
];

/**
 * Create default retry config.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  backoff: "exponential",
  initialDelayMs: 1000,
  maxDelayMs: 60000,
};
