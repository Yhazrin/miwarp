<script lang="ts">
  import Spinner from "$lib/components/Spinner.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { dbg } from "$lib/utils/debug";
  import { showToast as globalToast } from "$lib/stores/toast-store.svelte";
  import { relativeTime } from "$lib/utils/format";
  import {
    installPlugin,
    uninstallPlugin,
    enablePlugin,
    disablePlugin,
    updatePlugin,
    addMarketplace,
    removeMarketplace,
    updateMarketplace,
  } from "$lib/api";
  import PluginCard from "./PluginCard.svelte";
  import type {
    MarketplacePlugin,
    InstalledPlugin,
    MarketplaceInfo,
  } from "$lib/types";

  let {
    plugins = [] as MarketplacePlugin[],
    installedPlugins = [] as InstalledPlugin[],
    marketplaces = [] as MarketplaceInfo[],
    projectCwd = "",
    categoryColors = {} as Record<string, string>,
    componentBadges = [] as { key: keyof MarketplacePlugin["components"]; label: () => string; color: string }[],
    onRefresh,
    confirmAction = $bindable<{ title: string; message: string; onConfirm: () => void } | null>(null),
  }: {
    plugins?: MarketplacePlugin[];
    installedPlugins?: InstalledPlugin[];
    marketplaces?: MarketplaceInfo[];
    projectCwd?: string;
    categoryColors?: Record<string, string>;
    componentBadges?: { key: keyof MarketplacePlugin["components"]; label: () => string; color: string }[];
    onRefresh: () => Promise<void>;
    confirmAction?: { title: string; message: string; onConfirm: () => void } | null;
  } = $props();

  // Search and filter state
  let searchQuery = $state("");
  let selectedCategory = $state<string | null>(null);
  let installScope = $state<"user" | "project" | "local">("user");
  let registriesOpen = $state(false);
  let newMarketplaceSource = $state("");
  let operationLoading = $state<string | null>(null);

  let categories = $derived([
    ...new Set(plugins.map((p) => p.category).filter(Boolean)),
  ] as string[]);

  let filteredPlugins = $derived(
    plugins.filter((p) => {
      if (selectedCategory && p.category !== selectedCategory) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        (p.author?.name ?? "").toLowerCase().includes(q)
      );
    }),
  );

  function needsCwd(scope: string): boolean {
    return scope === "project" || scope === "local";
  }

  function resolvePluginCwd(plugin: InstalledPlugin): string | undefined {
    const scope = (plugin.scope as string) ?? "user";
    if (!needsCwd(scope)) return undefined;
    return plugin.projectPath || projectCwd || undefined;
  }

  async function handleInstall(name: string) {
    operationLoading = name;
    dbg("plugins", "install", { name, scope: installScope });
    try {
      await installPlugin(
        name,
        installScope,
        needsCwd(installScope) ? projectCwd || undefined : undefined,
      );
      globalToast(t("plugin_installedPlugin", { name }), "success");
      await onRefresh();
    } catch (e) {
      globalToast(t("plugin_failedInstall", { error: String(e) }), "error");
    } finally {
      operationLoading = null;
    }
  }

  async function handleUninstall(plugin: InstalledPlugin) {
    confirmAction = {
      title: t("extensions_confirmUninstallTitle"),
      message: t("extensions_confirmUninstallMsg", { name: plugin.name }),
      onConfirm: async () => {
        operationLoading = plugin.name;
        dbg("plugins", "uninstall", { name: plugin.name });
        try {
          await uninstallPlugin(plugin.name, resolvePluginCwd(plugin));
          globalToast(t("plugin_uninstalledPlugin", { name: plugin.name }), "success");
          await onRefresh();
        } catch (e) {
          globalToast(t("plugin_failedUninstall", { error: String(e) }), "error");
        } finally {
          operationLoading = null;
        }
      },
    };
  }

  async function handleToggleEnabled(plugin: InstalledPlugin) {
    operationLoading = plugin.name;
    dbg("plugins", "toggleEnabled", { name: plugin.name, currently: plugin.enabled });
    try {
      if (plugin.enabled !== false) {
        await disablePlugin(plugin.name, resolvePluginCwd(plugin));
        globalToast(t("plugin_disabledPlugin", { name: plugin.name }), "success");
      } else {
        await enablePlugin(plugin.name, resolvePluginCwd(plugin));
        globalToast(t("plugin_enabledPlugin", { name: plugin.name }), "success");
      }
      await onRefresh();
    } catch (e) {
      globalToast(t("plugin_failedToggle", { error: String(e) }), "error");
    } finally {
      operationLoading = null;
    }
  }

  async function handleUpdate(plugin: InstalledPlugin) {
    operationLoading = plugin.name;
    dbg("plugins", "update", { name: plugin.name });
    try {
      await updatePlugin(plugin.name, resolvePluginCwd(plugin));
      globalToast(t("plugin_updatedPlugin", { name: plugin.name }), "success");
      await onRefresh();
    } catch (e) {
      globalToast(t("plugin_failedUpdate", { error: String(e) }), "error");
    } finally {
      operationLoading = null;
    }
  }

  async function handleAddMarketplace() {
    const source = newMarketplaceSource.trim();
    if (!source) return;
    operationLoading = "__marketplace_add";
    dbg("plugins", "addMarketplace", { source });
    try {
      await addMarketplace(source);
      globalToast(t("plugin_addedMarketplace", { name: source }), "success");
      newMarketplaceSource = "";
      await onRefresh();
    } catch (e) {
      globalToast(t("plugin_failedAddMarketplace", { error: String(e) }), "error");
    } finally {
      operationLoading = null;
    }
  }

  async function handleRemoveMarketplace(name: string) {
    confirmAction = {
      title: t("extensions_confirmRemoveSourceTitle"),
      message: t("extensions_confirmRemoveSourceMsg", { name }),
      onConfirm: async () => {
        operationLoading = `__mp_${name}`;
        dbg("plugins", "removeMarketplace", { name });
        try {
          await removeMarketplace(name);
          globalToast(t("plugin_removedMarketplace", { name }), "success");
          await onRefresh();
        } catch (e) {
          globalToast(t("plugin_failedRemoveMarketplace", { error: String(e) }), "error");
        } finally {
          operationLoading = null;
        }
      },
    };
  }

  async function handleUpdateMarketplace(name: string) {
    operationLoading = `__mp_${name}`;
    dbg("plugins", "updateMarketplace", { name });
    try {
      await updateMarketplace(name);
      globalToast(t("plugin_updatedMarketplace", { name }), "success");
      await onRefresh();
    } catch (e) {
      globalToast(t("plugin_failedUpdateMarketplace", { error: String(e) }), "error");
    } finally {
      operationLoading = null;
    }
  }
