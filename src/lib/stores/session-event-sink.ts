import type { BusEvent, HookEvent } from "$lib/types";

/** Usage totals forwarded from CLI hook stream (matches hook-usage event shape). */
export interface SessionHookUsagePayload {
  run_id: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

/**
 * Narrow surface SessionStore exposes to EventMiddleware.
 * Decouples middleware from session-store.svelte.ts and breaks the import cycle.
 */
export interface SessionEventSink {
  loadRun(id: string, xtermRef?: { clear(): void; writeText(s: string): void }): Promise<void>;
  applyEvent(ev: BusEvent): void;
  applyEventBatch(events: BusEvent[], opts?: { replayOnly?: boolean }): number;
  applyHookEvent(event: HookEvent): void;
  applyHookUsage(usage: SessionHookUsagePayload): void;
}
