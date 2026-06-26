<script lang="ts">
  /**
   * v1.0.9 perf: lazy-load tab components; only the active tab chunk is fetched.
   */
  import type { Component } from "svelte";
  import type {
    AgentSettings,
    CliSessionInfo,
    ImportReport,
    PlatformCredential,
    RemoteHost,
    UserSettings,
  } from "$lib/types";
  import type { SettingsTabId } from "./tabs/registry";
  import Spinner from "$lib/components/Spinner.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { dbgWarn } from "$lib/utils/debug";

  type TabState = {
    settings: UserSettings | null;
    saveGeneralPatch: (patch: Record<string, unknown>) => Promise<void>;
    applyZoomQueued: (factor: number) => void;
    platformCredentials: PlatformCredential[];
    selectedPlatformId: string | null;
    authMode: string;
    anthropicApiKey: string;
    anthropicBaseUrl: string;
    showApiKey: boolean;
    onSelectPlatform: (id: string) => Promise<void>;
    onAuthModeChange: (mode: string) => Promise<void>;
    saveApiAuth: () => Promise<void>;
    webStatus: {
      enabled: boolean;
      running: boolean;
      port: number;
      bind: string;
      tunnel_url?: string | null;
      warning?: string;
    } | null;
    webToken: string | null;
    webTunnelUrl: string;
    webLinkCopied: boolean;
    webRestarting: boolean;
    webRestartWarning: string | null;
    webLanIp: string | null;
    webAdvancedOpen: boolean;
    webOrigins: string[];
    webRestartError: string | null;
    mobileQrDataUrl: string | null;
    mobilePairingLinkCopied: boolean;
    toggleWebServer: (enable: boolean) => Promise<void>;
    applyWebServerSettings: () => Promise<void>;
    copyAccessLink: () => Promise<void>;
    copyPairingLink: () => Promise<void>;
    cliConfig: Record<string, unknown>;
    projectCliConfig: Record<string, unknown>;
    cliConfigLoaded: boolean;
    cliConfigLoading: boolean;
    cliConfigError: string;
    loadCliConfig: () => Promise<void>;
    saveCliConfigPatch: (key: string, value: unknown) => Promise<void>;
    remoteHosts: RemoteHost[];
    editingRemote: RemoteHost | null;
    onStartEdit: (host: RemoteHost | null) => void;
    deleteRemoteHost: (name: string) => Promise<void>;
    notifEnabled: boolean;
    notifRunCompleted: boolean;
    notifRunFailed: boolean;
    notifApprovalRequired: boolean;
    notifScheduleCompleted: boolean;
    notifTeamCompleted: boolean;
    notifMinDuration: number;
    soundFeedbackLevel: "off" | "minimal" | "standard" | "detailed";
    feishuWebhookUrl: string;
    feishuWebhookEnabled: boolean;
    feishuWebhookTriggers: string[];
    feishuTestResult: string | null;
    saveNotificationSettings: () => Promise<void>;
    saveFeishuSettings: () => Promise<void>;
    testFeishuWebhook: () => Promise<void>;
    scanningHistory: boolean;
    exportingHistory: boolean;
    importingHistory: boolean;
    scanResult: CliSessionInfo[] | null;
    importReport: ImportReport | null;
    historyError: string | null;
    onScanHistory: () => Promise<void>;
    onExportHistory: () => Promise<void>;
    onImportHistory: () => Promise<void>;
    mimoAgentSettings: AgentSettings | null;
  };

  let {
    tab,
    panelState,
  }: {
    tab: SettingsTabId;
    panelState: TabState;
  } = $props();

  type SettingsTabComponent = Component<any>;

  const TAB_LOADERS: Record<SettingsTabId, () => Promise<{ default: SettingsTabComponent }>> = {
    appearance: () => import("./tabs/AppearanceTab.svelte"),
    theme: () => import("./tabs/ThemeTab.svelte"),
    providers: () => import("./tabs/ProvidersTab.svelte"),
    devices: () => import("./tabs/DevicesTab.svelte"),
    shortcuts: () => import("./tabs/ShortcutsTab.svelte"),
    "remote-hosts": () => import("./tabs/RemoteHostsTab.svelte"),
    "cli-behavior": () => import("./tabs/CliBehaviorTab.svelte"),
    worktree: () => import("./tabs/WorktreeTab.svelte"),
    runtimes: () => import("./tabs/RuntimesTab.svelte"),
    notifications: () => import("./tabs/NotificationsTab.svelte"),
    "data-debug": () => import("./tabs/DataAndDebugTab.svelte"),
    updates: () => import("./tabs/UpdatesTab.svelte"),
  };

  let TabComponent = $state<SettingsTabComponent | null>(null);
  let loadError = $state<string | null>(null);

  $effect(() => {
    const activeTab = tab;
    let cancelled = false;
    TabComponent = null;
    loadError = null;

    void TAB_LOADERS[activeTab]()
      .then((mod) => {
        if (cancelled) return;
        TabComponent = mod.default;
      })
      .catch((loadFailure: unknown) => {
        if (cancelled) return;
        dbgWarn("settings", "settings panel import failed", loadFailure);
        loadError = t("settings_tab_loadFailed");
      });

    return () => {
      cancelled = true;
    };
  });
