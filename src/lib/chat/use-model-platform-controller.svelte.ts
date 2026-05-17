import type { CliModelInfo, PlatformCredential } from "$lib/types";
import { isContaminatedDefaultModel, resolvePlatformDefaultModels } from "./model-utils";
import { PLATFORM_PRESETS, findCredential } from "$lib/utils/platform-presets";

export interface ModelPlatformControllerOptions {
  store: {
    model: string;
    platformId: string | null | undefined;
    authMode: string;
    sessionAlive: boolean;
    run?: { id: string } | null;
  };
  api: {
    sendSessionControl(
      runId: string,
      action: string,
      payload: Record<string, unknown>,
    ): Promise<void>;
    updateRunModel(runId: string, model: string): Promise<void>;
    updateUserSettings(settings: Record<string, unknown>): Promise<void>;
    updateCliConfig(settings: Record<string, unknown>): Promise<void>;
    getAuthOverview(): Promise<{ app_platform_name?: string | null }>;
    detectLocalProxy(
      platformId: string,
      url: string,
    ): Promise<{ running: boolean; needsAuth: boolean }>;
  };
  getCliCurrentModel: () => string;
  /** Auth overview state setter */
  setAuthOverview: (val: { app_platform_name?: string | null } | null) => void;
  /** Local proxy statuses state setter */
  setLocalProxyStatuses: (val: Record<string, { running: boolean; needsAuth: boolean }>) => void;
  /** Platform credentials (from settings) */
  platformCredentials: PlatformCredential[];
  /** Get current settings (for findCredential lookups) */
  getSettings: () => { platform_credentials?: PlatformCredential[] } | null;
  t: (key: string) => string;
  dbg: (area: string, msg: string, ...args: unknown[]) => void;
  dbgWarn: (area: string, msg: string, ...args: unknown[]) => void;
}

/** Last confirmed-clean Anthropic model, used as final fallback. */
let lastKnownGoodAnthropicModel: string | undefined;

export function createModelPlatformController(options: ModelPlatformControllerOptions) {
  const {
    store,
    api,
    getCliCurrentModel,
    setAuthOverview,
    setLocalProxyStatuses,
    platformCredentials,
    getSettings,
    t,
    dbg,
    dbgWarn,
  } = options;

  async function handleModelChange(newModel: string) {
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
      lastKnownGoodAnthropicModel = newModel;
      try {
        await api.updateUserSettings({ default_model: newModel } as Record<string, unknown>);
      } catch (e) {
        dbgWarn("chat", "failed to persist model change", e);
      }
    }
  }

  async function handleEffortChange(newEffort: string, currentEffort: string) {
    dbg("chat", "effort change", { from: currentEffort, to: newEffort });
    // Write to CLI config (~/.claude/settings.json) — the CLI reads effortLevel
    // per-request, so changes take effect immediately within a running session.
    // Deliberately NOT writing to agentSettings.effort — that would cause --effort
    // to be passed at spawn, which locks the CLI's in-memory effort and prevents
    // settings.json changes from being picked up during the session.
    api.updateCliConfig({ effortLevel: newEffort || null }).catch((e) => {
      dbgWarn("chat", "failed to persist effort to CLI config", e);
    });
  }

  async function handleAuthModeChange(mode: string) {
    dbg("chat", "auth mode change", { from: store.authMode, to: mode });
    store.authMode = mode;
    try {
      await api.updateUserSettings({ auth_mode: mode } as Record<string, unknown>);
      setAuthOverview(await api.getAuthOverview());
    } catch (e) {
      dbgWarn("chat", "failed to persist auth mode change", e);
    }
  }

  async function checkAllLocalProxies() {
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

  async function handlePlatformChange(platformId: string) {
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

    const persistUpdate: Record<string, unknown> = { active_platform_id: platformId };
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
    handlePlatformChange,
    checkAllLocalProxies,
  };
}
