<script lang="ts">
  /**
   * Browser Management Page
   *
   * Full-featured browser automation interface for web scraping,
   * testing, and automated workflows.
   */
  import BrowserPanel from "$lib/components/BrowserPanel.svelte";
  import WebFetch from "$lib/components/WebFetch.svelte";
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
      <button class="btn btn-icon" onclick={() => (showSettings = !showSettings)}> ⚙️ </button>
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

  <!-- Settings Panel -->
  {#if showSettings}
    <div class="settings-overlay" onclick={() => (showSettings = false)}>
      <div class="settings-panel" onclick={(e) => e.stopPropagation()}>
        <div class="settings-header">
          <h2>{t("browser_settings")}</h2>
          <button class="btn btn-icon" onclick={() => (showSettings = false)}> × </button>
        </div>
        <div class="settings-content">
          <div class="settings-section">
            <h3>{t("browser_mcp")}</h3>
            <div class="setting-item">
              <label>
                <input type="checkbox" checked />
                <span>{t("browser_autoConnect")}</span>
              </label>
            </div>
            <div class="setting-item">
              <label>
                <span>{t("browser_viewportWidth")}</span>
                <input type="number" value="1920" class="setting-input" />
              </label>
            </div>
            <div class="setting-item">
              <label>
                <span>{t("browser_viewportHeight")}</span>
                <input type="number" value="1080" class="setting-input" />
              </label>
            </div>
          </div>

          <div class="settings-section">
            <h3>{t("browser_screenshot")}</h3>
            <div class="setting-item">
              <label>
                <input type="checkbox" checked />
                <span>{t("browser_autoSave")}</span>
              </label>
            </div>
            <div class="setting-item">
              <label>
                <span>{t("browser_format")}</span>
                <select class="setting-input">
                  <option value="png">PNG</option>
                  <option value="jpeg">JPEG</option>
                  <option value="webp">WebP</option>
                </select>
              </label>
            </div>
          </div>

          <div class="settings-section">
            <h3>{t("browser_webfetch")}</h3>
            <div class="setting-item">
              <label>
                <span>{t("browser_timeout")}</span>
                <input type="number" value="30000" class="setting-input" />
              </label>
            </div>
            <div class="setting-item">
              <label>
                <input type="checkbox" />
                <span>{t("browser_followRedirects")}</span>
              </label>
            </div>
          </div>
        </div>
        <div class="settings-footer">
          <button class="btn btn-secondary" onclick={() => (showSettings = false)}>
            {t("browser_cancel")}
          </button>
          <button class="btn btn-primary"> {t("browser_saveSettings")} </button>
        </div>
      </div>
    </div>
  {/if}
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
    color: var(--color-text-secondary, #888);
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
    background: var(--color-background, #0a0a0a);
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
    color: var(--color-text-secondary, #888);
    cursor: pointer;
    transition: all 0.2s;
  }

  .tab-button:hover {
    background: var(--color-hover, #222);
    color: var(--color-text, white);
  }

  .tab-button.active {
    background: var(--color-primary, #6366f1);
    color: white;
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

  .settings-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
    padding: 2rem;
  }

  .settings-panel {
    background: var(--color-surface, #1a1a1a);
    border-radius: 12px;
    width: 100%;
    max-width: 500px;
    max-height: 80vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .settings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem;
    border-bottom: 1px solid var(--color-border, #333);
  }

  .settings-header h2 {
    margin: 0;
    font-size: 1.25rem;
  }

  .settings-content {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem;
  }

  .settings-section {
    margin-bottom: 1.5rem;
  }

  .settings-section:last-child {
    margin-bottom: 0;
  }

  .settings-section h3 {
    margin: 0 0 1rem 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text-secondary, #888);
  }

  .setting-item {
    margin-bottom: 1rem;
  }

  .setting-item:last-child {
    margin-bottom: 0;
  }

  .setting-item label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .setting-item input[type="checkbox"] {
    width: 16px;
    height: 16px;
  }

  .setting-item span {
    font-size: 0.875rem;
  }

  .setting-input {
    width: 150px;
    padding: 0.5rem;
    background: var(--color-background, #0a0a0a);
    border: 1px solid var(--color-border, #333);
    border-radius: 4px;
    color: var(--color-text, white);
    font-size: 0.875rem;
  }

  .setting-input:focus {
    outline: none;
    border-color: var(--color-primary, #6366f1);
  }

  .settings-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    border-top: 1px solid var(--color-border, #333);
  }

  .btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s;
  }

  .btn-icon {
    padding: 0.5rem;
    background: transparent;
    border: 1px solid var(--color-border, #333);
    font-size: 1.25rem;
  }

  .btn-icon:hover {
    background: var(--color-hover, #222);
  }

  .btn-primary {
    background: var(--color-primary, #6366f1);
    color: white;
  }

  .btn-primary:hover {
    background: var(--color-primary-hover, #4f46e5);
  }

  .btn-secondary {
    background: var(--color-secondary, #333);
    color: white;
  }

  .btn-secondary:hover {
    background: var(--color-secondary-hover, #444);
  }
</style>
