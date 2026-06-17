/**
 * control_cancelled reducer.
 *
 * Resolves pending tool cards and hook callbacks that were waiting on
 * the now-cancelled request, and removes the elicitation entry.
 *
 * Three side effects:
 * 1. Resolve stale tool entries (permission_prompt + optimistic running)
 *    whose permission_request_id matches — both main timeline and sub-timelines.
 * 2. Mark pending hook callbacks (status === "hook_pending") as "cancelled"
 *    for the same request_id.
 * 3. Drop the elicitation entry from pendingElicitations if present.
 */
import type { BusEvent } from "$lib/types";
import type { Reducer } from "./types";

export const reduceControlCancelled: Reducer = (ev, ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "control_cancelled" }>;
  store._resolveStaleTools(
    (t) =>
      (t.status === "permission_prompt" || t.status === "running") &&
      t.permission_request_id === e.request_id,
    ctx,
  );
  store.hookEvents = store.hookEvents.map((h) =>
    h.request_id === e.request_id && h.status === "hook_pending"
      ? { ...h, status: "cancelled" as const }
      : h,
  );
  if (store.pendingElicitations.has(e.request_id)) {
    const elicUpdated = new Map(store.pendingElicitations);
    elicUpdated.delete(e.request_id);
    store.pendingElicitations = elicUpdated;
  }
};
