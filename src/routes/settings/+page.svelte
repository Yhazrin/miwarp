<script lang="ts">
  /**
   * Settings orchestrator (v1.0.9 perf): tab-scoped loading, no mount-time
   * deferHeavy IPC. Heavy work runs only when a tab is first activated.
   */
  import { getContext, onMount } from "svelte";
  import { page } from "$app/stores";
  import { disarmChatSettingsHop } from "$lib/utils/chat-settings-nav";
  import * as api from "$lib/api";
  import type { AgentSettings, RemoteHost, UserSettings } from "$lib/types";
  import { findCredential } from "$lib/utils/platform-presets";
  import { dbg, dbgWarn, redactSensitive } from "$lib/utils/debug";
  import { perfMark, perfMarkAsync } from "$lib/utils/perf";
  import { t } from "$lib/i18n/index.svelte";
  import { getTransport } from "$lib/transport";
  import {
    SETTINGS_CACHE_CONTEXT_KEY,
    type SettingsCacheContext,
    resolveLayoutCachedSettings,
  } from "$lib/layout-chrome-context";
  import { applyUiZoomCssVar, clampUiZoom } from "$lib/utils/ui-zoom";
  import {
    applySoundFeedbackLevel,
    normalizeSoundFeedbackLevel,
  } from "$lib/services/sound-feedback-service";
  import { resolveTabId, type SettingsTabId } from "$lib/components/settings/tabs/registry";
  import SettingsPanels from "$lib/components/settings/SettingsPanels.svelte";
  import {
    SettingsTabLoadController,
    createMountedGuard,
    fetchCliBehaviorTabData,
    fetchDevicesTabData,
    fetchRuntimesTabData,
    fetchUpdatesTabData,
    loadSettingsPageCore,
  } from "$lib/settings/settings-tab-loaders";
  import { agentToRuntimeId } from "$lib/runtime/registry";
  import { runtimeHubStore } from "$lib/stores/runtime-hub-store.svelte";

  let mounted = $state(false);
  let pageGeneration = 0;
  // Local generation for QR generation effect — increments every time the
  // effect re-runs so rapid web server changes don't pile up stale QR work.
  let qrGeneration = 0;
  const tabLoadController = new SettingsTabLoadController();

  let settings = $state<UserSettings | null>(null);
  let authMode = $state("cli");
  let anthropicApiKey = $state("");
  let anthropicBaseUrl = $state("");
  let showApiKey = $state(false);
  let selectedPlatformId = $state<string | null>(null);
  let platformCredentials = $state<NonNullable<UserSettings["platform_credentials"]>>([]);

  let notifEnabled = $state(true);
  let notifRunCompleted = $state(true);
  let notifRunFailed = $state(true);
  let notifApprovalRequired = $state(true);
  let notifScheduleCompleted = $state(true);
  let notifTeamCompleted = $state(true);
  let notifMinDuration = $state(10);
  let soundFeedbackLevel = $state<"off" | "minimal" | "standard" | "detailed">("minimal");
  let feishuWebhookUrl = $state("");
  let feishuWebhookEnabled = $state(false);
  let feishuWebhookTriggers = $state<string[]>([]);
  let feishuTestResult = $state<string | null>(null);

  let webToken = $state<string | null>(null);
  let webStatus = $state<{
    enabled: boolean;
    running: boolean;
    port: number;
    bind: string;
    tunnel_url?: string | null;
    warning?: string;
  } | null>(null);
  let webLinkCopied = $state(false);
  let webRestarting = $state(false);
  let webRestartError = $state<string | null>(null);
  let webRestartWarning = $state<string | null>(null);
  let webPortInput = $state("9476");
  let webBindValue = $state("127.0.0.1");
  let webOrigins = $state<string[]>([]);
  let webAdvancedOpen = $state(false);
  let webLanIp = $state<string | null>(null);
  let webTunnelUrl = $state("");
  let mobileQrDataUrl = $state<string | null>(null);
  let mobilePairingLinkCopied = $state(false);
  let webSelfCheckRunning = $state(false);
  let webSelfCheckResult = $state<string | null>(null);
  let webSelfCheckError = $state<string | null>(null);

  let cliConfig = $state<Record<string, unknown>>({});
  let projectCliConfig = $state<Record<string, unknown>>({});
  let cliConfigLoaded = $state(false);
  let cliConfigLoading = $state(false);
  let cliConfigError = $state("");

  let remoteHosts = $state<RemoteHost[]>([]);
  let editingRemote = $state<RemoteHost | null>(null);

  let scanningHistory = $state(false);
  let exportingHistory = $state(false);
  let importingHistory = $state(false);
  let scanResult = $state<import("$lib/types").CliSessionInfo[] | null>(null);
  let importReport = $state<import("$lib/types").ImportReport | null>(null);
  let historyError = $state<string | null>(null);

  let mimoAgentSettings = $state<AgentSettings | null>(null);

  let cachedWebview: { setZoom: (factor: number) => Promise<void> } | null = null;

  async function getWebview() {
    if (!cachedWebview) {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      cachedWebview = getCurrentWebviewWindow();
    }
    return cachedWebview;
  }

  function isAlive(gen: number): boolean {
    return mounted && gen === pageGeneration;
  }

  function detectPlatformFromUrl(
    url: string,
    activePlatformId: string | undefined = undefined,
  ): string | null {
    if (activePlatformId) return activePlatformId;
    if (!url) return null;
    return "anthropic";
  }

  function hydrateProviderFieldsFromSettings(s: UserSettings) {
    if (authMode !== "api") {
      anthropicApiKey = s.anthropic_api_key ?? "";
      anthropicBaseUrl = s.anthropic_base_url ?? "";
      return;
    }
    selectedPlatformId = detectPlatformFromUrl(
      s.anthropic_base_url ?? "",
      s.active_platform_id ?? undefined,
    );
    const cred = findCredential(platformCredentials, selectedPlatformId ?? "");
    anthropicApiKey = cred?.api_key ?? s.anthropic_api_key ?? "";
    anthropicBaseUrl = cred?.base_url ?? s.anthropic_base_url ?? "";
  }

  function hydrateFromSettings(s: UserSettings) {
    settings = s;
    authMode = s.auth_mode ?? "cli";
    remoteHosts = s.remote_hosts ?? [];
    platformCredentials = s.platform_credentials ?? [];
    notifEnabled = s.notifications_enabled ?? true;
    notifRunCompleted = s.notify_on_run_completed ?? true;
    notifRunFailed = s.notify_on_run_failed ?? true;
    notifApprovalRequired = s.notify_on_approval_required ?? true;
    notifScheduleCompleted = s.notify_on_schedule_completed ?? true;
    notifTeamCompleted = s.notify_on_team_completed ?? true;
    notifMinDuration = s.notification_min_duration_sec ?? 10;
    soundFeedbackLevel = normalizeSoundFeedbackLevel(s.sound_feedback_level);
    applySoundFeedbackLevel(soundFeedbackLevel);
    feishuWebhookUrl = s.feishu_webhook_url ?? "";
    feishuWebhookEnabled = s.feishu_webhook_enabled ?? false;
    feishuWebhookTriggers = s.feishu_webhook_triggers ?? [];
    webPortInput = String(s.web_server_port ?? 9476);
    webBindValue = s.web_server_bind ?? "127.0.0.1";
    webOrigins = [...(s.web_server_allowed_origins ?? [])];
    webTunnelUrl = s.web_server_tunnel_url ?? "";
    hydrateProviderFieldsFromSettings(s);
  }

  async function applyTabLoad(tab: SettingsTabId, gen: number) {
    const guard = createMountedGuard(() => isAlive(gen));

    switch (tab) {
      case "devices": {
        const data = await perfMarkAsync("settings.tab.devices", () => fetchDevicesTabData(guard), {
          tab: "devices",
        });
        if (!isAlive(gen) || !data) return;
        webStatus = data.webStatus;
        webToken = data.webToken;
        webLanIp = data.webLanIp;
        break;
      }
      case "cli-behavior": {
        cliConfigLoading = true;
        cliConfigError = "";
        try {
          const data = await perfMarkAsync(
            "settings.tab.cli-behavior",
            () => fetchCliBehaviorTabData(guard),
            { tab: "cli-behavior" },
          );
          if (!isAlive(gen) || !data) return;
          cliConfig = data.cliConfig;
          projectCliConfig = data.projectCliConfig;
          cliConfigLoaded = true;
        } catch (e) {
          if (!isAlive(gen)) return;
          cliConfigError = String(e);
        } finally {
          if (isAlive(gen)) cliConfigLoading = false;
        }
        break;
      }
      case "runtimes": {
        runtimeHubStore.init();
        const data = await perfMarkAsync(
          "settings.tab.runtimes",
          () => fetchRuntimesTabData(guard),
          { tab: "runtimes" },
        );
        if (!isAlive(gen) || !data) return;
        mimoAgentSettings = data.mimoAgentSettings;
        const configuredRuntime = agentToRuntimeId(settings?.default_agent ?? "");
        if (configuredRuntime) runtimeHubStore.setDefault(configuredRuntime);
        break;
      }
      case "updates": {
        perfMark("settings.tab.updates", () => fetchUpdatesTabData(guard), { tab: "updates" });
        break;
      }
      default:
        break;
    }
  }

  async function ensureTabLoaded(tab: SettingsTabId) {
    const gen = pageGeneration;
    const guard = createMountedGuard(() => isAlive(gen));
    await tabLoadController.ensureTabLoaded(tab, guard, (target) => applyTabLoad(target, gen));
  }

  const resolvedTab = $derived(resolveTabId($page.url.searchParams.get("tab")));

  $effect(() => {
    if (!mounted) return;
    const tab = resolvedTab;
    void ensureTabLoaded(tab);
  });

  $effect(() => {
    if (!mounted || resolvedTab !== "devices") return;
    const _key = `${webStatus?.running}-${webStatus?.bind}-${webToken}-${webLanIp}`;
    if (webStatus?.running && webToken) {
      const gen = ++qrGeneration;
      void generateMobileQr(pageGeneration, gen);
    } else {
      mobileQrDataUrl = null;
    }
  });

  onMount(() => {
    disarmChatSettingsHop();
    mounted = true;
    const gen = pageGeneration;

    void (async () => {
      try {
        // v1.0.9 perf: use layout-cached settings to skip the mount-time
        // getUserSettings() IPC round-trip. The layout already loaded settings
        // during its own onMount; reading from context avoids a ~10-30ms
        // duplicate call that blocks the settings page first paint.
        const cache = getContext<SettingsCacheContext>(SETTINGS_CACHE_CONTEXT_KEY);
        const cached = await resolveLayoutCachedSettings(cache);
        if (cached && isAlive(gen)) {
          perfMark("settings.firstOpen.hydrate", () => hydrateFromSettings(cached), {
            tab: "general",
            source: "context-cache",
          });
          return;
        }
        const guard = createMountedGuard(() => isAlive(gen));
        const loaded = await perfMarkAsync(
          "settings.firstOpen",
          () => loadSettingsPageCore(guard),
          { tab: "general", cold: true },
        );
        if (!isAlive(gen) || !loaded) return;
        perfMark("settings.firstOpen.hydrate", () => hydrateFromSettings(loaded), {
          tab: "general",
        });
      } catch (e) {
        dbgWarn("settings", "error", e);
      }
    })();

    return () => {
      mounted = false;
      pageGeneration += 1;
      qrGeneration += 1;
      tabLoadController.bumpGeneration();
    };
  });

  async function saveGeneralPatch(patch: Record<string, unknown>) {
    dbg("settings", "saveGeneralPatch", redactSensitive(patch));
    try {
      settings = await api.updateUserSettings(patch as Partial<UserSettings>);
    } catch (e) {
      dbgWarn("settings", "saveGeneralPatch error", e);
    }
  }

  async function applyZoomQueued(factor: number) {
    const zoom = clampUiZoom(factor);
    applyUiZoomCssVar(zoom);
    try {
      const wv = await getWebview();
      await wv.setZoom(zoom);
    } catch (e) {
      dbgWarn("settings", "applyZoomQueued failed", e);
    }
  }

  async function onSelectPlatform(id: string) {
    if (selectedPlatformId === id) return;
    selectedPlatformId = id;
    settings = await api.updateUserSettings({ active_platform_id: id } as Partial<UserSettings>);
  }

  async function onAuthModeChange(mode: string) {
    authMode = mode;
    settings = await api.updateUserSettings({ auth_mode: mode } as Partial<UserSettings>);
  }

  async function saveApiAuth() {
    settings = await api.updateUserSettings({
      anthropic_api_key: anthropicApiKey,
      anthropic_base_url: anthropicBaseUrl,
    } as Partial<UserSettings>);
  }

  async function loadCliConfig() {
    if (cliConfigLoading) return;
    cliConfigLoading = true;
    cliConfigError = "";
    const gen = pageGeneration;
    try {
      const data = await fetchCliBehaviorTabData(createMountedGuard(() => isAlive(gen)));
      if (!isAlive(gen) || !data) return;
      cliConfig = data.cliConfig;
      projectCliConfig = data.projectCliConfig;
      cliConfigLoaded = true;
    } catch (e) {
      if (!isAlive(gen)) return;
      cliConfigError = String(e);
    } finally {
      if (isAlive(gen)) cliConfigLoading = false;
    }
  }

  async function saveCliConfigPatch(key: string, value: unknown) {
    try {
      cliConfig = await api.updateCliConfig({ [key]: value ?? null });
    } catch (e) {
      dbgWarn("settings", "saveCliConfigPatch error", e);
    }
  }

  async function toggleWebServer(enable: boolean) {
    webRestarting = true;
    webRestartError = null;
    try {
      await api.restartWebServer({
        enabled: enable,
        port: enable ? (webStatus?.port ?? 9476) : 0,
        bind: enable ? (webStatus?.bind ?? "127.0.0.1") : "",
        allowed_origins: null,
        tunnel_url: enable ? webTunnelUrl.trim() || null : null,
      });
      webStatus = await api.getWebServerStatus();
      settings = await api.getUserSettings();
    } catch (e) {
      webRestartError = e instanceof Error ? e.message : String(e);
    } finally {
      webRestarting = false;
    }
  }

  async function applyWebServerSettings() {
    webRestarting = true;
    webRestartError = null;
    webRestartWarning = null;
    try {
      const portNum = parseInt(webPortInput, 10);
      if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
        throw new Error(t("settings_general_webPortInvalid"));
      }
      const result = await api.restartWebServer({
        enabled: true,
        port: portNum,
        bind: webBindValue,
        allowed_origins: webOrigins.length > 0 ? webOrigins : null,
        tunnel_url: webTunnelUrl.trim() || null,
      });
      webStatus = await api.getWebServerStatus();
      settings = await api.getUserSettings();
      if (!result.config_saved) {
        webRestartWarning = t("settings_general_webSaveWarning");
      }
      if (webStatus?.running && getTransport().isDesktop()) {
        const data = await fetchDevicesTabData(createMountedGuard(() => mounted));
        if (data) webLanIp = data.webLanIp;
      }
    } catch (e: unknown) {
      webRestartError = (e as Error)?.message ?? String(e);
      webStatus = await api.getWebServerStatus();
    } finally {
      webRestarting = false;
    }
  }

  function buildLocalAccessUrl(): string | null {
    if (!webStatus?.running || !webToken) return null;
    const bind = webStatus.bind;
    const isAll = bind === "0.0.0.0" || bind === "::" || bind === "[::]";
    const rawHost = isAll ? webLanIp : bind;
    if (!rawHost) return null;
    const host = rawHost.includes(":") ? `[${rawHost}]` : rawHost;
    return `http://${host}:${webStatus.port}/login#token=${webToken}`;
  }

  function buildPairingLink(): string | null {
    if (!webStatus?.running || !webToken) return null;
    const bind = webStatus.bind;
    const isAll = bind === "0.0.0.0" || bind === "::" || bind === "[::]";
    const rawHost = isAll ? webLanIp : bind;
    if (!rawHost) return null;
    const host = rawHost.includes(":") ? `[${rawHost}]` : rawHost;
    return `miwarp://connect?host=${encodeURIComponent(host)}&port=${encodeURIComponent(webStatus.port)}&token=${encodeURIComponent(webToken)}`;
  }

  async function copyAccessLink() {
    const url = buildLocalAccessUrl();
    if (!url) return;
    await navigator.clipboard.writeText(url);
    webLinkCopied = true;
    setTimeout(() => (webLinkCopied = false), 1500);
  }

  async function copyPairingLink() {
    const link = buildPairingLink();
    if (!link) return;
    await navigator.clipboard.writeText(link);
    mobilePairingLinkCopied = true;
    setTimeout(() => (mobilePairingLinkCopied = false), 1500);
  }

  function buildLocalUrl(path: string): string | null {
    if (!webStatus?.running) return null;
    const bind = webStatus.bind;
    const isAll = bind === "0.0.0.0" || bind === "::" || bind === "[::]";
    const rawHost = isAll ? "localhost" : bind;
    const host = rawHost.includes(":") ? `[${rawHost}]` : rawHost;
    return `http://${host}:${webStatus.port}${path}`;
  }

  async function runWebSelfCheck() {
    if (!webStatus?.running) {
      webSelfCheckError = t("settings_general_webSelfCheckDisabled");
      return;
    }
    webSelfCheckRunning = true;
    webSelfCheckError = null;
    webSelfCheckResult = null;
    try {
      const base = buildLocalUrl("");
      if (!base) throw new Error("no base url");
      const healthUrl = `${base}/health`;
      const healthRes = await fetch(healthUrl, { method: "GET" });
      if (!healthRes.ok) {
        throw new Error(`HTTP ${healthRes.status}`);
      }
      const healthJson = (await healthRes.json()) as {
        status?: string;
        port?: number;
        bind?: string;
        mcp_endpoint?: string | null;
      };
      const okPrefix = t("settings_general_webSelfCheckOk");
      const okDesc = t("settings_general_webSelfCheckOkDesc", {
        port: String(healthJson.port ?? webStatus.port),
        bind: String(healthJson.bind ?? webStatus.bind),
      });

      let authOk = false;
      let authMsg = "";
      if (webToken) {
        try {
          const authRes = await fetch(`${base}/auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: webToken }),
          });
          authOk = authRes.ok;
          if (!authOk) {
            const data = (await authRes.json().catch(() => ({}))) as { error?: string };
            authMsg = t("settings_general_webSelfCheckAuthFail", {
              error: data.error ?? `HTTP ${authRes.status}`,
            });
          } else {
            authMsg = t("settings_general_webSelfCheckAuthOk");
          }
        } catch (authErr) {
          authMsg = t("settings_general_webSelfCheckAuthFail", {
            error: authErr instanceof Error ? authErr.message : String(authErr),
          });
        }
      }

      const mcpNote = healthJson.mcp_endpoint ? ` MCP=${healthJson.mcp_endpoint}` : "";
      webSelfCheckResult = `${okPrefix}: ${okDesc} | ${authMsg}${mcpNote}`;
      if (healthJson.status !== "ok") {
        webSelfCheckError = t("settings_general_webSelfCheckNetErr");
        webSelfCheckResult = null;
      }
    } catch (e) {
      webSelfCheckError = `${t("settings_general_webSelfCheckNetErr")} (${e instanceof Error ? e.message : String(e)})`;
    } finally {
      webSelfCheckRunning = false;
    }
  }

  async function generateMobileQr(gen: number, qrGen: number) {
    const link = buildPairingLink();
    if (!link) {
      if (isAlive(gen) && qrGen === qrGeneration) mobileQrDataUrl = null;
      return;
    }
    try {
      const QRCode = await import("qrcode");
      const dataUrl = await QRCode.toDataURL(link, {
        width: 200,
        margin: 2,
        color: { dark: "#e6e6e6", light: "#00000000" },
        errorCorrectionLevel: "M",
      });
      if (isAlive(gen) && qrGen === qrGeneration) mobileQrDataUrl = dataUrl;
    } catch (e) {
      dbgWarn("settings", "QR generation failed", e);
      if (isAlive(gen) && qrGen === qrGeneration) mobileQrDataUrl = null;
    }
  }

  async function saveNotificationSettings() {
    try {
      settings = await api.updateUserSettings({
        notifications_enabled: notifEnabled,
        notify_on_run_completed: notifRunCompleted,
        notify_on_run_failed: notifRunFailed,
        notify_on_approval_required: notifApprovalRequired,
        notify_on_schedule_completed: notifScheduleCompleted,
        notify_on_team_completed: notifTeamCompleted,
        notification_min_duration_sec: notifMinDuration,
        sound_feedback_level: soundFeedbackLevel,
      } as Partial<UserSettings>);
      applySoundFeedbackLevel(soundFeedbackLevel);
    } catch (e) {
      dbgWarn("settings", "saveNotificationSettings error", e);
    }
  }

  async function saveFeishuSettings() {
    try {
      settings = await api.updateUserSettings({
        feishu_webhook_url: feishuWebhookUrl || null,
        feishu_webhook_enabled: feishuWebhookEnabled,
        feishu_webhook_triggers: feishuWebhookTriggers,
      } as Partial<UserSettings>);
    } catch (e) {
      dbgWarn("settings", "saveFeishuSettings error", e);
    }
  }

  async function testFeishuWebhook() {
    feishuTestResult = null;
    try {
      await api.sendFeishuNotification(
        t("settings_notif_feishuTestTitle"),
        t("settings_notif_feishuTestBody"),
        "test",
      );
      feishuTestResult = t("settings_notif_feishuTestOk");
    } catch (e: unknown) {
      feishuTestResult = (e as Error)?.message || t("settings_notif_feishuTestFailed");
    }
  }

  async function deleteRemoteHost(name: string) {
    const updated = remoteHosts.filter((h) => h.name !== name);
    try {
      await api.updateUserSettings({ remote_hosts: updated } as Partial<UserSettings>);
      remoteHosts = updated;
      if (editingRemote?.name === name) editingRemote = null;
    } catch (e) {
      dbgWarn("settings", "delete remote host failed", e);
    }
  }

  async function scanHistory() {
    scanningHistory = true;
    historyError = null;
    scanResult = null;
    importReport = null;
    try {
      scanResult = await api.scanClaudeCodeHistory();
    } catch (e) {
      historyError = String(e);
    } finally {
      scanningHistory = false;
    }
  }

  async function exportHistory() {
    exportingHistory = true;
    historyError = null;
    try {
      const { pickClaudeHistoryExportPath } = await import("$lib/utils/claude-history-archive");
      const outputPath = await pickClaudeHistoryExportPath();
      if (!outputPath) return;
      const result = await api.exportClaudeCodeHistoryArchive(outputPath);
      const kb = (result.totalBytes / 1024).toFixed(1);
      alert(
        t("settings_data_exportToast", {
          count: String(result.sessionCount),
          kb,
          path: outputPath,
          failures: "",
        }),
      );
    } catch (e) {
      historyError = String(e);
    } finally {
      exportingHistory = false;
    }
  }

  async function importHistory() {
    importingHistory = true;
    historyError = null;
    importReport = null;
    try {
      const { pickClaudeHistoryImportPath, notifyRunsChanged } =
        await import("$lib/utils/claude-history-archive");
      const archivePath = await pickClaudeHistoryImportPath();
      if (!archivePath) return;
      importReport = await api.importClaudeCodeHistoryArchive(archivePath);
      notifyRunsChanged();
      await scanHistory();
    } catch (e) {
      historyError = String(e);
    } finally {
      importingHistory = false;
    }
  }

  /** Stable reference — mutate fields in place to avoid prop churn. */
  const panelsState = {
    get settings() {
      return settings;
    },
    saveGeneralPatch,
    applyZoomQueued,
    get platformCredentials() {
      return platformCredentials;
    },
    get selectedPlatformId() {
      return selectedPlatformId;
    },
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
    onSelectPlatform,
    onAuthModeChange,
    saveApiAuth,
    get webStatus() {
      return webStatus;
    },
    get webToken() {
      return webToken;
    },
    get webTunnelUrl() {
      return webTunnelUrl;
    },
    get webLinkCopied() {
      return webLinkCopied;
    },
    get webRestarting() {
      return webRestarting;
    },
    get webRestartWarning() {
      return webRestartWarning;
    },
    get webLanIp() {
      return webLanIp;
    },
    get webAdvancedOpen() {
      return webAdvancedOpen;
    },
    set webAdvancedOpen(v: boolean) {
      webAdvancedOpen = v;
    },
    get webOrigins() {
      return webOrigins;
    },
    get webRestartError() {
      return webRestartError;
    },
    get mobileQrDataUrl() {
      return mobileQrDataUrl;
    },
    get mobilePairingLinkCopied() {
      return mobilePairingLinkCopied;
    },
    get webSelfCheckRunning() {
      return webSelfCheckRunning;
    },
    get webSelfCheckResult() {
      return webSelfCheckResult;
    },
    get webSelfCheckError() {
      return webSelfCheckError;
    },
    toggleWebServer,
    applyWebServerSettings,
    copyAccessLink,
    copyPairingLink,
    runWebSelfCheck,
    get cliConfig() {
      return cliConfig;
    },
    set cliConfig(v: Record<string, unknown>) {
      cliConfig = v;
    },
    get projectCliConfig() {
      return projectCliConfig;
    },
    get cliConfigLoaded() {
      return cliConfigLoaded;
    },
    get cliConfigLoading() {
      return cliConfigLoading;
    },
    get cliConfigError() {
      return cliConfigError;
    },
    loadCliConfig,
    saveCliConfigPatch,
    get remoteHosts() {
      return remoteHosts;
    },
    get editingRemote() {
      return editingRemote;
    },
    set editingRemote(v: RemoteHost | null) {
      editingRemote = v;
    },
    onStartEdit: (host: RemoteHost | null) => {
      editingRemote = host;
    },
    deleteRemoteHost,
    get notifEnabled() {
      return notifEnabled;
    },
    set notifEnabled(v: boolean) {
      notifEnabled = v;
    },
    get notifRunCompleted() {
      return notifRunCompleted;
    },
    set notifRunCompleted(v: boolean) {
      notifRunCompleted = v;
    },
    get notifRunFailed() {
      return notifRunFailed;
    },
    set notifRunFailed(v: boolean) {
      notifRunFailed = v;
    },
    get notifApprovalRequired() {
      return notifApprovalRequired;
    },
    set notifApprovalRequired(v: boolean) {
      notifApprovalRequired = v;
    },
    get notifScheduleCompleted() {
      return notifScheduleCompleted;
    },
    set notifScheduleCompleted(v: boolean) {
      notifScheduleCompleted = v;
    },
    get notifTeamCompleted() {
      return notifTeamCompleted;
    },
    set notifTeamCompleted(v: boolean) {
      notifTeamCompleted = v;
    },
    get notifMinDuration() {
      return notifMinDuration;
    },
    set notifMinDuration(v: number) {
      notifMinDuration = v;
    },
    get soundFeedbackLevel() {
      return soundFeedbackLevel;
    },
    set soundFeedbackLevel(v: "off" | "minimal" | "standard" | "detailed") {
      soundFeedbackLevel = v;
    },
    get feishuWebhookUrl() {
      return feishuWebhookUrl;
    },
    set feishuWebhookUrl(v: string) {
      feishuWebhookUrl = v;
    },
    get feishuWebhookEnabled() {
      return feishuWebhookEnabled;
    },
    set feishuWebhookEnabled(v: boolean) {
      feishuWebhookEnabled = v;
    },
    get feishuWebhookTriggers() {
      return feishuWebhookTriggers;
    },
    set feishuWebhookTriggers(v: string[]) {
      feishuWebhookTriggers = v;
    },
    get feishuTestResult() {
      return feishuTestResult;
    },
    saveNotificationSettings,
    saveFeishuSettings,
    testFeishuWebhook,
    get scanningHistory() {
      return scanningHistory;
    },
    set scanningHistory(v: boolean) {
      scanningHistory = v;
    },
    get exportingHistory() {
      return exportingHistory;
    },
    set exportingHistory(v: boolean) {
      exportingHistory = v;
    },
    get importingHistory() {
      return importingHistory;
    },
    set importingHistory(v: boolean) {
      importingHistory = v;
    },
    get scanResult() {
      return scanResult;
    },
    set scanResult(v: import("$lib/types").CliSessionInfo[] | null) {
      scanResult = v;
    },
    get importReport() {
      return importReport;
    },
    set importReport(v: import("$lib/types").ImportReport | null) {
      importReport = v;
    },
    get historyError() {
      return historyError;
    },
    set historyError(v: string | null) {
      historyError = v;
    },
    onScanHistory: scanHistory,
    onExportHistory: exportHistory,
    onImportHistory: importHistory,
    get mimoAgentSettings() {
      return mimoAgentSettings;
    },
  };
</script>

<div class="flex h-full animate-slide-up">
  <main class="scrollbar-hide flex-1 overflow-y-auto">
    <div class="max-w-3xl mx-auto p-6">
      <SettingsPanels tab={resolvedTab} panelState={panelsState} />
    </div>
  </main>
</div>
