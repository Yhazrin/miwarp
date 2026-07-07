/**
 * TauriTransport: wraps @tauri-apps/api for desktop IPC.
 *
 * The listen wrapper unwraps the Tauri event envelope so callers receive
 * the raw payload directly (consistent with WsTransport).
 *
 * The desktop-only API methods (`getAppVersion`, `openDialog`, ...) keep the
 * dynamic-import pattern alive: each one lazy-loads its underlying
 * `@tauri-apps/api/*` module so SSR and test environments never pay for code
 * they can't use. Components reach these via `getTransport()` instead of
 * importing `@tauri-apps/*` directly, keeping the ESLint boundary intact.
 */
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { dbg } from "$lib/utils/debug";
import {
  getInvokeTimeoutMs,
  type DesktopWebviewWindowLike,
  type DesktopWindowLike,
  type TauriDpiModule,
  type TauriWebviewModule,
  type Transport,
} from "./contract";
import {
  ConnectionState,
  type ConnectionStateListener,
  type ConnectionStateValue,
} from "./connection-state";

export class TauriTransport implements Transport {
  async invoke<T>(
    cmd: string,
    args?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    dbg("transport", "tauri.invoke", { cmd });
    const timeoutMs = options?.timeoutMs ?? getInvokeTimeoutMs(cmd);
    const tauriPromise = invoke<T>(cmd, args);
    if (!timeoutMs) return tauriPromise;
    let timer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`IPC_TIMEOUT: ${cmd} did not respond in ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    return Promise.race([tauriPromise, timeoutPromise]).finally(() => clearTimeout(timer));
  }

  async listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
    dbg("transport", "tauri.listen", { event });
    return tauriListen<T>(event, (e) => handler(e.payload));
  }

  fileAssetUrl(path: string): string {
    // Tauri asset protocol lets the WebView read the file directly from
    // disk instead of round-tripping bytes through the IPC channel.
    return convertFileSrc(path, "asset");
  }

  isDesktop(): boolean {
    return true;
  }

  subscribeRun(_runId: string, _lastSeq?: number, _ownerId?: string): void {
    // No-op: Tauri receives all events via app.emit(), no explicit subscription needed
  }

  unsubscribeRun(_runId: string, _ownerId?: string): void {
    // No-op
  }

  getConnectionState(): ConnectionStateValue {
    return ConnectionState.Open;
  }

  onConnectionStateChange(_listener: ConnectionStateListener): () => void {
    return () => {};
  }

  dispose(): void {
    // No-op: Tauri transport doesn't own persistent resources
  }

  // ---------------------------------------------------------------------------
  // Desktop-only API surface (lazy dynamic imports).
  // ---------------------------------------------------------------------------

  async getAppVersion(): Promise<string> {
    const { getVersion } = await import("@tauri-apps/api/app");
    return getVersion();
  }

  async getCurrentWindow(): Promise<DesktopWindowLike> {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow() as unknown as DesktopWindowLike;
  }

  async getCurrentWebviewWindow(): Promise<DesktopWebviewWindowLike> {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    return getCurrentWebviewWindow() as unknown as DesktopWebviewWindowLike;
  }

  async loadWebviewModule(): Promise<TauriWebviewModule> {
    return await import("@tauri-apps/api/webview");
  }

  async loadDpiModule(): Promise<TauriDpiModule> {
    return await import("@tauri-apps/api/dpi");
  }

  async openDialog(options?: Record<string, unknown>): Promise<unknown> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    return open(options as Parameters<typeof open>[0]);
  }

  async saveDialog(options?: Record<string, unknown>): Promise<string | null> {
    const { save } = await import("@tauri-apps/plugin-dialog");
    return save(options as Parameters<typeof save>[0]);
  }

  async shellOpen(path: string): Promise<void> {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(path);
  }
}
