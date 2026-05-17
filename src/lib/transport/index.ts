/**
 * Transport abstraction layer.
 *
 * Detects Tauri desktop vs browser environment and returns the appropriate
 * transport implementation. The singleton is cached after first call.
 */
import { isTauri as runtimeIsTauri } from "@tauri-apps/api/core";
import { dbg } from "$lib/utils/debug";
import { TauriTransport } from "./tauri";
import { WsTransport } from "./websocket";
import type { Transport } from "./transport-types";

export type { Transport } from "./transport-types";

let _instance: Transport | null = null;

function detectTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;

  const w = window as typeof window & {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
    isTauri?: boolean;
  };

  return runtimeIsTauri() || !!w.__TAURI_INTERNALS__ || !!w.__TAURI__ || w.isTauri === true;
}

export function getTransport(): Transport {
  if (!_instance) {
    const isTauri = detectTauriRuntime();

    _instance = isTauri ? new TauriTransport() : new WsTransport();

    dbg("transport", "initialized", { type: _instance.isDesktop() ? "tauri" : "websocket" });
  }
  return _instance;
}
