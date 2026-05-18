/**
 * Composable for connection/platform settings state and logic.
 * Extracted from settings/+page.svelte to reduce script section complexity.
 *
 * All state and functions are exported as getters so the parent template
 * can reference them by the same names.
 */
import * as api from "$lib/api";
import type {
  AuthOverview,
  LocalProxyStatus,
  ApiTestResult,
  PlatformPreset,
  PlatformCredential,
  UserSettings,
} from "$lib/types";
import {
  PLATFORM_PRESETS,
  buildPlatformList,
  findCredential,
  expandModelsToTiers,
  compressModelsFromTiers,
} from "$lib/utils/platform-presets";
import { dbg, dbgWarn } from "$lib/utils/debug";

export function useConnectionPlatform(opts: {
  saveGeneralPatch: (patch: Record<string, unknown>) => void;
}) {
  const { saveGeneralPatch } = opts;

  // ── Auth state ──
  let authMode = $state("cli");
  let anthropicApiKey = $state("");
  let anthropicBaseUrl = $state("");
  let showApiKey = $state(false);
  let modelOpus = $state("");
  let modelSonnet = $state("");
  let modelHaiku = $state("");
  let selectedPlatformId = $state<string | null>(null);
  let platformCredentials = $state<PlatformCredential[]>([]);
  let platformExtraEnv = $state<Array<{ key: string; value: string }>>([]);
  const extraEnvTouched = $state<Record<string, boolean>>({});

  // CLI Auth state
  let authOverview = $state<AuthOverview | null>(null);
  let cliLoginLoading = $state(false);
  let cliLoginError = $state("");

  // Derive merged platform list (static presets + dynamic custom endpoints)
  const platformList = $derived(buildPlatformList(platformCredentials));

  // Derive selected platform from id
  const selectedPlatform = $derived<PlatformPreset | null>(
    selectedPlatformId ? (platformList.find((p) => p.id === selectedPlatformId) ?? null) : null,
  );

  // Local proxy detection state
  let localProxyStatus = $state<LocalProxyStatus | null>(null);
  let localProxyChecking = $state(false);
  let localProxyRequestId = $state(0);
  let localAdvancedOpen = $state(false);
  let localProxyStatuses = $state<Record<string, { running: boolean; needsAuth: boolean }>>({});

  // API connectivity test state
  let apiTestLoading = $state(false);
  let apiTestResult = $state<ApiTestResult | null>(null);
  let apiTestRequestId = $state(0);

  // Derive effective auth env var
  const effectiveAuthEnvVar = $derived(
    findCredential(platformCredentials, selectedPlatformId ?? "")?.auth_env_var ||
      selectedPlatform?.auth_env_var ||
      "ANTHROPIC_API_KEY",
  );

  // Clear stale test result when inputs change
  $effect(() => {
    void anthropicApiKey;
    void anthropicBaseUrl;
    void modelOpus;
    void modelSonnet;
    void modelHaiku;
    void effectiveAuthEnvVar;
    return () => {
      apiTestResult = null;
      apiTestRequestId++;
      apiTestLoading = false;
    };
  });

  // ── Functions ──

  function detectPlatformFromUrl(url: string, activePlatformId?: string): string | null {
    if (activePlatformId) return activePlatformId;
    if (!url) return null;
    const match = PLATFORM_PRESETS.find((p) => p.base_url && url === p.base_url);
    return match?.id ?? "custom";
  }

  function loadFieldsFromCredential(platformId: string | null) {
    apiTestResult = null;
    if (!platformId) {
      anthropicApiKey = "";
      anthropicBaseUrl = "";
      platformExtraEnv = [];
      return;
    }
    const cred = findCredential(platformCredentials, platformId);
    const preset = PLATFORM_PRESETS.find((p) => p.id === platformId);
    anthropicApiKey = cred?.api_key ?? "";
    anthropicBaseUrl = cred?.base_url ?? preset?.base_url ?? "";
    const models = cred?.models ?? preset?.models;
    const [o, s, h] = expandModelsToTiers(models);
    modelOpus = o;
    modelSonnet = s;
    modelHaiku = h;
    const extraEnv = cred?.extra_env !== undefined ? cred.extra_env : (preset?.extra_env ?? {});
    platformExtraEnv = Object.entries(extraEnv).map(([key, value]) => ({ key, value }));
    dbg("settings", "loadFieldsFromCredential", {
      platformId,
      hasKey: !!anthropicApiKey,
      url: anthropicBaseUrl,
      models: [modelOpus, modelSonnet, modelHaiku],
      extraEnvKeys: Object.keys(extraEnv),
      extraEnvSource: cred?.extra_env !== undefined ? "credential" : "preset",
    });
  }

  function saveCurrentToCredential() {
    if (!selectedPlatformId) return;
    const preset = PLATFORM_PRESETS.find((p) => p.id === selectedPlatformId);
    const modelsToSave = compressModelsFromTiers(modelOpus, modelSonnet, modelHaiku);
    const extraEnvRecord: Record<string, string> = {};
    const seenKeys = new Set<string>();
    for (const { key, value } of platformExtraEnv) {
      const k = key.trim();
      if (!k) continue;
      if (seenKeys.has(k)) {
        dbgWarn("settings", `duplicate extra_env key "${k}" — last value wins`);
      }
      seenKeys.add(k);
      extraEnvRecord[k] = value;
    }
    const extraEnvToSave = extraEnvTouched[selectedPlatformId] ? extraEnvRecord : undefined;
    dbg("settings", "saveCurrentToCredential: extra_env", {
      platform: selectedPlatformId,
      touched: !!extraEnvTouched[selectedPlatformId],
      keys: Object.keys(extraEnvRecord),
    });
    _upsertCredential(selectedPlatformId, {
      api_key: anthropicApiKey || undefined,
      base_url: anthropicBaseUrl || preset?.base_url || undefined,
      auth_env_var: selectedPlatform?.auth_env_var ?? preset?.auth_env_var,
      models: modelsToSave,
      ...(extraEnvToSave !== undefined ? { extra_env: extraEnvToSave } : {}),
    });
  }

  function syncAndSave(platformId: string) {
    const preset = PLATFORM_PRESETS.find((p) => p.id === platformId);
    saveGeneralPatch({
      anthropic_api_key: anthropicApiKey || undefined,
      anthropic_base_url: anthropicBaseUrl || undefined,
      auth_env_var: preset?.auth_env_var,
      active_platform_id: platformId,
      platform_credentials: platformCredentials,
    });
  }

  function markExtraEnvTouched() {
    if (selectedPlatformId) extraEnvTouched[selectedPlatformId] = true;
  }

  function parseEnvText(text: string): Array<{ key: string; value: string }> {
    const trimmed = text.trim();
    if (trimmed.startsWith("{")) {
      try {
        const obj = JSON.parse(trimmed);
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          const results: Array<{ key: string; value: string }> = [];
          for (const [key, val] of Object.entries(obj)) {
            if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
              results.push({ key, value: String(val) });
            }
          }
          if (results.length > 0) return results;
        }
      } catch {
        // Not valid JSON, fall through
      }
    }
    const results: Array<{ key: string; value: string }> = [];
    for (const raw of trimmed.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const stripped = line.replace(/^export\s+/, "");
      const eqIdx = stripped.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = stripped.slice(0, eqIdx).trim();
      let value = stripped.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        results.push({ key, value });
      }
    }
    return results;
  }

  function handleEnvKeyPaste(e: ClipboardEvent, index: number) {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    const parsed = parseEnvText(text);
    if (parsed.length === 0) return;
    e.preventDefault();
    const before = platformExtraEnv.slice(0, index);
    const after = platformExtraEnv.slice(index + 1);
    platformExtraEnv = [...before, ...parsed, ...after];
    markExtraEnvTouched();
    persistCurrentPlatform();
    dbg("settings", "env paste parsed", { count: parsed.length, keys: parsed.map((p) => p.key) });
  }

  function persistCurrentPlatform() {
    saveCurrentToCredential();
    if (selectedPlatformId) syncAndSave(selectedPlatformId);
  }

  async function checkLocalProxy() {
    if (!selectedPlatform || selectedPlatform.category !== "local" || !selectedPlatformId) return;
    localProxyChecking = true;
    localProxyStatus = null;
    const myRequestId = ++localProxyRequestId;
    const myPlatformId = selectedPlatformId;
    const urlToCheck = anthropicBaseUrl;
    dbg("settings", "checkLocalProxy start", {
      id: myPlatformId,
      url: urlToCheck,
      reqId: myRequestId,
    });
    try {
      const result = await api.detectLocalProxy(myPlatformId, urlToCheck);
      if (myRequestId !== localProxyRequestId) return;
      if (myPlatformId !== selectedPlatformId) return;
      localProxyStatus = result;
      localProxyStatuses = {
        ...localProxyStatuses,
        [myPlatformId]: { running: result.running, needsAuth: result.needsAuth },
      };
      dbg("settings", "checkLocalProxy result", result);
    } catch (e) {
      if (myRequestId !== localProxyRequestId || myPlatformId !== selectedPlatformId) return;
      localProxyStatus = {
        proxyId: myPlatformId,
        running: false,
        needsAuth: false,
        baseUrl: urlToCheck,
        error: String(e),
      };
      localProxyStatuses = {
        ...localProxyStatuses,
        [myPlatformId]: { running: false, needsAuth: false },
      };
      dbgWarn("settings", "checkLocalProxy error", e);
    } finally {
      if (myRequestId === localProxyRequestId) localProxyChecking = false;
    }
  }

  async function checkAllLocalProxies() {
    const localPresets = PLATFORM_PRESETS.filter((p) => p.category === "local");
    const results = await Promise.allSettled(
      localPresets.map((p) => {
        const cred = findCredential(platformCredentials, p.id);
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
    localProxyStatuses = statuses;
    dbg("settings", "checkAllLocalProxies", statuses);
  }

  function applyPlatformPreset(preset: PlatformPreset) {
    saveCurrentToCredential();
    selectedPlatformId = preset.id;
    localAdvancedOpen = false;
    localProxyStatus = null;
    loadFieldsFromCredential(preset.id);
    syncAndSave(preset.id);
    if (preset.category === "local") {
      checkLocalProxy();
    }
  }

  function _upsertCredential(platformId: string, fields: Partial<PlatformCredential>) {
    const idx = platformCredentials.findIndex((c) => c.platform_id === platformId);
    if (idx >= 0) {
      platformCredentials[idx] = { ...platformCredentials[idx], ...fields };
    } else {
      platformCredentials = [...platformCredentials, { platform_id: platformId, ...fields }];
    }
  }

  function addCustomEndpoint() {
    const id = `custom-${Date.now()}`;
    const cred: PlatformCredential = {
      platform_id: id,
      name: "Custom",
      base_url: "",
      auth_env_var: "ANTHROPIC_AUTH_TOKEN",
    };
    platformCredentials = [...platformCredentials, cred];
    saveGeneralPatch({ platform_credentials: platformCredentials });
    const preset = buildPlatformList(platformCredentials).find((p) => p.id === id);
    if (preset) applyPlatformPreset(preset);
  }

  function deleteCustomEndpoint(platformId: string) {
    const wasActive = selectedPlatformId === platformId;
    if (wasActive) selectedPlatformId = null;
    platformCredentials = platformCredentials.filter((c) => c.platform_id !== platformId);
    saveGeneralPatch({ platform_credentials: platformCredentials });
    if (wasActive) {
      const anthropic = PLATFORM_PRESETS.find((p) => p.id === "anthropic")!;
      applyPlatformPreset(anthropic);
    }
  }

  function initFromSettings(s: UserSettings) {
    authMode = s.auth_mode ?? "cli";
    platformCredentials = s.platform_credentials ?? [];
    if (authMode === "api") {
      selectedPlatformId = detectPlatformFromUrl(s.anthropic_base_url ?? "", s.active_platform_id);
      loadFieldsFromCredential(selectedPlatformId);
    } else {
      anthropicApiKey = s.anthropic_api_key ?? "";
      anthropicBaseUrl = s.anthropic_base_url ?? "";
    }
  }

  return {
    get authMode() {
      return authMode;
    },
    set authMode(v: string) {
      authMode = v;
    },
    get anthropicApiKey() {
      return anthropicApiKey;
    },
    set anthropicApiKey(v: string) {
      anthropicApiKey = v;
    },
    get anthropicBaseUrl() {
      return anthropicBaseUrl;
    },
    set anthropicBaseUrl(v: string) {
      anthropicBaseUrl = v;
    },
    get showApiKey() {
      return showApiKey;
    },
    set showApiKey(v: boolean) {
      showApiKey = v;
    },
    get modelOpus() {
      return modelOpus;
    },
    set modelOpus(v: string) {
      modelOpus = v;
    },
    get modelSonnet() {
      return modelSonnet;
    },
    set modelSonnet(v: string) {
      modelSonnet = v;
    },
    get modelHaiku() {
      return modelHaiku;
    },
    set modelHaiku(v: string) {
      modelHaiku = v;
    },
    get selectedPlatformId() {
      return selectedPlatformId;
    },
    set selectedPlatformId(v: string | null) {
      selectedPlatformId = v;
    },
    get platformCredentials() {
      return platformCredentials;
    },
    set platformCredentials(v: PlatformCredential[]) {
      platformCredentials = v;
    },
    get platformExtraEnv() {
      return platformExtraEnv;
    },
    set platformExtraEnv(v: Array<{ key: string; value: string }>) {
      platformExtraEnv = v;
    },
    get extraEnvTouched() {
      return extraEnvTouched;
    },
    get authOverview() {
      return authOverview;
    },
    set authOverview(v: AuthOverview | null) {
      authOverview = v;
    },
    get cliLoginLoading() {
      return cliLoginLoading;
    },
    set cliLoginLoading(v: boolean) {
      cliLoginLoading = v;
    },
    get cliLoginError() {
      return cliLoginError;
    },
    set cliLoginError(v: string) {
      cliLoginError = v;
    },
    get platformList() {
      return platformList;
    },
    get selectedPlatform() {
      return selectedPlatform;
    },
    get localProxyStatus() {
      return localProxyStatus;
    },
    set localProxyStatus(v: LocalProxyStatus | null) {
      localProxyStatus = v;
    },
    get localProxyChecking() {
      return localProxyChecking;
    },
    set localProxyChecking(v: boolean) {
      localProxyChecking = v;
    },
    get localAdvancedOpen() {
      return localAdvancedOpen;
    },
    set localAdvancedOpen(v: boolean) {
      localAdvancedOpen = v;
    },
    get localProxyStatuses() {
      return localProxyStatuses;
    },
    get apiTestLoading() {
      return apiTestLoading;
    },
    set apiTestLoading(v: boolean) {
      apiTestLoading = v;
    },
    get apiTestResult() {
      return apiTestResult;
    },
    set apiTestResult(v: ApiTestResult | null) {
      apiTestResult = v;
    },
    get apiTestRequestId() {
      return apiTestRequestId;
    },
    set apiTestRequestId(v: number) {
      apiTestRequestId = v;
    },
    get effectiveAuthEnvVar() {
      return effectiveAuthEnvVar;
    },
    detectPlatformFromUrl,
    loadFieldsFromCredential,
    saveCurrentToCredential,
    syncAndSave,
    markExtraEnvTouched,
    handleEnvKeyPaste,
    persistCurrentPlatform,
    checkLocalProxy,
    checkAllLocalProxies,
    applyPlatformPreset,
    _upsertCredential,
    addCustomEndpoint,
    deleteCustomEndpoint,
    initFromSettings,
  };
}
