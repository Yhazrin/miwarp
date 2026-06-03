<script lang="ts">
  /**
   * PluginInstaller Component
   *
   * A step-by-step wizard for plugin installation with progress tracking.
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { MarketplacePlugin, MarketplaceInfo } from "$lib/types";
  import Icon from "$lib/components/Icon.svelte";
  import type { LucideIconName } from "$lib/lucide-icon";

  type InstallStep = "select" | "configure" | "installing" | "complete" | "error";

  interface Props {
    plugins: MarketplacePlugin[];
    marketplaces: MarketplaceInfo[];
    projectCwd?: string;
    onInstall?: (
      pluginName: string,
      scope: "user" | "project" | "local",
      autoEnable: boolean,
    ) => Promise<boolean>;
    onCancel?: () => void;
  }

  let { plugins, marketplaces: _marketplaces, projectCwd, onInstall, onCancel }: Props = $props();

  // State
  let currentStep = $state<InstallStep>("select");
  let selectedPlugin = $state<MarketplacePlugin | null>(null);
  let selectedScope = $state<"user" | "project" | "local">("user");
  let autoEnable = $state(true);
  let searchQuery = $state("");
  let filteredPlugins = $state<MarketplacePlugin[]>([]);

  // Progress tracking
  let installProgress = $state(0);
  let installStage = $state("");
  let installMessage = $state("");
  let installError = $state<string | null>(null);

  // Derived
  const canInstallProject = $derived(!!projectCwd);

  // Filter plugins based on search
  $effect(() => {
    if (!searchQuery) {
      filteredPlugins = plugins;
    } else {
      const q = searchQuery.toLowerCase();
      filteredPlugins = plugins.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.category?.toLowerCase().includes(q),
      );
    }
  });

  function selectPlugin(plugin: MarketplacePlugin) {
    selectedPlugin = plugin;
    currentStep = "configure";
  }

  function goBack() {
    if (currentStep === "configure") {
      selectedPlugin = null;
      currentStep = "select";
    }
  }

  async function startInstallation() {
    if (!selectedPlugin || !onInstall) return;

    currentStep = "installing";
    installProgress = 0;
    installStage = "preparing";
    installMessage = t("plugin_preparingInstallation");
    installError = null;

    try {
      // Simulate progress stages
      installProgress = 10;
      installStage = "validating";
      installMessage = t("plugin_validatingPlugin");

      await new Promise((r) => setTimeout(r, 300));

      installProgress = 30;
      installStage = "downloading";
      installMessage = t("plugin_downloading");

      await new Promise((r) => setTimeout(r, 400));

      installProgress = 60;
      installStage = "installing";
      installMessage = t("plugin_installing");

      const success = await onInstall(selectedPlugin.name, selectedScope, autoEnable);

      if (success) {
        installProgress = 100;
        installStage = "complete";
        installMessage = t("plugin_installationComplete");
        import("$lib/services/sound-feedback-service")
          .then((m) => m.playMiWarpSound("plugin_installed"))
          .catch(() => {});
        await new Promise((r) => setTimeout(r, 500));
        currentStep = "complete";
      } else {
        throw new Error(t("pluginInstaller_failed"));
      }
    } catch (e) {
      installError = e instanceof Error ? e.message : String(e);
      installStage = "error";
      currentStep = "error";
    }
  }

  function reset() {
    selectedPlugin = null;
    currentStep = "select";
    searchQuery = "";
    installProgress = 0;
    installStage = "";
    installMessage = "";
    installError = null;
  }

  function handleClose() {
    reset();
    onCancel?.();
  }

  // Stage icons and descriptions
  const stageInfo: Record<string, { iconName: LucideIconName; description: string }> = {
    preparing: {
      iconName: "loader-2",
      description: t("pluginInstaller_preparing"),
    },
    validating: {
      iconName: "check",
      description: t("pluginInstaller_validating"),
    },
    downloading: {
      iconName: "download",
      description: t("pluginInstaller_downloading"),
    },
    installing: {
      iconName: "settings",
      description: t("pluginInstaller_installing"),
    },
    enabling: {
      iconName: "play",
      description: t("pluginInstaller_enabling"),
    },
    complete: {
      iconName: "check",
      description: t("pluginInstaller_complete"),
    },
    error: {
      iconName: "x",
      description: t("pluginInstaller_failed"),
    },
  };
</script>

<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-miwarp-overlay"
  role="button"
  tabindex="0"
  aria-label={t("common_close")}
  onclick={handleClose}
  onkeydown={(e) => {
    if (e.key === "Escape") handleClose();
  }}
>
  <div
    class="w-full max-w-lg rounded-lg border border-border bg-background shadow-xl"
    role="presentation"
    onclick={(e) => e.stopPropagation()}
  >
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-4 py-3">
      <h2 class="text-sm font-semibold text-foreground">
        {#if currentStep === "select"}
          {t("plugin_selectPlugin")}
        {:else if currentStep === "configure"}
          {t("plugin_configureInstallation")}
        {:else if currentStep === "installing"}
          {t("plugin_installing")} {selectedPlugin?.name}
        {:else if currentStep === "complete"}
          {t("plugin_installationComplete")}
        {:else if currentStep === "error"}
          {t("plugin_installationFailed")}
        {/if}
      </h2>
      <button type="button"
        class="text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Close"
        onclick={handleClose}
      >
        <Icon name="x" size="md" />
      </button>
    </div>

    <!-- Content -->
    <div class="p-4">
      {#if currentStep === "select"}
        <!-- Search and plugin list -->
        <div class="space-y-4">
          <!-- Search input -->
          <div class="relative">
            <Icon name="search" class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder={t("plugin_searchPlugins")}
              class="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              bind:value={searchQuery}
            />
          </div>

          <!-- Plugin list -->
          <div class="max-h-[300px] overflow-y-auto space-y-2">
            {#if filteredPlugins.length === 0}
              <div class="flex flex-col items-center justify-center py-8 text-center">
                <p class="text-xs text-muted-foreground">{t("plugin_noPluginsFound")}</p>
              </div>
            {:else}
              {#each filteredPlugins as plugin}
                <button type="button"
                  class="w-full text-left rounded-lg border border-border/50 bg-muted/30 px-3 py-2 transition-colors hover:bg-muted/50"
                  onclick={() => selectPlugin(plugin)}
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex-1 min-w-0">
                      <span class="text-sm font-medium text-foreground truncate block"
                        >{plugin.name}</span
                      >
                      <span class="text-xs text-muted-foreground truncate block"
                        >{plugin.description}</span
                      >
                    </div>
                    {#if plugin.category}
                      <span class="text-[10px] text-muted-foreground shrink-0"
                        >{plugin.category}</span
                      >
                    {/if}
                  </div>
                </button>
              {/each}
            {/if}
          </div>
        </div>
      {:else if currentStep === "configure"}
        <!-- Configuration options -->
        {#if selectedPlugin}
          <div class="space-y-4">
            <!-- Plugin info -->
            <div class="rounded-lg border border-border/50 bg-muted/20 p-3">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-foreground">{selectedPlugin.name}</span>
                {#if selectedPlugin.version}
                  <span class="text-[11px] text-muted-foreground">v{selectedPlugin.version}</span>
                {/if}
              </div>
              <p class="text-xs text-muted-foreground mt-1">{selectedPlugin.description}</p>
            </div>

            <!-- Scope selector -->
            <div>
              <span class="block text-xs font-medium text-muted-foreground mb-2">
                {t("plugin_installScope")}
              </span>
              <div class="flex rounded-md border border-border p-0.5">
                <button type="button"
                  class="flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors {selectedScope ===
                  'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'}"
                  onclick={() => (selectedScope = "user")}
                >
                  {t("plugin_scopeUser")}
                </button>
                <button type="button"
                  class="flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors {selectedScope ===
                  'project'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'} {!canInstallProject
                    ? 'opacity-40 cursor-not-allowed'
                    : ''}"
                  disabled={!canInstallProject}
                  onclick={() => (selectedScope = "project")}
                >
                  {t("plugin_scopeProject")}
                </button>
                <button type="button"
                  class="flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors {selectedScope ===
                  'local'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'} {!canInstallProject
                    ? 'opacity-40 cursor-not-allowed'
                    : ''}"
                  disabled={!canInstallProject}
                  onclick={() => (selectedScope = "local")}
                >
                  {t("plugin_scopeLocal")}
                </button>
              </div>
              {#if selectedScope === "project" || selectedScope === "local"}
                <p class="text-[10px] text-muted-foreground mt-1">
                  {t("plugin_scopeProjectNote")}
                </p>
              {/if}
            </div>

            <!-- Auto-enable toggle -->
            <div class="flex items-center gap-3">
              <input
                type="checkbox"
                id="autoEnable"
                class="h-4 w-4 rounded border-border bg-background text-primary focus:ring-primary"
                bind:checked={autoEnable}
              />
              <label for="autoEnable" class="text-xs text-foreground">
                {t("plugin_autoEnable")}
              </label>
            </div>
          </div>
        {/if}
      {:else if currentStep === "installing"}
        <!-- Installation progress -->
        <div class="space-y-4 py-4">
          <!-- Progress bar -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs text-muted-foreground">{installStage}</span>
              <span class="text-xs text-muted-foreground">{installProgress}%</span>
            </div>
            <div class="h-2 rounded-full bg-muted overflow-hidden">
              <div
                class="h-full rounded-full bg-primary transition-all duration-300"
                style="width: {installProgress}%"
              ></div>
            </div>
          </div>

          <!-- Stage info -->
          <div class="flex items-center gap-3">
            <Icon
              name={stageInfo[installStage]?.iconName ?? "circle"}
              size="md"
              class={installStage === "preparing" ? "animate-spin" : ""}
            />
            <span class="text-sm text-foreground">{installMessage}</span>
          </div>
        </div>
      {:else if currentStep === "complete"}
        <!-- Success -->
        <div class="flex flex-col items-center justify-center py-8 text-center">
          <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--miwarp-status-success)/0.1)]">
            <Icon name="check" size="lg" class="text-miwarp-status-success" />
          </div>
          <h3 class="text-sm font-medium text-foreground mb-1">
            {t("plugin_installationSuccessful")}
          </h3>
          <p class="text-xs text-muted-foreground max-w-sm">
            {t("plugin_installationSuccessNote", { name: selectedPlugin?.name || "" })}
          </p>
        </div>
      {:else if currentStep === "error"}
        <!-- Error -->
        <div class="flex flex-col items-center justify-center py-8 text-center">
          <div
            class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10"
          >
            <Icon name="x" size="lg" class="text-destructive" />
          </div>
          <h3 class="text-sm font-medium text-destructive mb-1">
            {t("plugin_installationFailed")}
          </h3>
          <p class="text-xs text-muted-foreground max-w-sm">
            {installError || t("plugin_unknownError")}
          </p>
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
      {#if currentStep === "select"}
        <button type="button"
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onclick={handleClose}
        >
          {t("common_cancel")}
        </button>
      {:else if currentStep === "configure"}
        <button type="button"
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onclick={goBack}
        >
          {t("common_back")}
        </button>
        <button type="button"
          class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          onclick={startInstallation}
        >
          {t("plugin_install")}
        </button>
      {:else if currentStep === "complete" || currentStep === "error"}
        <button type="button"
          class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          onclick={handleClose}
        >
          {t("common_done")}
        </button>
      {/if}
    </div>
  </div>
</div>
