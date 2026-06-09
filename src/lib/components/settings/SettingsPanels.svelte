<script lang="ts">
  /**
   * v1.0.6 follow-up: unified dispatcher for the settings body.
   * Replaces the 10 inline `{:else if activeTab === "..."}` branches in
   * +page.svelte. Takes the entire settings state as a single `state`
   * object and dispatches to the right tab component based on the
   * registry.
   *
   * The orchestrator (+page.svelte) maps `activeTab` (legacy id) →
   * new id, then renders `<SettingsPanels {tab} {state} />`. Each
   * state field is read from the bundle and passed as a named prop
   * to the tab component.
   */
  import type {
    UserSettings,
    PlatformCredential,
    RemoteHost,
    CliSessionInfo,
    ImportReport,
  } from "$lib/types";
  import type { SettingsTabId } from "./tabs/registry";
  import { getTab } from "./tabs/registry";
  import AppearanceTab from "./tabs/AppearanceTab.svelte";
  import ProvidersTab from "./tabs/ProvidersTab.svelte";
  import DevicesTab from "./tabs/DevicesTab.svelte";
  import ShortcutsTab from "./tabs/ShortcutsTab.svelte";
  import RemoteHostsTab from "./tabs/RemoteHostsTab.svelte";
  import CliBehaviorTab from "./tabs/CliBehaviorTab.svelte";
  import WorktreeTab from "./tabs/WorktreeTab.svelte";
  import NotificationsTab from "./tabs/NotificationsTab.svelte";
  import DataAndDebugTab from "./tabs/DataAndDebugTab.svelte";
  import ThemeTab from "./tabs/ThemeTab.svelte";

  // Bundled state type — flattened for prop wiring convenience.
  // Keep fields as `any` only where the tab has its own narrower type
  // (e.g. webStatus is `{enabled, bind, port, tunnel_url}` but the
  // panel declares its own structural type).
  type TabState = {
    // settings
    settings: UserSettings | null;
    saveGeneralPatch: (patch: Record<string, unknown>) => Promise<void>;
    applyZoomQueued: (factor: number) => void;

    // providers
    platformCredentials: PlatformCredential[];
    selectedPlatformId: string | null;
    authMode: string;
    anthropicApiKey: string;
    anthropicBaseUrl: string;
    showApiKey: boolean;
    onSelectPlatform: (id: string) => Promise<void>;
    onAuthModeChange: (mode: string) => Promise<void>;
    saveApiAuth: () => Promise<void>;

    // devices
    webStatus: { enabled: boolean; bind: string; port: number; tunnel_url?: string | null } | null;
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

    // cli behavior
    cliConfig: Record<string, unknown>;
    projectCliConfig: Record<string, unknown>;
    cliConfigLoaded: boolean;
    cliConfigLoading: boolean;
    cliConfigError: string;
    loadCliConfig: () => Promise<void>;
    saveCliConfigPatch: (key: string, value: unknown) => Promise<void>;

    // remote
    remoteHosts: RemoteHost[];
    editingRemote: RemoteHost | null;
    onStartEdit: (host: RemoteHost | null) => void;
    deleteRemoteHost: (name: string) => Promise<void>;

    // notifications
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

    // data + debug
    scanningHistory: boolean;
    exportingHistory: boolean;
    importingHistory: boolean;
    scanResult: CliSessionInfo[] | null;
    importReport: ImportReport | null;
    historyError: string | null;
    onScanHistory: () => Promise<void>;
    onExportHistory: () => Promise<void>;
    onImportHistory: () => Promise<void>;
  };

  let {
    tab,
    state,
  }: {
    tab: SettingsTabId;
    state: TabState;
  } = $props();

  // svelte 5 dynamic component: cast to Component<any> to bypass strict type
  // checks across the 8 different prop shapes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AppearanceTabC = AppearanceTab as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ProvidersTabC = ProvidersTab as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const DevicesTabC = DevicesTab as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ShortcutsTabC = ShortcutsTab as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const RemoteHostsTabC = RemoteHostsTab as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CliBehaviorTabC = CliBehaviorTab as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const WorktreeTabC = WorktreeTab as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const NotificationsTabC = NotificationsTab as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const DataAndDebugTabC = DataAndDebugTab as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ThemeTabC = ThemeTab as any;
</script>

