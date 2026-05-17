<script lang="ts">
  import { onMount, getContext } from "svelte";
  import { page } from "$app/stores";
  import * as api from "$lib/api";
  import { loadCliInfo, KeybindingStore } from "$lib/stores";
  import type { UserSettings } from "$lib/types";
  import Card from "$lib/components/Card.svelte";
  import Button from "$lib/components/Button.svelte";
  import Input from "$lib/components/Input.svelte";
  import KeybindingEditor from "$lib/components/KeybindingEditor.svelte";
  import BackgroundPicker from "$lib/components/BackgroundPicker.svelte";
  import ThemeEditor from "$lib/components/ThemeEditor.svelte";
  import SettingsToggle from "$lib/components/settings/SettingsToggle.svelte";
  import GeneralTab from "$lib/components/settings/GeneralTab.svelte";
  import NotificationsTab from "$lib/components/settings/NotificationsTab.svelte";
  import AgentAppearanceSettings from "$lib/components/settings/AgentAppearanceSettings.svelte";
  import RemoteTab from "$lib/components/settings/RemoteTab.svelte";
  import CliConfigTab from "$lib/components/settings/CliConfigTab.svelte";
  import { useConnectionPlatform } from "$lib/composables/use-connection-platform.svelte";
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

  import { IS_WINDOWS } from "$lib/utils/platform";
  import { t, currentLocale } from "$lib/i18n/index.svelte";

  // ── Tab state ──
  type SettingsTab =
    | "general"
    | "connection"
    | "cli-config"
    | "shortcuts"
    | "remote"
    | "notifications"
    | "debug"
    | "theme";
  const VALID_TABS: SettingsTab[] = [
    "general",
    "connection",
    "cli-config",
    "shortcuts",
    "remote",
    "notifications",
    "debug",
    "theme",
  ];
  const urlTab = $page.url.searchParams.get("tab");
  const initialTab: SettingsTab = VALID_TABS.includes(urlTab as SettingsTab)
    ? (urlTab as SettingsTab)
    : "general";
  let activeTab = $state<SettingsTab>(initialTab);

  function setActiveTab(tabId: SettingsTab) {
    activeTab = tabId;
    const url = new URL($page.url);
    url.searchParams.set("tab", tabId);
    history.replaceState(null, "", url.toString());
  }

  const tabLabels: Record<SettingsTab, () => string> = {
    general: () => t("settings_tab_general"),
    connection: () => t("settings_tab_connection"),
    "cli-config": () => t("settings_tab_cliConfig"),
    shortcuts: () => t("settings_tab_shortcuts"),
    remote: () => t("settings_tab_remote"),
    notifications: () => t("settings_tab_notifications") || "Notifications",
    debug: () => t("settings_tab_debug"),
    theme: () => t("settings_tab_theme") || "Theme",
  };

  const tabs: { id: SettingsTab; icon: string }[] = [
    {
      id: "general",
      icon: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
    },
    {
      id: "connection",
      icon: "M12 2a4 4 0 0 0-4 4c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2 4 4 0 0 0-4-4z M8 8v2a4 4 0 0 0 8 0V8 M12 14v4 M8 18h8",
    },
    {
      id: "cli-config",
      icon: "M4 17l6-6-6-6 M12 19h8",
    },
    {
      id: "shortcuts",
      icon: "M10 8h.01 M12 12h.01 M14 8h.01 M16 12h.01 M18 8h.01 M6 8h.01 M7 16h10 M8 12h.01 M2 4h20v16H2z",
    },
    {
      id: "remote",
      icon: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
    },
    {
      id: "notifications",
      icon: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0",
    },
    { id: "debug", icon: "m18 16 4-4-4-4 M6 8l-4 4 4 4 M14.5 4l-5 16" },
    {
      id: "theme",
      icon: "M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z",
    },
  ];

  let settings = $state<UserSettings | null>(null);
  let generalSaved = $state(false);

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

  const conn = useConnectionPlatform({ saveGeneralPatch });

  let debugOn = $state(isDebugMode());
  let logCopied = $state(false);
  let debugFilter = $state(getDebugFilter() || "1");

  let logCount = $state(getDebugLogCount());
  let rustCmdCopied = $state(false);

  // Keybinding store from layout context
  const keybindingStore = getContext<KeybindingStore>("keybindings");
  let cliSectionOpen = $state(false);
  let cliSource = $state<"defaults" | "file">("defaults");

  // Keybinding conflict warning for recording editor
  let recordingConflict = $state("");

  // Derived keybinding groups (editable app shortcuts split by context, aligned with shortcut help)
  let appBindingsGlobal = $derived(
    keybindingStore.resolved.filter(
      (b) => b.source === "app" && b.editable && b.context === "global",
    ),
  );
  let appBindingsChat = $derived(
    keybindingStore.resolved.filter(
      (b) => b.source === "app" && b.editable && b.context === "chat",
    ),
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

  // Refresh log count periodically when debug is on
  $effect(() => {
    if (!debugOn) return;
    const timer = setInterval(() => {
      logCount = getDebugLogCount();
    }, 2000);
    return () => clearInterval(timer);
  });

  function openSetupWizard() {
    window.dispatchEvent(new CustomEvent("ocv:show-wizard"));
  }

  onMount(async () => {
    try {
      settings = await api.getUserSettings();
      conn.initFromSettings(settings);
    } catch (e) {
      dbgWarn("settings", "error", e);
    }
    api
      .getAuthOverview()
      .then((ov) => (conn.authOverview = ov))
      .catch((e) => {
        dbgWarn("settings", "failed to load auth overview", e);
      });
    loadCliInfo();
    conn.checkAllLocalProxies();
    if (conn.selectedPlatform?.category === "local") {
      conn.checkLocalProxy();
    }
    // Detect CLI keybindings source
    import("@tauri-apps/api/path")
      .then(async (p) => {
        const home = await p.homeDir();
        const absPath = await p.join(home, ".claude", "keybindings.json");
        return api.readTextFile(absPath);
      })
      .then(() => {
        cliSource = "file";
      })
      .catch(() => {
        cliSource = "defaults";
      });
  });
</script>

{#key currentLocale()}
  <div class="flex h-full animate-slide-up">
    <!-- ═══ Left Sidebar Navigation ═══ -->
    <aside
      class="w-56 shrink-0 border-r border-border/50 overflow-y-auto flex flex-col bg-background/50"
    >
      <div class="p-4 pb-2">
        <h1 class="text-base font-bold">{t("settings_title")}</h1>
      </div>
      <nav class="flex-1 px-2 pb-4 space-y-0.5">
        <!-- General -->
        <p
          class="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest px-2 pt-3 pb-1"
        >
          {t("settings_nav_general") || "General"}
        </p>
        {#each ["general"] as tabId (tabId)}
          {@const tab = tabs.find((t) => t.id === tabId)}
          {#if tab}
            <button
              class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors text-left
              {activeTab === tab.id
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}"
              onclick={() => setActiveTab(tab.id)}
            >
              <svg
                class="h-3.5 w-3.5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"><path d={tab.icon} /></svg
              >
              {tabLabels[tab.id]()}
            </button>
          {/if}
        {/each}

        <!-- Models & Providers -->
        <p
          class="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest px-2 pt-3 pb-1"
        >
          {t("settings_nav_providers") || "Providers"}
        </p>
        {#each ["connection"] as tabId (tabId)}
          {@const tab = tabs.find((t) => t.id === tabId)}
          {#if tab}
            <button
              class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors text-left
              {activeTab === tab.id
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}"
              onclick={() => setActiveTab(tab.id)}
            >
              <svg
                class="h-3.5 w-3.5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"><path d={tab.icon} /></svg
              >
              {tabLabels[tab.id]()}
            </button>
          {/if}
        {/each}

        <!-- CLI -->
        <p
          class="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest px-2 pt-3 pb-1"
        >
          {t("settings_nav_cli") || "CLI"}
        </p>
        {#each ["cli-config"] as tabId (tabId)}
          {@const tab = tabs.find((t) => t.id === tabId)}
          {#if tab}
            <button
              class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors text-left
              {activeTab === tab.id
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}"
              onclick={() => setActiveTab(tab.id)}
            >
              <svg
                class="h-3.5 w-3.5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"><path d={tab.icon} /></svg
              >
              {tabLabels[tab.id]()}
            </button>
          {/if}
        {/each}

        <!-- Workspace -->
        <p
          class="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest px-2 pt-3 pb-1"
        >
          {t("settings_nav_workspace") || "Workspace"}
        </p>
        {#each ["shortcuts", "remote"] as tabId (tabId)}
          {@const tab = tabs.find((t) => t.id === tabId)}
          {#if tab}
            <button
              class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors text-left
              {activeTab === tab.id
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}"
              onclick={() => setActiveTab(tab.id)}
            >
              <svg
                class="h-3.5 w-3.5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"><path d={tab.icon} /></svg
              >
              {tabLabels[tab.id]()}
            </button>
          {/if}
        {/each}

        <!-- System -->
        <p
          class="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest px-2 pt-3 pb-1"
        >
          {t("settings_nav_system") || "System"}
        </p>
        {#each ["notifications", "theme", "debug"] as tabId (tabId)}
          {@const tab = tabs.find((t) => t.id === tabId)}
          {#if tab}
            <button
              class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors text-left
              {activeTab === tab.id
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}"
              onclick={() => setActiveTab(tab.id)}
            >
              <svg
                class="h-3.5 w-3.5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"><path d={tab.icon} /></svg
              >
              {tabLabels[tab.id]()}
            </button>
          {/if}
        {/each}
      </nav>
    </aside>

    <!-- ═══ Content Area ═══ -->
    <main class="flex-1 overflow-y-auto">
      <div class="max-w-3xl mx-auto p-6">
        <!-- ═══ General tab ═══ -->
        {#if activeTab === "general"}
          {#if settings}
            <GeneralTab
              initialSettings={settings}
              onSettingsUpdated={(updated) => {
                settings = updated;
              }}
            />
          {/if}

          <!-- ═══ Connection tab ═══ -->
        {:else if activeTab === "connection"}
          <div class="space-y-6">
            <!-- Authentication -->
            <Card class="p-6 space-y-5">
              <div class="flex items-center justify-between">
                <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("settings_general_connection")}
                </h2>
                {#if generalSaved}
                  <span class="text-xs text-emerald-500 flex items-center gap-1 animate-fade-in">
                    <svg
                      class="h-3 w-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
                    >
                    {t("settings_general_saved")}
                  </span>
                {/if}
              </div>

              <!-- Auth Mode selector: 2-way radio -->
              <div>
                <span class="text-sm font-medium mb-2 block">{t("settings_auth_modeLabel")}</span>
                <div class="mt-1 grid grid-cols-2 gap-3">
                  <button
                    class="flex flex-col items-center gap-2 rounded-lg border p-4 text-sm transition-all duration-150
                {conn.authMode === 'cli'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      : 'hover:bg-accent hover:border-ring/30'}"
                    onclick={() => {
                      conn.authMode = "cli";
                      saveGeneralPatch({
                        auth_mode: "cli",
                        anthropic_base_url: null,
                        active_platform_id: null,
                        auth_env_var: null,
                      });
                      api.removeCliApiKey().catch(() => {});
                      api
                        .getAuthOverview()
                        .then((ov) => (conn.authOverview = ov))
                        .catch(() => {});
                    }}
                  >
                    <div
                      class="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10"
                    >
                      <svg
                        class="h-5 w-5 text-emerald-400"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path
                          d="M7 11V7a5 5 0 0 1 10 0v4"
                        />
                      </svg>
                    </div>
                    <span class="font-medium">{t("auth_cliAuth")}</span>
                    <span class="text-[10px] text-muted-foreground text-center"
                      >{t("settings_auth_modeCliDesc")}</span
                    >
                  </button>
                  <button
                    class="flex flex-col items-center gap-2 rounded-lg border p-4 text-sm transition-all duration-150
                {conn.authMode === 'api'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      : 'hover:bg-accent hover:border-ring/30'}"
                    onclick={() => {
                      conn.authMode = "api";
                      saveGeneralPatch({ auth_mode: "api" });
                      api
                        .getAuthOverview()
                        .then((ov) => (conn.authOverview = ov))
                        .catch(() => {});
                    }}
                  >
                    <div
                      class="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/10"
                    >
                      <svg
                        class="h-5 w-5 text-violet-400"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path
                          d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"
                        />
                      </svg>
                    </div>
                    <span class="font-medium">{t("auth_appApiKey")}</span>
                    <span class="text-[10px] text-muted-foreground text-center"
                      >{t("settings_auth_modeAppDesc")}</span
                    >
                  </button>
                </div>
              </div>

              <!-- CLI Auth details (expanded when auth_mode = cli) -->
              {#if conn.authMode === "cli"}
                <div class="space-y-4 rounded-lg border border-border/50 p-4">
                  <!-- CLI Login status -->
                  <div>
                    <h3 class="text-sm font-medium mb-1">{t("settings_auth_cliLoginTitle")}</h3>
                    <p class="text-xs text-muted-foreground mb-2">
                      {t("settings_auth_cliLoginDesc")}
                    </p>
                    {#if conn.authOverview?.cli_login_available}
                      <div class="flex items-center gap-2">
                        <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
                        <span class="text-xs text-emerald-500">
                          {t("auth_loggedIn")}{conn.authOverview.cli_login_account
                            ? `: ${conn.authOverview.cli_login_account}`
                            : ""}
                        </span>
                      </div>
                    {:else}
                      <div class="flex flex-col gap-2">
                        <div class="flex items-center gap-2">
                          <span class="h-2 w-2 rounded-full bg-muted-foreground/40"></span>
                          <span class="text-xs text-muted-foreground">{t("auth_notLoggedIn")}</span>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={conn.cliLoginLoading}
                            onclick={() => {
                              conn.cliLoginLoading = true;
                              conn.cliLoginError = "";
                              api
                                .runClaudeLogin()
                                .then((success) => {
                                  if (success) {
                                    api
                                      .getAuthOverview()
                                      .then((ov) => (conn.authOverview = ov))
                                      .catch(() => {});
                                  } else {
                                    conn.cliLoginError = t("setup_loginFailed");
                                  }
                                })
                                .catch((e) => {
                                  conn.cliLoginError = String(e);
                                })
                                .finally(() => {
                                  conn.cliLoginLoading = false;
                                });
                            }}
                          >
                            {#if conn.cliLoginLoading}
                              <span class="flex items-center gap-1.5">
                                <span
                                  class="h-3 w-3 border border-foreground/30 border-t-foreground rounded-full animate-spin"
                                ></span>
                                {t("settings_auth_cliLoginBtn")}
                              </span>
                            {:else}
                              {t("settings_auth_cliLoginBtn")}
                            {/if}
                          </Button>
                        </div>
                        {#if conn.cliLoginError}
                          <div class="rounded border border-red-500/30 bg-red-500/5 px-2 py-1">
                            <p class="text-xs text-red-500">{conn.cliLoginError}</p>
                          </div>
                        {/if}
                      </div>
                    {/if}
                  </div>

                  <!-- CLI API Key (read-only) -->
                  <div>
                    <h3 class="text-sm font-medium mb-1">{t("settings_auth_cliApiKeyTitle")}</h3>
                    {#if conn.authOverview?.cli_has_api_key}
                      <div class="flex items-center gap-2">
                        <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
                        <span class="text-xs text-emerald-500"
                          >{t("auth_cliKeyHint", {
                            hint: conn.authOverview.cli_api_key_hint ?? "",
                          })}</span
                        >
                      </div>
                      <p class="mt-1 text-[10px] text-muted-foreground/70 italic">
                        {#if conn.authOverview.cli_api_key_source === "settings"}
                          {t("settings_auth_cliApiKeySourceSettings")}
                        {:else if conn.authOverview.cli_api_key_source === "env"}
                          {t("settings_auth_cliApiKeySourceEnv")}
                        {:else if conn.authOverview.cli_api_key_source?.startsWith("shell_config:")}
                          {t("settings_auth_cliApiKeySourceShell", {
                            path: conn.authOverview.cli_api_key_source.slice(13),
                          })}
                        {/if}
                      </p>
                    {:else}
                      <div class="flex items-center gap-2">
                        <span class="h-2 w-2 rounded-full bg-muted-foreground/40"></span>
                        <span class="text-xs text-muted-foreground"
                          >{t("settings_auth_cliApiKeyNotSet")}</span
                        >
                      </div>
                      <p class="mt-1 text-[10px] text-muted-foreground/70 italic">
                        {t("settings_auth_cliApiKeyEditHint")}
                      </p>
                    {/if}
                  </div>

                  <!-- Priority hint -->
                  {#if conn.authOverview?.cli_login_available && conn.authOverview?.cli_has_api_key}
                    <p class="text-[10px] text-muted-foreground/70 italic">
                      {t("auth_cliPriorityHint")}
                    </p>
                  {/if}
                </div>
              {/if}

              {#if conn.authMode === "api"}
                <div class="space-y-4 rounded-lg border border-border/50 p-4">
                  <div>
                    <h3 class="text-sm font-medium mb-1">{t("settings_auth_appApiKeyTitle")}</h3>
                    <p class="text-xs text-muted-foreground mb-3">
                      {t("settings_auth_appApiKeyDesc")}
                    </p>
                  </div>
                  <!-- Platform selector -->
                  <div>
                    <span class="text-sm font-medium mb-1.5 block"
                      >{t("settings_general_platform")}</span
                    >
                    <!-- Platform grid (always visible) -->
                    <div class="grid grid-cols-4 gap-1.5">
                      {#each conn.platformList.filter((p) => p.id !== "custom") as preset (preset.id)}
                        <button
                          class="flex flex-col gap-0 rounded-md p-2 text-left transition-colors relative group
                      {conn.selectedPlatformId === preset.id
                            ? 'bg-primary/10 ring-1 ring-primary'
                            : 'bg-muted/40 hover:bg-muted/70'}"
                          onclick={() => conn.applyPlatformPreset(preset)}
                        >
                          <span class="text-xs font-medium truncate">{preset.name}</span>
                          <span class="text-[10px] text-muted-foreground truncate"
                            >{preset.description}</span
                          >
                          {#if isCustomPlatform(preset.id)}
                            <span
                              role="button"
                              tabindex="0"
                              class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-0.5 cursor-pointer"
                              onclick={(e: MouseEvent) => {
                                e.stopPropagation();
                                conn.deleteCustomEndpoint(preset.id);
                              }}
                              onkeydown={(e: KeyboardEvent) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.stopPropagation();
                                  conn.deleteCustomEndpoint(preset.id);
                                }
                              }}
                              title={t("settings_general_deleteCustom")}
                            >
                              <svg
                                class="h-3 w-3"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
                              >
                            </span>
                          {/if}
                          {#if preset.category === "local"}
                            {@const ps = conn.localProxyStatuses[preset.id]}
                            <span
                              class="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full {ps?.running &&
                              !ps.needsAuth
                                ? 'bg-green-500'
                                : ps?.running && ps.needsAuth
                                  ? 'bg-amber-500'
                                  : 'bg-muted-foreground/30'}"
                              title={ps?.running && !ps.needsAuth
                                ? t("settings_local_running")
                                : ps?.running && ps.needsAuth
                                  ? t("settings_local_needsAuth")
                                  : t("settings_local_notDetected")}
                            ></span>
                          {:else if findCredential(conn.platformCredentials, preset.id)?.api_key}
                            <span
                              class="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-green-500"
                              title="Key saved"
                            ></span>
                          {/if}
                        </button>
                      {/each}
                      <!-- Add Custom -->
                      <button
                        class="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-muted-foreground/30 p-2 text-muted-foreground hover:border-primary/50 hover:text-foreground hover:bg-muted/40 transition-colors"
                        onclick={() => conn.addCustomEndpoint()}
                      >
                        <svg
                          class="h-4 w-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"><path d="M12 5v14" /><path d="M5 12h14" /></svg
                        >
                        <span class="text-[10px]">{t("settings_general_addCustom")}</span>
                      </button>
                    </div>
                  </div>

                  {#if conn.selectedPlatform?.category === "local"}
                    <!-- Local proxy status card -->
                    <div class="rounded-lg border p-4 space-y-3">
                      <div class="flex items-center gap-2">
                        {#if conn.localProxyChecking}
                          <span class="h-2 w-2 rounded-full bg-amber-400 animate-pulse"></span>
                          <span class="text-sm">{t("settings_local_checking")}</span>
                        {:else if conn.localProxyStatus?.running && !conn.localProxyStatus.needsAuth}
                          <span class="h-2 w-2 rounded-full bg-green-500"></span>
                          <span class="text-sm font-medium">{t("settings_local_running")}</span>
                        {:else if conn.localProxyStatus?.running && conn.localProxyStatus.needsAuth}
                          <span class="h-2 w-2 rounded-full bg-amber-500"></span>
                          <span class="text-sm font-medium">{t("settings_local_needsAuth")}</span>
                        {:else}
                          <span class="h-2 w-2 rounded-full bg-muted-foreground/30"></span>
                          <span class="text-sm">{t("settings_local_notDetected")}</span>
                        {/if}
                        <button
                          class="ml-auto rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          onclick={conn.checkLocalProxy}>{t("settings_local_refresh")}</button
                        >
                      </div>
                      <p class="text-xs text-muted-foreground font-mono">{conn.anthropicBaseUrl}</p>
                      {#if conn.localProxyStatus && !conn.localProxyStatus.running}
                        <p class="text-xs text-amber-500">
                          {conn.selectedPlatform.setup_hint
                            ? t(conn.selectedPlatform.setup_hint as Parameters<typeof t>[0])
                            : t("settings_local_startHint", { name: conn.selectedPlatform.name })}
                        </p>
                      {/if}
                      {#if conn.selectedPlatform.docs_url}
                        <a
                          href={conn.selectedPlatform.docs_url}
                          target="_blank"
                          class="text-xs text-primary hover:underline"
                        >
                          {t("settings_local_viewDocs")} →
                        </a>
                      {/if}
                    </div>

                    <!-- Advanced settings toggle -->
                    <button
                      class="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onclick={() => (conn.localAdvancedOpen = !conn.localAdvancedOpen)}
                    >
                      {conn.localAdvancedOpen ? "▾" : "▸"}
                      {t("settings_local_advanced")}
                    </button>
                  {/if}

                  {#if conn.selectedPlatform?.category !== "local" || conn.localAdvancedOpen}
                    <!-- Custom endpoint: Name + Auth Type -->
                    {#if isCustomPlatform(conn.selectedPlatformId ?? "")}
                      <div class="flex gap-3">
                        <div class="flex-1">
                          <label class="text-sm font-medium mb-1.5 block"
                            >{t("settings_general_customNameLabel")}</label
                          >
                          <Input
                            value={findCredential(
                              conn.platformCredentials,
                              conn.selectedPlatformId ?? "",
                            )?.name ?? ""}
                            placeholder={t("settings_general_customNamePlaceholder")}
                            class="mt-1 text-xs"
                            onblur={(e) => {
                              const target = e.currentTarget as HTMLInputElement | null;
                              if (!target) return;
                              const val = target.value.trim();
                              if (conn.selectedPlatformId) {
                                conn._upsertCredential(conn.selectedPlatformId, {
                                  name: val || "Custom",
                                });
                                saveGeneralPatch({
                                  platform_credentials: conn.platformCredentials,
                                });
                              }
                            }}
                          />
                        </div>
                        <div>
                          <label class="text-sm font-medium mb-1.5 block"
                            >{t("settings_general_authType")}</label
                          >
                          <div class="mt-1 flex rounded-md border border-input overflow-hidden">
                            <button
                              class="px-3 py-1.5 text-xs font-medium transition-colors {(findCredential(
                                conn.platformCredentials,
                                conn.selectedPlatformId ?? '',
                              )?.auth_env_var ?? 'ANTHROPIC_AUTH_TOKEN') === 'ANTHROPIC_AUTH_TOKEN'
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:text-foreground hover:bg-accent'}"
                              onclick={() => {
                                if (conn.selectedPlatformId) {
                                  conn._upsertCredential(conn.selectedPlatformId, {
                                    auth_env_var: "ANTHROPIC_AUTH_TOKEN",
                                  });
                                  saveGeneralPatch({
                                    platform_credentials: conn.platformCredentials,
                                  });
                                }
                              }}>{t("settings_bearer")}</button
                            >
                            <button
                              class="px-3 py-1.5 text-xs font-medium transition-colors border-l border-input {(findCredential(
                                conn.platformCredentials,
                                conn.selectedPlatformId ?? '',
                              )?.auth_env_var ?? 'ANTHROPIC_AUTH_TOKEN') === 'ANTHROPIC_API_KEY'
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:text-foreground hover:bg-accent'}"
                              onclick={() => {
                                if (conn.selectedPlatformId) {
                                  conn._upsertCredential(conn.selectedPlatformId, {
                                    auth_env_var: "ANTHROPIC_API_KEY",
                                  });
                                  saveGeneralPatch({
                                    platform_credentials: conn.platformCredentials,
                                  });
                                }
                              }}>x-api-key</button
                            >
                          </div>
                        </div>
                      </div>
                    {/if}

                    <!-- API Key input -->
                    <div>
                      <label class="text-sm font-medium mb-1.5 block" for="api-key"
                        >{t("settings_general_apiKey")}</label
                      >
                      <div class="mt-1 flex gap-2">
                        <div class="flex-1 relative">
                          <Input
                            bind:value={conn.anthropicApiKey}
                            placeholder={conn.selectedPlatform?.key_placeholder ?? "<your-api-key>"}
                            type={conn.showApiKey ? "text" : "password"}
                            class="font-mono text-xs"
                            onblur={() => conn.persistCurrentPlatform()}
                          />
                        </div>
                        <button
                          class="rounded-md border px-3 py-2 text-xs text-muted-foreground hover:bg-accent transition-colors"
                          onclick={() => (conn.showApiKey = !conn.showApiKey)}
                        >
                          {conn.showApiKey
                            ? t("settings_general_hide")
                            : t("settings_general_show")}
                        </button>
                        {#if conn.selectedPlatform?.category !== "local"}
                          {@const cred = findCredential(
                            conn.platformCredentials,
                            conn.selectedPlatformId ?? "",
                          )}
                          {@const authEnvVar =
                            cred?.auth_env_var ||
                            conn.selectedPlatform?.auth_env_var ||
                            "ANTHROPIC_API_KEY"}
                          {@const [presetOpusTest, presetSonnetTest] = expandModelsToTiers(
                            conn.selectedPlatform?.models,
                          )}
                          {@const testModel =
                            conn.modelSonnet.trim() ||
                            conn.modelOpus.trim() ||
                            presetSonnetTest ||
                            presetOpusTest ||
                            ""}
                          {@const isCustom = isCustomPlatform(conn.selectedPlatformId ?? "")}
                          {@const noKey = !conn.anthropicApiKey}
                          {@const noUrl = isCustom && !conn.anthropicBaseUrl.trim()}
                          {@const disableReason = noKey
                            ? t("settings_apiTest_noKey")
                            : noUrl
                              ? t("settings_apiTest_noUrl")
                              : ""}
                          <button
                            class="rounded-md border px-3 py-2 text-xs transition-colors {disableReason ||
                            conn.apiTestLoading
                              ? 'text-muted-foreground/50 cursor-not-allowed'
                              : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
                            disabled={!!disableReason || conn.apiTestLoading}
                            title={disableReason || ""}
                            onclick={async () => {
                              const myRequestId = ++conn.apiTestRequestId;
                              const myPlatformId = conn.selectedPlatformId;
                              conn.apiTestLoading = true;
                              conn.apiTestResult = null;
                              dbg("settings", "testApi start", {
                                platform: myPlatformId,
                                model: testModel,
                                authEnvVar,
                                reqId: myRequestId,
                              });
                              try {
                                const result = await api.testApiConnectivity(
                                  conn.anthropicApiKey,
                                  conn.anthropicBaseUrl,
                                  authEnvVar,
                                  testModel,
                                );
                                if (myRequestId !== conn.apiTestRequestId) return;
                                if (myPlatformId !== conn.selectedPlatformId) return;
                                conn.apiTestResult = result;
                                if (result.success) {
                                  dbg("settings", "testApi success", {
                                    latencyMs: result.latencyMs,
                                  });
                                } else {
                                  dbgWarn("settings", "testApi error", result.error);
                                }
                              } catch (e) {
                                if (
                                  myRequestId !== conn.apiTestRequestId ||
                                  myPlatformId !== conn.selectedPlatformId
                                )
                                  return;
                                conn.apiTestResult = {
                                  success: false,
                                  latencyMs: 0,
                                  error: String(e),
                                  partial: false,
                                };
                                dbgWarn("settings", "testApi error", e);
                              } finally {
                                if (myRequestId === conn.apiTestRequestId)
                                  conn.apiTestLoading = false;
                              }
                            }}
                          >
                            {t("settings_apiTest")}
                          </button>
                        {/if}
                      </div>
                      <!-- API test result -->
                      {#if conn.apiTestLoading}
                        <div class="mt-1.5 flex items-center gap-1.5">
                          <span class="h-2 w-2 rounded-full bg-amber-400 animate-pulse"></span>
                          <span class="text-xs text-muted-foreground"
                            >{t("settings_apiTest_testing")}</span
                          >
                        </div>
                      {:else if conn.apiTestResult?.success && conn.apiTestResult.partial}
                        <div class="mt-1.5 flex items-center gap-1.5">
                          <span class="h-2 w-2 rounded-full bg-green-500"></span>
                          <span class="text-xs text-green-600 dark:text-green-400"
                            >{t("settings_apiTest_partial", {
                              latency: String(conn.apiTestResult.latencyMs),
                            })}</span
                          >
                        </div>
                      {:else if conn.apiTestResult?.success}
                        <div class="mt-1.5 flex items-center gap-1.5">
                          <span class="h-2 w-2 rounded-full bg-green-500"></span>
                          <span class="text-xs text-green-600 dark:text-green-400"
                            >{t("settings_apiTest_success", {
                              latency: String(conn.apiTestResult.latencyMs),
                            })}</span
                          >
                        </div>
                      {:else if conn.apiTestResult && !conn.apiTestResult.success}
                        <div class="mt-1.5 flex items-center gap-1.5">
                          <span class="h-2 w-2 rounded-full bg-red-500"></span>
                          <span class="text-xs text-red-600 dark:text-red-400"
                            >{conn.apiTestResult.error ?? t("settings_apiTest_failed")}</span
                          >
                        </div>
                      {:else if conn.selectedPlatform?.id === "ollama"}
                        <p class="mt-1 text-xs text-muted-foreground">{t("setup_noKeyNeeded")}</p>
                      {:else}
                        <p class="mt-1 text-xs text-muted-foreground">
                          {t("settings_general_apiKeyStored")}
                        </p>
                      {/if}
                    </div>

                    <!-- Base URL (only show for custom or direct editing) -->
                    <div>
                      <label class="text-sm font-medium mb-1.5 block" for="base-url"
                        >{t("settings_general_baseUrl")}</label
                      >
                      <Input
                        bind:value={conn.anthropicBaseUrl}
                        placeholder="https://api.anthropic.com"
                        class="mt-1 font-mono text-xs"
                        disabled={conn.selectedPlatformId !== null &&
                          conn.selectedPlatformId !== "anthropic" &&
                          conn.selectedPlatform?.category !== "local" &&
                          !isCustomPlatform(conn.selectedPlatformId ?? "")}
                        onblur={() => conn.persistCurrentPlatform()}
                      />
                      <p class="mt-1 text-xs text-muted-foreground">
                        {#if conn.selectedPlatform && conn.selectedPlatform.auth_env_var === "ANTHROPIC_AUTH_TOKEN"}
                          {t("setup_authTypeBearer")}
                        {:else if conn.selectedPlatform && conn.selectedPlatform.auth_env_var === "ANTHROPIC_API_KEY"}
                          {t("setup_authTypeApiKey")}
                        {:else}
                          {t("settings_general_baseUrlHelp")}
                        {/if}
                      </p>
                    </div>

                    <!-- Models (3-tier: Opus / Sonnet / Haiku) -->
                    {@const [presetOpus, presetSonnet, presetHaiku] = expandModelsToTiers(
                      conn.selectedPlatform?.models,
                    )}
                    {@const phOpus = presetOpus || t("settings_general_modelsPlaceholder")}
                    {@const phSonnet = presetSonnet || t("settings_general_modelsPlaceholder")}
                    {@const phHaiku = presetHaiku || t("settings_general_modelsPlaceholder")}
                    <div>
                      <label class="text-sm font-medium mb-1.5 block"
                        >{t("settings_general_models")}</label
                      >
                      <div class="mt-1 space-y-1.5">
                        <div class="flex items-center gap-2">
                          <span class="text-xs text-muted-foreground w-24 shrink-0 text-right"
                            >{t("settings_general_modelOpus")}</span
                          >
                          <Input
                            bind:value={conn.modelOpus}
                            placeholder={phOpus}
                            class="flex-1 font-mono text-xs"
                            onblur={() => conn.persistCurrentPlatform()}
                          />
                        </div>
                        <div class="flex items-center gap-2">
                          <span
                            class="text-xs text-muted-foreground w-24 shrink-0 text-right font-medium"
                            >{t("settings_general_modelSonnet")}</span
                          >
                          <Input
                            bind:value={conn.modelSonnet}
                            placeholder={phSonnet}
                            class="flex-1 font-mono text-xs"
                            onblur={() => conn.persistCurrentPlatform()}
                          />
                        </div>
                        <div class="flex items-center gap-2">
                          <span class="text-xs text-muted-foreground w-24 shrink-0 text-right"
                            >{t("settings_general_modelHaiku")}</span
                          >
                          <Input
                            bind:value={conn.modelHaiku}
                            placeholder={phHaiku}
                            class="flex-1 font-mono text-xs"
                            onblur={() => conn.persistCurrentPlatform()}
                          />
                        </div>
                      </div>
                      <p class="mt-1 text-xs text-muted-foreground">
                        {t("settings_general_modelsHelp")}
                      </p>
                    </div>

                    <!-- Extra Environment Variables -->
                    <div>
                      <label class="text-sm font-medium mb-1.5 block" for="extra-env-section">
                        {t("settings_general_extraEnv")}
                      </label>
                      {#each conn.platformExtraEnv as envVar, i}
                        <div class="flex gap-1.5 mt-1.5">
                          <Input
                            bind:value={envVar.key}
                            placeholder={t("settings_general_envKeyPlaceholder")}
                            class="flex-1 font-mono text-xs"
                            oninput={() => conn.markExtraEnvTouched()}
                            onblur={() => conn.persistCurrentPlatform()}
                            onpaste={(e: ClipboardEvent) => conn.handleEnvKeyPaste(e, i)}
                          />
                          <Input
                            bind:value={envVar.value}
                            placeholder={t("settings_general_envValuePlaceholder")}
                            class="flex-1 font-mono text-xs"
                            oninput={() => conn.markExtraEnvTouched()}
                            onblur={() => conn.persistCurrentPlatform()}
                          />
                          <button
                            class="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            aria-label={t("settings_remote_delete")}
                            onclick={() => {
                              conn.platformExtraEnv = conn.platformExtraEnv.filter(
                                (_, idx) => idx !== i,
                              );
                              conn.markExtraEnvTouched();
                              conn.persistCurrentPlatform();
                            }}
                          >
                            <svg
                              class="h-3.5 w-3.5"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            >
                              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                            </svg>
                          </button>
                        </div>
                      {/each}
                      <button
                        class="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        onclick={() => {
                          conn.platformExtraEnv = [
                            ...conn.platformExtraEnv,
                            { key: "", value: "" },
                          ];
                        }}
                      >
                        <svg
                          class="h-3 w-3"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="M12 5v14" /><path d="M5 12h14" />
                        </svg>
                        {t("settings_general_addEnvVar")}
                      </button>
                      <p class="mt-1 text-xs text-muted-foreground">
                        {t("settings_general_extraEnvHelp")}
                      </p>
                    </div>
                  {/if}
                </div>
              {/if}
            </Card>

            <!-- Setup Wizard button -->
            <div class="flex items-center justify-between rounded-lg border border-border p-4">
              <div>
                <p class="text-sm font-medium">{t("settings_general_setupWizard")}</p>
                <p class="text-xs text-muted-foreground">{t("settings_general_setupWizardDesc")}</p>
              </div>
              <button
                class="rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onclick={openSetupWizard}>{t("settings_general_runWizard")}</button
              >
            </div>
          </div>

          <!-- ═══ CLI Config tab ═══ -->
        {:else if activeTab === "cli-config"}
          <CliConfigTab />

          <!-- ═══ Shortcuts tab ═══ -->
        {:else if activeTab === "shortcuts"}
          <div class="space-y-5 max-w-3xl">
            <!-- App shortcuts (editable), grouped by context -->
            <Card class="p-6 space-y-6">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("settings_shortcuts_appShortcuts")}
                </h2>
                {#if hasOverrides}
                  <button
                    type="button"
                    class="shrink-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    onclick={() => keybindingStore.resetAll()}
                  >
                    {t("settings_shortcuts_resetAll")}
                  </button>
                {/if}
              </div>

              <div class="space-y-5">
                {#if appBindingsGlobal.length > 0}
                  <section class="space-y-2">
                    <h3
                      class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {t("shortcutHelp_global")}
                    </h3>
                    <div
                      class="rounded-lg border border-border/70 bg-muted/10 divide-y divide-border/60 overflow-hidden"
                    >
                      {#each appBindingsGlobal as binding (binding.command)}
                        <div class="px-3 sm:px-4">
                          <KeybindingEditor
                            {binding}
                            isOverridden={isOverridden(binding.command)}
                            conflictWarning={recordingConflict}
                            onSave={(key) => {
                              const conflict = getConflictWarning(
                                key,
                                binding.context,
                                binding.command,
                              );
                              if (conflict) {
                                recordingConflict = conflict;
                              }
                              keybindingStore.setOverride(binding.command, key);
                              recordingConflict = "";
                            }}
                            onReset={isOverridden(binding.command)
                              ? () => keybindingStore.resetBinding(binding.command)
                              : undefined}
                          />
                        </div>
                      {/each}
                    </div>
                  </section>
                {/if}

                {#if appBindingsChat.length > 0}
                  <section class="space-y-2">
                    <h3
                      class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {t("shortcutHelp_chat")}
                    </h3>
                    <div
                      class="rounded-lg border border-border/70 bg-muted/10 divide-y divide-border/60 overflow-hidden"
                    >
                      {#each appBindingsChat as binding (binding.command)}
                        <div class="px-3 sm:px-4">
                          <KeybindingEditor
                            {binding}
                            isOverridden={isOverridden(binding.command)}
                            conflictWarning={recordingConflict}
                            onSave={(key) => {
                              const conflict = getConflictWarning(
                                key,
                                binding.context,
                                binding.command,
                              );
                              if (conflict) {
                                recordingConflict = conflict;
                              }
                              keybindingStore.setOverride(binding.command, key);
                              recordingConflict = "";
                            }}
                            onReset={isOverridden(binding.command)
                              ? () => keybindingStore.resetBinding(binding.command)
                              : undefined}
                          />
                        </div>
                      {/each}
                    </div>
                  </section>
                {/if}
              </div>
            </Card>

            <!-- Fixed shortcuts (prompt context) -->
            <Card class="p-6 space-y-4">
              <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t("settings_shortcuts_inputFixed")}
              </h2>
              <div
                class="rounded-lg border border-border/70 bg-muted/10 divide-y divide-border/60 overflow-hidden"
              >
                {#each fixedBindings as binding (binding.command)}
                  <div
                    class="grid grid-cols-1 min-[520px]:grid-cols-[minmax(0,1fr)_auto] gap-2 min-[520px]:gap-x-5 min-[520px]:items-center px-3 sm:px-4 py-2.5"
                  >
                    <span
                      class="text-sm text-foreground/70 min-w-0 leading-snug"
                      title={binding.label}>{binding.label}</span
                    >
                    <span
                      class="inline-flex items-center rounded-md border bg-muted/40 px-2.5 py-1 text-xs font-mono text-muted-foreground min-w-[3.25rem] justify-center shrink-0 min-[520px]:justify-self-end"
                    >
                      {formatKeyDisplay(binding.key)}
                    </span>
                  </div>
                {/each}
              </div>
            </Card>

            <!-- CLI shortcuts (collapsible) -->
            <Card class="p-0 overflow-hidden">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-3 px-6 py-4 text-left transition-colors hover:bg-muted/30"
                onclick={() => (cliSectionOpen = !cliSectionOpen)}
              >
                <span class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span
                    class="text-sm font-semibold text-muted-foreground uppercase tracking-wider"
                  >
                    {t("settings_shortcuts_cliShortcuts")}
                  </span>
                  <span
                    class="text-[10px] font-normal normal-case tracking-normal text-muted-foreground"
                    >{t("settings_shortcuts_readOnly")}</span
                  >
                </span>
                <svg
                  class="h-4 w-4 shrink-0 text-muted-foreground transition-transform {cliSectionOpen
                    ? 'rotate-180'
                    : ''}"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {#if cliSectionOpen}
                <div class="border-t border-border/60 px-6 pb-5 pt-1 space-y-3">
                  <div
                    class="rounded-lg border border-border/70 bg-muted/10 divide-y divide-border/60 overflow-hidden"
                  >
                    {#each cliBindings as binding (binding.command)}
                      <div
                        class="grid grid-cols-1 min-[520px]:grid-cols-[minmax(0,1fr)_auto] gap-2 min-[520px]:gap-x-5 min-[520px]:items-center px-3 sm:px-4 py-2.5"
                      >
                        <span
                          class="text-sm text-foreground/60 min-w-0 leading-snug"
                          title={binding.label}>{binding.label}</span
                        >
                        <span
                          class="inline-flex items-center rounded-md border bg-muted/30 px-2.5 py-1 text-xs font-mono text-muted-foreground min-w-[3.25rem] justify-center shrink-0 min-[520px]:justify-self-end"
                        >
                          {formatKeyDisplay(binding.key)}
                        </span>
                      </div>
                    {/each}
                  </div>
                  <p class="text-[10px] text-muted-foreground px-0.5">
                    {t("settings_shortcuts_source", {
                      source:
                        cliSource === "file"
                          ? IS_WINDOWS
                            ? "%USERPROFILE%\\.claude\\keybindings.json"
                            : "~/.claude/keybindings.json"
                          : t("settings_shortcuts_cliDefaults"),
                    })}
                  </p>
                </div>
              {/if}
            </Card>
          </div>

          <!-- ═══ Remote tab ═══ -->
        {:else if activeTab === "remote"}
          <RemoteTab />

          <!-- ═══ Debug tab ═══ -->
        {:else if activeTab === "debug"}
          <Card class="p-6 space-y-5">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium">{t("settings_debug_title")}</p>
                <p class="text-xs text-muted-foreground mt-0.5">
                  {t("settings_debug_desc")}
                  {t("settings_debug_rustHint")}
                  <code class="text-xs">RUST_LOG=debug cargo tauri dev</code>
                </p>
              </div>
              <button
                aria-label={t("settings_debugMode")}
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 {debugOn
                  ? 'bg-primary'
                  : 'bg-neutral-700'}"
                onclick={() => {
                  debugOn = !debugOn;
                  setDebugMode(debugOn);
                }}
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 {debugOn
                    ? 'translate-x-6'
                    : 'translate-x-1'}"
                ></span>
              </button>
            </div>

            {#if debugOn}
              <!-- Tag filter -->
              <div>
                <label class="text-sm font-medium mb-1 block" for="debug-filter"
                  >{t("settings_debug_tagFilter")}</label
                >
                <input
                  id="debug-filter"
                  class="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm font-mono placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                  value={debugFilter}
                  placeholder="1 = all, api,bus = only those, -replay = exclude"
                  oninput={(e) => {
                    const val = (e.target as HTMLInputElement).value.trim();
                    debugFilter = val;
                    setDebugMode(val || "1");
                  }}
                />
                <p class="mt-1 text-[10px] text-muted-foreground">
                  <code class="text-xs">1</code> = {t("settings_debug_filterHelp_all")} &nbsp;|&nbsp;
                  <code class="text-xs">api,bus</code> = {t("settings_debug_filterHelp_only")} &nbsp;|&nbsp;
                  <code class="text-xs">-replay</code> = {t("settings_debug_filterHelp_exclude")}
                </p>
              </div>

              <!-- Log actions -->
              <div class="flex items-center gap-3">
                <button
                  class="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                  onclick={async () => {
                    logCopied = await copyDebugLogs();
                    if (logCopied) setTimeout(() => (logCopied = false), 2000);
                  }}
                >
                  {logCopied
                    ? t("settings_debug_copied")
                    : t("settings_debug_copyLogs", { count: String(logCount) })}
                </button>
                <button
                  class="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent text-muted-foreground"
                  onclick={() => {
                    clearDebugLogs();
                    logCount = 0;
                  }}
                >
                  {t("settings_debug_clear")}
                </button>
                <span class="text-[10px] text-muted-foreground ml-auto"
                  >{t("settings_debug_entriesBuffered", { count: String(logCount) })}</span
                >
              </div>

              <!-- Rust log hint -->
              <div class="rounded-md bg-muted/50 p-3">
                <p class="text-xs text-muted-foreground mb-1.5">
                  {t("settings_debug_rustBackendLogs")}
                </p>
                <div class="flex items-center gap-2">
                  <code class="flex-1 text-xs font-mono break-all"
                    >RUST_LOG=debug cargo tauri dev</code
                  >
                  <button
                    class="shrink-0 rounded border px-2 py-1 text-[10px] transition-colors hover:bg-accent"
                    onclick={async () => {
                      await navigator.clipboard.writeText("RUST_LOG=debug cargo tauri dev");
                      rustCmdCopied = true;
                      setTimeout(() => (rustCmdCopied = false), 2000);
                    }}
                  >
                    {rustCmdCopied ? t("settings_debug_copied") : t("settings_debug_copy")}
                  </button>
                </div>
              </div>

              <p class="text-[10px] text-muted-foreground">
                {t("settings_debug_maxEntries")}
              </p>
            {/if}
          </Card>

          <!-- ═══ Notifications tab ═══ -->
        {:else if activeTab === "notifications"}
          {#if settings}
            <NotificationsTab
              initialSettings={settings}
              onSettingsUpdated={(s) => (settings = s)}
            />
          {/if}

          <!-- ═══ Theme tab ═══ -->
        {:else if activeTab === "theme"}
          <ThemeEditor />
          <BackgroundPicker />
          {#if settings}
            <Card class="p-6">
              <AgentAppearanceSettings {settings} />
            </Card>
          {/if}
        {/if}
      </div>
    </main>
  </div>
{/key}
