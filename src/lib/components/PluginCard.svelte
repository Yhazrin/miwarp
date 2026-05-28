<script lang="ts">
  /**
   * PluginCard Component
   *
   * Displays a marketplace plugin with its components, badges, and actions.
   */
  import { t } from "$lib/i18n/index.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { formatInstallCount } from "$lib/utils/format";
  import type { MarketplacePlugin, InstalledPlugin } from "$lib/types";

  interface Props {
    plugin: MarketplacePlugin;
    isInstalled?: boolean;
    installedPlugin?: InstalledPlugin;
    operationLoading?: string | boolean;
    onInstall?: (name: string) => void;
    onUninstall?: (plugin: InstalledPlugin) => void;
    onToggle?: (plugin: InstalledPlugin, enabled: boolean) => void;
    onUpdate?: (plugin: InstalledPlugin) => void;
  }

  let {
    plugin,
    isInstalled = false,
    installedPlugin,
    operationLoading = false,
    onInstall,
    onUninstall,
    onToggle,
    onUpdate,
  }: Props = $props();

  // Component badge configuration
  const componentBadges: {
    key: keyof MarketplacePlugin["components"];
    label: string;
    color: string;
  }[] = [
    {
      key: "skills",
      label: t("pluginCard_skills"),
      color: "bg-[hsl(var(--miwarp-status-error)/0.1)] text-miwarp-status-error",
    },
    {
      key: "commands",
      label: t("pluginCard_commands"),
      color: "bg-[hsl(var(--miwarp-status-info)/0.1)] text-miwarp-status-info",
    },
    {
      key: "agents",
      label: t("pluginCard_agents"),
      color: "bg-[hsl(var(--miwarp-accent-violet)/0.1)] text-miwarp-accent-violet",
    },
    {
      key: "hooks",
      label: t("pluginCard_hooks"),
      color: "bg-[hsl(var(--miwarp-status-warning)/0.1)] text-miwarp-status-warning",
    },
    {
      key: "mcp_servers",
      label: t("pluginCard_mcp"),
      color: "bg-[hsl(var(--miwarp-status-info)/0.1)] text-miwarp-status-info",
    },
    {
      key: "lsp_servers",
      label: t("pluginCard_lsp"),
      color: "bg-[hsl(var(--miwarp-status-success)/0.1)] text-miwarp-status-success",
    },
  ];

  const categoryColors: Record<string, string> = {
    development: "bg-[hsl(var(--miwarp-status-info)/0.1)] text-miwarp-status-info",
    productivity: "bg-[hsl(var(--miwarp-status-info)/0.1)] text-miwarp-status-info",
    security: "bg-[hsl(var(--miwarp-status-error)/0.1)] text-miwarp-status-error",
    testing: "bg-[hsl(var(--miwarp-status-warning)/0.1)] text-miwarp-status-warning",
    learning: "bg-[hsl(var(--miwarp-accent-violet)/0.1)] text-miwarp-accent-violet",
    database: "bg-[hsl(var(--miwarp-status-success)/0.1)] text-miwarp-status-success",
    monitoring: "bg-[hsl(var(--miwarp-status-warning)/0.1)] text-miwarp-status-warning",
    deployment: "bg-[hsl(var(--miwarp-accent-primary)/0.1)] text-miwarp-accent-primary",
    design: "bg-[hsl(var(--miwarp-accent-violet)/0.1)] text-miwarp-accent-violet",
  };

  function hasComponent(
    components: MarketplacePlugin["components"],
    key: keyof MarketplacePlugin["components"],
  ): boolean {
    const val = components[key];
    if (typeof val === "boolean") return val;
    if (Array.isArray(val)) return val.length > 0;
    return false;
  }

  function componentCount(
    components: MarketplacePlugin["components"],
    key: keyof MarketplacePlugin["components"],
  ): number {
    const val = components[key];
    if (Array.isArray(val)) return val.length;
    return 0;
  }

  function getCategoryColor(category: string): string {
    return categoryColors[category.toLowerCase()] ?? "bg-muted text-muted-foreground";
  }

  const isLoading = $derived(operationLoading === plugin.name);
  const enabled = $derived(installedPlugin?.enabled !== false);
