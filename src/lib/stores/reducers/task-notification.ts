/**
 * task_notification reducer.
 *
 * Updates the store's `taskNotifications` map with a new task entry. If the
 * task already exists, preserves `startedAt`/`output_file`/`task_type`/
 * `summary`/`tool_use_id` from the prior entry (idempotent merge).
 *
 * Falls back through `data.summary` → `data.message` → `data.task_description`
 * → task_id for the human-readable message.
 */
import type { BusEvent } from "$lib/types";
import { dbg } from "$lib/utils/debug";
import type { Reducer } from "./types";

export const reduceTaskNotification: Reducer = (ev, _ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "task_notification" }>;
  const existing = store.taskNotifications.get(e.task_id);
  const rawData = e.data as Record<string, unknown> | undefined;
  const message =
    (rawData?.summary as string) ??
    (rawData?.message as string) ??
    (rawData?.task_description as string) ??
    e.task_id;
  const updated = new Map(store.taskNotifications);
  updated.set(e.task_id, {
    task_id: e.task_id,
    status: e.status,
    message,
    startedAt: existing?.startedAt ?? Date.now(),
    data: e,
    output_file:
      ((rawData?.output_file ?? rawData?.outputFile) as string | undefined) ??
      existing?.output_file,
    task_type:
      ((rawData?.task_type ?? rawData?.taskType) as string | undefined) ?? existing?.task_type,
    summary: (rawData?.summary as string | undefined) ?? existing?.summary,
    tool_use_id:
      ((rawData?.tool_use_id ?? rawData?.toolUseId) as string | undefined) ?? existing?.tool_use_id,
  });
  store.taskNotifications = updated;
  dbg("store", "task_notification updated", { taskId: e.task_id, status: e.status });
};
