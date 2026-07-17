/**
 * Snapshot building helpers extracted from SessionStore.
 *
 * @module snapshot-manager
 */
import type { TimelineEntry, RunStatus } from "$lib/types";
import type { ReduceCtx } from "../reducers/types";

/**
 * Resolve incomplete tool entries to "error" for snapshot contexts.
 * Called during offline replay (buildSnapshotFromEvents) when the source run
 * is terminal — any tools still in "running" / "ask_pending" / "permission_prompt"
 * will never receive results.
 */
export function finalizeSnapshotCtxTools(ctx: ReduceCtx, runStatus: RunStatus): void {
  const sessionDead =
    runStatus === "stopped" || runStatus === "completed" || runStatus === "failed";
  if (!sessionDead) return;
  const staleStatuses = new Set(["running", "ask_pending", "permission_prompt"]);
  const finalizeTools = (tl: TimelineEntry[]): TimelineEntry[] => {
    let changed = false;
    const result = tl.map((e) => {
      if (e.kind !== "tool") return e;
      const newSub = e.subTimeline ? finalizeTools(e.subTimeline) : e.subTimeline;
      const needsFinalize = staleStatuses.has(e.tool.status);
      if (!needsFinalize && newSub === e.subTimeline) return e;
      changed = true;
      return {
        ...e,
        ...(newSub !== e.subTimeline ? { subTimeline: newSub } : {}),
        tool: needsFinalize
          ? { ...e.tool, status: "error" as const, output: { error: "Session ended" } }
          : e.tool,
      };
    });
    return changed ? result : tl;
  };
  ctx.tl = finalizeTools(ctx.tl);
}

/**
 * Same as finalizeSnapshotCtxTools but for committed timeline arrays
 * (used in _commitReduceCtx when the session is dead).
 */
export function finalizeTimelineForDeadSession(tl: TimelineEntry[]): TimelineEntry[] | null {
  const staleStatuses = new Set(["running", "ask_pending", "permission_prompt"]);
  let changed = false;
  const result = tl.map((e) => {
    if (e.kind !== "tool") return e;
    const newSub = e.subTimeline ? finalizeTimelineForDeadSession(e.subTimeline) ?? e.subTimeline : e.subTimeline;
    const needsFinalize = staleStatuses.has(e.tool.status);
    if (!needsFinalize && newSub === e.subTimeline) return e;
    changed = true;
    return {
      ...e,
      ...(newSub !== e.subTimeline ? { subTimeline: newSub } : {}),
      tool: needsFinalize
        ? { ...e.tool, status: "error" as const, output: { error: "Session ended" } }
        : e.tool,
    };
  });
  return changed ? result : null;
}
