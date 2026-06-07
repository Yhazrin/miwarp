<script lang="ts">
  import { onMount, getContext } from "svelte";
  import { goto } from "$app/navigation";
  import { beginRouteTransition, endRouteTransition } from "$lib/utils/route-transition";
  import { chatViewCache } from "$lib/chat/chat-view-cache.svelte";
  import { disarmChatSettingsHop } from "$lib/utils/chat-settings-nav";
  import { slide } from "svelte/transition";
  import { page } from "$app/stores";
  import * as api from "$lib/api";
  import { loadCliInfo } from "$lib/stores";
  import type { KeybindingStore } from "$lib/stores";
  import type {
    UserSettings,
    CliConfigSettingDef,
    RemoteHost,
    RemoteTestResult,
    SshKeyInfo,
  } from "$lib/types";
  import Card from "$lib/components/Card.svelte";
  import SessionModeToggle from "$lib/components/SessionModeToggle.svelte";
  import Button from "$lib/components/Button.svelte";
  import Input from "$lib/components/Input.svelte";
  import KeybindingEditor from "$lib/components/KeybindingEditor.svelte";
  import BackgroundPicker from "$lib/components/BackgroundPicker.svelte";
  import ThemeEditor from "$lib/components/ThemeEditor.svelte";
  import SettingsToggle from "$lib/components/settings/SettingsToggle.svelte";
  import SettingsDoctorPanel from "$lib/components/settings/SettingsDoctorPanel.svelte";
  import { formatKeyDisplay } from "$lib/stores/keybindings.svelte";
  import {
    PLATFORM_PRESETS,
    buildPlatformList,
    isCustomPlatform,
    findCredential,
    expandModelsToTiers,
    compressModelsFromTiers,
  } from "$lib/utils/platform-presets";
  import type { PlatformPreset, PlatformCredential } from "$lib/types";
  import {
    isDebugMode,
    setDebugMode,
    copyDebugLogs,
    getDebugLogCount,
    clearDebugLogs,
    getDebugFilter,
  } from "$lib/utils/debug";
  import { dbg, dbgWarn, redactSensitive } from "$lib/utils/debug";
  import { splitPath } from "$lib/utils/format";
  import { IS_WINDOWS } from "$lib/utils/platform";
  import { t, LOCALE_REGISTRY, currentLocale, switchLocale } from "$lib/i18n/index.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { getTransport } from "$lib/transport";
  import {
    PROCESS_VISIBILITY_LEVELS,
    normalizeProcessVisibility,
    persistCachedProcessVisibility,
  } from "$lib/utils/process-visibility";
  import { applyUiZoomCssVar, clampUiZoom } from "$lib/utils/ui-zoom";
  import {
    applySoundFeedbackLevel,
    normalizeSoundFeedbackLevel,
    previewSoundFeedback,
  } from "$lib/services/sound-feedback-service";

  // ── Tab state (v1.0.6: registry import + URL compatibility) ──
  // v1.0.6 follow-up: import the new settings tab registry so:
  //   1. URL ?tab= param accepts both legacy ids ("general", "connection")
  //      and new ids ("appearance", "providers") via LEGACY_TAB_MAP
  //   2. Future PRs can register new tabs in registry.ts without touching
  //      this file's 5000-line body
  // The legacy `tabs: { id: SettingsTab; icon: string }[]` array below
  // is kept for the existing nav rendering; phase 2 will swap it for
  // SETTINGS_TABS once the body branches are extracted into sub-components.
  import {
    LEGACY_TAB_MAP,
    SETTINGS_TABS,
    SETTINGS_NAV_GROUPS,
    resolveTabId,
    getTab,
    type SettingsTabId,
  } from "$lib/components/settings/tabs/registry";
  import SettingsPanels from "$lib/components/settings/SettingsPanels.svelte";

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
  // v1.0.6 URL compat: route new ids (e.g. ?tab=appearance) through
  // the legacy map first, so the body branches still match. Users
  // who bookmark old ?tab=general URLs still land on general.
  const initialTab: SettingsTab = (() => {
    if (!urlTab) return "general";
    // New id → pick the first legacy id that maps to it
    if (Object.values(LEGACY_TAB_MAP).includes(urlTab as SettingsTabId)) {
      const legacy = Object.entries(LEGACY_TAB_MAP).find(([, v]) => v === urlTab);
      if (legacy) return legacy[0] as SettingsTab;
    }
    // Otherwise treat as legacy id directly
    if (VALID_TABS.includes(urlTab as SettingsTab)) return urlTab as SettingsTab;
    return "general";
  })();
  let activeTab = $state<SettingsTab>(initialTab);

  function setActiveTab(tabId: SettingsTab) {
    activeTab = tabId;
    const url = new URL($page.url);
    url.searchParams.set("tab", tabId);
    history.replaceState(null, "", url.toString());
  }

  // v1.0.6 follow-up: navigation is now registry-driven. The new
  // structure groups 8 tabs into 4 categories (display / integration
  // / automation / system). Each entry resolves to a new tab id;
  // legacy id compatibility is handled by `setActiveTab` + the
  // `SettingsPanels` dispatcher.
  const settingsNavGroups = SETTINGS_NAV_GROUPS.map((g) => ({
    label: () => {
      const key = g.labelKey as Parameters<typeof t>[0];
      return t(key) ?? g.fallbackLabel;
    },
    tabs: SETTINGS_TABS.filter((t) => t.groupId === g.id),
  }));

  /** New tab id → first legacy id. Inverse of LEGACY_TAB_MAP. */
  const NEW_TO_LEGACY: Record<string, string> = Object.fromEntries(
    Object.entries(LEGACY_TAB_MAP).map(([legacy, next]) => [next, legacy]),
  ) as Record<string, string>;
  function newIdToLegacy(id: string): string {
    return NEW_TO_LEGACY[id] ?? id;
  }

  // ── Search (v1.0.6 follow-up: filter sidebar nav by query) ──
  let searchQuery = $state("");
  const trimmedQuery = $derived(searchQuery.trim().toLowerCase());
  /** Filtered nav: groups with ≥1 tab whose label matches the query. */
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
  let generalSaved = $state(false);
  let modelOpus = $state("");
  let modelSonnet = $state("");
  let modelHaiku = $state("");
  let selectedPlatformId = $state<string | null>(null);
  let platformCredentials = $state<PlatformCredential[]>([]);
  let platformExtraEnv = $state<Array<{ key: string; value: string }>>([]);
  // Track whether user manually edited extra_env (per platform ID).
  // Untouched platforms don't write extra_env, avoiding preset defaults being baked into credentials.
  let extraEnvTouched = $state<Record<string, boolean>>({});

  // CLI Auth state
  let authOverview = $state<import("$lib/types").AuthOverview | null>(null);
  let cliLoginLoading = $state(false);
  let cliLoginError = $state("");

  // Derive merged platform list (static presets + dynamic custom endpoints)
  let platformList = $derived(buildPlatformList(platformCredentials));

  // Derive selected platform from id (search merged list, not just static presets)
  let selectedPlatform = $derived<PlatformPreset | null>(
    selectedPlatformId ? (platformList.find((p) => p.id === selectedPlatformId) ?? null) : null,
  );

  // Custom endpoint editing state
  // ── Local proxy detection state ──
  let localProxyStatus = $state<import("$lib/types").LocalProxyStatus | null>(null);
  let localProxyChecking = $state(false);
  let localProxyRequestId = $state(0);
  let localAdvancedOpen = $state(false);
  let localProxyStatuses = $state<Record<string, { running: boolean; needsAuth: boolean }>>({});

  // ── API connectivity test state ──
  let apiTestLoading = $state(false);
  let apiTestResult = $state<import("$lib/types").ApiTestResult | null>(null);
  let apiTestRequestId = $state(0);

  // ── Notification settings ──
  let notifEnabled = $state(true);
  let notifRunCompleted = $state(true);
  let notifRunFailed = $state(true);
  let notifApprovalRequired = $state(true);
  let notifScheduleCompleted = $state(true);
  let notifTeamCompleted = $state(true);
  let notifMinDuration = $state(10);
  let soundFeedbackLevel = $state<"off" | "minimal" | "standard" | "detailed">("minimal");
  let soundPreviewing = $state(false);
  let notifSaved = $state(false);

  // ── Claude Code History Migration ──
  let scanningHistory = $state(false);
  let exportingHistory = $state(false);
  let importingHistory = $state(false);
  let scanResult = $state<import("$lib/types").CliSessionInfo[] | null>(null);
  let importReport = $state<import("$lib/types").ImportReport | null>(null);
  let historyError = $state<string | null>(null);

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
      if (!outputPath) {
        return;
      }
      const result = await api.exportClaudeCodeHistoryArchive(outputPath);
      alert(
        `Exported ${result.sessionCount} sessions (${(result.totalBytes / 1024).toFixed(1)} KB) to:\n${outputPath}${
          result.failures.length > 0 ? `\n${result.failures.length} failures` : ""
        }`,
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
      if (!archivePath) {
        return;
      }
      importReport = await api.importClaudeCodeHistoryArchive(archivePath);
      notifyRunsChanged();
      await scanHistory();
    } catch (e) {
      historyError = String(e);
    } finally {
      importingHistory = false;
    }
  }

  // ── Feishu webhook settings ──
  let feishuWebhookUrl = $state("");
  let feishuWebhookEnabled = $state(false);
  let feishuWebhookTriggers = $state<string[]>([]);
  let feishuSaved = $state(false);
  let feishuTesting = $state(false);
  let feishuTestResult = $state<string | null>(null);
  let feishuUrlError = $state<string | null>(null);
  // Derive effective auth env var (tracks platformCredentials + selectedPlatformId)
  let effectiveAuthEnvVar = $derived(
    findCredential(platformCredentials, selectedPlatformId ?? "")?.auth_env_var ||
      selectedPlatform?.auth_env_var ||
      "ANTHROPIC_API_KEY",
  );
  // Clear stale test result AND invalidate in-flight requests when any relevant input changes
  $effect(() => {
    void anthropicApiKey;
    void anthropicBaseUrl;
    void modelOpus;
    void modelSonnet;
    void modelHaiku;
    void effectiveAuthEnvVar;
    return () => {
      apiTestResult = null;
      apiTestRequestId++; // invalidate in-flight request
      apiTestLoading = false;
    };
  });

  // ── Web Server state (desktop-only) ──
  let webToken = $state<string | null>(null);
  let webStatus = $state<{
    enabled: boolean;
    running: boolean;
    port: number;
    bind: string;
    tunnel_url?: string | null;
    warning?: string;
  } | null>(null);
  let showWebToken = $state(false);
  let webTokenCopied = $state(false);
  let webLinkCopied = $state(false);
  let webRestarting = $state(false);
  let webRestartError = $state<string | null>(null);
  let webRestartWarning = $state<string | null>(null);
  let webPortInput = $state("9476");
  let webOriginInput = $state("");
  let webBindValue = $state("127.0.0.1");
  let webOrigins = $state<string[]>([]);
  let webOriginError = $state<string | null>(null);
  let webAdvancedOpen = $state(false);
  let webLanIp = $state<string | null>(null);
  let webTunnelUrl = $state("");
  let webTunnelError = $state<string | null>(null);
  let webTunnelLinkCopied = $state(false);
  let lanIpRequestId = $state(0);
  let mobileQrDataUrl = $state<string | null>(null);
  let mobilePairingLinkCopied = $state(false);

  let debugOn = $state(isDebugMode());
  let logCopied = $state(false);
  let debugFilter = $state(getDebugFilter() || "1");

  // ── UI Zoom state (desktop-only, dynamic import with fallback) ──

  let cachedWebview: any = null;
  async function getWebview() {
    if (!cachedWebview) {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      cachedWebview = getCurrentWebviewWindow();
    }
    return cachedWebview;
  }

  let zoomPreview = $state(1.0);

  $effect(() => {
    if (settings) {
      zoomPreview = Math.min(1.5, Math.max(0.75, settings.ui_zoom ?? 1.0));
    }
  });

  function clampZoom(v: number): number | null {
    if (!Number.isFinite(v)) return null;
    return Math.min(1.5, Math.max(0.75, v));
  }

  let pendingZoom: number | null = null;
  let zoomFlying = false;

  async function applyZoomQueued(factor: number) {
    const zoom = clampUiZoom(factor);
    applyUiZoomCssVar(zoom);
    if (zoomFlying) {
      pendingZoom = zoom;
      return;
    }

    zoomFlying = true;
    try {
      const wv = await getWebview();
      await wv.setZoom(zoom);
      dbg("settings", "applyZoomQueued", { factor: zoom });
    } catch (e) {
      dbgWarn("settings", "applyZoomQueued failed", e);
    }
    zoomFlying = false;

    if (pendingZoom !== null) {
      const next = pendingZoom;
      pendingZoom = null;
      void applyZoomQueued(next);
    }
  }

  function previewZoom(raw: number) {
    const factor = clampZoom(raw);
    if (factor === null) return;
    zoomPreview = factor;
    void applyZoomQueued(factor);
  }

  let displaySaved = $state(false);

  async function commitZoom(raw: number) {
    const factor = clampZoom(raw);
    if (factor === null) return;

    // Persist
    try {
      settings = await api.updateUserSettings({ ui_zoom: factor });
      dbg("settings", "commitZoom saved", { factor });
      displaySaved = true;
      setTimeout(() => (displaySaved = false), 1500);
    } catch (e) {
      dbgWarn("settings", "commitZoom save failed", e);
      // Rollback to last persisted value
      const fallback = clampUiZoom(settings?.ui_zoom);
      zoomPreview = fallback;
      pendingZoom = null;
      void applyZoomQueued(fallback);
      return;
    }

    // Apply final value via queue (overrides any stale preview)
    pendingZoom = null;
    void applyZoomQueued(factor);
  }
  let logCount = $state(getDebugLogCount());
  let rustCmdCopied = $state(false);
  let currentUsername = $state("");

  // ── Remote host state ──
  let remoteHosts = $state<RemoteHost[]>([]);
  let editingRemote = $state<RemoteHost | null>(null);
  let remoteFormName = $state("");
  let remoteFormHost = $state("");
  let remoteFormUser = $state("");
  let remoteFormPort = $state(22);
  let remoteFormKeyPath = $state("");
  let remoteFormRemoteCwd = $state("");
  let remoteFormClaudePath = $state("");
  let remoteFormForwardKey = $state(false);
  let remoteTesting = $state(false);
  let remoteTestResult = $state<RemoteTestResult | null>(null);
  let remoteSaving = $state(false);
  let remoteSaved = $state(false);

  function resetRemoteForm() {
    editingRemote = null;
    remoteFormName = "";
    remoteFormHost = "";
    remoteFormUser = "";
    remoteFormPort = 22;
    remoteFormKeyPath = "";
    remoteFormRemoteCwd = "";
    remoteFormClaudePath = "";
    remoteFormForwardKey = false;
    remoteTestResult = null;
    remoteFormTouched = false;
  }

  function editRemoteHost(host: RemoteHost) {
    editingRemote = host;
    remoteFormName = host.name;
    remoteFormHost = host.host;
    remoteFormUser = host.user;
    remoteFormPort = host.port;
    remoteFormKeyPath = host.key_path ?? "";
    remoteFormRemoteCwd = host.remote_cwd ?? "";
    remoteFormClaudePath = host.remote_claude_path ?? "";
    remoteFormForwardKey = host.forward_api_key;
    remoteTestResult = null;
  }

  async function saveRemoteHost(keepForm = false) {
    if (!remoteFormName.trim() || !remoteFormHost.trim() || !remoteFormUser.trim()) {
      remoteFormTouched = true;
      return;
    }
    remoteSaving = true;
    try {
      const newHost: RemoteHost = {
        name: remoteFormName.trim(),
        host: remoteFormHost.trim(),
        user: remoteFormUser.trim(),
        port: remoteFormPort || 22,
        key_path: remoteFormKeyPath.trim() || undefined,
        remote_cwd: remoteFormRemoteCwd.trim() || undefined,
        remote_claude_path: remoteFormClaudePath.trim() || undefined,
        forward_api_key: remoteFormForwardKey,
      };

      const updated = editingRemote
        ? remoteHosts.map((h) => (h.name === editingRemote!.name ? newHost : h))
        : [...remoteHosts, newHost];

      await api.updateUserSettings({ remote_hosts: updated } as Partial<UserSettings>);
      remoteHosts = updated;
      if (keepForm) {
        // Switch to edit mode so subsequent saves update instead of duplicate
        editingRemote = newHost;
      } else {
        resetRemoteForm();
      }
      remoteSaved = true;
      setTimeout(() => (remoteSaved = false), 2000);
      dbg("settings", "remote host saved", newHost.name);
    } catch (e) {
      dbgWarn("settings", "save remote host failed", e);
    } finally {
      remoteSaving = false;
    }
  }

  async function deleteRemoteHost(name: string) {
    const updated = remoteHosts.filter((h) => h.name !== name);
    try {
      await api.updateUserSettings({ remote_hosts: updated } as Partial<UserSettings>);
      remoteHosts = updated;
      if (editingRemote?.name === name) resetRemoteForm();
      dbg("settings", "remote host deleted", name);
    } catch (e) {
      dbgWarn("settings", "delete remote host failed", e);
    }
  }

  let remoteFormTouched = $state(false);

  async function testRemoteConnection() {
    if (!remoteFormHost.trim() || !remoteFormUser.trim()) {
      remoteFormTouched = true;
      return;
    }
    remoteTesting = true;
    remoteTestResult = null;
    try {
      remoteTestResult = await api.testRemoteHost(
        remoteFormHost.trim(),
        remoteFormUser.trim(),
        remoteFormPort || undefined,
        remoteFormKeyPath.trim() || undefined,
        remoteFormClaudePath.trim() || undefined,
      );
      dbg("settings", "remote test result", remoteTestResult);
      // Auto-save on successful SSH connection (keep form visible for user to review)
      if (remoteTestResult.ssh_ok && remoteFormName && remoteFormHost && remoteFormUser) {
        await saveRemoteHost(true);
      }
    } catch (e) {
      remoteTestResult = { ssh_ok: false, cli_found: false, error: String(e) };
      dbgWarn("settings", "remote test error", e);
    } finally {
      remoteTesting = false;
    }
  }

  // ── SSH Key wizard state ──
  type SshKeyStep =
    | "idle"
    | "checking"
    | "no_key"
    | "has_key"
    | "pub_missing"
    | "generating"
    | "done"
    | "error";
  let sshKeyStep = $state<SshKeyStep>("idle");
  let sshKeyInfo = $state<SshKeyInfo | null>(null);
  let sshKeyError = $state("");
  let sshCopied = $state(false);
  let sshVerifying = $state(false);
  let wizardKeyPath = $derived(sshKeyInfo?.key_path ?? "");

  function shellQuote(s: string): string {
    return "'" + s.replace(/'/g, "'\\''") + "'";
  }

  function pwshQuote(s: string): string {
    return "'" + s.replace(/'/g, "''") + "'";
  }

  function buildCopyCommand(keyInfo: SshKeyInfo, host: string, user: string, port: number): string {
    if (IS_WINDOWS) {
      const pubPath = pwshQuote(keyInfo.key_path_expanded + ".pub");
      const target = pwshQuote(`${user}@${host}`);
      const remoteScript = pwshQuote(
        "mkdir -p ~/.ssh && chmod 700 ~/.ssh && " +
          "touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && " +
          'key=$(cat) && (grep -qxF "$key" ~/.ssh/authorized_keys 2>/dev/null || ' +
          'echo "$key" >> ~/.ssh/authorized_keys)',
      );
      return `Get-Content -LiteralPath ${pubPath} -Raw | ssh -p ${port} ${target} ${remoteScript}`;
    }
    const keyArg = shellQuote(keyInfo.key_path_expanded);
    const pubArg = shellQuote(keyInfo.key_path_expanded + ".pub");
    const target = `${shellQuote(user)}@${shellQuote(host)}`;

    if (keyInfo.ssh_copy_id_available) {
      return `ssh-copy-id -i ${keyArg} -p ${port} ${target}`;
    }
    const remoteScript =
      "mkdir -p ~/.ssh && chmod 700 ~/.ssh && " +
      "touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && " +
      'key=$(cat) && (grep -qxF "$key" ~/.ssh/authorized_keys 2>/dev/null || ' +
      'echo "$key" >> ~/.ssh/authorized_keys)';
    return `cat ${pubArg} | ssh -p ${port} ${target} ${shellQuote(remoteScript)}`;
  }

  function buildRebuildPubKeyCommand(keyInfo: SshKeyInfo): string {
    if (IS_WINDOWS) {
      const keyPath = pwshQuote(keyInfo.key_path_expanded);
      const pubPath = pwshQuote(keyInfo.key_path_expanded + ".pub");
      return `ssh-keygen -y -f ${keyPath} | Out-File -Encoding ascii ${pubPath}`;
    }
    const keyArg = shellQuote(keyInfo.key_path_expanded);
    return `ssh-keygen -y -f ${keyArg} > ${shellQuote(keyInfo.key_path_expanded + ".pub")}`;
  }

  async function startSshKeyWizard() {
    sshKeyStep = "checking";
    sshKeyError = "";
    sshCopied = false;
    try {
      const info = await api.checkSshKey();
      sshKeyInfo = info;
      dbg("settings", "ssh key check", info);
      if (info.exists && info.pub_exists) {
        sshKeyStep = "has_key";
      } else if (info.exists && !info.pub_exists) {
        sshKeyStep = "pub_missing";
      } else {
        sshKeyStep = "no_key";
      }
    } catch (e) {
      sshKeyError = String(e);
      sshKeyStep = "error";
      dbgWarn("settings", "ssh key check failed", e);
    }
  }

  async function generateSshKey() {
    sshKeyStep = "generating";
    sshKeyError = "";
    try {
      const info = await api.generateSshKey();
      sshKeyInfo = info;
      sshKeyStep = "has_key";
      dbg("settings", "ssh key generated", info);
    } catch (e) {
      sshKeyError = String(e);
      sshKeyStep = "error";
      dbgWarn("settings", "ssh key generation failed", e);
    }
  }

  async function verifySshConnection() {
    if (!sshKeyInfo || !remoteFormHost || !remoteFormUser) return;
    sshVerifying = true;
    try {
      const result = await api.testRemoteHost(
        remoteFormHost.trim(),
        remoteFormUser.trim(),
        remoteFormPort || undefined,
        wizardKeyPath || undefined,
        remoteFormClaudePath.trim() || undefined,
      );
      dbg("settings", "ssh verify result", result);
      if (result.ssh_ok) {
        remoteFormKeyPath = wizardKeyPath;
        sshKeyStep = "done";
      } else {
        sshKeyError = result.error ?? "";
        sshKeyStep = "has_key"; // stay on has_key so user can retry
      }
      remoteTestResult = result;
    } catch (e) {
      sshKeyError = String(e);
      dbgWarn("settings", "ssh verify failed", e);
    } finally {
      sshVerifying = false;
    }
  }

  function closeSshWizard() {
    sshKeyStep = "idle";
    sshKeyError = "";
    sshCopied = false;
    sshVerifying = false;
  }

  // Keybinding store from layout context
  const keybindingStore = getContext<KeybindingStore>("keybindings");
  let cliSectionOpen = $state(false);
  let cliSource = $state<"defaults" | "file">("defaults");

  // Keybinding conflict warning for recording editor
  let recordingConflict = $state("");

  // Derived keybinding groups
  let appBindings = $derived(
    keybindingStore.resolved.filter((b) => b.source === "app" && b.editable),
  );
  let fixedBindings = $derived(
    keybindingStore.resolved.filter((b) => b.source === "app" && !b.editable),
  );
  let cliBindings = $derived(keybindingStore.resolved.filter((b) => b.source === "cli"));
  let hasOverrides = $derived(keybindingStore.overrides.length > 0);

  function isOverridden(command: string): boolean {
    return keybindingStore.overrides.some((o) => o.command === command);
  }

  function getConflictWarning(key: string, context: string, excludeCmd: string): string {
    const conflict = keybindingStore.findConflict(key, context, excludeCmd);
    return conflict ? t("settings_shortcuts_conflictsWith", { label: conflict.label }) : "";
  }

  // ── CLI Config state ──
  let cliConfig = $state<Record<string, unknown>>({});
  let projectCliConfig = $state<Record<string, unknown>>({});
  let cliConfigLoaded = $state(false);
  let cliConfigLoading = $state(false);
  let cliConfigError = $state("");

  // CLI Config setting definitions
  const CLI_CONFIG_SETTINGS: CliConfigSettingDef[] = [
    // Behavior
    {
      key: "thinkingEnabled",
      label: t("settings_cliConfig_thinkingModeLabel"),
      description: t("settings_cliConfig_thinkingModeDesc"),
      group: "behavior",
      type: "boolean",
      default: true,
    },
    {
      key: "fastMode",
      label: t("settings_cliConfig_fastModeLabel"),
      description: t("settings_cliConfig_fastModeDesc"),
      group: "behavior",
      type: "boolean",
      default: false,
    },
    {
      key: "autoCompactEnabled",
      label: t("settings_cliConfig_autoCompactLabel"),
      description: t("settings_cliConfig_autoCompactDesc"),
      group: "behavior",
      type: "boolean",
      default: true,
    },
    {
      key: "fileCheckpointingEnabled",
      label: t("settings_cliConfig_fileCheckpointsLabel"),
      description: t("settings_cliConfig_fileCheckpointsDesc"),
      group: "behavior",
      type: "boolean",
      default: true,
    },
    {
      key: "respectGitignore",
      label: t("settings_cliConfig_respectGitignoreLabel"),
      description: t("settings_cliConfig_respectGitignoreDesc"),
      group: "behavior",
      type: "boolean",
      default: true,
    },
    {
      key: "verbose",
      label: t("settings_cliConfig_verboseLabel"),
      description: t("settings_cliConfig_verboseDesc"),
      group: "behavior",
      type: "boolean",
      default: false,
    },
    {
      key: "defaultPermissionMode",
      label: t("settings_cliConfig_permissionModeLabel"),
      description: t("settings_cliConfig_permissionModeDesc"),
      group: "behavior",
      type: "enum",
      default: undefined,
      options: [
        { value: "default", label: t("settings_cliConfig_optDefault") },
        { value: "plan", label: t("settings_cliConfig_optPlan") },
        { value: "acceptEdits", label: t("settings_cliConfig_optAutoEdit") },
        { value: "bypassPermissions", label: t("settings_cliConfig_optFullAuto") },
      ],
    },
    {
      key: "teammateMode",
      label: t("settings_cliConfig_teammateModeLabel"),
      description: t("settings_cliConfig_teammateModeDesc"),
      group: "behavior",
      type: "enum",
      default: "auto",
      options: [
        { value: "auto", label: t("settings_cliConfig_optAuto") },
        { value: "always", label: t("settings_cliConfig_optAlways") },
        { value: "never", label: t("settings_cliConfig_optNever") },
      ],
    },
    // Appearance
    {
      key: "theme",
      label: t("settings_cliConfig_cliThemeLabel"),
      description: t("settings_cliConfig_cliThemeDesc"),
      group: "appearance",
      type: "enum",
      default: "dark",
      options: [
        { value: "dark", label: t("settings_cliConfig_optDark") },
        { value: "light", label: t("settings_cliConfig_optLight") },
        { value: "light-high-contrast", label: t("settings_cliConfig_optHighContrast") },
      ],
    },
    {
      key: "prefersReducedMotion",
      label: t("settings_cliConfig_reduceMotionLabel"),
      description: t("settings_cliConfig_reduceMotionDesc"),
      group: "appearance",
      type: "boolean",
      default: false,
    },
    {
      key: "language",
      label: t("settings_cliConfig_responseLangLabel"),
      description: t("settings_cliConfig_responseLangDesc"),
      group: "appearance",
      type: "string",
      default: undefined,
    },
    {
      key: "outputStyle",
      label: t("settings_cliConfig_outputStyleLabel"),
      description: t("settings_cliConfig_outputStyleDesc"),
      group: "appearance",
      type: "string",
      default: undefined,
    },
    // Advanced
    {
      key: "autoConnectIde",
      label: t("settings_cliConfig_autoConnectIdeLabel"),
      description: t("settings_cliConfig_autoConnectIdeDesc"),
      group: "advanced",
      type: "boolean",
      default: false,
    },
    {
      key: "promptSuggestionsEnabled",
      label: t("settings_cliConfig_promptSuggestionsLabel"),
      description: t("settings_cliConfig_promptSuggestionsDesc"),
      group: "advanced",
      type: "boolean",
      default: true,
    },
    {
      key: "spinnerTipsEnabled",
      label: t("settings_cliConfig_spinnerTipsLabel"),
      description: t("settings_cliConfig_spinnerTipsDesc"),
      group: "advanced",
      type: "boolean",
      default: true,
    },
    {
      key: "codeDiffFooterEnabled",
      label: t("settings_cliConfig_codeDiffFooterLabel"),
      description: t("settings_cliConfig_codeDiffFooterDesc"),
      group: "advanced",
      type: "boolean",
      default: true,
    },
    {
      key: "prStatusFooterEnabled",
      label: t("settings_cliConfig_prStatusFooterLabel"),
      description: t("settings_cliConfig_prStatusFooterDesc"),
      group: "advanced",
      type: "boolean",
      default: true,
    },
    {
      key: "autoUpdatesChannel",
      label: t("settings_cliConfig_updateChannelLabel"),
      description: t("settings_cliConfig_updateChannelDesc"),
      group: "advanced",
      type: "enum",
      default: undefined,
      options: [
        { value: "latest", label: t("settings_cliConfig_optLatest") },
        { value: "stable", label: t("settings_cliConfig_optStable") },
      ],
    },
    {
      key: "preferredNotifChannel",
      label: t("settings_cliConfig_notifChannelLabel"),
      description: t("settings_cliConfig_notifChannelDesc"),
      group: "advanced",
      type: "enum",
      default: "auto",
      options: [
        { value: "auto", label: t("settings_cliConfig_optAuto") },
        { value: "iterm2", label: t("settings_cliConfig_optIterm2") },
        { value: "terminal_bell", label: t("settings_cliConfig_optTerminalBell") },
      ],
    },
  ];

  const behaviorSettings = CLI_CONFIG_SETTINGS.filter((s) => s.group === "behavior");
  const appearanceSettings = CLI_CONFIG_SETTINGS.filter((s) => s.group === "appearance");
  const advancedSettings = CLI_CONFIG_SETTINGS.filter((s) => s.group === "advanced");

  function getCliConfigValue(key: string, def: CliConfigSettingDef): unknown {
    return key in cliConfig ? cliConfig[key] : def.default;
  }

  function isProjectOverride(key: string): boolean {
    return key in projectCliConfig;
  }

  async function saveCliConfigPatch(key: string, value: unknown) {
    dbg("settings", "saveCliConfigPatch", { key, value });
    try {
      // null value = delete key (restore CLI default)
      cliConfig = await api.updateCliConfig({ [key]: value ?? null });
    } catch (e) {
      dbgWarn("settings", "saveCliConfigPatch error", e);
    }
  }

  async function loadCliConfig() {
    if (cliConfigLoading) return;
    cliConfigLoading = true;
    cliConfigError = "";
    try {
      cliConfig = await api.getCliConfig();
      // Load project config for override indicators
      const cwd = localStorage.getItem("ocv:project-cwd") || "";
      if (cwd) {
        projectCliConfig = await api.getProjectCliConfig(cwd);
      }
      cliConfigLoaded = true;
      dbg("settings", "cliConfig loaded", {
        keys: Object.keys(cliConfig).length,
        projectKeys: Object.keys(projectCliConfig).length,
      });
    } catch (e) {
      cliConfigError = String(e);
      dbgWarn("settings", "loadCliConfig error", e);
    } finally {
      cliConfigLoading = false;
    }
  }

  // Lazy load CLI config when tab activates
  $effect(() => {
    if (activeTab === "cli-config" && !cliConfigLoaded && !cliConfigLoading) {
      loadCliConfig();
    }
  });

  // Refresh log count periodically when debug is on
  $effect(() => {
    if (!debugOn) return;
    const timer = setInterval(() => {
      logCount = getDebugLogCount();
    }, 2000);
    return () => clearInterval(timer);
  });

  function detectPlatformFromUrl(url: string, activePlatformId?: string): string | null {
    // If we have a stored active_platform_id, prefer it
    if (activePlatformId) return activePlatformId;
    if (!url) return null;
    const match = PLATFORM_PRESETS.find((p) => p.base_url && url === p.base_url);
    return match?.id ?? "custom";
  }

  /** Load display fields (key + URL) from credential store for a given platform. */
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
    // base_url: credential override > preset default > empty
    anthropicBaseUrl = cred?.base_url ?? preset?.base_url ?? "";
    // models: credential override > preset default > expand to 3 tiers
    const models = cred?.models ?? preset?.models;
    const [o, s, h] = expandModelsToTiers(models);
    modelOpus = o;
    modelSonnet = s;
    modelHaiku = h;
    // extra_env: credential explicit value (including {}) takes priority; undefined falls back to preset
    const extraEnv = cred?.extra_env !== undefined ? cred.extra_env : (preset?.extra_env ?? {});
    platformExtraEnv = Object.entries(extraEnv).map(([key, value]) => ({ key, value }));
    // Don't set touched on load — touched is only driven by UI edit actions (onblur/delete row)
    dbg("settings", "loadFieldsFromCredential", {
      platformId,
      hasKey: !!anthropicApiKey,
      url: anthropicBaseUrl,
      models: [modelOpus, modelSonnet, modelHaiku],
      extraEnvKeys: Object.keys(extraEnv),
      extraEnvSource: cred?.extra_env !== undefined ? "credential" : "preset",
    });
  }

  /** Save current editing fields into the credentials array. */
  function saveCurrentToCredential() {
    if (!selectedPlatformId) return;
    const preset = PLATFORM_PRESETS.find((p) => p.id === selectedPlatformId);
    // Compress 3 tier inputs → models array; undefined when all empty (→ backend preset fallback).
    // Do NOT fall back to preset?.models here — undefined means "use provider defaults",
    // and baking preset values into credential would prevent future preset updates from taking effect.
    const modelsToSave = compressModelsFromTiers(modelOpus, modelSonnet, modelHaiku);

    // Convert extra_env array back to Record, filter empty keys, warn on duplicates
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

    // Only write extra_env when user has touched it; otherwise preserve credential's original value
    const extraEnvToSave = extraEnvTouched[selectedPlatformId]
      ? extraEnvRecord // always write (even empty {}), distinct from undefined
      : undefined; // don't overwrite — keep credential as-is (may be undefined or old value)

    dbg("settings", "saveCurrentToCredential: extra_env", {
      platform: selectedPlatformId,
      touched: !!extraEnvTouched[selectedPlatformId],
      keys: Object.keys(extraEnvRecord),
    });

    _upsertCredential(selectedPlatformId, {
      api_key: anthropicApiKey || undefined,
      // Always save base_url — backend needs it for ANTHROPIC_BASE_URL injection
      base_url: anthropicBaseUrl || preset?.base_url || undefined,
      auth_env_var: selectedPlatform?.auth_env_var ?? preset?.auth_env_var,
      models: modelsToSave,
      ...(extraEnvToSave !== undefined ? { extra_env: extraEnvToSave } : {}),
    });
  }

  /** Sync global fields from current display state and persist everything. */
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

  /**
   * Parse pasted env text. Supported formats:
   * - KEY=value lines (with optional `export` prefix, # comments, quoted values)
   * - JSON object: { "KEY": "value", ... }
   */
  function parseEnvText(text: string): Array<{ key: string; value: string }> {
    const trimmed = text.trim();
    // Try JSON object first
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
        // Not valid JSON, fall through to line-based parsing
      }
    }
    // Line-based: KEY=value, export KEY=value, # comments
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

  /** Handle paste on env key input: if content looks like KEY=value lines, bulk-add them. */
  function handleEnvKeyPaste(e: ClipboardEvent, index: number) {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    const parsed = parseEnvText(text);
    if (parsed.length === 0) return; // not env format, let normal paste through
    e.preventDefault();
    // Replace current (likely empty) row with first parsed entry, append rest
    const before = platformExtraEnv.slice(0, index);
    const after = platformExtraEnv.slice(index + 1);
    platformExtraEnv = [...before, ...parsed, ...after];
    markExtraEnvTouched();
    persistCurrentPlatform();
    dbg("settings", "env paste parsed", { count: parsed.length, keys: parsed.map((p) => p.key) });
  }

  /** Unified persist: save current platform fields to credential + sync to settings. */
  function persistCurrentPlatform() {
    saveCurrentToCredential();
    if (selectedPlatformId) syncAndSave(selectedPlatformId);
  }

  // ── Local proxy detection ──

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
    // 1. Save current platform's data to credentials (if modified)
    saveCurrentToCredential();
    // 2. Switch to new platform
    selectedPlatformId = preset.id;
    localAdvancedOpen = false;
    localProxyStatus = null;
    // 3. Load new platform's data from credentials
    loadFieldsFromCredential(preset.id);
    // 4. Sync global fields + persist
    syncAndSave(preset.id);
    // 5. Auto-detect if local proxy
    if (preset.category === "local") {
      checkLocalProxy();
    }
  }

  /** Upsert a credential in the local platformCredentials array. */
  function _upsertCredential(platformId: string, fields: Partial<PlatformCredential>) {
    const idx = platformCredentials.findIndex((c) => c.platform_id === platformId);
    if (idx >= 0) {
      platformCredentials[idx] = { ...platformCredentials[idx], ...fields };
    } else {
      platformCredentials = [...platformCredentials, { platform_id: platformId, ...fields }];
    }
  }

  /** Add a new custom endpoint — creates with defaults and immediately selects it. */
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
    // Select the newly created endpoint — opens full config form below
    const preset = buildPlatformList(platformCredentials).find((p) => p.id === id);
    if (preset) applyPlatformPreset(preset);
  }

  /** Delete a custom endpoint. */
  function deleteCustomEndpoint(platformId: string) {
    // Clear selection first so applyPlatformPreset won't re-save the deleted credential
    const wasActive = selectedPlatformId === platformId;
    if (wasActive) selectedPlatformId = null;
    platformCredentials = platformCredentials.filter((c) => c.platform_id !== platformId);
    saveGeneralPatch({ platform_credentials: platformCredentials });
    // If we deleted the active platform, switch to Anthropic
    if (wasActive) {
      const anthropic = PLATFORM_PRESETS.find((p) => p.id === "anthropic");
      if (anthropic) applyPlatformPreset(anthropic);
    }
  }

  function openSetupWizard() {
    window.dispatchEvent(new CustomEvent("ocv:show-wizard"));
  }

  function navigateBackFromSettings() {
    const target = chatViewCache.lastChatHref || "/chat";
    beginRouteTransition();
    void goto(target).finally(endRouteTransition);
  }

  onMount(() => {
    disarmChatSettingsHop();
    void (async () => {
      try {
        settings = await api.getUserSettings();
        authMode = settings.auth_mode ?? "cli";
        remoteHosts = settings.remote_hosts ?? [];
        platformCredentials = settings.platform_credentials ?? [];
        // Notification settings
        notifEnabled = settings.notifications_enabled ?? true;
        notifRunCompleted = settings.notify_on_run_completed ?? true;
        notifRunFailed = settings.notify_on_run_failed ?? true;
        notifApprovalRequired = settings.notify_on_approval_required ?? true;
        notifScheduleCompleted = settings.notify_on_schedule_completed ?? true;
        notifTeamCompleted = settings.notify_on_team_completed ?? true;
        notifMinDuration = settings.notification_min_duration_sec ?? 10;
        soundFeedbackLevel = normalizeSoundFeedbackLevel(settings.sound_feedback_level);
        applySoundFeedbackLevel(soundFeedbackLevel);
        // Feishu webhook settings
        feishuWebhookUrl = settings.feishu_webhook_url ?? "";
        feishuWebhookEnabled = settings.feishu_webhook_enabled ?? false;
        feishuWebhookTriggers = settings.feishu_webhook_triggers ?? [];
        // Load display fields from credentials (not global fields)
        if (authMode === "api") {
          selectedPlatformId = detectPlatformFromUrl(
            settings.anthropic_base_url ?? "",
            settings.active_platform_id,
          );
          loadFieldsFromCredential(selectedPlatformId);
        } else {
          anthropicApiKey = settings.anthropic_api_key ?? "";
          anthropicBaseUrl = settings.anthropic_base_url ?? "";
        }
      } catch (e) {
        dbgWarn("settings", "error", e);
      }

      const deferHeavy = () => {
        api
          .getAuthOverview()
          .then((ov) => (authOverview = ov))
          .catch((e) => {
            dbgWarn("settings", "failed to load auth overview", e);
          });
        if (getTransport().isDesktop()) {
          Promise.all([api.getWebServerStatus(), api.getWebServerToken()])
            .then(async ([status, token]) => {
              webStatus = status;
              webToken = token;
              webPortInput = String(settings?.web_server_port ?? 9476);
              webBindValue = settings?.web_server_bind ?? "127.0.0.1";
              webOrigins = [...(settings?.web_server_allowed_origins ?? [])];
              webTunnelUrl = settings?.web_server_tunnel_url ?? "";
              dbg("settings", "webServer loaded", {
                enabled: status?.enabled,
                hasToken: !!token,
                tunnel: webTunnelUrl,
              });
              if (status?.running) await refreshLanIp(status.bind);
            })
            .catch((e) => {
              dbgWarn("settings", "webServer load failed", e);
            });
        }
        loadCliInfo();
        void checkAllLocalProxies();
        if (selectedPlatform?.category === "local") {
          void checkLocalProxy();
        }
        import("@tauri-apps/api/path")
          .then(async (p) => {
            const home = await p.homeDir();
            const parts = splitPath(home.replace(/[/\\]+$/, ""));
            currentUsername = parts[parts.length - 1] || "";
            const absPath = await p.join(home, ".claude", "keybindings.json");
            return api.readTextFile(absPath);
          })
          .then(() => {
            cliSource = "file";
          })
          .catch(() => {
            cliSource = "defaults";
          });
      };

      if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(deferHeavy, { timeout: 120 });
      } else {
        requestAnimationFrame(deferHeavy);
      }
    })();
  });

  async function saveGeneralPatch(patch: Record<string, unknown>) {
    dbg("settings", "saveGeneralPatch", redactSensitive(patch));
    try {
      settings = await api.updateUserSettings(patch as Partial<UserSettings>);
      generalSaved = true;
      setTimeout(() => (generalSaved = false), 1500);
    } catch (e) {
      dbgWarn("settings", "saveGeneralPatch error", e);
    }
  }
  // v1.0.6 follow-up: thin callbacks that SettingsPanels expects.
  // The original inline handlers lived in the connection / mobile
  // branches; with the switch to SettingsPanels they're hoisted here.
  async function onSelectPlatform(preset: PlatformPreset | string) {
    const id = typeof preset === "string" ? preset : preset.id;
    if (selectedPlatformId === id) return;
    selectedPlatformId = id;
    settings = await api.updateUserSettings({
      active_platform_id: id,
    } as Partial<UserSettings>);
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
  async function toggleWebServer(enable: boolean) {
    // Delegated to the web server settings apply path; the new tab
    // only flips enable so we run a minimal restart with current state.
    webRestarting = true;
    webRestartError = null;
    try {
      if (enable) {
        await api.restartWebServer({
          enabled: true,
          port: webStatus?.port ?? 9476,
          bind: webStatus?.bind ?? "127.0.0.1",
          allowed_origins: null,
          tunnel_url: webTunnelUrl.trim() || null,
        });
      } else {
        await api.restartWebServer({
          enabled: false,
          port: 0,
          bind: "",
          allowed_origins: null,
          tunnel_url: null,
        });
      }
      webStatus = await api.getWebServerStatus();
      settings = await api.getUserSettings();
    } catch (e) {
      webRestartError = e instanceof Error ? e.message : String(e);
    } finally {
      webRestarting = false;
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
      notifSaved = true;
      setTimeout(() => (notifSaved = false), 1500);
    } catch (e) {
      dbgWarn("settings", "saveNotificationSettings error", e);
    }
  }

  function validateFeishuUrl(url: string): string | null {
    if (!url) return null;
    if (
      url.startsWith("https://open.feishu.cn/open-apis/bot/v2/hook/") ||
      url.startsWith("https://open.larksuite.com/open-apis/bot/v2/hook/")
    ) {
      return null;
    }
    return t("settings_notif_feishuUrlInvalid") || "Invalid Feishu webhook URL";
  }

  async function saveFeishuSettings() {
    feishuUrlError = validateFeishuUrl(feishuWebhookUrl);
    if (feishuUrlError && feishuWebhookEnabled) return;
    try {
      settings = await api.updateUserSettings({
        feishu_webhook_url: feishuWebhookUrl || null,
        feishu_webhook_enabled: feishuWebhookEnabled,
        feishu_webhook_triggers: feishuWebhookTriggers,
      } as Partial<UserSettings>);
      feishuSaved = true;
      setTimeout(() => (feishuSaved = false), 1500);
    } catch (e) {
      dbgWarn("settings", "saveFeishuSettings error", e);
    }
  }

  async function testFeishuWebhook() {
    feishuUrlError = validateFeishuUrl(feishuWebhookUrl);
    if (feishuUrlError) return;
    feishuTesting = true;
    feishuTestResult = null;
    try {
      await api.sendFeishuNotification("Test", "Feishu webhook test from MiWarp", "test");
      feishuTestResult = t("settings_notif_feishuTestOk") || "Test notification sent";
    } catch (e: unknown) {
      feishuTestResult = (e as Error)?.message || "Failed to send";
    } finally {
      feishuTesting = false;
    }
  }

  // ── Web Server helpers ──

  async function applyWebServerSettings() {
    webRestarting = true;
    webRestartError = null;
    webRestartWarning = null;
    webTunnelError = null;
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
      dbg("settings", "webServer apply", { started: result.started, saved: result.config_saved });
      if (webStatus?.running) await refreshLanIp(webStatus.bind);
    } catch (e: unknown) {
      webRestartError = (e as Error)?.message ?? String(e);
      webStatus = await api.getWebServerStatus();
      dbgWarn("settings", "webServer apply failed", e);
    } finally {
      webRestarting = false;
    }
  }

  function addWebOrigin() {
    const trimmed = webOriginInput.trim().replace(/\/+$/, "");
    if (!trimmed) return;
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        webOriginError = t("settings_general_webOriginInvalid");
        return;
      }
      const origin = url.origin;
      if (!webOrigins.includes(origin)) {
        webOrigins = [...webOrigins, origin];
      }
    } catch {
      webOriginError = t("settings_general_webOriginInvalid");
      return;
    }
    webOriginInput = "";
    webOriginError = null;
  }

  async function refreshLanIp(bind: string): Promise<string | null> {
    const myId = ++lanIpRequestId;
    if (bind !== "0.0.0.0" && bind !== "::" && bind !== "[::]") {
      webLanIp = null;
      return null;
    }
    try {
      const preferV6 = bind === "::" || bind === "[::]";
      const ip = await api.getLocalIp(preferV6);
      if (myId !== lanIpRequestId) return webLanIp;
      webLanIp = ip;
      return ip;
    } catch (e) {
      dbgWarn("settings", "refreshLanIp failed", e);
      if (myId !== lanIpRequestId) return webLanIp;
      webLanIp = null;
      return null;
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

  function buildTunnelAccessUrl(): string | null {
    if (!webStatus?.running || !webToken) return null;
    // Use saved (applied) tunnel URL, not the draft input value
    const tunnel = settings?.web_server_tunnel_url?.trim();
    if (!tunnel) return null;
    try {
      const u = new URL(tunnel);
      // Tunnel links use ?token= (server-side auth) to survive ngrok/cloudflared
      // interstitial pages. Local links keep #token= (fragment, never sent to server).
      return `${u.origin}/login?token=${webToken}`;
    } catch {
      return null;
    }
  }

  function buildAccessUrl(): string | null {
    return buildTunnelAccessUrl() ?? buildLocalAccessUrl();
  }

  async function copyAccessLink() {
    const url = buildAccessUrl();
    if (!url) return;
    await navigator.clipboard.writeText(url);
    webLinkCopied = true;
    dbg("settings", "webLink copied");
    setTimeout(() => (webLinkCopied = false), 1500);
  }

  async function openAccessLink() {
    const url = buildAccessUrl();
    if (!url) return;
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
      dbg("settings", "webLink opened in browser");
    } catch (e) {
      dbgWarn("settings", "failed to open browser", e);
    }
  }

  function buildPairingLink(): string | null {
    if (!webStatus?.running || !webToken) return null;
    const bind = webStatus.bind;
    const isAll = bind === "0.0.0.0" || bind === "::" || bind === "[::]";
    const rawHost = isAll ? webLanIp : bind;
    if (!rawHost) return null;
    // IPv6 addresses need brackets; encodeURIComponent handles special chars in all fields
    const host = rawHost.includes(":") ? `[${rawHost}]` : rawHost;
    return `miwarp://connect?host=${encodeURIComponent(host)}&port=${encodeURIComponent(webStatus.port)}&token=${encodeURIComponent(webToken)}`;
  }

  async function generateMobileQr() {
    const link = buildPairingLink();
    if (!link) {
      mobileQrDataUrl = null;
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
      mobileQrDataUrl = dataUrl;
    } catch (e) {
      dbgWarn("settings", "QR generation failed", e);
      mobileQrDataUrl = null;
    }
  }

  async function copyPairingLink() {
    const link = buildPairingLink();
    if (!link) return;
    await navigator.clipboard.writeText(link);
    mobilePairingLinkCopied = true;
    dbg("settings", "pairing link copied");
    setTimeout(() => (mobilePairingLinkCopied = false), 1500);
  }

  // Generate QR when status/token/IP changes
  $effect(() => {
    const _key = `${webStatus?.running}-${webStatus?.bind}-${webToken}-${webLanIp}`;
    if (webStatus?.running && webToken) {
      void generateMobileQr();
    } else {
      mobileQrDataUrl = null;
    }
  });
</script>

{#key currentLocale()}
  <div class="flex h-full animate-slide-up">
    <!-- ═══ Left Sidebar Navigation ═══ -->
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
        <!-- Search input (v1.0.6 follow-up) -->
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

    <!-- ═══ Content Area ═══ -->
    <main class="flex-1 overflow-y-auto">
      <div class="max-w-3xl mx-auto p-6">
        <div>
          <SettingsPanels
            tab={resolveTabId(activeTab)}
            state={{
              settings,
              saveGeneralPatch,
              applyZoomQueued,

              platformCredentials,
              selectedPlatformId,
              authMode,
              anthropicApiKey,
              anthropicBaseUrl,
              showApiKey,
              onSelectPlatform,
              onAuthModeChange,
              saveApiAuth,

              webStatus,
              webToken,
              webTunnelUrl,
              webLinkCopied,
              webRestarting,
              webRestartWarning,
              webLanIp,
              webAdvancedOpen,
              webOrigins,
              webRestartError,
              mobileQrDataUrl,
              mobilePairingLinkCopied,
              toggleWebServer,
              applyWebServerSettings,
              copyAccessLink,
              copyPairingLink,

              cliConfig,
              projectCliConfig,
              cliConfigLoaded,
              cliConfigLoading,
              cliConfigError,
              loadCliConfig,
              saveCliConfigPatch,

              remoteHosts,
              editingRemote,
              onStartEdit: (host) => (editingRemote = host),
              deleteRemoteHost,

              notifEnabled,
              notifRunCompleted,
              notifRunFailed,
              notifApprovalRequired,
              notifScheduleCompleted,
              notifTeamCompleted,
              notifMinDuration,
              soundFeedbackLevel,
              feishuWebhookUrl,
              feishuWebhookEnabled,
              feishuWebhookTriggers,
              feishuTestResult,
              saveNotificationSettings,
              saveFeishuSettings,
              testFeishuWebhook,

              scanningHistory,
              exportingHistory,
              importingHistory,
              scanResult,
              importReport,
              historyError,
              onScanHistory: scanHistory,
              onExportHistory: exportHistory,
              onImportHistory: importHistory,
            }}
          />
        </div>
      </div>
    </main>
  </div>
{/key}