</script>

<!-- Search + Filter + Scope -->
<div class="flex items-center gap-3 mb-4">
  <div class="relative flex-1">
    <Icon
      name="search"
      class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
    />
    <input
      type="text"
      placeholder={t("plugin_searchPlugins")}
      class="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      bind:value={searchQuery}
    />
  </div>
  <select
    class="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
    value={selectedCategory ?? ""}
    onchange={(e) => {
      const val = (e.target as HTMLSelectElement).value;
      selectedCategory = val || null;
    }}
  >
    <option value="">{t("plugin_allCategories")}</option>
    {#each categories as cat}
      <option value={cat}>{cat}</option>
    {/each}
  </select>
  <div class="flex rounded-lg border border-border p-0.5 shrink-0">
    <button
      type="button"
      class="rounded-md px-2 py-1 text-xs font-medium transition-colors {installScope ===
      'user'
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => (installScope = "user")}>{t("plugin_scopeUser")}</button
    >
    <button
      type="button"
      class="rounded-md px-2 py-1 text-xs font-medium transition-colors {installScope ===
      'project'
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:text-foreground'} {!projectCwd
        ? 'opacity-40 cursor-not-allowed'
        : ''}"
      disabled={!projectCwd}
      onclick={() => (installScope = "project")}>{t("plugin_scopeProject")}</button
    >
    <button
      type="button"
      class="rounded-md px-2 py-1 text-xs font-medium transition-colors {installScope ===
      'local'
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:text-foreground'} {!projectCwd
        ? 'opacity-40 cursor-not-allowed'
        : ''}"
      disabled={!projectCwd}
      onclick={() => (installScope = "local")}>{t("plugin_scopeLocal")}</button
    >
  </div>
</div>

