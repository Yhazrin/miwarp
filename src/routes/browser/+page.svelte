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

  let activeTab = $state<"browser" | "webfetch">("browser");
  let showSettings = $state(false);

  let tabs = [
    { id: "browser", label: t("browser_automation"), icon: "🌐" },
    { id: "webfetch", label: t("webfetch_title"), icon: "📡" },
  ];
</script>

<svelte:head>
  <title>{t("browser_title")}</title>
</svelte:head>

<div class="browser-page">
  <!-- Header -->
  <div class="page-header">
    <div class="header-left">
      <h1>{t("browser_automation")}</h1>
      <p class="description">{t("browser_description")}</p>
    </div>
    <div class="header-actions">
      <button class="btn btn-icon" title={t("browser_settings")} aria-label={t("browser_settings")} onclick={() => (showSettings = !showSettings)}> ⚙️ </button>
    </div>
  </div>

  <!-- Tab Navigation -->
  <div class="tab-navigation">
    {#each tabs as tab}
      <button
        class="tab-button"
        class:active={activeTab === tab.id}
        onclick={() => (activeTab = tab.id as "browser" | "webfetch")}
      >
        <span class="tab-icon">{tab.icon}</span>
        <span class="tab-label">{tab.label}</span>
      </button>
    {/each}
  </div>

  <!-- Content Area -->
  <div class="content-area">
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
      <button class="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent transition-colors" onclick={() => (showSettings = false)}>
        {t("browser_cancel")}
      </button>
      <button class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
        {t("browser_saveSettings")}
      </button>
    </div>
  </Modal>
</div>

<style>
  .browser-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 1.5rem;
    gap: 1rem;
    overflow: hidden;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-shrink: 0;
  }

  .header-left h1 {
    margin: 0 0 0.25rem 0;
    font-size: 1.75rem;
    font-weight: 600;
  }

  .description {
    margin: 0;
    font-size: 0.875rem;
    color: hsl(var(--miwarp-text-secondary, 220 10% 62%));
  }

  .header-actions {
    display: flex;
    gap: 0.5rem;
  }

  .tab-navigation {
    display: flex;
    gap: 0.5rem;
    flex-shrink: 0;
    padding: 0.25rem;
    background: hsl(var(--miwarp-bg-deepest, 220 18% 6%));
    border-radius: 8px;
    width: fit-content;
  }

  .tab-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: hsl(var(--miwarp-text-secondary, 220 10% 62%));
    cursor: pointer;
    transition: all 0.2s;
  }

  .tab-button:hover {
    background: hsl(var(--miwarp-bg-hover, 220 10% 21%));
    color: hsl(var(--miwarp-text-primary, 0 0% 94%));
  }

  .tab-button.active {
    background: hsl(var(--miwarp-accent-primary, 210 100% 60%));
    color: hsl(var(--miwarp-accent-on-accent, 0 0% 100%));
  }

  .tab-icon {
    font-size: 1.25rem;
  }

  .tab-label {
    font-size: 0.875rem;
    font-weight: 500;
  }

  .content-area {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .content-area :global(.browser-panel),
  .content-area :global(.webfetch-panel) {
    height: 100%;
    overflow-y: auto;
  }

  .btn-icon {
    padding: 0.5rem;
    background: transparent;
    border: 1px solid hsl(var(--miwarp-border, 220 10% 25%));
    border-radius: 6px;
    font-size: 1.25rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-icon:hover {
    background: hsl(var(--miwarp-bg-hover, 220 10% 21%));
  }
</style>
