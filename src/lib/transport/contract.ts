/**
 * Transport contract — shared types and helpers for the transport layer.
 *
 * This module is a true leaf: it imports nothing from project sources. Both
 * `tauri.ts` and `websocket.ts` depend on it, and `index.ts` re-exports
 * from it. Keeping the contract in its own file breaks the historical
 * barrel cycle (transport/index.ts ↔ tauri.ts ↔ websocket.ts).
 */
export interface Transport {
  invoke<T>(
    cmd: string,
    args?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
  isDesktop(): boolean;
  /** Subscribe to a run's real-time events (WS only, no-op on desktop) */
  subscribeRun(runId: string, lastSeq?: number): void;
  /** Unsubscribe from a run's events (WS only, no-op on desktop) */
  unsubscribeRun(runId: string): void;
}

/** Default timeout per command category */
const CMD_TIMEOUTS: Record<string, number> = {
  // Long-running: start, send, resume
  start_session: 45_000,
  send_session_message: 45_000,
  resume_session: 45_000,
  approve_session_tool: 45_000,
  // Large payloads: summarize, export
  generate_insight: 120_000,
  export_insight: 120_000,
};
const DEFAULT_INVOKE_TIMEOUT = 30_000;

/** Resolve timeout for a command name */
export function getInvokeTimeoutMs(cmd: string): number {
  return CMD_TIMEOUTS[cmd] ?? DEFAULT_INVOKE_TIMEOUT;
}
