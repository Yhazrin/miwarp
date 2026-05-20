import * as api from "$lib/api";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { PLATFORM_PRESETS, findCredential } from "$lib/utils/platform-presets";
import type { SessionStore } from "$lib/stores/session-store.svelte";
import type { UserSettings, CliModelInfo, AuthOverview } from "$lib/types";
import { getCliModels, getCliCurrentModel } from "$lib/stores";

export interface ModelPlatformContext {
  store: SessionStore;
  getSettings: () => UserSettings | null;
  getAuthOverview: () => AuthOverview | null;
}

export function useModelPlatform(ctx: ModelPlatformContext) {
  const { store, getSettings, getAuthOverview } = ctx;

  /** Cache of last confirmed-clean Anthropic model, used as final fallback. */
  let lastKnownGoodAnthropicModel: string | undefined;

  function setLastKnownGoodModel(v: string) {
    lastKnownGoodAnthropicModel = v;
  }

  /** Detect if default_model was contaminated by a third-party platform model. */
  function isContaminatedDefaultModel(dm: string): boolean | null {
    const cliModels = getCliModels();
    if (!cliModels.length) return null;
    if (cliModels.some((m) => m.value === dm)) return false;

    const settings = getSettings();
    const inThirdParty =
      PLATFORM_PRESETS.some(
        (p) => p.id !== "anthropic" && p.id !== "custom" && p.models?.includes(dm),
      ) ||
      (settings?.platform_credentials ?? []).some(
        (c) => c.platform_id !== "anthropic" && c.models?.includes(dm),
      );
    return inThirdParty ? true : null;
  }

  let currentEffort = $state("");

  let platformDisplayName = $derived.by(() => {
    const pid = store.platformId;
    if (!pid) return undefined;
    const preset = PLATFORM_PRESETS.find((p) => p.id === pid);
    return preset?.name ?? getAuthOverview()?.app_platform_name ?? pid;
  });

  let platformModels = $derived.by((): CliModelInfo[] => {
    const pid = store.platformId;
    if (!pid || pid === "anthropic") return [];
    const settings = getSettings();
    const cred = findCredential(settings?.platform_credentials ?? [], pid);
    const preset = PLATFORM_PRESETS.find((p) => p.id === pid);
    const models = cred?.models?.length ? cred.models : preset?.models;
    if (!models?.length) return [];
    return models.map((m, i) => ({
      value: m,
      displayName: m,
      description: i === 0 ? "Default" : "",
    }));
  });

  let effectiveModels = $derived(platformModels.length > 0 ? platformModels : getCliModels());

  // Effort guard: auto-clear effort when model doesn't support it;
  // also auto-populate default effort ("high") when empty and model supports it.
  $effect(() => {
    if (store.agent !== "claude") return;
    const pid = store.platformId;
    if (pid && pid !== "anthropic") return;

    const modelInfo = effectiveModels.find((m) => m.value === store.model);
    if (!modelInfo) return;

    if (currentEffort && modelInfo.supportsEffort === false) {
      dbg("chat", "effort-guard: clearing for unsupported model", { model: store.model });
      currentEffort = "";
      api.updateCliConfig({ effortLevel: null }).catch((e) => {
        dbgWarn("chat", "effort-guard: CLI config clear failed", e);
      });
    } else if (!currentEffort && modelInfo.supportsEffort === true) {
      dbg("chat", "effort-guard: defaulting to high", { model: store.model });
      currentEffort = "high";
      api.updateCliConfig({ effortLevel: "high" }).catch((e) => {
        dbgWarn("chat", "effort-guard: CLI config default failed", e);
      });
    }
  });

  // Restore model when store.model is empty (e.g. after reset/loadRun)
  $effect(() => {
    if (!store.model) {
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
      const cliModel = getCliCurrentModel();
      const isAnthropicPlatform = !store.platformId || store.platformId === "anthropic";
      const rawFallback = isAnthropicPlatform ? settings?.default_model : undefined;
      const contaminated = rawFallback ? isContaminatedDefaultModel(rawFallback) : null;
      const fallback = contaminated === false ? rawFallback : undefined;
      const model =
        cliModel || fallback || (isAnthropicPlatform ? lastKnownGoodAnthropicModel : undefined);
      if (model) {
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
    get currentEffort() {
      return currentEffort;
    },
    set currentEffort(v: string) {
      currentEffort = v;
    },
    get platformDisplayName() {
      return platformDisplayName;
    },
    get platformModels() {
      return platformModels;
    },
    get effectiveModels() {
      return effectiveModels;
    },
    isContaminatedDefaultModel,
    setLastKnownGoodModel,
  };
}
