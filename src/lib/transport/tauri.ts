/**
 * TauriTransport: wraps @tauri-apps/api for desktop IPC.
 *
 * The listen wrapper unwraps the Tauri event envelope so callers receive
 * the raw payload directly (consistent with WsTransport).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { dbg } from "$lib/utils/debug";
import { getInvokeTimeoutMs, type Transport } from "./contract";
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
}
