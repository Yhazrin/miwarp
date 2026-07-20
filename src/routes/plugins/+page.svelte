<script lang="ts">
  import { onMount, getContext, tick } from "svelte";
  import { goto } from "$app/navigation";
  import { LS_PROJECT_CWD } from "$lib/utils/storage-keys";
  import { EVT_PROJECT_CHANGED } from "$lib/utils/bus-events";
  import {
    listMarketplacePlugins,
    listStandaloneSkills,
    listMarketplaces,
    deleteSkill,
    listInstalledPlugins,
    installPlugin,
    listConfiguredMcpServers,
    getCliConfig,
    listAgents,
  } from "$lib/api";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { showToast as globalToast } from "$lib/stores/toast-store.svelte";
  import McpDiscoverPanel from "$lib/components/McpDiscoverPanel.svelte";
  import McpConfiguredPanel from "$lib/components/McpConfiguredPanel.svelte";
  import HookManager from "$lib/components/HookManager.svelte";
  import AgentsPanel from "$lib/components/AgentsPanel.svelte";
  import SkillSourceManager from "$lib/components/SkillSourceManager.svelte";
  import BuiltinSkillsPanel from "$lib/components/plugins/BuiltinSkillsPanel.svelte";
  import PluginInstaller from "$lib/components/PluginInstaller.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { fade } from "svelte/transition";
  import SkillEditor from "./SkillEditor.svelte";
  import CommunityBrowser from "./CommunityBrowser.svelte";
  import MarketplaceBrowser from "./MarketplaceBrowser.svelte";
  import type {
    MarketplacePlugin,
    StandaloneSkill,
    MarketplaceInfo,
    InstalledPlugin,
  } from "$lib/types";

  // Active section driven by layout sidebar context
  const sectionCtx = getContext<{ active: string }>("pluginSection");
  let activeTab = $derived(
    (sectionCtx?.active ?? "skills") as
      | "overview"
      | "skills"
      | "sources"
      | "mcp"
      | "hooks"
      | "plugins"
      | "agents",
  );

  // Skills section: Discover vs Installed toggle
  let skillsSource = $state<"discover" | "installed">("discover");

  // MCP section: toggle
  let mcpSource = $state<"discover" | "configured">("discover");

  let plugins = $state<MarketplacePlugin[]>([]);
  let installedPlugins = $state<InstalledPlugin[]>([]);
  let skills = $state<StandaloneSkill[]>([]);
  const installedSkillNames = $derived(new Set(skills.map((skill) => skill.name)));
  let marketplaces = $state<MarketplaceInfo[]>([]);
  let loading = $state(true);
  let loadError = $state(false);
  let loadWarnings = $state<string[]>([]);

  // Project CWD for project-scope skills
  let projectCwd = $state("");

  // Operation state
  let operationLoading = $state<string | null>(null);

  // Skill editor ref
  let skillEditorRef = $state<SkillEditor | null>(null);

  // Confirmation dialog
  let confirmAction = $state<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Plugin installer modal
  let showInstaller = $state(false);

  // Overview counts (MCP, hooks, agents loaded non-blocking)
  let mcpConfiguredCount = $state(0);
  let hooksCount = $state(0);
  let agentsCount = $state(0);

  // Overview counts
  let installedSkillCount = $derived(skills.length);
  let installedPluginCount = $derived(installedPlugins.length);
  let totalInstalledCount = $derived(
    installedSkillCount + installedPluginCount + mcpConfiguredCount + hooksCount + agentsCount,
  );

  const categoryColors: Record<string, string> = {
    development: "bg-[hsl(var(--miwarp-status-info)/0.1)] text-miwarp-status-info",
    productivity: "bg-[hsl(var(--miwarp-status-info)/0.1)] text-miwarp-status-info",
    security: "bg-[hsl(var(--miwarp-status-error)/0.1)] text-miwarp-status-error",
    testing: "bg-[hsl(var(--miwarp-status-warning)/0.1)] text-miwarp-status-warning",
    learning: "bg-[hsl(var(--miwarp-accent-violet)/0.1)] text-miwarp-accent-violet",
    database: "bg-[hsl(var(--miwarp-status-success)/0.1)] text-miwarp-status-success",
    monitoring: "bg-[hsl(var(--miwarp-status-warning)/0.1)] text-miwarp-status-warning",
    deployment: "bg-[hsl(var(--miwarp-accent-primary)/0.1)] text-miwarp-accent-primary",
    design: "bg-[hsl(var(--miwarp-accent-secondary)/0.1)] text-miwarp-accent-secondary",
  };

  const componentBadges: {
    key: keyof MarketplacePlugin["components"];
    label: () => string;
    color: string;
  }[] = [
    {
      key: "skills",
      label: () => t("plugin_badgeSkills"),
      color: "bg-[hsl(var(--miwarp-status-error)/0.1)] text-miwarp-status-error",
    },
    {
      key: "commands",
      label: () => t("plugin_badgeCommands"),
      color: "bg-[hsl(var(--miwarp-status-info)/0.1)] text-miwarp-status-info",
    },
    {
      key: "agents",
      label: () => t("plugin_badgeAgents"),
      color: "bg-[hsl(var(--miwarp-accent-violet)/0.1)] text-miwarp-accent-violet",
    },
    {
      key: "hooks",
      label: () => t("plugin_badgeHooks"),
      color: "bg-[hsl(var(--miwarp-status-warning)/0.1)] text-miwarp-status-warning",
    },
    {
      key: "mcp_servers",
      label: () => t("plugin_badgeMcp"),
      color: "bg-[hsl(var(--miwarp-status-info)/0.1)] text-miwarp-status-info",
    },
    {
      key: "lsp_servers",
      label: () => t("plugin_badgeLsp"),
      color: "bg-[hsl(var(--miwarp-status-success)/0.1)] text-miwarp-status-success",
    },
  ];

  // ── Installed slug helpers (for CommunityBrowser) ──

  function installedSlug(skillPath: string): string {
    const parts = skillPath.replace(/\\/g, "/").split("/");
    return parts.length >= 2 ? parts[parts.length - 2].toLowerCase() : "";
  }
  let installedSlugsByScope = $derived.by(() => {
    const map: Record<string, Set<string>> = { user: new Set(), project: new Set() };
    for (const s of skills) {
      const slug = installedSlug(s.path);
      if (slug && s.scope && map[s.scope]) map[s.scope].add(slug);
    }
    return map;
  });

  // ── Lifecycle ──

  onMount(async () => {
    // Initialize from URL params
    const params = new URL(window.location.href).searchParams;
    const urlSection = params.get("section");
    if (
      urlSection &&
      ["overview", "skills", "sources", "mcp", "hooks", "plugins", "agents"].includes(urlSection)
    ) {
      if (sectionCtx) sectionCtx.active = urlSection;
    }
    const urlSource = params.get("source");
    if (urlSection === "skills" && (urlSource === "discover" || urlSource === "installed")) {
      skillsSource = urlSource;
    }
    if (urlSection === "mcp" && (urlSource === "discover" || urlSource === "configured")) {
      mcpSource = urlSource;
    }

    projectCwd = localStorage.getItem(LS_PROJECT_CWD) ?? "";
    loading = true;
    const warnings: string[] = [];
    try {
      const results = await Promise.allSettled([
        listMarketplacePlugins(),
        listInstalledPlugins(),
        listStandaloneSkills(projectCwd || undefined),
        listMarketplaces(),
      ]);

      if (results[0].status === "fulfilled") {
        plugins = results[0].value;
      } else {
        dbgWarn("plugins", "marketplace load error", results[0].reason);
        warnings.push(t("plugin_loadWarn_marketplacePlugins"));
      }

      if (results[1].status === "fulfilled") {
        installedPlugins = results[1].value;
      } else {
        dbgWarn("plugins", "installed plugins load error", results[1].reason);
        warnings.push(t("plugin_loadWarn_installedPlugins"));
      }

      if (results[2].status === "fulfilled") {
        skills = results[2].value;
      } else {
        dbgWarn("plugins", "skills load error", results[2].reason);
        warnings.push(t("plugin_loadWarn_standaloneSkills"));
      }

      if (results[3].status === "fulfilled") {
        marketplaces = results[3].value;
      } else {
        dbgWarn("plugins", "marketplaces load error", results[3].reason);
        warnings.push(t("plugin_loadWarn_marketplaces"));
      }

      loadWarnings = warnings;
      loadError = warnings.length === 4;

      dbg("plugins", "loaded", {
        marketplace: plugins.length,
        installed: installedPlugins.length,
        skills: skills.length,
        marketplaces: marketplaces.length,
        warnings: warnings.length,
      });
    } catch (e) {
      dbgWarn("plugins", "load error", e);
      loadError = true;
    } finally {
      loading = false;
    }

    // Load overview counts (non-blocking)
    Promise.allSettled([
      listConfiguredMcpServers(projectCwd || undefined),
      getCliConfig(),
      listAgents(projectCwd || undefined),
    ]).then(([mcpResult, configResult, agentsResult]) => {
      if (mcpResult.status === "fulfilled") mcpConfiguredCount = mcpResult.value.length;
      if (configResult.status === "fulfilled") {
        const hooks = configResult.value?.hooks;
        if (hooks && typeof hooks === "object") {
          hooksCount = Object.values(hooks).reduce(
            (sum: number, groups: unknown) => sum + (Array.isArray(groups) ? groups.length : 0),
            0,
          );
        }
      }
      if (agentsResult.status === "fulfilled") agentsCount = agentsResult.value.length;
    });

    // Trigger community data load after CommunityBrowser mounts (non-blocking)
    tick().then(() => {
      // CommunityBrowser handles its own initialization
    });
  });

  // Sync project cwd when user switches projects
  onMount(() => {
    function onProjectChanged(e: Event) {
      const cwd = (e as CustomEvent).detail?.cwd ?? "";
      if (cwd === projectCwd) return;
      dbg("plugins", "project-changed", { old: projectCwd, new: cwd });
      projectCwd = cwd;
      listStandaloneSkills(projectCwd || undefined)
        .then((s) => {
          skills = s;
        })
        .catch((err) => {
          dbgWarn("plugins", "skills reload on project-change failed", err);
        });
    }
    window.addEventListener(EVT_PROJECT_CHANGED, onProjectChanged);
    return () => window.removeEventListener(EVT_PROJECT_CHANGED, onProjectChanged);
  });

  function syncUrl() {
    const section = activeTab;
    let url = `/plugins?section=${section}`;
    if (section === "skills") url += `&source=${skillsSource}`;
    else if (section === "mcp") url += `&source=${mcpSource}`;
    goto(url, { replaceState: true, noScroll: true });
  }

  // ── Skill delete ──

  function handleDeleteSkill(skill: StandaloneSkill) {
    confirmAction = {
      title: t("extensions_confirmDeleteTitle"),
      message: t("extensions_confirmDeleteMsg", { name: skill.name }),
      onConfirm: async () => {
        operationLoading = skill.path;
        dbg("plugins", "deleteSkill", { path: skill.path });
        try {
          await deleteSkill(skill.path, projectCwd || undefined);
          globalToast(t("plugin_deletedSkill", { name: skill.name }), "success");
          await refreshSkills();
        } catch (e) {
          globalToast(t("plugin_failedDeleteSkill", { error: String(e) }), "error");
        } finally {
          operationLoading = null;
        }
      },
    };
  }

  async function refreshSkills() {
    try {
      skills = await listStandaloneSkills(projectCwd || undefined);
    } catch (e) {
      dbgWarn("plugins", "refresh skills error", e);
    }
  }

  // ── Refresh helpers ──

  async function refreshPluginData() {
    const results = await Promise.allSettled([listMarketplacePlugins(), listInstalledPlugins()]);
    if (results[0].status === "fulfilled") plugins = results[0].value;
    else dbgWarn("plugins", "refresh marketplace error", results[0].reason);
    if (results[1].status === "fulfilled") installedPlugins = results[1].value;
    else dbgWarn("plugins", "refresh installed error", results[1].reason);
  }

  // ── Guided install handler (for PluginInstaller) ──

  async function handleGuidedInstall(pluginName: string): Promise<boolean> {
    operationLoading = pluginName;
    dbg("plugins", "guidedInstall", { name: pluginName });
    try {
      const result = await installPlugin(pluginName, "user");
      dbg("plugins", "guidedInstall result", result);
      globalToast(
        result.success
          ? t("plugin_installedPlugin", { name: pluginName })
          : t("plugin_failedOp", { error: result.message }),
        result.success ? "success" : "error",
      );
      if (result.success) await refreshPluginData();
      return result.success;
    } catch (e) {
      globalToast(t("plugin_errorInstalling", { name: pluginName, error: String(e) }), "error");
      return false;
    } finally {
      operationLoading = null;
    }
  }

  // ── Confirm dialog Esc handling ──
  function handleConfirmKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && confirmAction) {
      confirmAction = null;
    }
  }
