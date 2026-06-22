import * as api from "$lib/api";
import type { RuntimeDetection, RuntimeDetectionMap, SupportedRuntimeId } from "./types";

type CliProbe = {
  agent: string;
  found: boolean;
  path?: string;
  version?: string;
};

function missing(agent: string): CliProbe {
  return { agent, found: false };
}

export interface RuntimeProbeOutcome {
  detections: RuntimeDetectionMap;
  /** True when every underlying probe rejected — a transport/IO failure
   *  rather than a user whose CLIs are simply not installed. */
  probeFailed: boolean;
}

/** Controlled API detection only — no shell execution from UI. */
export async function probeRuntimeAvailability(): Promise<RuntimeDetectionMap> {
  return (await probeRuntimeAvailabilityWithStatus()).detections;
}

/** Same as `probeRuntimeAvailability` but also reports whether the underlying
 *  probes themselves failed (distinguishing "no CLIs installed" from
 *  "the probe transport is broken"). */
export async function probeRuntimeAvailabilityWithStatus(): Promise<RuntimeProbeOutcome> {
  const settled = await Promise.allSettled([
    api.checkAgentCli("claude"),
    api.checkAgentCli("codex"),
    api.detectMimoRuntime(),
    api.checkAgentCli("opencode"),
    api.checkAgentCli("cursor"),
  ]);

  function unwrap<T>(idx: number, fallback: T): T {
    const r = settled[idx];
    return r.status === "fulfilled" ? (r.value as T) : fallback;
  }

  const claude = unwrap<CliProbe>(0, missing("claude"));
  const codex = unwrap<CliProbe>(1, missing("codex"));
  const mimo = unwrap<{ available: boolean; binary: string; version: string | null }>(2, {
    available: false,
    binary: "mimo",
    version: null,
  });
  const openCode = unwrap<CliProbe>(3, missing("opencode"));
  const cursor = unwrap<CliProbe>(4, missing("cursor"));

  const detections: RuntimeDetectionMap = {
    claude: {
      available: claude.found,
      binary: claude.path ?? "claude",
      version: claude.version ?? null,
    } satisfies RuntimeDetection,
    codex: {
      available: codex.found,
      binary: codex.path ?? "codex",
      version: codex.version ?? null,
    } satisfies RuntimeDetection,
    mimo: {
      available: mimo.available,
      binary: mimo.binary,
      version: mimo.version,
    } satisfies RuntimeDetection,
    opencode: {
      available: openCode.found,
      binary: openCode.path ?? "opencode",
      version: openCode.version ?? null,
    } satisfies RuntimeDetection,
    cursor: {
      available: cursor.found,
      binary: cursor.path ?? "cursor",
      version: cursor.version ?? null,
    } satisfies RuntimeDetection,
  };

  // Only report a transport-level failure when every probe rejected.
  // Partial failures still provide useful availability data and should not
  // be presented as a total Runtime Hub detection outage.
  const probeFailed = settled.every((result) => result.status === "rejected");

  return {
    detections,
    probeFailed,
  };
}

export async function probeRuntimeAvailabilityFor(
  id: SupportedRuntimeId,
): Promise<RuntimeDetectionMap[SupportedRuntimeId] | undefined> {
  return (await probeRuntimeAvailability())[id];
}
