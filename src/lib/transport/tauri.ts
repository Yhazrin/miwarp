/**
 * TauriTransport: wraps @tauri-apps/api for desktop IPC.
 *
 * The listen wrapper unwraps the Tauri event envelope so callers receive
 * the raw payload directly (consistent with WsTransport).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { dbg } from "$lib/utils/debug";
import type { Transport } from "./transport-types";

export class TauriTransport implements Transport {
  async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    dbg("transport", "tauri.invoke", { cmd });
    return invoke<T>(cmd, args);
  }

  async listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
    dbg("transport", "tauri.listen", { event });
    return tauriListen<T>(event, (e) => handler(e.payload));
  }

  isDesktop(): boolean {
    return true;
  }

  subscribeRun(_runId: string, _lastSeq?: number): void {
    // No-op: Tauri receives all events via app.emit(), no explicit subscription needed
  }

  unsubscribeRun(_runId: string): void {
    // No-op
  }
}
