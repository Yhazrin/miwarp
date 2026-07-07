/**
 * Transport contract — shared types and helpers for the transport layer.
 *
 * Both `tauri.ts` and `websocket.ts` depend on this contract, while `index.ts`
 * only re-exports it. The contract imports connection-state types directly so
 * implementations never need to depend on the transport barrel.
 *
 * Type imports from `@tauri-apps/api/*` are allowed because they are erased at
 * compile time — runtime imports stay confined to `src/lib/transport/`.
 */
import type { ConnectionStateListener, ConnectionStateValue } from "./connection-state";
import type { Webview as TauriWebview } from "@tauri-apps/api/webview";
import type * as TauriWebviewApi from "@tauri-apps/api/webview";
import type * as TauriDpiApi from "@tauri-apps/api/dpi";

/** Re-export of the Tauri Webview class so callers can `new` instances. */
export type { TauriWebview };

/** Shape of the Tauri `webview` module surface that callers consume. */
export type TauriWebviewModule = typeof TauriWebviewApi;

/** Shape of the Tauri `dpi` module surface that callers consume. */
export type TauriDpiModule = typeof TauriDpiApi;

/** Minimal surface of a Tauri webview/window used by the renderer. */
export interface DesktopWebviewWindowLike {
  setZoom(factor: number): Promise<void>;
}

/** Minimal surface of a Tauri Window used by renderer code. */
export interface DesktopWindowLike {
  // Kept open for future call sites — kept honest by the index signature.
  [key: string]: unknown;
}

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

  // ---------------------------------------------------------------------------
  // Desktop-only API surface (lazy-loaded inside the transport).
  // WebSocket transport throws (or no-ops for `shellOpen`) because the
  // underlying Tauri runtime / plugins are absent. Callers must gate these
  // with `isDesktop()` first.
  // ---------------------------------------------------------------------------

  /** Read the bundled application version (Tauri app metadata). */
  getAppVersion(): Promise<string>;
  /** Resolve the current desktop window. */
  getCurrentWindow(): Promise<DesktopWindowLike>;
  /** Resolve the current desktop webview window (supports `setZoom`). */
  getCurrentWebviewWindow(): Promise<DesktopWebviewWindowLike>;
  /** Load the Tauri `webview` module (needed for `new Webview(...)`). */
  loadWebviewModule(): Promise<TauriWebviewModule>;
  /** Load the Tauri `dpi` module (needed for `LogicalSize` / `LogicalPosition`). */
  loadDpiModule(): Promise<TauriDpiModule>;
  /** Open a native file/folder picker dialog. */
  openDialog(options?: Record<string, unknown>): Promise<unknown>;
  /** Open a native save dialog; returns the chosen path or `null`. */
  saveDialog(options?: Record<string, unknown>): Promise<string | null>;
  /** Open a path or URL via the system shell / OS default handler. */
  shellOpen(path: string): Promise<void>;
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
