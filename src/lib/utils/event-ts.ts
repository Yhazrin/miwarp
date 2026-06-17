/**
 * Shared bus-event timestamp helpers.
 *
 * These were originally private helpers inside session-store.svelte.ts.
 * Extracted so per-event-family reducers (in stores/reducers/) can use them
 * without depending on the store.
 */
import type { BusEvent } from "$lib/types";

/** Get an event's timestamp as ISO string. Falls back to now(). */
export function eventTs(ev: BusEvent): string {
  const r = ev as Record<string, unknown>;
  return (r.ts as string) ?? (r.timestamp as string) ?? new Date().toISOString();
}

/** Parse an event's timestamp to epoch milliseconds. Falls back to Date.now(). */
export function eventTsMs(ev: BusEvent): number {
  const iso = eventTs(ev);
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}
