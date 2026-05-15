/**
 * Scheduled Task types — mirrors src-tauri/src/scheduler/model.rs
 */
import { t } from "$lib/i18n/index.svelte";

export type Agent = "claude" | "codex";
export type ScheduleType = "cron" | "one-time" | "interval";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

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
