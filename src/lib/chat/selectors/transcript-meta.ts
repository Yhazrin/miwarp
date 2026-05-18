import type { TimelineEntry } from "$lib/types";
import { CONTEXT_CLEARED_MARKER } from "$lib/utils/slash-commands";

/** ID of the last context-cleared separator (for dimming messages above it). */
export function selectLastContextClearSeparatorId(timeline: TimelineEntry[]): string | null {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const e = timeline[i];
    if (e.kind === "separator" && e.content === CONTEXT_CLEARED_MARKER) return e.id;
  }
  return null;
}
