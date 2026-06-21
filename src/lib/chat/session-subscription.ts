import type { BusEvent } from "$lib/types";

function busEventSeq(event: BusEvent): number {
  const seq = (event as Record<string, unknown>)._seq;
  return typeof seq === "number" && Number.isFinite(seq) ? seq : 0;
}

/** Highest replay sequence represented by a batch of persisted bus events. */
export function replayCheckpoint(events: BusEvent[]): number {
  return events.reduce((max, event) => Math.max(max, busEventSeq(event)), 0);
}
