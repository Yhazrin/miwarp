import type { TaskNotificationItem } from "$lib/stores/session-store.svelte";

/** Statuses that only belong inline on the Task tool card — not the top chat banner. */
const TERMINAL_TASK_NOTIFICATION_STATUSES = new Set([
  "stopped",
  "completed",
  "done",
  "failed",
  "error",
  "cancelled",
  "canceled",
]);

export function getLatestTaskNotification(
  notifications: Map<string, TaskNotificationItem>,
): TaskNotificationItem | null {
  let latest: TaskNotificationItem | null = null;
  for (const item of notifications.values()) {
    if (!latest || item.startedAt >= latest.startedAt) latest = item;
  }
  return latest;
}

export function shouldShowTopTaskNotificationBanner(item: TaskNotificationItem): boolean {
  return !TERMINAL_TASK_NOTIFICATION_STATUSES.has(item.status.toLowerCase());
}

function taskNotificationBannerKey(item: TaskNotificationItem): string {
  return `${item.task_id}:${item.status}`;
}
