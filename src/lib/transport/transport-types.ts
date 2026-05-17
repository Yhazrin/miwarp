/**
 * Shared transport contract — kept separate from index.ts so implementors
 * (tauri.ts, websocket.ts) don't import the singleton module (breaks cycles).
 */
export interface Transport {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
  isDesktop(): boolean;
  /** Subscribe to a run's real-time events (WS only, no-op on desktop) */
  subscribeRun(runId: string, lastSeq?: number): void;
  /** Unsubscribe from a run's events (WS only, no-op on desktop) */
  unsubscribeRun(runId: string): void;
}