</script>

<svelte:head>
  <title>{t("extensions_title")} — MiWarp</title>
</svelte:head>

<svelte:window onkeydown={handleConfirmKeydown} />

<!-- Confirmation dialog -->
{#if confirmAction}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-miwarp-overlay backdrop-blur-sm"
    onclick={() => (confirmAction = null)}
    onkeydown={(e) => {
      if (e.key === "Escape") confirmAction = null;
    }}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div
      class="rounded-2xl border border-border/40 bg-background/95 backdrop-blur-md p-6 shadow-2xl max-w-sm w-full mx-4"
      role="presentation"
      onclick={(e) => e.stopPropagation()}
    >
      <h3 class="text-sm font-semibold text-foreground mb-2">{confirmAction.title}</h3>
      <p class="text-xs text-muted-foreground mb-5 leading-relaxed">{confirmAction.message}</p>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg border border-border px-3.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          onclick={() => (confirmAction = null)}>{t("common_cancel")}</button
        >
        <button
          type="button"
          class="rounded-lg bg-destructive px-3.5 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
          onclick={() => {
            confirmAction?.onConfirm();
            confirmAction = null;
          }}>{t("plugin_confirm")}</button
        >
      </div>
    </div>
  </div>
{/if}

<div class="flex h-full min-h-0 flex-col overflow-hidden">
  <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-5 pb-10">
    {#if loading}
      <div class="flex items-center justify-center py-16">
        <Spinner size="md" />
      </div>
    {:else if loadError}
      <div class="flex flex-col items-center justify-center py-16 text-center">
        <p class="text-sm text-destructive">
          {t("plugin_loadFailed")}
        </p>
      </div>
    {:else}
      <!-- Partial load warning -->
      {#if loadWarnings.length > 0}
        <div
          class="rounded-lg border border-[hsl(var(--miwarp-status-warning)/0.3)] bg-[hsl(var(--miwarp-status-warning)/0.1)] px-4 py-2.5 text-xs text-miwarp-status-warning mb-4"
        >
          {t("plugin_couldNotLoad", { items: loadWarnings.join(", ") })}
        </div>
      {/if}

      <!-- Page header (visible on overview) -->
      {#if activeTab === "overview"}
        <div class="mb-6">
          <h1 class="text-lg font-semibold text-foreground">{t("extensions_title")}</h1>
          <p class="text-xs text-muted-foreground mt-0.5">{t("extensions_subtitle")}</p>
        </div>
      {/if}

      <!-- ═══════════════════════════════════════════════════════ -->
      <!-- Overview Section                                       -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <div class="space-y-6" class:hidden={activeTab !== "overview"}>
        <!-- Installed Summary cards -->
        <div>
          <h3 class="text-xs font-medium text-muted-foreground mb-3">
            {t("extensions_installedSummary")}
          </h3>
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            <button
              type="button"
              class="group rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-3.5 text-left hover:border-[hsl(var(--miwarp-status-error)/0.3)] hover:bg-[hsl(var(--miwarp-status-error)/0.05)] transition-all"
              onclick={() => {
                if (sectionCtx) sectionCtx.active = "skills";
              }}
            >
              <div class="flex items-center gap-2 mb-1.5">
                <div
                  class="flex h-6 w-6 items-center justify-center rounded-md bg-miwarp-status-error text-miwarp-accent-on-accent"
                >
                  <svg
                    class="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    ><path
                      d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"
                    /></svg
                  >
                </div>
              </div>
              <div class="text-xl font-bold text-foreground">{installedSkillCount}</div>
              <div class="text-[11px] text-muted-foreground mt-0.5">{t("sidebar_skills")}</div>
            </button>
            <button
              type="button"
              class="group rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-3.5 text-left hover:border-[hsl(var(--miwarp-status-success)/0.3)] hover:bg-[hsl(var(--miwarp-status-success)/0.05)] transition-all"
              onclick={() => {
                if (sectionCtx) sectionCtx.active = "plugins";
              }}
            >
              <div class="flex items-center gap-2 mb-1.5">
                <div
                  class="flex h-6 w-6 items-center justify-center rounded-md bg-miwarp-status-success text-miwarp-accent-on-accent"
                >
                  <svg
                    class="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    ><path d="m7.5 4.27 9 5.15" /><path
                      d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
                    /></svg
                  >
                </div>
              </div>
              <div class="text-xl font-bold text-foreground">{installedPluginCount}</div>
              <div class="text-[11px] text-muted-foreground mt-0.5">{t("sidebar_plugins")}</div>
            </button>
            <button
              type="button"
              class="group rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-3.5 text-left hover:border-[hsl(var(--miwarp-status-info)/0.3)] hover:bg-[hsl(var(--miwarp-status-info)/0.05)] transition-all"
              onclick={() => {
                if (sectionCtx) sectionCtx.active = "mcp";
              }}
            >
              <div class="flex items-center gap-2 mb-1.5">
                <div
                  class="flex h-6 w-6 items-center justify-center rounded-md bg-miwarp-status-info text-miwarp-accent-on-accent"
                >
                  <svg
                    class="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    ><rect width="20" height="8" x="2" y="2" rx="2" ry="2" /><rect
                      width="20"
                      height="8"
                      x="2"
                      y="14"
                      rx="2"
                      ry="2"
                    /></svg
                  >
                </div>
              </div>
              <div class="text-xl font-bold text-foreground">{mcpConfiguredCount}</div>
              <div class="text-[11px] text-muted-foreground mt-0.5">{t("sidebar_mcpServers")}</div>
            </button>
            <button
              type="button"
              class="group rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-3.5 text-left hover:border-[hsl(var(--miwarp-status-warning)/0.3)] hover:bg-[hsl(var(--miwarp-status-warning)/0.05)] transition-all"
              onclick={() => {
                if (sectionCtx) sectionCtx.active = "hooks";
              }}
            >
              <div class="flex items-center gap-2 mb-1.5">
                <div
                  class="flex h-6 w-6 items-center justify-center rounded-md bg-miwarp-status-warning text-miwarp-accent-on-accent"
                >
                  <svg
                    class="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    ><path
                      d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"
                    /><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" /></svg
                  >
                </div>
              </div>
              <div class="text-xl font-bold text-foreground">{hooksCount}</div>
              <div class="text-[11px] text-muted-foreground mt-0.5">{t("sidebar_hooks")}</div>
            </button>
            <button
              type="button"
              class="group rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-3.5 text-left hover:border-[hsl(var(--miwarp-accent-violet)/0.3)] hover:bg-[hsl(var(--miwarp-accent-violet)/0.05)] transition-all"
              onclick={() => {
                if (sectionCtx) sectionCtx.active = "agents";
              }}
            >
              <div class="flex items-center gap-2 mb-1.5">
                <div
                  class="flex h-6 w-6 items-center justify-center rounded-md bg-miwarp-accent-violet text-miwarp-accent-on-accent"
                >
                  <svg
                    class="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    ><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path
                      d="M2 14h2"
                    /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></svg
                  >
                </div>
              </div>
              <div class="text-xl font-bold text-foreground">{agentsCount}</div>
              <div class="text-[11px] text-muted-foreground mt-0.5">{t("sidebar_agents")}</div>
            </button>
          </div>
        </div>

        <!-- Current Workspace -->
        <div>
          <h3 class="text-xs font-medium text-muted-foreground mb-3">
            {t("extensions_currentWorkspace")}
          </h3>
          <div class="rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-4">
            {#if projectCwd}
              <div class="flex items-center gap-2 mb-2">
                <svg
                  class="h-3.5 w-3.5 text-muted-foreground"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><path
                    d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
                  /></svg
                >
                <span class="text-xs font-mono text-foreground truncate">{projectCwd}</span>
              </div>
              <div class="flex items-center gap-4 text-[11px] text-muted-foreground">
                <span
                  >{t("extensions_projectSkills")}: {skills.filter((s) => s.scope === "project")
                    .length}</span
                >
                <span
                  >{t("extensions_projectPlugins")}: {installedPlugins.filter(
                    (p) => (p.scope ?? "user") !== "user",
                  ).length}</span
                >
              </div>
            {:else}
              <div class="flex items-center gap-2">
                <svg
                  class="h-3.5 w-3.5 text-muted-foreground/50"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><circle cx="12" cy="12" r="10" /><path d="m4.93 4.93 14.14 14.14" /></svg
                >
                <span class="text-xs text-muted-foreground">{t("extensions_noWorkspace")}</span>
              </div>
              <p class="text-[11px] text-muted-foreground/70 mt-1">
                {t("extensions_noWorkspaceDesc")}
              </p>
            {/if}
          </div>
        </div>

        {#if totalInstalledCount === 0}
          <EmptyState
            title={t("extensions_noExtensions")}
            description={t("extensions_noExtensionsDesc")}
            variant="dashed"
          />
        {/if}

        <!-- Recommended Actions -->
        <div>
          <h3 class="text-xs font-medium text-muted-foreground mb-3">
            {t("extensions_recommendedActions")}
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              class="flex items-center gap-3 rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-3 text-left hover:border-primary/30 hover:bg-accent/5 transition-all"
              onclick={() => {
                skillEditorRef?.startNewSkill();
                if (sectionCtx) sectionCtx.active = "skills";
              }}
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-miwarp-status-error text-miwarp-accent-on-accent"
              >
                <Icon name="plus" size="md" />
              </div>
              <span class="text-xs font-medium text-foreground"
                >{t("extensions_createProjectSkill")}</span
              >
            </button>
            <button
              type="button"
              class="flex items-center gap-3 rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-3 text-left hover:border-primary/30 hover:bg-accent/5 transition-all"
              onclick={() => {
                skillsSource = "discover";
                if (sectionCtx) sectionCtx.active = "skills";
              }}
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-miwarp-status-info text-miwarp-accent-on-accent"
              >
                <Icon name="search" size="md" />
              </div>
              <span class="text-xs font-medium text-foreground"
                >{t("extensions_installCommunitySkill")}</span
              >
            </button>
            <button
              type="button"
              class="flex items-center gap-3 rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-3 text-left hover:border-primary/30 hover:bg-accent/5 transition-all"
              onclick={() => {
                mcpSource = "discover";
                if (sectionCtx) sectionCtx.active = "mcp";
              }}
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-miwarp-status-info text-miwarp-accent-on-accent"
              >
                <svg
                  class="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  ><rect width="20" height="8" x="2" y="2" rx="2" ry="2" /><rect
                    width="20"
                    height="8"
                    x="2"
                    y="14"
                    rx="2"
                    ry="2"
                  /></svg
                >
              </div>
              <span class="text-xs font-medium text-foreground"
                >{t("extensions_configureMcpServer")}</span
              >
            </button>
            <button
              type="button"
              class="flex items-center gap-3 rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-3 text-left hover:border-primary/30 hover:bg-accent/5 transition-all"
              onclick={() => {
                if (sectionCtx) sectionCtx.active = "hooks";
              }}
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-miwarp-status-warning text-miwarp-accent-on-accent"
              >
                <svg
                  class="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  ><path
                    d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"
                  /><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" /></svg
                >
              </div>
              <span class="text-xs font-medium text-foreground">{t("extensions_reviewHooks")}</span>
            </button>
            <button
              type="button"
              class="flex items-center gap-3 rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-3 text-left hover:border-primary/30 hover:bg-accent/5 transition-all sm:col-span-2"
              onclick={() => {
                if (sectionCtx) sectionCtx.active = "plugins";
              }}
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-miwarp-status-success text-miwarp-accent-on-accent"
              >
                <svg
                  class="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  ><path d="m7.5 4.27 9 5.15" /><path
                    d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
                  /></svg
                >
              </div>
              <span class="text-xs font-medium text-foreground"
                >{t("extensions_installPluginPackage")}</span
              >
            </button>
          </div>
        </div>

        <!-- Extension type guide -->
        <div>
          <h3 class="text-xs font-medium text-muted-foreground mb-3">
            {t("extensions_typeGuide")}
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <button
              type="button"
              class="flex items-start gap-3 rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-3 text-left hover:border-primary/30 hover:bg-accent/5 transition-all"
              onclick={() => {
                if (sectionCtx) sectionCtx.active = "skills";
              }}
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-miwarp-status-error text-miwarp-accent-on-accent"
              >
                <svg
                  class="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  ><path
                    d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"
                  /></svg
                >
              </div>
              <div class="min-w-0">
                <div class="text-xs font-medium text-foreground">{t("sidebar_skills")}</div>
                <div class="text-[11px] text-muted-foreground mt-0.5">
                  {t("extensions_typeGuide_skills")}
                </div>
              </div>
            </button>
            <button
              type="button"
              class="flex items-start gap-3 rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-3 text-left hover:border-primary/30 hover:bg-accent/5 transition-all"
              onclick={() => {
                if (sectionCtx) sectionCtx.active = "agents";
              }}
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-miwarp-accent-violet text-miwarp-accent-on-accent"
              >
                <svg
                  class="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  ><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path
                    d="M2 14h2"
                  /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></svg
                >
              </div>
              <div class="min-w-0">
                <div class="text-xs font-medium text-foreground">{t("sidebar_agents")}</div>
                <div class="text-[11px] text-muted-foreground mt-0.5">
                  {t("extensions_typeGuide_agents")}
                </div>
              </div>
            </button>
            <button
              type="button"
              class="flex items-start gap-3 rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-3 text-left hover:border-primary/30 hover:bg-accent/5 transition-all"
              onclick={() => {
                if (sectionCtx) sectionCtx.active = "mcp";
              }}
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-miwarp-status-info text-miwarp-accent-on-accent"
              >
                <svg
                  class="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  ><rect width="20" height="8" x="2" y="2" rx="2" ry="2" /><rect
                    width="20"
                    height="8"
                    x="2"
                    y="14"
                    rx="2"
                    ry="2"
                  /><line x1="6" x2="6.01" y1="6" y2="6" /><line
                    x1="6"
                    x2="6.01"
                    y1="18"
                    y2="18"
                  /></svg
                >
              </div>
              <div class="min-w-0">
                <div class="text-xs font-medium text-foreground">{t("sidebar_mcpServers")}</div>
                <div class="text-[11px] text-muted-foreground mt-0.5">
                  {t("extensions_typeGuide_mcp")}
                </div>
              </div>
            </button>
            <button
              type="button"
              class="flex items-start gap-3 rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-3 text-left hover:border-primary/30 hover:bg-accent/5 transition-all"
              onclick={() => {
                if (sectionCtx) sectionCtx.active = "hooks";
              }}
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-miwarp-status-warning text-miwarp-accent-on-accent"
              >
                <svg
                  class="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  ><path
                    d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"
                  /><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" /><path
                    d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8H12"
                  /></svg
                >
              </div>
              <div class="min-w-0">
                <div class="text-xs font-medium text-foreground">{t("sidebar_hooks")}</div>
                <div class="text-[11px] text-muted-foreground mt-0.5">
                  {t("extensions_typeGuide_hooks")}
                </div>
              </div>
            </button>
            <button
              type="button"
              class="flex items-start gap-3 rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm p-3 text-left hover:border-primary/30 hover:bg-accent/5 transition-all"
              onclick={() => {
                if (sectionCtx) sectionCtx.active = "plugins";
              }}
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-miwarp-status-success text-miwarp-accent-on-accent"
              >
                <svg
                  class="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  ><path d="m7.5 4.27 9 5.15" /><path
                    d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
                  /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg
                >
              </div>
              <div class="min-w-0">
                <div class="text-xs font-medium text-foreground">{t("sidebar_plugins")}</div>
                <div class="text-[11px] text-muted-foreground mt-0.5">
                  {t("extensions_typeGuide_plugins")}
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════ -->
      <!-- Skills Section                                         -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <div class="space-y-4" class:hidden={activeTab !== "skills"}>
        <div>
          <h2 class="text-sm font-semibold text-foreground">{t("sidebar_skills")}</h2>
          <p class="text-xs text-muted-foreground">
            {t("extensions_typeGuide_skills")}
          </p>
        </div>

        <BuiltinSkillsPanel
          installedNames={installedSkillNames}
          projectCwd={projectCwd || null}
          onInstalled={refreshSkills}
        />

        <!-- Source toggle + Create Skill -->
        <div class="flex items-center gap-3">
          <div class="flex gap-1 rounded-lg border border-border p-0.5 w-fit">
            <button
              type="button"
              class="rounded-md px-3 py-1 text-xs font-medium transition-colors {skillsSource ===
              'discover'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => {
                skillsSource = "discover";
                syncUrl();
              }}>{t("plugin_discover")}</button
            >
            <button
              type="button"
              class="rounded-md px-3 py-1 text-xs font-medium transition-colors {skillsSource ===
              'installed'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => {
                skillsSource = "installed";
                syncUrl();
              }}>{t("plugin_installed")}</button
            >
            <button
              type="button"
              class="rounded-md px-3 py-1 text-xs font-medium transition-colors {skillEditorRef?.isOpen()
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => skillEditorRef?.startNewSkill()}>{t("plugin_createSkill")}</button
            >
          </div>
        </div>

        <!-- Skill Editor (create / edit) -->
        <SkillEditor
          bind:this={skillEditorRef}
          {projectCwd}
          onSaved={refreshSkills}
          onClose={() => {}}
        />

        <!-- Discover sub-view (community skills) -->
        <div class:hidden={skillsSource !== "discover"}>
          <CommunityBrowser
            {projectCwd}
            sByScope={installedSlugsByScope}
            bind:operationLoading
            onInstalled={async () => {
              await refreshSkills();
              await refreshPluginData();
            }}
          />
        </div>

        <!-- Installed sub-view (standalone skills) -->
        <div class:hidden={skillsSource !== "installed"}>
          <div class="mb-4">
            <h3 class="text-xs font-medium text-muted-foreground">
              {t("plugin_standaloneSkills")}
            </h3>
          </div>

          {#if skills.length === 0}
            <div class="flex flex-col items-center justify-center py-16 text-center">
              <div
                class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted"
              >
                <svg
                  class="h-6 w-6 text-muted-foreground"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></svg
                >
              </div>
              <h2 class="text-sm font-medium text-foreground mb-1">
                {t("extensions_noSkillsInstalled")}
              </h2>
              <p class="text-xs text-muted-foreground max-w-sm mb-3">
                {t("plugin_skillsEmptyDesc")}
              </p>
              <button
                type="button"
                class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                onclick={() => skillEditorRef?.startNewSkill()}
              >
                {t("plugin_createFirstSkill")}
              </button>
            </div>
          {:else}
            <div class="space-y-1.5">
              {#each skills as skill}
                <div
                  class="w-full rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm px-4 py-3 transition-all hover:bg-accent/10 hover:shadow-sm"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div
                      class="flex-1 min-w-0 cursor-pointer"
                      onclick={() => skillEditorRef?.startEditSkill(skill)}
                      onkeydown={(e) => {
                        if (e.key === "Enter") skillEditorRef?.startEditSkill(skill);
                      }}
                      role="button"
                      tabindex="0"
                    >
                      <span class="text-sm font-medium text-foreground truncate block"
                        >{skill.name}</span
                      >
                      <div class="flex items-center gap-2 mt-0.5">
                        {#if skill.scope}
                          <span
                            class="rounded-full px-1.5 py-0.5 text-[10px] font-medium {skill.scope ===
                            'project'
                              ? 'bg-[hsl(var(--miwarp-status-info)/0.1)] text-miwarp-status-info'
                              : 'bg-muted text-muted-foreground'}">{skill.scope}</span
                          >
                        {/if}
                        {#if skill.remoteRef?.sourceType === "feishu"}
                          <span
                            class="rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-[hsl(var(--miwarp-accent-violet)/0.1)] text-miwarp-accent-violet"
                            >{t("skillSources_badge_feishu")}</span
                          >
                        {/if}
                        <span class="text-[11px] text-muted-foreground truncate"
                          >{skill.description}</span
                        >
                      </div>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        class="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        onclick={() => skillEditorRef?.startEditSkill(skill)}
                        title={t("extensions_editSkill")}
                      >
                        <svg
                          class="h-3.5 w-3.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          ><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path
                            d="m15 5 4 4"
                          /></svg
                        >
                      </button>
                      <button
                        type="button"
                        class="rounded-lg p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        onclick={(e) => {
                          e.stopPropagation();
                          handleDeleteSkill(skill);
                        }}
                        title={t("plugin_deleteSkillTooltip")}
                        disabled={operationLoading === skill.path}
                      >
                        <Icon name="trash" size="sm" />
                      </button>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <!-- Skill sources (Feishu MVP) -->
      <div class="space-y-4" class:hidden={activeTab !== "sources"}>
        <SkillSourceManager
          {projectCwd}
          onSkillsReload={async () => {
            try {
              skills = await listStandaloneSkills(projectCwd || undefined);
            } catch {
              dbgWarn("plugins", "reload skills after remote install failed");
            }
          }}
        />
      </div>

      <!-- ═══════════════════════════════════════════════════════ -->
      <!-- MCP Servers Section                                    -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <div class="space-y-4" class:hidden={activeTab !== "mcp"}>
        <div>
          <h2 class="text-sm font-semibold text-foreground">{t("sidebar_mcpServers")}</h2>
          <p class="text-xs text-muted-foreground">
            {t("extensions_typeGuide_mcp")}
          </p>
        </div>

        <!-- Source toggle -->
        <div class="flex gap-1 rounded-lg border border-border p-0.5 w-fit">
          <button
            type="button"
            class="rounded-md px-3 py-1 text-xs font-medium transition-colors {mcpSource ===
            'discover'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => {
              mcpSource = "discover";
              syncUrl();
            }}>{t("plugin_discover")}</button
          >
          <button
            type="button"
            class="rounded-md px-3 py-1 text-xs font-medium transition-colors {mcpSource ===
            'configured'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => {
              mcpSource = "configured";
              syncUrl();
            }}>{t("plugin_configured")}</button
          >
        </div>

        <!-- Discover sub-view -->
        <div class:hidden={mcpSource !== "discover"}>
          <McpDiscoverPanel
            {projectCwd}
            visible={mcpSource === "discover"}
            bind:operationLoading
            showToast={globalToast}
          />
        </div>

        <!-- Configured sub-view -->
        <div class:hidden={mcpSource !== "configured"}>
          <McpConfiguredPanel
            {projectCwd}
            visible={mcpSource === "configured"}
            bind:operationLoading
            showToast={globalToast}
            bind:confirmAction
          />
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════ -->
      <!-- Hooks Section                                           -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <div class="space-y-4" class:hidden={activeTab !== "hooks"}>
        <div>
          <h2 class="text-sm font-semibold text-foreground">{t("sidebar_hooks")}</h2>
          <p class="text-xs text-muted-foreground">
            {t("extensions_typeGuide_hooks")}
          </p>
        </div>
        <HookManager />
      </div>

      <!-- ═══════════════════════════════════════════════════════ -->
      <!-- Plugins Section                                        -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <div class="space-y-4" class:hidden={activeTab !== "plugins"}>
        <div>
          <h2 class="text-sm font-semibold text-foreground">{t("sidebar_plugins")}</h2>
          <p class="text-xs text-muted-foreground">{t("extensions_typeGuide_plugins")}</p>
        </div>

        <!-- Guided Install -->
        <div class="flex justify-end">
          <button
            type="button"
            class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            onclick={() => (showInstaller = true)}
          >
            {t("plugin_guidedInstall")}
          </button>
        </div>

        <MarketplaceBrowser
          {plugins}
          {installedPlugins}
          {marketplaces}
          {projectCwd}
          {categoryColors}
          {componentBadges}
          onRefresh={refreshPluginData}
          bind:confirmAction
        />
      </div>
      <!-- ═══════════════════════════════════════════════════════ -->
      <!-- Agents Section                                        -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <!--
        Agents panel: unlike the other tabs (whose inner panels render tall
        scrollable bodies), AgentsPanel's grid has a fixed 460px min-height
        that doesn't grow with the viewport. Without a flex wrapper that
        claims the scrollable area's height, AgentsPanel sits at ~520px tall
        while sibling tabs (MCP/Hooks/Plugins) fill the whole viewport —
        leaving a conspicuous blank band at the bottom of the page.
        `flex h-full min-h-0 flex-col` + `flex-1` on the inner wrapper makes
        AgentsPanel claim the remaining height and stretch its 3-column grid
        to fill, matching every other tab.
      -->
      <div class="flex h-full min-h-0 flex-col gap-4" class:hidden={activeTab !== "agents"}>
        <div>
          <h2 class="text-sm font-semibold text-foreground">{t("sidebar_agents")}</h2>
          <p class="text-xs text-muted-foreground">
            {t("extensions_typeGuide_agents")}
          </p>
        </div>
        <div class="min-h-0 flex-1">
          <AgentsPanel {projectCwd} showToast={globalToast} />
        </div>
      </div>
    {/if}
  </div>
</div>

<!-- Plugin Installer Modal -->
{#if showInstaller}
  <div transition:fade={{ duration: 200 }}>
    <PluginInstaller
      {plugins}
      {marketplaces}
      {projectCwd}
      onInstall={handleGuidedInstall}
      onCancel={() => (showInstaller = false)}
    />
  </div>
{/if}
