/**
 * permission_denied reducer.
 *
 * Retroactively marks a tool entry as "permission_denied" when the CLI
 * reports that a permission request was rejected. Searches the main timeline
 * first; if the tool isn't found there (CLI may omit parent_tool_use_id),
 * falls back to scanning all subTimelines.
 */
import type { BusEvent, TimelineEntry } from "$lib/types";
import type { Reducer } from "./types";

export const reducePermissionDenied: Reducer = (ev, ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "permission_denied" }>;
  const tl = ctx ? ctx.tl : store.timeline;
  const tIdx = store._findToolIdx(ctx, e.tool_use_id);
  if (tIdx >= 0) {
    const old = tl[tIdx] as Extract<TimelineEntry, { kind: "tool" }>;
    const updated: TimelineEntry = {
      ...old,
      tool: { ...old.tool, status: "permission_denied" },
    };
    if (ctx) ctx.tl[tIdx] = updated;
    else {
      const u = [...store.timeline];
      u[tIdx] = updated;
      store.timeline = u;
    }
  } else {
    store._updateToolInAnySubTimeline(
      e.tool_use_id,
      (t) => ({ ...t, status: "permission_denied" as const }),
      ctx,
    );
  }
};
