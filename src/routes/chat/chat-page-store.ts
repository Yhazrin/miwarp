/**
 * Shared derived state for the chat page.
 *
 * Extracts commonly-used timeline computations out of +page.svelte
 * so they can be tested independently and reused by child components.
 */
import type { TimelineEntry } from "$lib/types";
import type { TurnUsage } from "$lib/stores/types";

/** Compute the visible (progressive-render) slice of the filtered timeline. */
export function computeVisibleTimeline(
  filtered: TimelineEntry[],
  renderLimit: number,
): TimelineEntry[] {
  const start = Math.max(0, filtered.length - renderLimit);
  return filtered.slice(start);
}

/** Build a map of visibleTimeline index → TurnUsage for turn-boundary annotations. */
export function computeUsageAnnotations(
  visibleTimeline: TimelineEntry[],
  filteredTimeline: TimelineEntry[],
  usageByTurn: Map<number, TurnUsage>,
): Map<number, TurnUsage> {
  const map = new Map<number, TurnUsage>();
  if (usageByTurn.size === 0) return map;

  const hidden = filteredTimeline.length - visibleTimeline.length;
  let userCount = 0;
  for (let i = 0; i < hidden; i++) {
    if (filteredTimeline[i].kind === "user") userCount++;
  }

  for (let i = 0; i < visibleTimeline.length; i++) {
    if (visibleTimeline[i].kind === "user") {
      if (userCount > 0) {
        const tu = usageByTurn.get(userCount);
        if (tu) map.set(i, tu);
      }
      userCount++;
    }
  }
  return map;
}

/** Detect indices where a Claude turn starts (first tool after a user message). */
export function computeClaudeTurnStarts(
  visibleTimeline: TimelineEntry[],
  burstHiddenIndices: Set<number>,
): Set<number> {
  const starts = new Set<number>();
  for (let i = 0; i < visibleTimeline.length; i++) {
    if (visibleTimeline[i].kind !== "tool") continue;
    if (burstHiddenIndices.has(i)) continue;
    for (let j = i - 1; j >= 0; j--) {
      if (burstHiddenIndices.has(j)) continue;
      if (visibleTimeline[j].kind === "tool") continue;
      if (visibleTimeline[j].kind === "user") starts.add(i);
      break;
    }
  }
  return starts;
}

/** Get the usage for the last (current) turn. */
export function computeLastTurnUsage(
  filteredTimeline: TimelineEntry[],
  usageByTurn: Map<number, TurnUsage>,
): TurnUsage | null {
  const userCount = filteredTimeline.filter((e) => e.kind === "user").length;
  if (userCount === 0) return null;
  return usageByTurn.get(userCount) ?? null;
}

/** Prefix-sum of user message count across timeline entries. */
export function computeUserCountPrefix(filtered: TimelineEntry[]): Int32Array {
  const arr = new Int32Array(filtered.length + 1);
  for (let i = 0; i < filtered.length; i++) {
    arr[i + 1] = arr[i] + (filtered[i].kind === "user" ? 1 : 0);
  }
  return arr;
}
