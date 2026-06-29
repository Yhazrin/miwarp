/**
 * Composable for per-turn usage annotations and claude turn markers
 * in the visible timeline.
 *
 * Extracted from use-session-derived to keep timeline-domain logic
 * in its own module.
 */
import { untrack } from "svelte";
import type { SessionStore } from "$lib/stores/session-store.svelte";
import type { TimelineEntry } from "$lib/types";
import type { TurnUsage } from "$lib/stores/types";

export interface TimelineAnnotationsContext {
  store: SessionStore;
  getVisibleTimeline: () => TimelineEntry[];
  getFilteredTimeline: () => TimelineEntry[];
  getUserCountPrefix: () => Int32Array;
  getCollapsedIndices: () => Set<number>;
}

export interface TimelineAnnotationsHandle {
  usageByTurn: Map<number, TurnUsage>;
  usageAnnotations: Map<number, TurnUsage>;
  claudeTurnStarts: Set<number>;
  lastTurnUsage: TurnUsage | null;
}

export function createTimelineAnnotations(
  ctx: TimelineAnnotationsContext,
): TimelineAnnotationsHandle {
  const {
    store,
    getVisibleTimeline,
    getFilteredTimeline,
    getUserCountPrefix,
    getCollapsedIndices,
  } = ctx;

  const usageByTurn = $state(new Map<number, TurnUsage>());

  // Subscribe to the primitive length signal only — turnUsages entries are
  // append-only on usage_update events. Mutate the Map in place so downstream
  // $state subscribers re-fire on size changes without churning a new Map.
  $effect(() => {
    const length = store.turnUsages.length;
    untrack(() => {
      if (usageByTurn.size === length) return;
      usageByTurn.clear();
      const tu = store.turnUsages;
      for (let i = 0; i < length; i++) {
        usageByTurn.set(tu[i].turnIndex, tu[i]);
      }
    });
  });

  const usageAnnotations = $derived.by(() => {
    const map = new Map<number, TurnUsage>();
    if (usageByTurn.size === 0) return map;
    const vt = getVisibleTimeline();
    const filtered = getFilteredTimeline();
    const hidden = filtered.length - vt.length;
    let userCount = getUserCountPrefix()[hidden];
    for (let i = 0; i < vt.length; i++) {
      if (vt[i].kind === "user") {
        if (userCount > 0) {
          const tu = usageByTurn.get(userCount);
          if (tu) map.set(i, tu);
        }
        userCount++;
      }
    }
    return map;
  });

  const claudeTurnStarts = $derived.by(() => {
    const starts = new Set<number>();
    const vt = getVisibleTimeline();
    const collapsed = getCollapsedIndices();
    for (let i = 0; i < vt.length; i++) {
      if (vt[i].kind !== "tool") continue;
      if (collapsed.has(i)) continue;
      for (let j = i - 1; j >= 0; j--) {
        if (collapsed.has(j)) continue;
        if (vt[j].kind === "tool") continue;
        if (vt[j].kind === "user") starts.add(i);
        break;
      }
    }
    return starts;
  });

  const lastTurnUsage = $derived.by(() => {
    const prefix = getUserCountPrefix();
    const userCount = prefix[prefix.length - 1] ?? 0;
    if (userCount === 0) return null;
    return usageByTurn.get(userCount) ?? null;
  });

  return {
    get usageByTurn() {
      return usageByTurn;
    },
    get usageAnnotations() {
      return usageAnnotations;
    },
    get claudeTurnStarts() {
      return claudeTurnStarts;
    },
    get lastTurnUsage() {
      return lastTurnUsage;
    },
  };
}
