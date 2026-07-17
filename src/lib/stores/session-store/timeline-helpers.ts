/**
 * Pure timeline manipulation helpers extracted from SessionStore.
 *
 * All functions operate on explicit `tl`/`he` arrays and index Maps — no `this`,
 * no `$state`, no store dependency. The caller is responsible for:
 *  - Read-only helpers: pass the correct tl/he + index.
 *  - Mutating helpers: pass a mutable array (clone for live mode, ctx.tl for batch).
 *
 * @module timeline-helpers
 */
import type { TimelineEntry, HookEvent, BusToolItem } from "$lib/types";
import { dbg, dbgWarn } from "$lib/utils/debug";

// ── Read-only lookups ────────────────────────────────────────────────────────

/** Find tool timeline entry by tool_use_id. Map fast-path + findIndex fallback. */
export function findToolIdx(
  tl: TimelineEntry[],
  index: Map<string, number>,
  toolUseId: string,
): number {
  const idx = index.get(toolUseId);
  if (idx !== undefined && tl[idx]?.kind === "tool" && tl[idx].id === toolUseId) return idx;
  const fallback = tl.findIndex((e) => e.kind === "tool" && e.id === toolUseId);
  if (fallback >= 0) {
    dbgWarn("store", "findToolIdx: index miss, found via scan", {
      toolUseId,
      mapIdx: idx,
      scanIdx: fallback,
    });
  }
  return fallback;
}

/** Simple id-only lookup for hook events. Map fast-path + findIndex fallback. */
export function findHeIdx(
  he: HookEvent[],
  index: Map<string, number>,
  toolUseId: string,
): number {
  const idx = index.get(toolUseId);
  if (
    idx !== undefined &&
    he[idx] &&
    (he[idx] as Record<string, unknown>).tool_use_id === toolUseId
  )
    return idx;
  const fallback = he.findIndex(
    (e) => (e as Record<string, unknown>).tool_use_id === toolUseId,
  );
  if (fallback >= 0) {
    dbgWarn("store", "findHeIdx: index miss, found via scan", {
      toolUseId,
      mapIdx: idx,
      scanIdx: fallback,
    });
  }
  return fallback;
}

/** Status-aware hook event lookup: Map fast-path + status validation + scan fallback. */
export function findHeIdxByStatus(
  he: HookEvent[],
  index: Map<string, number>,
  toolUseId: string,
  status: string,
): number {
  const idx = index.get(toolUseId);
  if (
    idx !== undefined &&
    he[idx] &&
    (he[idx] as Record<string, unknown>).tool_use_id === toolUseId &&
    he[idx].status === status
  ) {
    return idx;
  }
  return he.findIndex(
    (e) => (e as Record<string, unknown>).tool_use_id === toolUseId && e.status === status,
  );
}

/** Find the parent tool entry in timeline by tool_use_id; return index or -1. */
export function findParentToolIdx(
  tl: TimelineEntry[],
  index: Map<string, number>,
  parentToolUseId: string,
): number {
  return findToolIdx(tl, index, parentToolUseId);
}

/** Extract thinkingText from a parent tool's synthetic streaming entry. */
export function extractSubTimelineThinking(
  tl: TimelineEntry[],
  index: Map<string, number>,
  parentToolUseId: string,
): string | undefined {
  const pIdx = findParentToolIdx(tl, index, parentToolUseId);
  if (pIdx < 0) return undefined;
  const parent = tl[pIdx] as Extract<TimelineEntry, { kind: "tool" }>;
  const sub = parent.subTimeline ?? [];
  const syntheticId = `__sub_stream_${parentToolUseId}`;
  const entry = sub.find((e) => e.kind === "assistant" && e.id === syntheticId);
  if (!entry || entry.kind !== "assistant") return undefined;
  return entry.thinkingText;
}

