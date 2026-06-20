import { appVisibility } from "$lib/stores/app-visibility.svelte";
import type { TaskRun } from "$lib/types";
import { dbgWarn } from "$lib/utils/debug";

type NotificationPlugin = {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<"granted" | "denied" | "default">;
  sendNotification: (options: { title: string; body?: string }) => void;
};

let pluginPromise: Promise<NotificationPlugin | null> | null = null;

function loadNotificationPlugin(): Promise<NotificationPlugin | null> {
  if (pluginPromise) return pluginPromise;
  pluginPromise = import("@tauri-apps/plugin-notification")
    .then((m) => m as unknown as NotificationPlugin)
    .catch(() => null);
  return pluginPromise;
}

export type NotifyKind =
  | "run_completed"
  | "run_failed"
  | "approval_required"
  | "schedule_completed"
  | "schedule_failed"
  | "team_completed"
  | "team_failed";

interface NotifyOptions {
  kind: NotifyKind;
  title: string;
  body?: string;
  silent?: boolean;
}

let permissionChecked = false;
let permissionGranted = false;

export async function ensureNotificationPermission(): Promise<boolean> {
  if (permissionChecked) return permissionGranted;

  const plugin = await loadNotificationPlugin();
  if (!plugin) {
    permissionChecked = true;
    permissionGranted = false;
    return permissionGranted;
  }

  try {
    permissionGranted = await plugin.isPermissionGranted();
    if (!permissionGranted) {
      const permission = await plugin.requestPermission();
      permissionGranted = permission === "granted";
    }
  } catch {
    permissionGranted = false;
  }

  permissionChecked = true;
  return permissionGranted;
}

export async function notifyUser(options: NotifyOptions): Promise<void> {
  if (options.silent) return;

  try {
    const ok = await ensureNotificationPermission();
    if (!ok) return;

    const plugin = await loadNotificationPlugin();
    if (!plugin) return;

    plugin.sendNotification({
      title: options.title,
      body: options.body ?? "",
    });
  } catch (error) {
    dbgWarn("notification", "send failed", error);
  }
}

/** Should we send a system notification, or is the user actively watching? */
export function shouldNotify(kind: NotifyKind, settings: NotificationSettings): boolean {
  if (!settings.notificationsEnabled) return false;

  switch (kind) {
    case "run_completed":
      if (!settings.notifyOnRunCompleted) return false;
      // If app is focused, in-app toast is enough — skip system notification
      if (appVisibility.isAppFocused) return false;
      return true;
    case "run_failed":
      return settings.notifyOnRunFailed;
    case "approval_required":
      return settings.notifyOnApprovalRequired;
    case "schedule_completed":
      return settings.notifyOnScheduleCompleted;
    case "schedule_failed":
      return true; // Always notify failures
    case "team_completed":
      return settings.notifyOnTeamCompleted;
    case "team_failed":
      return true;
  }
}

/** Duration threshold: short tasks don't need system notifications. */
export function isLongEnough(run: TaskRun, minDurationSec: number): boolean {
  if (!run.started_at) return true;
  const start = new Date(run.started_at).getTime();
  const end = run.ended_at ? new Date(run.ended_at).getTime() : Date.now();
  return (end - start) / 1000 >= minDurationSec;
}

export interface NotificationSettings {
  notificationsEnabled: boolean;
  notifyOnRunCompleted: boolean;
  notifyOnRunFailed: boolean;
  notifyOnApprovalRequired: boolean;
  notifyOnScheduleCompleted: boolean;
  notifyOnTeamCompleted: boolean;
  notificationMinDurationSec: number;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  notificationsEnabled: true,
  notifyOnRunCompleted: true,
  notifyOnRunFailed: true,
  notifyOnApprovalRequired: true,
  notifyOnScheduleCompleted: true,
  notifyOnTeamCompleted: true,
  notificationMinDurationSec: 10,
};