<!-- Scope description -->
<div class="flex items-center gap-1.5 mb-4 text-[11px] text-muted-foreground/70">
  <svg
    class="h-3 w-3"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    ><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg
  >
  {installScope === "user"
    ? t("extensions_scopeUserDesc")
    : installScope === "project"
      ? t("extensions_scopeProjectDesc")
      : t("extensions_scopeLocalDesc")}
  {#if !projectCwd && installScope !== "user"}
    <span class="text-[hsl(var(--miwarp-status-warning)/0.8)] ml-1">
      {t("extensions_noWorkspaceForProjectScope")}
    </span>
  {/if}
</div>

<!-- Plugin cards -->
{#if filteredPlugins.length === 0}
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
        ><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg
      >
    </div>
    <h2 class="text-sm font-medium text-foreground mb-1">{t("plugin_noPluginsFound")}</h2>
    <p class="text-xs text-muted-foreground max-w-sm">
      {#if searchQuery || selectedCategory}
        {t("plugin_noPluginsMatch")}
      {:else}
        {t("extensions_noPluginsMarketplace")}
      {/if}
    </p>
  </div>
{:else}
  <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
    {#each filteredPlugins as plugin (plugin.name)}
      {@const installedMatch = installedPlugins.find((ip) => ip.name === plugin.name)}
      <PluginCard
        {plugin}
        installedPlugin={installedMatch}
        marketplaceMatch={plugin}
        {operationLoading}
        {categoryColors}
        {componentBadges}
        onInstall={handleInstall}
        onUninstall={handleUninstall}
        onToggleEnabled={handleToggleEnabled}
        onUpdate={handleUpdate}
      />
    {/each}
  </div>
{/if}

<!-- Installed sub-view -->
{#if installedPlugins.length === 0}
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
        ><path
          d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
        /></svg
      >
    </div>
    <h2 class="text-sm font-medium text-foreground mb-1">
      {t("extensions_noPluginsInstalled")}
    </h2>
    <p class="text-xs text-muted-foreground max-w-sm">
      {t("plugin_installFromMarketplace")}
    </p>
  </div>
{:else}
  <div class="space-y-2">
    {#each installedPlugins as plugin (plugin.name)}
      {@const mpMatch = plugins.find((p) => p.name === plugin.name)}
      <PluginCard
        plugin={mpMatch ?? {
          name: plugin.name,
          description: plugin.description ?? "",
          version: plugin.version,
          category: "",
          tags: [],
          components: { skills: [], commands: [], agents: [], hooks: [], mcp_servers: [], lsp_servers: [] },
          install_count: 0,
          author: null,
          homepage: "",
        }}
        installedPlugin={plugin}
        marketplaceMatch={mpMatch}
        {operationLoading}
        {categoryColors}
        {componentBadges}
        onInstall={handleInstall}
        onUninstall={handleUninstall}
        onToggleEnabled={handleToggleEnabled}
        onUpdate={handleUpdate}
      />
    {/each}
  </div>
{/if}

<!-- Registries (collapsible, always visible at bottom) -->
<div class="mt-6 border-t border-border pt-4">
  <button
    type="button"
    class="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
    onclick={() => (registriesOpen = !registriesOpen)}
  >
    <Icon
      name="chevron-down"
      size="xs"
      class="transition-transform {registriesOpen ? 'rotate-180' : ''}"
    />
    {t("extensions_manageSources")} ({marketplaces.length})
  </button>
  {#if registriesOpen}
    <div class="mt-3 space-y-3">
      <!-- Add marketplace input -->
      <div class="flex gap-2">
        <input
          type="text"
          placeholder={t("plugin_marketplacePlaceholder")}
          class="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          bind:value={newMarketplaceSource}
        />
        <button
          type="button"
          class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          onclick={() => handleAddMarketplace()}
          disabled={!newMarketplaceSource.trim() ||
            operationLoading === "__marketplace_add"}
        >
          {operationLoading === "__marketplace_add" ? t("plugin_adding") : t("plugin_add")}
        </button>
      </div>

      {#if marketplaces.length === 0}
        <div class="flex flex-col items-center justify-center py-8 text-center">
          <p class="text-xs text-muted-foreground">
            {t("plugin_noMarketplaces")}
          </p>
        </div>
      {:else}
        <div class="space-y-2">
          {#each marketplaces as mp (mp.name)}
            <div
              class="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm px-4 py-3"
            >
              <div class="flex items-center justify-between">
                <div>
                  <span class="text-sm font-medium text-foreground">{mp.name}</span>
                  <div class="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    <span
                      >{t("plugin_pluginCount", { count: String(mp.plugin_count) })}</span
                    >
                    {#if mp.last_updated}
                      <span
                        >{t("plugin_updatedTime", {
                          time: relativeTime(mp.last_updated),
                        })}</span
                      >
                    {/if}
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                    onclick={() => handleUpdateMarketplace(mp.name)}
                    disabled={operationLoading === `__mp_${mp.name}`}
                  >
                    {operationLoading === `__mp_${mp.name}`
                      ? t("plugin_updating")
                      : t("plugin_update")}
                  </button>
                  <button
                    type="button"
                    class="rounded-lg border border-destructive/30 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                    onclick={() => handleRemoveMarketplace(mp.name)}
                    disabled={operationLoading === `__mp_${mp.name}`}
                  >
                    {t("plugin_remove")}
                  </button>
                  {#if operationLoading === `__mp_${mp.name}`}
                    <Spinner size="sm" />
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
