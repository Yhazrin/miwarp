/**
 * Scheduled Task types
 */
export interface ScheduledTask {
  taskId: string;
  description: string;
  prompt: string;
  cronExpression?: string;
  fireAt?: string; // ISO 8601 timestamp with timezone
  enabled: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  createdAt: string;
}

export interface ScheduledTaskLog {
  id: string;
  taskId: string;
  startAt: string;
  endAt?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  result?: string;
  error?: string;
  sessionId?: string;
}

export type TaskScheduleType = "cron" | "one-time";

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