</script>

{#if isInstalled && installedPlugin}
  <!-- Installed Plugin Card -->
  <div
    class="rounded-lg border border-border/50 bg-muted/30 px-4 py-3 flex items-center justify-between gap-4"
  >
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-foreground">{plugin.name}</span>
        {#if plugin.version}
          <span class="text-[11px] text-muted-foreground">v{plugin.version}</span>
        {/if}
        {#if installedPlugin.scope}
          <span
            class="rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground"
          >
            {installedPlugin.scope}
          </span>
        {/if}
      </div>
      {#if plugin.description}
        <p class="text-xs text-muted-foreground mt-0.5 line-clamp-1">{plugin.description}</p>
      {/if}
      <!-- Component badges -->
      <div class="flex flex-wrap gap-1 mt-1">
        {#each componentBadges as badge}
          {#if hasComponent(plugin.components, badge.key)}
            <span class="rounded-full px-1.5 py-0.5 text-[10px] font-medium {badge.color}">
              {badge.label}
            </span>
          {/if}
        {/each}
      </div>
    </div>
    <div class="flex items-center gap-2 shrink-0">
      <!-- Enable/Disable toggle -->
      <button
        class="rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50 {enabled
          ? 'text-miwarp-status-success border-[hsl(var(--miwarp-status-success)/0.3)] hover:bg-[hsl(var(--miwarp-status-success)/0.1)]'
          : 'text-muted-foreground hover:bg-muted'}"
        onclick={() => onToggle?.(installedPlugin, !enabled)}
        disabled={isLoading}
      >
        {enabled ? t("plugin_enabled") : t("plugin_disabled")}
      </button>
      <!-- Update button -->
      <button
        class="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        onclick={() => onUpdate?.(installedPlugin)}
        disabled={isLoading}
        title={t("plugin_update")}
      >
        {t("plugin_update")}
      </button>
      <!-- Uninstall button -->
      <button
        class="rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
        onclick={() => onUninstall?.(installedPlugin)}
        disabled={isLoading}
      >
        {t("plugin_uninstall")}
      </button>
      {#if isLoading}
        <Spinner size="sm" />
      {/if}
    </div>
  </div>
{:else}
  <!-- Marketplace Plugin Card -->
  <div class="rounded-lg border border-border/50 bg-muted/30 px-4 py-3 space-y-2">
    <!-- Name + version + actions -->
    <div class="flex items-start gap-2">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-foreground truncate">{plugin.name}</span>
          {#if plugin.version}
            <span class="text-[11px] text-muted-foreground shrink-0">v{plugin.version}</span>
          {/if}
        </div>
        {#if plugin.author}
          <div class="text-xs text-muted-foreground">{plugin.author.name}</div>
        {/if}
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <!-- Install button -->
        <button
          class="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          onclick={() => onInstall?.(plugin.name)}
          disabled={isLoading}
        >
          {isLoading ? t("plugin_installing") : t("plugin_install")}
        </button>
        {#if plugin.install_count && plugin.install_count > 0}
          <span class="text-[11px] text-muted-foreground">
            {formatInstallCount(plugin.install_count)}
            {t("plugin_installs")}
          </span>
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
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" x2="21" y1="14" y2="3" />
            </svg>
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
          )}"
        >
          {plugin.category}
        </span>
      {/if}
      {#each componentBadges as badge}
        {#if hasComponent(plugin.components, badge.key)}
          <span class="rounded-full px-1.5 py-0.5 text-[10px] font-medium {badge.color}">
            {badge.label}{#if componentCount(plugin.components, badge.key) > 0}
              ({componentCount(plugin.components, badge.key)})
            {/if}
          </span>
        {/if}
      {/each}
    </div>

    <!-- Tags -->
    {#if plugin.tags.length > 0}
      <div class="flex flex-wrap gap-1">
        {#each plugin.tags as tag}
          <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {tag}
          </span>
        {/each}
      </div>
    {/if}
  </div>
{/if}
