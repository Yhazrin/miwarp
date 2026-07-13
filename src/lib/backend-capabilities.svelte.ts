import { getBackendCapabilities } from "$lib/api";
import type { BackendCapabilities } from "$lib/types";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { getTransport } from "$lib/transport";

const LEGACY_COMMANDS = ["list_runs"];

let caps = $state<BackendCapabilities | null>(null);
let legacyMode = $state(false);
let initialized = $state(false);
let versionMismatch = $state(false);
let frontendVersion = $state<string | null>(null);
let listRunsSinceUnsupportedWarned = false;

function normalizeVersion(v: string): string {
  return v.trim().replace(/^v/i, "");
}

export function getBackendCaps(): BackendCapabilities | null {
  return caps;
}

export function isLegacyBackend(): boolean {
  return legacyMode;
}

export function backendCapabilitiesReady(): boolean {
  return initialized;
}

export function hasVersionMismatch(): boolean {
  return versionMismatch;
}

export function getFrontendVersionLabel(): string | null {
  return frontendVersion;
}

export function getBackendVersionLabel(): string | null {
  return caps?.appVersion ?? null;
}

/** Whether incremental run sync (`list_runs_since`) is safe to call. */
export function useIncrementalRunsSync(): boolean {
  if (!initialized || legacyMode) return false;
  return supportsCommand("list_runs_since");
}

export function supportsCommand(command: string): boolean {
  if (!initialized) return LEGACY_COMMANDS.includes(command);
  if (legacyMode) return LEGACY_COMMANDS.includes(command);
  return caps?.supportedCommands.includes(command) ?? false;
}

export function warnListRunsSinceUnsupportedOnce(): void {
  if (listRunsSinceUnsupportedWarned) return;
  listRunsSinceUnsupportedWarned = true;
  dbgWarn("api", "list_runs_since not supported by running backend; using full list_runs sync");
}

export async function initBackendCapabilities(): Promise<void> {
  if (initialized) return;

  try {
    const backendCaps = await getBackendCapabilities();
    caps = backendCaps;
    legacyMode = false;

    // Browser clients use the WebSocket command bridge, so capability probing
    // is both available and essential for incremental synchronization. Only
    // the desktop shell can read its bundled application version directly.
    if (getTransport().isDesktop()) {
      const { getVersion } = await import("@tauri-apps/api/app");
      frontendVersion = normalizeVersion(await getVersion());
      const backendVersion = normalizeVersion(backendCaps.appVersion);
      versionMismatch = frontendVersion !== backendVersion;
      if (versionMismatch) {
        dbgWarn("api", "frontend/backend version mismatch", {
          frontend: frontendVersion,
          backend: backendVersion,
        });
      }
    } else {
      frontendVersion = null;
      versionMismatch = false;
    }
    dbg("api", "backend capabilities", {
      appVersion: backendCaps.appVersion,
      schemaVersion: backendCaps.schemaVersion,
      incrementalRuns: supportsCommand("list_runs_since"),
    });
  } catch (e) {
    legacyMode = true;
    caps = {
      appVersion: "unknown",
      schemaVersion: 0,
      supportedCommands: [...LEGACY_COMMANDS],
    };
    dbgWarn("api", "get_backend_capabilities unavailable; legacy backend mode", e);
  } finally {
    initialized = true;
  }
}
