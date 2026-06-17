/**
 * tool_use_summary reducer.
 *
 * Updates the `summary` field on an existing tool entry. Mirrors the
 * tool_progress dual-path (sub-timeline vs main timeline).
 */
import type { BusEvent, TimelineEntry } from "$lib/types";
import type { Reducer } from "./types";

export const reduceToolUseSummary: Reducer = (ev, ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "tool_use_summary" }>;
  if (e.parent_tool_use_id) {
    store._updateSubTimelineTool(
      e.parent_tool_use_id,
      e.tool_use_id,
      (t: Record<string, unknown>) => ({ ...t, summary: e.summary }),
      ctx,
    );
    return;
  }
  const idx = store._findToolIdx(ctx, e.tool_use_id);
  if (idx < 0) return;
  const tl = ctx ? ctx.tl : store.timeline;
  const old = tl[idx] as Extract<TimelineEntry, { kind: "tool" }>;
  const updated: TimelineEntry = { ...old, tool: { ...old.tool, summary: e.summary } };
  if (ctx) ctx.tl[idx] = updated;
  else {
    const u = [...store.timeline];
    u[idx] = updated;
    store.timeline = u;
  }
};
