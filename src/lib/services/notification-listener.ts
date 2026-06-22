/**
 * Notification Listener
 * Subscribes to bus events and triggers system notifications / toasts
 * for run completions, failures, and approval requests.
 */
import { getTransport } from "$lib/transport";
import { getUserSettings, sendFeishuNotification } from "$lib/api";
import { showToast } from "$lib/stores/toast-store.svelte";
import {
  notifyUser,
  shouldNotify,
  isLongEnough,
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
} from "./notification-service";
import type { BusEvent, TaskRun, UserSettings } from "$lib/types";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { t } from "$lib/i18n/index.svelte";

let _started = false;
const _unlisteners: Array<() => void> = [];
let _settings: NotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS };
let _feishuEnabled = false;
let _feishuTriggers: string[] = [];
const _runs: Map<string, TaskRun> = new Map();

// Cache settings refresh — don't hit API on every event
let _settingsFetchedAt = 0;
const SETTINGS_TTL_MS = 30_000;

async function refreshSettings(): Promise<void> {
  const now = Date.now();
  if (now - _settingsFetchedAt < SETTINGS_TTL_MS) return;
  _settingsFetchedAt = now;
  try {
    const s: UserSettings = await getUserSettings();
    _settings = {
      notificationsEnabled:
        s.notifications_enabled ?? DEFAULT_NOTIFICATION_SETTINGS.notificationsEnabled,
      notifyOnRunCompleted:
        s.notify_on_run_completed ?? DEFAULT_NOTIFICATION_SETTINGS.notifyOnRunCompleted,
      notifyOnRunFailed: s.notify_on_run_failed ?? DEFAULT_NOTIFICATION_SETTINGS.notifyOnRunFailed,
      notifyOnApprovalRequired:
        s.notify_on_approval_required ?? DEFAULT_NOTIFICATION_SETTINGS.notifyOnApprovalRequired,
      notifyOnScheduleCompleted:
        s.notify_on_schedule_completed ?? DEFAULT_NOTIFICATION_SETTINGS.notifyOnScheduleCompleted,
      notifyOnTeamCompleted:
        s.notify_on_team_completed ?? DEFAULT_NOTIFICATION_SETTINGS.notifyOnTeamCompleted,
      notificationMinDurationSec:
        s.notification_min_duration_sec ?? DEFAULT_NOTIFICATION_SETTINGS.notificationMinDurationSec,
    };
    _feishuEnabled = s.feishu_webhook_enabled ?? false;
    _feishuTriggers = s.feishu_webhook_triggers ?? [];
  } catch {
    // Use defaults on error
  }
}

function shouldSendFeishu(trigger: string): boolean {
  if (!_feishuEnabled) return false;
  // If triggers list is empty, send for all events (default behavior)
  if (_feishuTriggers.length === 0) return true;
  return _feishuTriggers.includes(trigger);
}

async function trySendFeishu(
  title: string,
  body: string,
  status?: string,
  link?: string,
): Promise<void> {
  try {
    await sendFeishuNotification(title, body, status, link);
  } catch (e) {
    dbg("notif", "feishu webhook failed (non-blocking)", e);
  }
}

async function handleBusEvent(ev: BusEvent): Promise<void> {
  if (ev.type !== "run_state") return;

  await refreshSettings();
  if (!_settings.notificationsEnabled) return;

  const runId = ev.run_id;
  const state = ev.state;

  if (state === "completed") {
    const run = _runs.get(runId);
    const title = run?.name || run?.prompt?.slice(0, 50) || "Task";

    // Toast: always show in-app
    showToast(`Task completed: ${title}`, "success");

    // System notification: only if app not focused and task was long enough
    if (
      shouldNotify("run_completed", _settings) &&
      (!run || isLongEnough(run, _settings.notificationMinDurationSec))
    ) {
      notifyUser({
        kind: "run_completed",
        title: "MiWarp",
        body: `Task completed: ${title}`,
      });
    }

    // Feishu webhook
    if (shouldSendFeishu("run_completed")) {
      trySendFeishu("Task completed", title, "completed");
    }
    _runs.delete(runId);
  } else if (state === "failed" || state === "stopped" || state === "error") {
    if (state === "stopped") {
      _runs.delete(runId);
      return;
    }

    const run = _runs.get(runId);
    const title = run?.name || run?.prompt?.slice(0, 50) || "Task";

    showToast(`Task failed: ${title}`, "error");

    if (shouldNotify("run_failed", _settings)) {
      notifyUser({
        kind: "run_failed",
        title: "MiWarp",
        body: `Task failed: ${title}`,
      });
    }

    // Feishu webhook
    if (shouldSendFeishu("run_failed")) {
      trySendFeishu("Task failed", title, "failed");
    }
    _runs.delete(runId);
  } else if (state === "running" || state === "spawning") {
    // Track run for later use (title lookup)
    // We don't fetch here — the session store handles that
  }
}

function handlePermissionPrompt(ev: BusEvent): void {
  if (ev.type !== "permission_prompt") return;
  if (!_settings.notificationsEnabled) return;

  if (shouldNotify("approval_required", _settings)) {
    notifyUser({
      kind: "approval_required",
      title: "MiWarp",
      body: "Claude is waiting for your approval",
    });
    showToast("Waiting for your approval", "warning");
  }
}

/** Update cached run info (called by session store when run data loads) */
export function cacheRun(run: TaskRun): void {
  // Cap map size as a safety net — evict oldest entries if needed
  if (_runs.size > 100) {
    const firstKey = _runs.keys().next().value;
    if (firstKey) _runs.delete(firstKey);
  }
  _runs.set(run.id, run);
}

export async function startNotificationListener(): Promise<void> {
  if (_started) return;
  _started = true;

  await refreshSettings();

  const transport = getTransport();
  try {
    const unlisten = await transport.listen<BusEvent>("bus-event", (ev) => {
      if (ev.type === "run_state") {
        handleBusEvent(ev).catch((e) => dbgWarn("notif", "handler error", e));
      } else if (ev.type === "permission_prompt") {
        handlePermissionPrompt(ev);
      } else if (ev.type === "protocol_desync") {
        showToast(t("protocol_desync_toast"), "error");
      } else if (ev.type === "session_recovering") {
        const secs = Math.round((ev.deadline_ms ?? 0) / 1000);
        showToast(t("protocol_session_recovering", { seconds: String(secs) }), "warning");
      } else if (ev.type === "session_recovered") {
        if (ev.ok) {
          showToast(t("protocol_recovered_ok_toast"), "success");
        } else {
          showToast(t("protocol_recovered_fail_toast"), "error");
        }
      } else if (ev.type === "task_notification") {
        // v1.0.6 / hardening A4: scheduled tasks (not just run_state) can
        // signal completion or failure — surface both as toasts.
        const tn = ev as Extract<BusEvent, { type: "task_notification" }>;
        const status = (tn as { status?: string }).status ?? "";
        if (status === "completed" || status === "success") {
          showToast("定时任务完成", "success");
        } else if (status === "failed" || status === "error") {
          showToast("定时任务失败", "error");
        }
      }
    });
    _unlisteners.push(unlisten);
    dbg("notif", "notification listener started");
  } catch (e) {
    dbgWarn("notif", "failed to start listener", e);
  }
}

export function stopNotificationListener(): void {
  for (const unlisten of _unlisteners) {
    try {
      unlisten();
    } catch {
      // Ignore
    }
  }
  _unlisteners.length = 0;
  _started = false;
}
