/**
 * tool_progress reducer.
 *
 * Updates elapsed_time_seconds on an existing tool entry — main timeline
 * or sub-timeline, depending on whether parent_tool_use_id is set.
 *
 * - With parent_tool_use_id: update via _updateSubTimelineTool
 * - Without: locate in main timeline via _findToolIdx, patch in place
 *
 * Idempotent on missing tool_use_id (no-op if tool not found).
 */
import type { BusEvent, TimelineEntry } from "$lib/types";
import type { Reducer } from "./types";

export const reduceToolProgress: Reducer = (ev, ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "tool_progress" }>;
  if (e.parent_tool_use_id) {
    store._updateSubTimelineTool(
      e.parent_tool_use_id,
      e.tool_use_id,
      (t: Record<string, unknown>) => ({ ...t, elapsed_time_seconds: e.elapsed_time_seconds }),
      ctx,
    );
    return;
  }
  const idx = store._findToolIdx(ctx, e.tool_use_id);
  if (idx < 0) return;
  const tl = ctx ? ctx.tl : store.timeline;
  const old = tl[idx] as Extract<TimelineEntry, { kind: "tool" }>;
  const updated: TimelineEntry = {
    ...old,
    tool: { ...old.tool, elapsed_time_seconds: e.elapsed_time_seconds },
  };
  if (ctx) ctx.tl[idx] = updated;
  else {
    const u = [...store.timeline];
    u[idx] = updated;
    store.timeline = u;
  }
};