</script>

{#if loadError}
  <p class="text-sm text-destructive">{loadError}</p>
{:else if !TabComponent}
  <div class="flex items-center justify-center py-16">
    <Spinner size="md" class="border-primary border-t-transparent" />
  </div>
{:else}
  {@const C = TabComponent}
  {#if tab === "appearance"}
    <C
      settings={panelState.settings}
      onSaveGeneralPatch={panelState.saveGeneralPatch}
      onZoom={panelState.applyZoomQueued}
    />
  {:else if tab === "theme"}
    <C />
  {:else if tab === "providers"}
    <C
      settings={panelState.settings}
      platformCredentials={panelState.platformCredentials}
      selectedPlatformId={panelState.selectedPlatformId}
      bind:authMode={panelState.authMode}
      bind:anthropicApiKey={panelState.anthropicApiKey}
      bind:anthropicBaseUrl={panelState.anthropicBaseUrl}
      bind:showApiKey={panelState.showApiKey}
      onSelectPlatform={panelState.onSelectPlatform}
      onAuthModeChange={panelState.onAuthModeChange}
      onSaveApiAuth={panelState.saveApiAuth}
    />
  {:else if tab === "devices"}
    <C
      settings={panelState.settings}
      webStatus={panelState.webStatus}
      webToken={panelState.webToken}
      webTunnelUrl={panelState.webTunnelUrl}
      webLinkCopied={panelState.webLinkCopied}
      webRestarting={panelState.webRestarting}
      webRestartWarning={panelState.webRestartWarning}
      webLanIp={panelState.webLanIp}
      webAdvancedOpen={panelState.webAdvancedOpen}
      webOrigins={panelState.webOrigins}
      webRestartError={panelState.webRestartError}
      mobileQrDataUrl={panelState.mobileQrDataUrl}
      mobilePairingLinkCopied={panelState.mobilePairingLinkCopied}
      onToggleWebServer={panelState.toggleWebServer}
      onApplyWebServerSettings={panelState.applyWebServerSettings}
      onCopyAccessLink={panelState.copyAccessLink}
      onCopyPairingLink={panelState.copyPairingLink}
    />
  {:else if tab === "shortcuts"}
    <C />
  {:else if tab === "remote-hosts"}
    <C
      remoteHosts={panelState.remoteHosts}
      bind:editingRemote={panelState.editingRemote}
      onStartEdit={panelState.onStartEdit}
      onDeleteHost={panelState.deleteRemoteHost}
    />
  {:else if tab === "cli-behavior"}
    <C
      bind:cliConfig={panelState.cliConfig}
      projectCliConfig={panelState.projectCliConfig}
      cliConfigLoaded={panelState.cliConfigLoaded}
      cliConfigLoading={panelState.cliConfigLoading}
      cliConfigError={panelState.cliConfigError}
      settings={panelState.settings}
      onLoad={panelState.loadCliConfig}
      onSavePatch={panelState.saveCliConfigPatch}
    />
  {:else if tab === "worktree"}
    <C settings={panelState.settings} onSaveGeneralPatch={panelState.saveGeneralPatch} />
  {:else if tab === "runtimes"}
    <C settings={panelState.settings} mimoAgentSettings={panelState.mimoAgentSettings} />
  {:else if tab === "notifications"}
    <C
      settings={panelState.settings}
      bind:notifEnabled={panelState.notifEnabled}
      bind:notifRunCompleted={panelState.notifRunCompleted}
      bind:notifRunFailed={panelState.notifRunFailed}
      bind:notifApprovalRequired={panelState.notifApprovalRequired}
      bind:notifScheduleCompleted={panelState.notifScheduleCompleted}
      bind:notifTeamCompleted={panelState.notifTeamCompleted}
      bind:notifMinDuration={panelState.notifMinDuration}
      bind:soundFeedbackLevel={panelState.soundFeedbackLevel}
      bind:feishuWebhookUrl={panelState.feishuWebhookUrl}
      bind:feishuWebhookEnabled={panelState.feishuWebhookEnabled}
      bind:feishuWebhookTriggers={panelState.feishuWebhookTriggers}
      feishuTestResult={panelState.feishuTestResult}
      onSaveNotificationSettings={panelState.saveNotificationSettings}
      onSaveFeishuSettings={panelState.saveFeishuSettings}
      onTestFeishuWebhook={panelState.testFeishuWebhook}
    />
  {:else if tab === "data-debug"}
    <C
      bind:scanningHistory={panelState.scanningHistory}
      bind:exportingHistory={panelState.exportingHistory}
      bind:importingHistory={panelState.importingHistory}
      bind:scanResult={panelState.scanResult}
      bind:importReport={panelState.importReport}
      bind:historyError={panelState.historyError}
      onScanHistory={panelState.onScanHistory}
      onExportHistory={panelState.onExportHistory}
      onImportHistory={panelState.onImportHistory}
    />
  {:else if tab === "updates"}
    <C settings={panelState.settings} onSaveGeneralPatch={panelState.saveGeneralPatch} />
  {/if}
{/if}
