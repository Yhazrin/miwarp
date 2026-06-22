<script lang="ts">
  /**
   * Settings orchestrator (v1.0.9 perf): tab-scoped loading, no mount-time
   * deferHeavy IPC. Heavy work runs only when a tab is first activated.
   */
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { beginRouteTransition, endRouteTransition } from "$lib/utils/route-transition";
  import { chatViewCache } from "$lib/chat/chat-view-cache.svelte";
  import { disarmChatSettingsHop } from "$lib/utils/chat-settings-nav";
  import * as api from "$lib/api";
  import type { AgentSettings, RemoteHost, UserSettings } from "$lib/types";
  import { findCredential } from "$lib/utils/platform-presets";
  import { dbg, dbgWarn, redactSensitive } from "$lib/utils/debug";
  import { perfMark, perfMarkAsync } from "$lib/utils/perf";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { getTransport } from "$lib/transport";
  import { applyUiZoomCssVar, clampUiZoom } from "$lib/utils/ui-zoom";
  import {
    applySoundFeedbackLevel,
    normalizeSoundFeedbackLevel,
  } from "$lib/services/sound-feedback-service";
  import {
    LEGACY_TAB_MAP,
    SETTINGS_TABS,
    SETTINGS_NAV_GROUPS,
    resolveTabId,
    type SettingsTabId,
  } from "$lib/components/settings/tabs/registry";
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

  type SettingsTab =
    | "general"
    | "connection"
    | "mobile"
    | "cli-config"
    | "shortcuts"
    | "remote"
    | "notifications"
    | "debug"
    | "theme"
    | "data";

  const VALID_TABS: SettingsTab[] = [
    "general",
    "connection",
    "mobile",
    "cli-config",
    "shortcuts",
    "remote",
    "notifications",
    "debug",
    "theme",
    "data",
  ];

  const urlTab = $page.url.searchParams.get("tab");
  const initialTab: SettingsTab = (() => {
    if (!urlTab) return "general";
    if (Object.values(LEGACY_TAB_MAP).includes(urlTab as SettingsTabId)) {
      const legacy = Object.entries(LEGACY_TAB_MAP).find(([, v]) => v === urlTab);
      if (legacy) return legacy[0] as SettingsTab;
    }
    if (VALID_TABS.includes(urlTab as SettingsTab)) return urlTab as SettingsTab;
    return "general";
  })();

  let activeTab = $state<SettingsTab>(initialTab);
  let mounted = $state(false);
  let pageGeneration = 0;
  const tabLoadController = new SettingsTabLoadController();

  function setActiveTab(tabId: SettingsTab) {
    activeTab = tabId;
    const url = new URL($page.url);
    url.searchParams.set("tab", tabId);
    history.replaceState(null, "", url.toString());
  }

  const settingsNavGroups = SETTINGS_NAV_GROUPS.map((g) => ({
    label: () => {
      const key = g.labelKey as Parameters<typeof t>[0];
      return t(key) ?? g.fallbackLabel;
    },
    tabs: SETTINGS_TABS.filter((tab) => tab.groupId === g.id),
  }));

  const NEW_TO_LEGACY: Record<string, string> = Object.fromEntries(
    Object.entries(LEGACY_TAB_MAP).map(([legacy, next]) => [next, legacy]),
  ) as Record<string, string>;

  function newIdToLegacy(id: string): string {
    return NEW_TO_LEGACY[id] ?? id;
  }

  let searchQuery = $state("");
  const trimmedQuery = $derived(searchQuery.trim().toLowerCase());
  const filteredNavGroups = $derived(
    trimmedQuery
      ? settingsNavGroups
          .map((g) => ({
            ...g,
            tabs: g.tabs.filter((tab) => {
              const hay = (
                t(tab.labelKey as Parameters<typeof t>[0]) ?? tab.fallbackLabel
              ).toLowerCase();
              return hay.includes(trimmedQuery);
            }),
          }))
          .filter((g) => g.tabs.length > 0)
      : settingsNavGroups,
  );

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

  function detectPlatformFromUrl(url: string, activePlatformId?: string): string | null {
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

  const resolvedTab = $derived(resolveTabId(activeTab));

  $effect(() => {
    if (!mounted) return;
    const tab = resolvedTab;
    void ensureTabLoaded(tab);
  });

  $effect(() => {
    if (!mounted || resolvedTab !== "devices") return;
    const _key = `${webStatus?.running}-${webStatus?.bind}-${webToken}-${webLanIp}`;
    if (webStatus?.running && webToken) {
      void generateMobileQr(pageGeneration);
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

  async function generateMobileQr(gen: number) {
    const link = buildPairingLink();
    if (!link) {
      if (isAlive(gen)) mobileQrDataUrl = null;
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
      if (isAlive(gen)) mobileQrDataUrl = dataUrl;
    } catch (e) {
      dbgWarn("settings", "QR generation failed", e);
      if (isAlive(gen)) mobileQrDataUrl = null;
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

  function navigateBackFromSettings() {
    const target = chatViewCache.lastChatHref || "/chat";
    beginRouteTransition();
    void goto(target).finally(endRouteTransition);
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
    toggleWebServer,
    applyWebServerSettings,
    copyAccessLink,
    copyPairingLink,
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
  <aside
    class="w-56 shrink-0 border-r border-border/50 overflow-y-auto flex flex-col bg-background/50"
  >
    <div class="shrink-0 h-[var(--miwarp-titlebar-band)]" aria-hidden="true"></div>
    <div class="relative flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-2.5">
      <button
        type="button"
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        onclick={navigateBackFromSettings}
        title={t("common_back")}
        aria-label={t("common_back")}
      >
        <Icon name="chevron-left" size="sm" />
      </button>
      <h1
        class="min-w-0 truncate text-[13px] font-semibold leading-snug tracking-tight text-foreground"
      >
        {t("settings_title")}
      </h1>
    </div>
    <nav class="flex flex-1 flex-col gap-5 px-2.5 pb-4 pt-3">
      <div class="relative px-1">
        <input
          type="text"
          placeholder={t("settings_search_placeholder")}
          bind:value={searchQuery}
          aria-label={t("settings_search_placeholder")}
          class="w-full rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5 pr-6 text-xs placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none"
        />
        {#if searchQuery}
          <button
            type="button"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear"
            onclick={() => (searchQuery = "")}
          >
            <Icon name="x" size="xs" />
          </button>
        {/if}
      </div>

      {#each filteredNavGroups as group (group.label())}
        <section class="flex flex-col gap-1.5">
          <p
            class="px-2 text-[11px] font-medium leading-none tracking-wide text-muted-foreground/70"
          >
            {group.label()}
          </p>
          <div class="flex flex-col gap-0.5">
            {#each group.tabs as tab (tab.id)}
              <button
                type="button"
                class="flex min-h-[32px] w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] leading-snug transition-colors
                  {activeTab === newIdToLegacy(tab.id)
                  ? 'bg-accent/90 font-medium text-foreground'
                  : 'font-normal text-muted-foreground hover:bg-accent/45 hover:text-foreground'}"
                onclick={() => setActiveTab(newIdToLegacy(tab.id) as SettingsTab)}
              >
                <svg
                  class="h-3.5 w-3.5 shrink-0 opacity-80"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d={tab.iconPath} />
                </svg>
                <span class="min-w-0 truncate"
                  >{t(tab.labelKey as Parameters<typeof t>[0]) ?? tab.fallbackLabel}</span
                >
              </button>
            {/each}
          </div>
        </section>
      {/each}
    </nav>
  </aside>

  <main class="scrollbar-hide flex-1 overflow-y-auto">
    <div class="max-w-3xl mx-auto p-6">
      <SettingsPanels tab={resolvedTab} panelState={panelsState} />
    </div>
  </main>
</div>
