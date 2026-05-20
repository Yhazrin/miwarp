/**
 * Composable that owns model contamination detection and restore logic.
 *
 * Extracted from +page.svelte to keep the page file focused on UI wiring.
 * Uses Svelte 5 runes (`$effect`) for reactivity.
 */

import type { SessionStore } from "$lib/stores/session-store.svelte";
import type { UserSettings } from "$lib/types";
import { PLATFORM_PRESETS, findCredential } from "$lib/utils/platform-presets";
import { getCliModels } from "$lib/stores/cli-info.svelte";
import { dbg } from "$lib/utils/debug";

// ── Context (dependency injection) ──

export interface ModelGuardContext {
  store: SessionStore;
  getSettings: () => UserSettings | null;
  getCliCurrentModel: () => string | undefined;
}

// ── Return type ──

export interface ModelGuardHandle {
  isContaminatedDefaultModel: (dm: string) => boolean | null;
  getLastKnownGoodModel: () => string | undefined;
  setLastKnownGoodModel: (v: string) => void;
}

// ── Composable ──

export function createModelGuard(ctx: ModelGuardContext): ModelGuardHandle {
  const { store, getSettings, getCliCurrentModel } = ctx;

  /** Cache of last confirmed-clean Anthropic model, used as final fallback. */
  let lastKnownGoodAnthropicModel: string | undefined;

  /** Detect if default_model was contaminated by a third-party platform model.
   *  Returns:
   *  - true  = confirmed contaminated (in third-party models, not in CLI models)
   *  - false = confirmed clean (in CLI known models)
   *  - null  = unknown (CLI not loaded, or model not found in any list)
   */
  function isContaminatedDefaultModel(dm: string): boolean | null {
    const cliModels = getCliModels();
    if (!cliModels.length) return null; // CLI models not loaded yet
    if (cliModels.some((m) => m.value === dm)) return false; // in CLI model list = clean

    const settings = getSettings();
    const inThirdParty =
      PLATFORM_PRESETS.some(
        (p) => p.id !== "anthropic" && p.id !== "custom" && p.models?.includes(dm),
      ) ||
      (settings?.platform_credentials ?? []).some(
        (c) => c.platform_id !== "anthropic" && c.models?.includes(dm),
      );
    return inThirdParty ? true : null; // not in CLI + not in third-party = unknown
  }

  // Restore model when store.model is empty (e.g. after reset/loadRun):
  // For third-party platforms, use the platform's default model.
  // For Anthropic, prefer CC's current active model, fall back to our saved default_model
  // (only if confirmed clean via three-state contamination check).
  $effect(() => {
    if (!store.model) {
      // Don't overwrite model during loadRun async gap — loadRun will set it
      if (store.phase === "loading") return;

      const settings = getSettings();
      const isThirdParty = store.platformId && store.platformId !== "anthropic";
      if (isThirdParty) {
        const restoreCred = findCredential(
          settings?.platform_credentials ?? [],
          store.platformId ?? "",
        );
        const restorePreset = PLATFORM_PRESETS.find((p) => p.id === store.platformId);
        const restoreModels = restoreCred?.models?.length
          ? restoreCred.models
          : restorePreset?.models;
        if (restoreModels?.[0]) {
          dbg("chat", "restore model from credential/preset", {
            platform: store.platformId,
            model: restoreModels[0],
          });
          store.model = restoreModels[0];
          return;
        }
      }
      // Only fall back to default_model for Anthropic platform — otherwise
      // default_model may belong to a different platform (cross-pollution).
      const cliModel = getCliCurrentModel();
      const isAnthropicPlatform = !store.platformId || store.platformId === "anthropic";
      const rawFallback = isAnthropicPlatform ? settings?.default_model : undefined;
      const contaminated = rawFallback ? isContaminatedDefaultModel(rawFallback) : null;
      // Only use default_model when confirmed clean (false). true/null → skip.
      const fallback = contaminated === false ? rawFallback : undefined;
      // Last resort: cached last-known-good Anthropic model (only for Anthropic platform)
      const model =
        cliModel || fallback || (isAnthropicPlatform ? lastKnownGoodAnthropicModel : undefined);
      if (model) {
        // Update cache when we have a trusted source
        if (isAnthropicPlatform && (cliModel || contaminated === false)) {
          lastKnownGoodAnthropicModel = model;
        }
        dbg("chat", "restore model", {
          cliModel,
          rawFallback,
          contaminated,
          lastKnownGood: lastKnownGoodAnthropicModel,
          using: model,
        });
        store.model = model;
      }
    }
  });

  return {
    isContaminatedDefaultModel,
    getLastKnownGoodModel: () => lastKnownGoodAnthropicModel,
    setLastKnownGoodModel: (v: string) => {
      lastKnownGoodAnthropicModel = v;
    },
  };
}
