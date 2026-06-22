import * as api from "$lib/api";
import type { RuntimeDetectionMap } from "./types";
import type { SupportedRuntimeId } from "./types";

/** Controlled API detection only — no shell/curl from UI. */
export async function probeRuntimeAvailability(): Promise<RuntimeDetectionMap> {
  const [claudeResult, codexResult, mimoResult] = await Promise.all([
    api
      .checkAgentCli("claude")
      .catch(() => ({ agent: "claude", found: false, path: undefined, version: undefined })),
    api
      .checkAgentCli("codex")
      .catch(() => ({ agent: "codex", found: false, path: undefined, version: undefined })),
    api.detectMimoRuntime().catch(() => ({ available: false, binary: "mimo", version: null })),
  ]);

  const detection: RuntimeDetectionMap = {
    claude: {
      available: claudeResult.found ?? false,
      binary: claudeResult.path ?? "claude",
      version: claudeResult.version ?? null,
    },
    codex: {
      available: codexResult.found ?? false,
      binary: codexResult.path ?? "codex",
      version: codexResult.version ?? null,
    },
    mimo: {
      available: mimoResult.available,
      binary: mimoResult.binary,
      version: mimoResult.version,
    },
  };

  return detection;
}

export async function probeRuntimeAvailabilityFor(
  id: SupportedRuntimeId,
): Promise<RuntimeDetectionMap[SupportedRuntimeId] | undefined> {
  const all = await probeRuntimeAvailability();
  return all[id];
}
