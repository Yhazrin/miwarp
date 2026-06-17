import type { BusEvent } from "$lib/types";
import { getTransport } from "$lib/transport";

function busEventSeq(event: BusEvent): number {
  const seq = (event as Record<string, unknown>)._seq;
  return typeof seq === "number" && Number.isFinite(seq) ? seq : 0;
}

export function replayCheckpoint(events: BusEvent[]): number {
  if (events.length === 0) return 0;
  return events.reduce((max, event) => Math.max(max, busEventSeq(event)), 0);
}

export function subscribeRunFromReplay(runId: string, events: BusEvent[]): void {
  subscribeRunFromSeq(runId, replayCheckpoint(events));
}

export function subscribeRunFresh(runId: string): void {
  subscribeRunFromSeq(runId, 0);
}

export function subscribeRunFromSeq(runId: string, lastSeq: number): void {
  if (!runId) return;
  const transport = getTransport();
  if (transport.isDesktop()) return;
  transport.subscribeRun(runId, Math.max(0, lastSeq));
}
