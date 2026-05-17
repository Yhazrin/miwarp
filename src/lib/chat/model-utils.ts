import type { CliModelInfo } from "$lib/types";
import { PLATFORM_PRESETS } from "$lib/utils/platform-presets";

export interface PlatformModelResult {
  platformModels: CliModelInfo[];
  effectiveModels: CliModelInfo[];
  platformDisplayName: string;
}

/** Detect if a model name was contaminated by a third-party platform preset.
 *
 * Returns:
 * - `true`  = confirmed contaminated (in third-party models, not in CLI known models)
 * - `false` = confirmed clean (in CLI model list)
 * - `null`  = unknown (CLI models not loaded, or model not found in any list)
 */
export function isContaminatedDefaultModel(
  model: string,
  platformId: string | undefined,
  cliModels: CliModelInfo[],
  platformCredentials: Array<{ platform_id: string; models?: string[] }>,
): boolean | null {
  if (!cliModels.length) return null;
  if (cliModels.some((m) => m.value === model)) return false;

  const inThirdParty =
    PLATFORM_PRESETS.some(
      (p) => p.id !== "anthropic" && p.id !== "custom" && p.models?.includes(model),
    ) ||
    (platformCredentials ?? []).some(
      (c) => c.platform_id !== "anthropic" && c.models?.includes(model),
    );
  return inThirdParty ? true : null;
}

/** Resolve platform-specific model list, effective available models, and display name.
 *
 * @param platformId   - Currently selected platform ID (e.g. "anthropic", "openrouter")
 * @param cliModels    - Full list of CLI-known models
 * @param authMode     - Current auth mode string
 * @param platformCredentials - Stored platform credentials
 * @param authOverview - Auth overview for fallback display name
 */
export function resolvePlatformDefaultModels(
  platformId: string,
  cliModels: CliModelInfo[],
  authMode: string,
  platformCredentials: Array<{ platform_id: string; models?: string[]; base_url?: string }>,
  authOverview?: { app_platform_name?: string | null } | null,
): PlatformModelResult {
  const preset = PLATFORM_PRESETS.find((p) => p.id === platformId);
  const cred = platformCredentials.find((c) => c.platform_id === platformId);

  // Build platform-specific model list
  const platformModels: CliModelInfo[] = [];
  if (platformId && platformId !== "anthropic") {
    const models = cred?.models?.length ? cred.models : (preset?.models ?? []);
    platformModels.push(
      ...models.map((m, i) => ({
        value: m,
        displayName: m,
        description: i === 0 ? "Default" : "",
      })),
    );
  }

  // Effective models: prefer platform list if available, otherwise fall back to CLI models
  const effectiveModels = platformModels.length > 0 ? platformModels : cliModels;

  // Platform display name
  const platformDisplayName = preset?.name ?? authOverview?.app_platform_name ?? platformId;

  return { platformModels, effectiveModels, platformDisplayName };
}
