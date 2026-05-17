<script lang="ts">
  import { onMount, getContext } from "svelte";
  import { page } from "$app/stores";
  import * as api from "$lib/api";
  import { loadCliInfo, KeybindingStore } from "$lib/stores";
  import type { UserSettings } from "$lib/types";
  import Card from "$lib/components/Card.svelte";
  import KeybindingEditor from "$lib/components/KeybindingEditor.svelte";
  import BackgroundPicker from "$lib/components/BackgroundPicker.svelte";
  import ThemeEditor from "$lib/components/ThemeEditor.svelte";
  import GeneralTab from "$lib/components/settings/GeneralTab.svelte";
  import NotificationsTab from "$lib/components/settings/NotificationsTab.svelte";
  import AgentAppearanceSettings from "$lib/components/settings/AgentAppearanceSettings.svelte";
  import RemoteTab from "$lib/components/settings/RemoteTab.svelte";
  import CliConfigTab from "$lib/components/settings/CliConfigTab.svelte";
  import ConnectionTab from "$lib/components/settings/ConnectionTab.svelte";
  import { useConnectionPlatform } from "$lib/composables/use-connection-platform.svelte";
  import { formatKeyDisplay } from "$lib/stores/keybindings.svelte";
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
          <ConnectionTab {conn} {saveGeneralPatch} {generalSaved} {openSetupWizard} />
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
                      class="miwarp-shortcuts-deck-1 rounded-lg border border-border/70 bg-muted/10 divide-y divide-border/60 overflow-hidden"
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
                      class="miwarp-shortcuts-deck-2 rounded-lg border border-border/70 bg-muted/10 divide-y divide-border/60 overflow-hidden"
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
            <Card class="p-6 space-y-4 miwarp-shortcuts-deck-3">
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
            <Card class="p-0 overflow-hidden miwarp-shortcuts-deck-4">
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
