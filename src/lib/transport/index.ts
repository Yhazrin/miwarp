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
;
export type { Transport };
export type {TauriWebview}from "./contract";;

let _instance: Transport | null = null;

export function getTransport(): Transport {
  if (!_instance) {
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

    _instance = isTauri ? new TauriTransport() : new WsTransport();

    dbg("transport", "initialized", { type: _instance.isDesktop() ? "tauri" : "websocket" });
  }
  return _instance;
}

/**
 * Resolve a local file path to a streamable URL via the active transport.
 * Tauri returns the `asset:` protocol URL; the WebSocket transport returns
 * a browser-fetchable `/_asset/<path>` URL. See Transport.fileAssetUrl.
 */
export function getFileAssetUrl(path: string): string {
  return getTransport().fileAssetUrl(path);
}

/** Reset the singleton (for testing). Disposes the current instance first. */
function _resetTransport(): void {
  if (_instance) {
    _instance.dispose?.();
    _instance = null;
  }
}
;
;
;
;
;
;
;
;
;
export type {TimeoutApi}from "./timer-api";;
export { systemTimers } from "./timer-api";
