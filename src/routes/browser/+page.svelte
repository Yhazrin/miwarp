<script lang="ts">
  /**
   * Browser Management Page
   *
   * Full-featured browser automation interface for web scraping,
   * testing, and automated workflows.
   */
  import BrowserPanel from "$lib/components/BrowserPanel.svelte";
  import WebFetch from "$lib/components/WebFetch.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import type { LucideIconName } from "$lib/lucide-icon";

  let activeTab = $state<"browser" | "webfetch">("browser");
  let showSettings = $state(false);

  let tabs: { id: "browser" | "webfetch"; label: string; iconName: LucideIconName }[] = [
    { id: "browser", label: t("browser_automation"), iconName: "globe" },
    { id: "webfetch", label: t("webfetch_title"), iconName: "radio" },
  ];
</script>

<svelte:head>
  <title>{t("browser_title")}</title>
</svelte:head>

<div class="flex h-full flex-col gap-4 overflow-hidden p-6">
  <!-- Header -->
  <div class="flex shrink-0 items-start justify-between">
    <div>
      <h1 class="mb-1 text-2xl font-semibold">{t("browser_automation")}</h1>
      <p class="text-sm text-miwarp-text-secondary">{t("browser_description")}</p>
    </div>
    <div class="flex gap-2">
      <button type="button"
        class="rounded-md border border-border p-2 text-xl transition-colors hover:bg-miwarp-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={t("browser_settings")}
        aria-label={t("browser_settings")}
        onclick={() => (showSettings = !showSettings)}
      >
        <Icon name="settings" size="md" />
      </button>
    </div>
  </div>

  <!-- Tab Navigation -->
  <div class="flex w-fit shrink-0 gap-2 rounded-lg bg-miwarp-bg-deepest p-1">
    {#each tabs as tab}
      <button type="button"
        class="flex items-center gap-2 rounded-md px-5 py-3 text-sm font-medium transition-all
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
          {activeTab === tab.id
          ? 'bg-miwarp-accent-primary text-miwarp-accent-on-accent'
          : 'text-miwarp-text-secondary hover:bg-miwarp-bg-hover hover:text-miwarp-text-primary'}"
        onclick={() => (activeTab = tab.id as "browser" | "webfetch")}
      >
        <Icon name={tab.iconName} size="md" />
        <span>{tab.label}</span>
      </button>
    {/each}
  </div>

  <!-- Content Area -->
  <div class="min-h-0 flex-1 overflow-hidden">
    {#if activeTab === "browser"}
      <BrowserPanel />
    {:else if activeTab === "webfetch"}
      <WebFetch />
    {/if}
  </div>

  <!-- Settings Modal -->
  <Modal bind:open={showSettings} title={t("browser_settings")}>
    <div class="space-y-5">
      <div>
        <h3 class="mb-3 text-sm font-semibold text-muted-foreground">{t("browser_mcp")}</h3>
        <div class="space-y-3">
          <label class="flex items-center justify-between gap-4">
            <span class="text-sm">{t("browser_autoConnect")}</span>
            <input type="checkbox" checked class="h-4 w-4" />
          </label>
          <label class="flex items-center justify-between gap-4">
            <span class="text-sm">{t("browser_viewportWidth")}</span>
            <input type="number" value="1920" class="w-36 rounded-md border border-border bg-background px-3 py-1.5 text-sm" />
          </label>
          <label class="flex items-center justify-between gap-4">
            <span class="text-sm">{t("browser_viewportHeight")}</span>
            <input type="number" value="1080" class="w-36 rounded-md border border-border bg-background px-3 py-1.5 text-sm" />
          </label>
        </div>
      </div>

      <div>
        <h3 class="mb-3 text-sm font-semibold text-muted-foreground">{t("browser_screenshot")}</h3>
        <div class="space-y-3">
          <label class="flex items-center justify-between gap-4">
            <span class="text-sm">{t("browser_autoSave")}</span>
            <input type="checkbox" checked class="h-4 w-4" />
          </label>
          <label class="flex items-center justify-between gap-4">
            <span class="text-sm">{t("browser_format")}</span>
            <select class="w-36 rounded-md border border-border bg-background px-3 py-1.5 text-sm">
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </label>
        </div>
      </div>

      <div>
        <h3 class="mb-3 text-sm font-semibold text-muted-foreground">{t("browser_webfetch")}</h3>
        <div class="space-y-3">
          <label class="flex items-center justify-between gap-4">
            <span class="text-sm">{t("browser_timeout")}</span>
            <input type="number" value="30000" class="w-36 rounded-md border border-border bg-background px-3 py-1.5 text-sm" />
          </label>
          <label class="flex items-center justify-between gap-4">
            <span class="text-sm">{t("browser_followRedirects")}</span>
            <input type="checkbox" class="h-4 w-4" />
          </label>
        </div>
      </div>
    </div>

    <div class="mt-6 flex justify-end gap-3">
      <button type="button" class="rounded-md border border-border px-4 py-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onclick={() => (showSettings = false)}>
        {t("browser_cancel")}
      </button>
      <button type="button" class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t("browser_saveSettings")}
      </button>
    </div>
  </Modal>
</div>

<style>
  /* Target child component panels that use their own class names */
  div > :global(.browser-panel),
  div > :global(.webfetch-panel) {
    height: 100%;
    overflow-y: auto;
  }
</style>
