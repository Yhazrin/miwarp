import type { TimelineEntry } from "$lib/types";

/** Distinct tool names in timeline, sorted. */
export function selectSortedToolNames(timeline: TimelineEntry[]): string[] {
  const names = new Set<string>();
  for (const entry of timeline) {
    if (entry.kind === "tool") names.add(entry.tool.tool_name);
  }
  return [...names].sort();
}

/** Filter transcript tools by name; `null` means full timeline. */
export function filterTimelineByToolName(
  timeline: TimelineEntry[],
  toolFilter: string | null,
): TimelineEntry[] {
  if (!toolFilter) return timeline;
  return timeline.filter((e) => e.kind !== "tool" || e.tool.tool_name === toolFilter);
}

/**
 * Indices where a Claude turn starts (first tool after a user message),
 * skipping burst-hidden slots.
 */
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