/** Extract streamed assistant content from a parent tool's synthetic subTimeline entry. */
export function extractSubTimelineStreamingContent(
  tl: TimelineEntry[],
  index: Map<string, number>,
  parentToolUseId: string,
): string {
  const pIdx = findParentToolIdx(tl, index, parentToolUseId);
  if (pIdx < 0) return "";
  const parent = tl[pIdx] as Extract<TimelineEntry, { kind: "tool" }>;
  const sub = parent.subTimeline ?? [];
  const syntheticId = `__sub_stream_${parentToolUseId}`;
  const entry = sub.find((e) => e.kind === "assistant" && e.id === syntheticId);
  if (!entry || entry.kind !== "assistant") return "";
  return entry.content;
}

/** Accumulate partial JSON and try to parse. Returns merged tool fields. */
export function accumulateJsonInput(
  tool: Record<string, unknown>,
  partialJson: string,
): { input?: Record<string, unknown>; _inputJsonAccum: string } {
  const prevAccum = ((tool as Record<string, unknown>)._inputJsonAccum as string) ?? "";
  const newAccum = prevAccum + partialJson;
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(newAccum);
  } catch {
    /* incomplete JSON */
  }
  return { ...(parsed ? { input: parsed } : {}), _inputJsonAccum: newAccum };
}

// ── Mutating helpers ─────────────────────────────────────────────────────────
// These mutate the passed-in `tl` array in place.
// For live-mode callers: clone the array first, then pass the clone.

/** Search ALL subTimelines (one level deep) for a tool with the given id.
 *  Returns true if found and updated; false if not found. */
export function updateToolInAnySubTimeline(
  tl: TimelineEntry[],
  toolUseId: string,
  updater: (old: BusToolItem) => BusToolItem,
): boolean {
  for (let pIdx = 0; pIdx < tl.length; pIdx++) {
    const entry = tl[pIdx];
    if (entry.kind !== "tool" || !entry.subTimeline) continue;
    const sub = entry.subTimeline;
    const cIdx = sub.findIndex((e) => e.kind === "tool" && e.id === toolUseId);
    if (cIdx < 0) continue;
    const oldChild = sub[cIdx] as Extract<TimelineEntry, { kind: "tool" }>;
    const newSub = [...sub];
    newSub[cIdx] = { ...oldChild, tool: updater(oldChild.tool) };
    tl[pIdx] = { ...entry, subTimeline: newSub };
    dbg("store", "found tool in subTimeline (missing parent_tool_use_id)", {
      tool: toolUseId,
      parent: entry.id,
    });
    return true;
  }
  return false;
}

/** Append an entry to a parent tool's subTimeline. Mutates tl[parentIdx] in place. */
export function appendToSubTimeline(
  tl: TimelineEntry[],
  parentIdx: number,
  entry: TimelineEntry,
): void {
  const old = tl[parentIdx] as Extract<TimelineEntry, { kind: "tool" }>;
  tl[parentIdx] = { ...old, subTimeline: [...(old.subTimeline ?? []), entry] };
}

/** Update a tool entry inside a parent tool's subTimeline. Returns true if found. */
export function updateSubTimelineTool(
  tl: TimelineEntry[],
  index: Map<string, number>,
  parentToolUseId: string,
  childToolUseId: string,
  updater: (old: BusToolItem) => BusToolItem,
): boolean {
  const pIdx = findParentToolIdx(tl, index, parentToolUseId);
  if (pIdx < 0) return false;
  const parent = tl[pIdx] as Extract<TimelineEntry, { kind: "tool" }>;
  const sub = parent.subTimeline ?? [];
  const cIdx = sub.findIndex((e) => e.kind === "tool" && e.id === childToolUseId);
  if (cIdx < 0) return false;
  const oldChild = sub[cIdx] as Extract<TimelineEntry, { kind: "tool" }>;
  const newSub = [...sub];
  newSub[cIdx] = { ...oldChild, tool: updater(oldChild.tool) };
  tl[pIdx] = { ...parent, subTimeline: newSub };
  return true;
}

/** Append/update a synthetic assistant entry in a parent tool's subTimeline
 *  for streaming deltas. Mutates tl in place. */
