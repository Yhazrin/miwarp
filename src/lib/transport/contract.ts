/**
 * Transport contract — shared types and helpers for the transport layer.
 *
 * Both `tauri.ts` and `websocket.ts` depend on this contract, while `index.ts`
 * only re-exports it. The contract imports connection-state types directly so
 * implementations never need to depend on the transport barrel.
 */
import type { ConnectionStateListener, ConnectionStateValue } from "./connection-state";

export interface Transport {
  invoke<T>(
    cmd: string,
    args?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
  isDesktop(): boolean;
  /**
   * Resolve a local file path to a URL the renderer can stream (image / video /
   * audio / binary). Tauri uses the `asset:` protocol so the WebView reads
   * the file directly from disk; the WebSocket transport returns a
   * browser-fetchable URL since there's no Tauri runtime in the browser.
   */
  fileAssetUrl(path: string): string;
  /** Subscribe to a run's real-time events (WS only, no-op on desktop). */
  subscribeRun(runId: string, lastSeq?: number, ownerId?: string): void;
  /** Unsubscribe one logical owner from a run (WS only, no-op on desktop). */
  unsubscribeRun(runId: string, ownerId?: string): void;
  /** Current connection state without leaking adapter implementation details. */
  getConnectionState(): ConnectionStateValue;
  /** Subscribe to future connection-state transitions. */
  onConnectionStateChange(listener: ConnectionStateListener): () => void;
  /** Release transport-owned timers, sockets, requests, and subscriptions. */
  dispose?(): void;
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
