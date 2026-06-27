/** Shared constants for opt-in runtime real E2E tests (mirrors Rust harness). */

export const RUNTIME_REAL_E2E_ENV = "MIWARP_RUNTIME_REAL_E2E";
export const RUNTIME_REAL_E2E_RUNTIMES_ENV = "MIWARP_RUNTIME_REAL_E2E_RUNTIMES";
export const RUNTIME_E2E_PROBE_ONLY_ENV = "MIWARP_RUNTIME_E2E_PROBE_ONLY";
export const RUNTIME_SMOKE_TIMEOUT_ENV = "MIWARP_RUNTIME_SMOKE_TIMEOUT_SECS";

export const SKIPPED_ENVIRONMENT = "SKIPPED_ENVIRONMENT";

export const STARTABLE_RUNTIMES = ["claude", "codex", "mimo", "opencode", "cursor"] as const;
export type StartableRuntimeId = (typeof STARTABLE_RUNTIMES)[number];

export type ProbeState = "binary_missing" | "unauthenticated" | "unsupported" | "ready";

export function isRealRuntimeE2eEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[RUNTIME_REAL_E2E_ENV];
  return value === "1" || value?.toLowerCase() === "true";
}

export function shouldSkipForProbeState(state: ProbeState): boolean {
  return state !== "ready";
}

export function skipLabelForProbeState(state: ProbeState): typeof SKIPPED_ENVIRONMENT | null {
  return shouldSkipForProbeState(state) ? SKIPPED_ENVIRONMENT : null;
}

export function parseSelectedRuntimes(raw: string | undefined): StartableRuntimeId[] {
  if (!raw?.trim()) return [...STARTABLE_RUNTIMES];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is StartableRuntimeId =>
      (STARTABLE_RUNTIMES as readonly string[]).includes(item),
    );
}
