import type { TimelineEntry } from "$lib/types";
import type { TurnUsage } from "$lib/stores/types";

export function buildTurnUsageMap(turnUsages: TurnUsage[]): Map<number, TurnUsage> {
  return new Map(turnUsages.map((tu) => [tu.turnIndex, tu]));
}

/** Prefix-sum of user message count across `filteredTimeline` (for progressive offset). */
export function computeUserCountPrefix(filteredTimeline: TimelineEntry[]): Int32Array {
  const arr = new Int32Array(filteredTimeline.length + 1);
  for (let i = 0; i < filteredTimeline.length; i++) {
    arr[i + 1] = arr[i] + (filteredTimeline[i].kind === "user" ? 1 : 0);
  }
  return arr;
}

/** Map visibleTimeline index → TurnUsage to show before this user entry. */
export function computeUsageAnnotations(
  usageByTurn: Map<number, TurnUsage>,
  visibleTimeline: TimelineEntry[],
  filteredTimelineLength: number,
  userCountPrefix: Int32Array,
): Map<number, TurnUsage> {
  const map = new Map<number, TurnUsage>();
  if (usageByTurn.size === 0) return map;
  const hidden = filteredTimelineLength - visibleTimeline.length;
  let userCount = userCountPrefix[hidden] ?? 0;
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

export function computeLastTurnUsage(
  filteredTimeline: TimelineEntry[],
  usageByTurn: Map<number, TurnUsage>,
): TurnUsage | null {
  const userCount = filteredTimeline.filter((e) => e.kind === "user").length;
  if (userCount === 0) return null;
  return usageByTurn.get(userCount) ?? null;
}
