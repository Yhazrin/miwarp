import * as api from "$lib/api";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { PLATFORM_PRESETS, findCredential } from "$lib/utils/platform-presets";
import type { UserSettings, AuthOverview } from "$lib/types";
import type { SessionStore } from "$lib/stores/session-store.svelte";

export interface PlatformHandlerContext {
  store: SessionStore;
  getSettings: () => UserSettings | null;
  getCurrentEffort: () => string;
  setCurrentEffort: (v: string) => void;
  setLastKnownGoodModel: (v: string) => void;
  setAuthOverview: (v: AuthOverview | null) => void;
  setLocalProxyStatuses: (v: Record<string, { running: boolean; needsAuth: boolean }>) => void;
  getCliCurrentModel: () => string | undefined;
}

export function createPlatformHandlers(ctx: PlatformHandlerContext) {
  const {
    store,
    getSettings,
    getCurrentEffort,
    setCurrentEffort,
    setLastKnownGoodModel,
    setAuthOverview,
    setLocalProxyStatuses,
    getCliCurrentModel,
  } = ctx;

  async function handleModelChange(newModel: string): Promise<void> {
    dbg("chat", "model change", { from: store.model, to: newModel });
    store.model = newModel;

    const isThirdParty = store.platformId && store.platformId !== "anthropic";

    if (!isThirdParty && store.sessionAlive && store.run) {
      try {
        await api.sendSessionControl(store.run.id, "set_model", { model: newModel });
        dbg("chat", "model hot-switched via control protocol");
      } catch (e) {
        dbgWarn("chat", "model hot-switch failed, will use new model on next session", e);
      }
    }

    if (store.run) {
      api.updateRunModel(store.run.id, newModel).catch((e) => {
        dbgWarn("chat", "failed to persist run model", e);
      });
    }

    if (!isThirdParty) {
      setLastKnownGoodModel(newModel);
      try {
        await api.updateUserSettings({ default_model: newModel });
      } catch (e) {
        dbgWarn("chat", "failed to persist model change", e);
      }
    }
  }

  async function handleEffortChange(newEffort: string): Promise<void> {
    dbg("chat", "effort change", { from: getCurrentEffort(), to: newEffort });
    setCurrentEffort(newEffort);
    api.updateCliConfig({ effortLevel: newEffort || null }).catch((e) => {
      dbgWarn("chat", "failed to persist effort to CLI config", e);
    });
  }

  async function handleAuthModeChange(mode: string): Promise<void> {
    dbg("chat", "auth mode change", { from: store.authMode, to: mode });
    store.authMode = mode;
    try {
      await api.updateUserSettings({ auth_mode: mode } as Partial<UserSettings>);
      setAuthOverview(await api.getAuthOverview());
    } catch (e) {
      dbgWarn("chat", "failed to persist auth mode change", e);
    }
  }

  async function checkAllLocalProxies(): Promise<void> {
    const settings = getSettings();
    const localPresets = PLATFORM_PRESETS.filter((p) => p.category === "local");
    const results = await Promise.allSettled(
      localPresets.map((p) => {
        const cred = findCredential(settings?.platform_credentials ?? [], p.id);
        const url = cred?.base_url || p.base_url;
        return api.detectLocalProxy(p.id, url);
      }),
    );
    const statuses: Record<string, { running: boolean; needsAuth: boolean }> = {};
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        statuses[localPresets[i].id] = { running: r.value.running, needsAuth: r.value.needsAuth };
      } else {
        statuses[localPresets[i].id] = { running: false, needsAuth: false };
      }
    });
    setLocalProxyStatuses(statuses);
    dbg("chat", "checkAllLocalProxies", statuses);
  }

  async function handlePlatformChange(platformId: string): Promise<void> {
    dbg("chat", "platform change", { from: store.platformId, to: platformId });
    store.platformId = platformId;

    const settings = getSettings();
    const cred = findCredential(settings?.platform_credentials ?? [], platformId);
    const preset = PLATFORM_PRESETS.find((p) => p.id === platformId);
    const models = cred?.models?.length ? cred.models : preset?.models;
    if (models?.length) {
      const defaultModel = models[0];
      dbg("chat", "auto-switch model for platform", { platformId, model: defaultModel });
      store.model = defaultModel;
    } else if (platformId === "anthropic") {
      const cliModel = getCliCurrentModel();
      store.model = cliModel || "";
      dbg("chat", "restore model on switch to anthropic", { cliModel, using: store.model });
    } else {
      store.model = "";
    }

    const persistUpdate: Partial<UserSettings> = { active_platform_id: platformId };
    if (platformId === "anthropic") {
      const validated = getCliCurrentModel();
      if (validated) persistUpdate.default_model = validated;
    }
    try {
      await api.updateUserSettings(persistUpdate);
    } catch (e) {
      dbgWarn("chat", "failed to persist platform change", e);
    }
    checkAllLocalProxies();
  }

  return {
    handleModelChange,
    handleEffortChange,
    handleAuthModeChange,
    checkAllLocalProxies,
    handlePlatformChange,
  };
}