export function appendSubTimelineStreamingDelta(
  tl: TimelineEntry[],
  index: Map<string, number>,
  parentToolUseId: string,
  field: "content" | "thinkingText",
  text: string,
): void {
  const pIdx = findParentToolIdx(tl, index, parentToolUseId);
  if (pIdx < 0) return;
  const parent = tl[pIdx] as Extract<TimelineEntry, { kind: "tool" }>;
  const sub = parent.subTimeline ?? [];
  const syntheticId = `__sub_stream_${parentToolUseId}`;
  const sIdx = sub.findIndex((e) => e.kind === "assistant" && e.id === syntheticId);
  let newSub: TimelineEntry[];
  if (sIdx >= 0) {
    const old = sub[sIdx] as Extract<TimelineEntry, { kind: "assistant" }>;
    newSub = [...sub];
    if (field === "content") {
      newSub[sIdx] = { ...old, content: old.content + text };
    } else {
      newSub[sIdx] = { ...old, thinkingText: (old.thinkingText ?? "") + text };
    }
  } else {
    const entry: TimelineEntry =
      field === "content"
        ? {
            kind: "assistant",
            id: syntheticId,
            anchorId: syntheticId,
            content: text,
            ts: new Date().toISOString(),
          }
        : {
            kind: "assistant",
            id: syntheticId,
            anchorId: syntheticId,
            content: "",
            thinkingText: text,
            ts: new Date().toISOString(),
          };
    newSub = [...sub, entry];
  }
  tl[pIdx] = { ...parent, subTimeline: newSub };
}

/** Remove the synthetic streaming entry from a parent tool's subTimeline. */
export function removeSubTimelineStreamingEntry(
  tl: TimelineEntry[],
  index: Map<string, number>,
  parentToolUseId: string,
): void {
  const pIdx = findParentToolIdx(tl, index, parentToolUseId);
  if (pIdx < 0) return;
  const parent = tl[pIdx] as Extract<TimelineEntry, { kind: "tool" }>;
  const sub = parent.subTimeline ?? [];
  const syntheticId = `__sub_stream_${parentToolUseId}`;
  const sIdx = sub.findIndex((e) => e.kind === "assistant" && e.id === syntheticId);
  if (sIdx < 0) return;
  const newSub = [...sub];
  newSub.splice(sIdx, 1);
  tl[pIdx] = { ...parent, subTimeline: newSub };
}

/** Patch an empty assistant entry's content. Returns true if patched. */
export function patchAssistantContentIfEmpty(
  tl: TimelineEntry[],
  messageId: string,
  content: string,
): boolean {
  if (!content.trim()) return false;
  const idx = tl.findIndex((e) => e.kind === "assistant" && e.id === messageId);
  if (idx < 0) return false;
  const old = tl[idx] as Extract<TimelineEntry, { kind: "assistant" }>;
  if (old.content.trim()) return false;
  tl[idx] = { ...old, content };
  dbgWarn("store", "patched empty assistant entry", {
    messageId,
    contentLen: content.length,
  });
  return true;
}

/**
 * Resolve stale tool entries to "error" across main timeline and all subTimelines.
 * Used by idle/spawning/control_cancelled cleanup. Mutates tl in place.
 */
export function resolveStaleTools(
  tl: TimelineEntry[],
  predicate: (tool: BusToolItem) => boolean,
): void {
  for (let i = 0; i < tl.length; i++) {
    const e = tl[i];
    if (e.kind !== "tool") continue;

    // Top-level tool
    let parentUpdated = e;
    if (predicate(e.tool)) {
      parentUpdated = { ...e, tool: { ...e.tool, status: "error" as const } };
      tl[i] = parentUpdated;
      dbg("store", "resolved stale tool", { id: e.id, name: e.tool.tool_name });
    }

    // subTimeline children
    const sub = parentUpdated.subTimeline;
    if (!sub) continue;
    let subChanged = false;
    let newSub = sub;
    for (let j = 0; j < newSub.length; j++) {
      const child = newSub[j];
      if (child.kind !== "tool" || !predicate(child.tool)) continue;
      if (!subChanged) {
        newSub = [...newSub];
        subChanged = true;
      }
      newSub[j] = { ...child, tool: { ...child.tool, status: "error" as const } };
      dbg("store", "resolved stale sub-tool", { id: child.id, name: child.tool.tool_name });
    }
    if (subChanged) {
      tl[i] = { ...parentUpdated, subTimeline: newSub };
    }
  }
}
