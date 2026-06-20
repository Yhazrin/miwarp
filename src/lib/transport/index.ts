/**
 * Transport abstraction layer.
 *
 * Detects Tauri desktop vs browser environment and returns the appropriate
 * transport implementation. The singleton is cached after first call.
 *
 * The shared `Transport` contract lives in `./contract` to break the
 * historical barrel cycle: this file imports implementations, the
 * implementations import the contract.
 */
import { dbg } from "$lib/utils/debug";
import { TauriTransport } from "./tauri";
import { WsTransport } from "./websocket";
import { getInvokeTimeoutMs, type Transport } from "./contract";

export { getInvokeTimeoutMs };
export type { Transport };

let _instance: Transport | null = null;

export function getTransport(): Transport {
  if (!_instance) {
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

    _instance = isTauri ? new TauriTransport() : new WsTransport();

    dbg("transport", "initialized", { type: _instance.isDesktop() ? "tauri" : "websocket" });
  }
  return _instance;
}
