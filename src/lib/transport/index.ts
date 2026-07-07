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

/**
 * Resolve a local file path to a streamable URL via the active transport.
 * Tauri returns the `asset:` protocol URL; the WebSocket transport returns
 * a browser-fetchable `/_asset/<path>` URL. See Transport.fileAssetUrl.
 */
export function getFileAssetUrl(path: string): string {
  return getTransport().fileAssetUrl(path);
}

/** Reset the singleton (for testing). Disposes the current instance first. */
export function _resetTransport(): void {
  if (_instance) {
    _instance.dispose?.();
    _instance = null;
  }
}

export type { WsTransportOptions } from "./websocket";
export {
  ConnectionState,
  ConnectionStateMachine,
  TransportError,
  ConnectionTimeoutError,
  ConnectionFailedError,
  ConnectionClosedError,
  AuthFailureError,
  DisposedError,
  NotConnectedError,
} from "./connection-state";
export type { ConnectionStateListener, ConnectionStateValue } from "./connection-state";
export { RequestRegistry, RequestTimeoutError } from "./request-registry";
export type { RpcError, PendingEntry } from "./request-registry";
export { RunSubscriptions } from "./run-subscriptions";
export { ChunkAssembler } from "./chunk-assembler";
export type { ChunkAssemblerOptions } from "./chunk-assembler";
export {
  CircuitBreaker,
  CircuitOpenError,
  CircuitState,
  createTransportCircuitBreaker,
} from "./circuit-breaker";
export type { TimerApi, TimeoutApi } from "./timer-api";
export { systemTimers } from "./timer-api";
