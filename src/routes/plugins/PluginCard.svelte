<script lang="ts">
  import Spinner from "$lib/components/Spinner.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { formatInstallCount } from "$lib/utils/format";
  import type { MarketplacePlugin, InstalledPlugin } from "$lib/types";

  let {
    plugin,
    installedPlugin,
    marketplaceMatch,
    operationLoading = null,
    categoryColors = {} as Record<string, string>,
    componentBadges = [] as { key: keyof MarketplacePlugin["components"]; label: () => string; color: string }[],
    onInstall,
    onUninstall,
    onToggleEnabled,
    onUpdate,
  }: {
    plugin: MarketplacePlugin;
    installedPlugin?: InstalledPlugin;
    marketplaceMatch?: MarketplacePlugin;
    operationLoading?: string | null;
    categoryColors?: Record<string, string>;
    componentBadges?: { key: keyof MarketplacePlugin["components"]; label: () => string; color: string }[];
    onInstall: (name: string) => void;
    onUninstall: (plugin: InstalledPlugin) => void;
    onToggleEnabled: (plugin: InstalledPlugin) => void;
    onUpdate: (plugin: InstalledPlugin) => void;
  } = $props();

  function hasComponent(
    components: MarketplacePlugin["components"],
    key: keyof MarketplacePlugin["components"],
  ): boolean {
    const val = components[key];
    return Array.isArray(val) ? val.length > 0 : !!val;
  }

  function componentCount(
    components: MarketplacePlugin["components"],
    key: keyof MarketplacePlugin["components"],
  ): number {
    const val = components[key];
    return Array.isArray(val) ? val.length : 0;
  }

  function getCategoryColor(category: string): string {
    return categoryColors[category] ?? "bg-muted text-muted-foreground";
  }
</script>

{#if installedPlugin}
  <!-- Installed plugin card -->
  <div
    class="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm px-4 py-3 flex items-center justify-between gap-4 hover:bg-accent/10 hover:shadow-sm transition-all"
  >
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-foreground">{installedPlugin.name}</span>
        {#if installedPlugin.version}
          <span class="text-[11px] text-muted-foreground">v{installedPlugin.version}</span>
        {/if}
        {#if installedPlugin.scope}
          <span
            class="rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground"
            >{installedPlugin.scope}</span
          >
        {/if}
      </div>
      {#if installedPlugin.description}
        <p class="text-xs text-muted-foreground mt-0.5 line-clamp-1">
          {installedPlugin.description}
        </p>
      {/if}
      <!-- Component badges for installed plugins -->
      {#if marketplaceMatch}
        <div class="flex flex-wrap gap-1 mt-1">
          {#each componentBadges as badge}
            {#if hasComponent(marketplaceMatch.components, badge.key)}
              <span
                class="rounded-full px-1.5 py-0.5 text-[10px] font-medium {badge.color}"
              >
                {badge.label()}
              </span>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
    <div class="flex items-center gap-2 shrink-0">
      <!-- Enable/Disable toggle -->
      <button
        type="button"
        class="rounded-lg border border-border px-2.5 py-1 text-xs {installedPlugin.enabled !==
        false
          ? 'text-miwarp-status-success border-[hsl(var(--miwarp-status-success)/0.3)]'
          : 'text-muted-foreground'} hover:bg-muted transition-colors disabled:opacity-50"
        onclick={() => onToggleEnabled(installedPlugin!)}
        disabled={operationLoading === installedPlugin.name}
      >
        {installedPlugin.enabled !== false ? t("plugin_enabled") : t("plugin_disabled")}
      </button>
      <!-- Update button -->
      <button
        type="button"
        class="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        onclick={() => onUpdate(installedPlugin!)}
        disabled={operationLoading === installedPlugin.name}
        title={t("plugins_updatePlugin")}
      >
        {t("plugin_update")}
      </button>
      <!-- Uninstall button -->
      <button
        type="button"
        class="rounded-lg border border-destructive/30 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
        onclick={() => onUninstall(installedPlugin!)}
        disabled={operationLoading === installedPlugin.name}
      >
        {t("plugin_uninstall")}
      </button>
      <!-- Loading spinner -->
      {#if operationLoading === installedPlugin.name}
        <Spinner size="sm" />
      {/if}
    </div>
  </div>
{:else}
  <!-- Marketplace plugin card -->
  <div
    class="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm px-4 py-3 space-y-2 hover:bg-accent/10 hover:shadow-sm transition-all"
  >
    <!-- Name + version + homepage -->
    <div class="flex items-start gap-2">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-foreground truncate"
            >{plugin.name}</span
          >
          {#if plugin.version}
            <span class="text-[11px] text-muted-foreground shrink-0"
              >v{plugin.version}</span
            >
          {/if}
        </div>
        {#if plugin.author}
          <div class="text-xs text-muted-foreground">{plugin.author.name}</div>
        {/if}
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <!-- Install button -->
        <button
          type="button"
          class="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          onclick={() => onInstall(plugin.name)}
          disabled={operationLoading === plugin.name}
        >
          {operationLoading === plugin.name
            ? t("plugin_installing")
            : t("plugin_install")}
        </button>
        {#if plugin.install_count != null && plugin.install_count > 0}
          <span class="text-[11px] text-muted-foreground"
            >{formatInstallCount(plugin.install_count)} {t("plugin_installs")}</span
          >
        {/if}
        {#if plugin.homepage}
          <a
            href={plugin.homepage}
            target="_blank"
            rel="noopener noreferrer"
            class="text-muted-foreground hover:text-foreground transition-colors"
            title={t("plugin_homepage")}
          >
            <svg
              class="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><path
                d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
              /><polyline points="15 3 21 3 21 9" /><line
                x1="10"
                x2="21"
                y1="14"
                y2="3"
              /></svg
            >
          </a>
        {/if}
      </div>
    </div>

    <!-- Description -->
    <p class="text-xs text-muted-foreground line-clamp-2">{plugin.description}</p>

    <!-- Badges row: category + components -->
    <div class="flex flex-wrap items-center gap-1.5">
      {#if plugin.category}
        <span
          class="rounded-full px-2 py-0.5 text-[10px] font-medium {getCategoryColor(
            plugin.category,
          )}">{plugin.category}</span
        >
      {/if}
      {#each componentBadges as badge}
        {#if hasComponent(plugin.components, badge.key)}
          <span
            class="rounded-full px-1.5 py-0.5 text-[10px] font-medium {badge.color}"
          >
            {badge.label()}{#if componentCount(plugin.components, badge.key) > 0}
              ({componentCount(plugin.components, badge.key)}){/if}
          </span>
        {/if}
      {/each}
    </div>

    <!-- Tags -->
    {#if plugin.tags.length > 0}
      <div class="flex flex-wrap gap-1">
        {#each plugin.tags as tag}
          <span
            class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >{tag}</span
          >
        {/each}
      </div>
    {/if}
  </div>
{/if}