{#if tab === "appearance"}
  <AppearanceTabC
    settings={state.settings}
    onSaveGeneralPatch={state.saveGeneralPatch}
    onZoom={state.applyZoomQueued}
  />
{:else if tab === "providers"}
  <ProvidersTabC
    settings={state.settings}
    platformCredentials={state.platformCredentials}
    selectedPlatformId={state.selectedPlatformId}
    bind:authMode={state.authMode}
    bind:anthropicApiKey={state.anthropicApiKey}
    bind:anthropicBaseUrl={state.anthropicBaseUrl}
    bind:showApiKey={state.showApiKey}
    onSelectPlatform={state.onSelectPlatform}
    onAuthModeChange={state.onAuthModeChange}
    onSaveApiAuth={state.saveApiAuth}
  />
{:else if tab === "devices"}
  <DevicesTabC
    settings={state.settings}
    webStatus={state.webStatus}
    webToken={state.webToken}
    webTunnelUrl={state.webTunnelUrl}
    webLinkCopied={state.webLinkCopied}
    webRestarting={state.webRestarting}
    webRestartWarning={state.webRestartWarning}
    webLanIp={state.webLanIp}
    webAdvancedOpen={state.webAdvancedOpen}
    webOrigins={state.webOrigins}
    webRestartError={state.webRestartError}
    mobileQrDataUrl={state.mobileQrDataUrl}
    mobilePairingLinkCopied={state.mobilePairingLinkCopied}
    onToggleWebServer={state.toggleWebServer}
    onApplyWebServerSettings={state.applyWebServerSettings}
    onCopyAccessLink={state.copyAccessLink}
    onCopyPairingLink={state.copyPairingLink}
  />
{:else if tab === "shortcuts"}
  <ShortcutsTabC />
{:else if tab === "remote-hosts"}
  <RemoteHostsTabC
    remoteHosts={state.remoteHosts}
    bind:editingRemote={state.editingRemote}
    onStartEdit={state.onStartEdit}
    onDeleteHost={state.deleteRemoteHost}
  />
{:else if tab === "cli-behavior"}
  <CliBehaviorTabC
    bind:cliConfig={state.cliConfig}
    projectCliConfig={state.projectCliConfig}
    cliConfigLoaded={state.cliConfigLoaded}
    cliConfigLoading={state.cliConfigLoading}
    cliConfigError={state.cliConfigError}
    settings={state.settings}
    onLoad={state.loadCliConfig}
    onSavePatch={state.saveCliConfigPatch}
  />
{:else if tab === "worktree"}
  <WorktreeTabC settings={state.settings} onSaveGeneralPatch={state.saveGeneralPatch} />
{:else if tab === "notifications"}
  <NotificationsTabC
    settings={state.settings}
    bind:notifEnabled={state.notifEnabled}
    bind:notifRunCompleted={state.notifRunCompleted}
    bind:notifRunFailed={state.notifRunFailed}
    bind:notifApprovalRequired={state.notifApprovalRequired}
    bind:notifScheduleCompleted={state.notifScheduleCompleted}
    bind:notifTeamCompleted={state.notifTeamCompleted}
    bind:notifMinDuration={state.notifMinDuration}
    bind:soundFeedbackLevel={state.soundFeedbackLevel}
    bind:feishuWebhookUrl={state.feishuWebhookUrl}
    bind:feishuWebhookEnabled={state.feishuWebhookEnabled}
    bind:feishuWebhookTriggers={state.feishuWebhookTriggers}
    feishuTestResult={state.feishuTestResult}
    onSaveNotificationSettings={state.saveNotificationSettings}
    onSaveFeishuSettings={state.saveFeishuSettings}
    onTestFeishuWebhook={state.testFeishuWebhook}
  />
{:else if tab === "data-debug"}
  <DataAndDebugTabC
    bind:scanningHistory={state.scanningHistory}
    bind:exportingHistory={state.exportingHistory}
    bind:importingHistory={state.importingHistory}
    bind:scanResult={state.scanResult}
    bind:importReport={state.importReport}
    bind:historyError={state.historyError}
    onScanHistory={state.onScanHistory}
    onExportHistory={state.onExportHistory}
    onImportHistory={state.onImportHistory}
  />
{/if}

<!-- Theme — standalone first-level tab. Color + mode are the two main
     sections; the advanced editor lives in a collapsed details element. -->
{#if tab === "theme"}
  <ThemeTabC />
{/if}

<!-- Defensive: if registry has no component for the requested tab,
     fall back to the appearance tab so the user always sees something. -->
{#if !getTab(tab)}
  <p class="text-sm text-muted-foreground">
    Unknown tab: {tab}
  </p>
{/if}
