<script lang="ts">
  /**
   * BrowserPanel - Main browser automation control panel
   *
   * Provides UI for browser connection, navigation, and automation controls.
   */
  import { browserStore } from "$lib/stores/browser-store.svelte";
  import { t } from "$lib/i18n/index.svelte";

  let urlInput = $state("");
  let searchQuery = $state("");
  let isNavigating = $state(false);
  let isFinding = $state(false);
  let foundElements = $state<Array<{ ref: string; text?: string }>>([]);

  // Quick actions
  let quickActions = [
    { label: t("browser_quickScreenshot"), icon: "📷", action: "screenshot" },
    { label: t("browser_quickFindElements"), icon: "🔍", action: "find" },
    { label: t("browser_quickNetwork"), icon: "🌐", action: "network" },
    { label: t("browser_quickConsole"), icon: "💻", action: "console" },
  ];

  // Tabs list
  let tabs = $derived(browserStore.state.tabs);
  let activeTabId = $derived(browserStore.state.activeTabId);
  let pageContent = $derived(browserStore.state.pageContent);
  let isLoading = $derived(browserStore.state.isLoading);
  let error = $derived(browserStore.state.error);
  let browsers = $derived(browserStore.state.browsers);
  let connected = $derived(browserStore.state.connected);

  // Navigation
  async function handleNavigate() {
    if (!urlInput) return;

    // Auto-add protocol if missing
    let targetUrl = urlInput;
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = "https://" + targetUrl;
    }

    isNavigating = true;
    await browserStore.navigate(targetUrl);
    urlInput = "";
    isNavigating = false;
  }

  async function handleFind() {
    if (!searchQuery) return;

    isFinding = true;
    foundElements = await browserStore.findElements(searchQuery);
    isFinding = false;
  }

  async function handleQuickAction(action: string) {
    switch (action) {
      case "screenshot":
        await browserStore.takeScreenshot();
        break;
      case "find": {
        // Focus search input
        const searchInput = document.querySelector("#search-input") as HTMLInputElement;
        searchInput?.focus();
        break;
      }
      case "network": {
        await browserStore.getNetworkRequests();
        break;
      }
      case "console": {
        await browserStore.getConsoleMessages();
        break;
      }
    }
  }

  async function handleSelectTab(tabId: number) {
    await browserStore.setActiveTab(tabId);
  }

  async function handleCreateTab() {
    await browserStore.createNewTab();
  }

  async function handleCloseTab(tabId: number, event: Event) {
    event.stopPropagation();
    if (tabs.length > 1) {
      await browserStore.closeCurrentTab();
    }
  }

  async function handleGoBack() {
    await browserStore.goBack();
  }

  async function handleGoForward() {
    await browserStore.goForward();
  }

  async function handleRefresh() {
    await browserStore.refresh();
  }

  async function handleConnectBrowser() {
    await browserStore.refreshBrowsers();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      handleNavigate();
    }
  }
</script>

<div class="browser-panel">
  <!-- Header -->
  <div class="panel-header">
    <h3>{t("browser_automation")}</h3>
    <div class="connection-status" class:connected>
      <span class="status-dot"></span>
      {connected ? t("browser_connected") : t("browser_disconnected")}
    </div>
  </div>

  <!-- Connection Section -->
  {#if !connected}
    <div class="section">
      <h4>{t("browser_connect")}</h4>
      <button class="btn btn-primary" onclick={handleConnectBrowser}>
        {t("browser_listBrowsers")}
      </button>

      {#if browsers.length > 0}
        <div class="browser-list">
          {#each browsers as browser}
            <button class="browser-item" onclick={() => browserStore.connect(browser)}>
              <span class="browser-icon">🌐</span>
              <div class="browser-info">
                <span class="browser-name">{browser.displayName}</span>
                <span class="browser-platform">{browser.platform}</span>
              </div>
              {#if browser.isThisComputer}
                <span class="badge">{t("browser_thisDevice")}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <!-- Browser Controls -->
    <div class="section navigation-section">
      <!-- Back/Forward/Refresh -->
      <div class="nav-controls">
        <button class="btn btn-icon" onclick={handleGoBack} title={t("browser_goBack")}> ← </button>
        <button class="btn btn-icon" onclick={handleGoForward} title={t("browser_goForward")}>
          →
        </button>
        <button class="btn btn-icon" onclick={handleRefresh} title={t("browser_refresh")}>
          ↻
        </button>
      </div>

      <!-- URL Bar -->
      <div class="url-bar">
        <input
          type="text"
          bind:value={urlInput}
          placeholder={t("browser_enterUrl")}
          onkeydown={handleKeyDown}
          class="url-input"
        />
        <button class="btn btn-primary" onclick={handleNavigate} disabled={isNavigating}>
          {isNavigating ? "..." : t("browser_go")}
        </button>
      </div>
    </div>

    <!-- Tabs -->
    <div class="section tabs-section">
      <div class="tabs-list">
        {#each tabs as tab}
          <button
            class="tab-item"
            class:active={tab.id === activeTabId}
            onclick={() => handleSelectTab(tab.id)}
          >
            <span class="tab-title">{tab.title || t("browser_newTab")}</span>
            <span
              class="tab-close"
              role="button"
              tabindex="0"
              onclick={(e) => handleCloseTab(tab.id, e)}
              onkeydown={(e) => {
                if (e.key === "Enter") handleCloseTab(tab.id, e);
              }}
            >
              ×
            </span>
          </button>
        {/each}
        <button class="btn btn-icon add-tab" onclick={handleCreateTab} title={t("browser_newTab")}>
          +
        </button>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="section quick-actions">
      {#each quickActions as action}
        <button class="btn btn-secondary" onclick={() => handleQuickAction(action.action)}>
          <span class="action-icon">{action.icon}</span>
          {action.label}
        </button>
      {/each}
    </div>

    <!-- Search -->
    <div class="section search-section">
      <input
        id="search-input"
        type="text"
        bind:value={searchQuery}
        placeholder={t("browser_findElements")}
        class="search-input"
      />
      <button class="btn btn-secondary" onclick={handleFind} disabled={isFinding}>
        {isFinding ? "..." : t("browser_find")}
      </button>

      {#if foundElements.length > 0}
        <div class="found-elements">
          <h5>{t("browser_foundElements", { count: String(foundElements.length) })}</h5>
          {#each foundElements as element}
            <div class="element-item">
              <span class="element-ref">{element.ref}</span>
              {#if element.text}
                <span class="element-text">{element.text}</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Page Content Preview -->
    {#if pageContent}
      <div class="section content-section">
        <h4>{t("browser_pageContent")}</h4>
        <div class="content-preview">
          <pre class="content-text">{pageContent.text.slice(0, 500)}{pageContent.text.length > 500
              ? "..."
              : ""}</pre>
        </div>
        <div class="element-count">
          {t("browser_elementsDetected", { count: String(pageContent.elements.length) })}
        </div>
      </div>
    {/if}

    <!-- Last Screenshot -->
    {#if browserStore.state.lastScreenshot}
      <div class="section screenshot-section">
        <h4>{t("browser_lastScreenshot")}</h4>
        <div class="screenshot-preview">
          <img
            src={browserStore.state.lastScreenshot.imageUrl}
            alt={t("browser_pageScreenshot")}
            class="screenshot-image"
          />
        </div>
      </div>
    {/if}
  {/if}

  <!-- Error Display -->
  {#if error}
    <div class="section error-section">
      <span class="error-icon">⚠️</span>
      <span class="error-text">{error}</span>
      <button
        class="btn btn-icon"
        onclick={() => browserStore.dispatch({ type: "SET_ERROR", error: null })}
      >
        ×
      </button>
    </div>
  {/if}

  <!-- Loading Indicator -->
  {#if isLoading}
    <div class="loading-overlay">
      <span class="loading-spinner">⏳</span>
      <span>{t("browser_loading")}</span>
    </div>
  {/if}
</div>

<style>
  .browser-panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    background: var(--color-surface, #1a1a1a);
    border-radius: 8px;
    max-height: 100%;
    overflow-y: auto;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--color-border, #333);
  }

  .panel-header h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .connection-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-error, #ff4444);
  }

  .connection-status.connected .status-dot {
    background: var(--color-success, #44ff44);
  }

  .section {
    padding: 0.75rem;
    background: var(--color-background, #0a0a0a);
    border-radius: 6px;
  }

  .section h4 {
    margin: 0 0 0.75rem 0;
    font-size: 0.875rem;
    color: var(--color-text-secondary, #888);
  }

  .btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--color-primary, #6366f1);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--color-primary-hover, #4f46e5);
  }

  .btn-secondary {
    background: var(--color-secondary, #333);
    color: white;
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--color-secondary-hover, #444);
  }

  .btn-icon {
    padding: 0.5rem;
    background: transparent;
    border: 1px solid var(--color-border, #333);
  }

  .btn-icon:hover:not(:disabled) {
    background: var(--color-hover, #222);
  }

  .browser-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .browser-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--color-background, #0a0a0a);
    border: 1px solid var(--color-border, #333);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .browser-item:hover {
    background: var(--color-hover, #222);
    border-color: var(--color-primary, #6366f1);
  }

  .browser-icon {
    font-size: 1.5rem;
  }

  .browser-info {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .browser-name {
    font-weight: 500;
  }

  .browser-platform {
    font-size: 0.75rem;
    color: var(--color-text-secondary, #888);
  }

  .badge {
    padding: 0.25rem 0.5rem;
    background: var(--color-success, #44ff44);
    color: black;
    font-size: 0.75rem;
    border-radius: 4px;
  }

  .nav-controls {
    display: flex;
    gap: 0.25rem;
  }

  .url-bar {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .url-input,
  .search-input {
    flex: 1;
    padding: 0.5rem;
    background: var(--color-background, #0a0a0a);
    border: 1px solid var(--color-border, #333);
    border-radius: 4px;
    color: var(--color-text, white);
    font-size: 0.875rem;
  }

  .url-input:focus,
  .search-input:focus {
    outline: none;
    border-color: var(--color-primary, #6366f1);
  }

  .tabs-section {
    padding: 0.5rem;
  }

  .tabs-list {
    display: flex;
    gap: 0.25rem;
    overflow-x: auto;
    padding: 0.25rem;
  }

  .tab-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--color-text-secondary, #888);
    cursor: pointer;
    white-space: nowrap;
    max-width: 150px;
    transition: all 0.2s;
  }

  .tab-item:hover {
    background: var(--color-hover, #222);
  }

  .tab-item.active {
    background: var(--color-primary, #6366f1);
    color: white;
  }

  .tab-title {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-close {
    padding: 0 0.25rem;
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 1rem;
    opacity: 0.7;
  }

  .tab-close:hover {
    opacity: 1;
  }

  .add-tab {
    flex-shrink: 0;
    font-size: 1.25rem;
  }

  .quick-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .action-icon {
    margin-right: 0.25rem;
  }

  .found-elements {
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: var(--color-background, #0a0a0a);
    border-radius: 4px;
  }

  .found-elements h5 {
    margin: 0 0 0.5rem 0;
    font-size: 0.875rem;
    color: var(--color-text-secondary, #888);
  }

  .element-item {
    display: flex;
    gap: 0.5rem;
    padding: 0.25rem 0;
    font-size: 0.75rem;
    border-bottom: 1px solid var(--color-border, #333);
  }

  .element-ref {
    color: var(--color-primary, #6366f1);
    font-family: monospace;
  }

  .element-text {
    color: var(--color-text-secondary, #888);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .content-section {
    max-height: 200px;
    overflow: hidden;
  }

  .content-preview {
    max-height: 150px;
    overflow: auto;
    background: var(--color-background, #0a0a0a);
    border-radius: 4px;
    padding: 0.5rem;
  }

  .content-text {
    margin: 0;
    font-size: 0.75rem;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .element-count {
    margin-top: 0.5rem;
    font-size: 0.75rem;
    color: var(--color-text-secondary, #888);
  }

  .screenshot-section {
    padding: 0.5rem;
  }

  .screenshot-preview {
    display: flex;
    justify-content: center;
  }

  .screenshot-image {
    max-width: 100%;
    max-height: 200px;
    border-radius: 4px;
    border: 1px solid var(--color-border, #333);
  }

  .error-section {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: hsl(var(--miwarp-status-error, 0 72% 60%) / 0.1);
    border: 1px solid hsl(var(--miwarp-status-error, 0 72% 60%));
  }

  .error-icon {
    font-size: 1.25rem;
  }

  .error-text {
    flex: 1;
    font-size: 0.875rem;
    color: hsl(var(--miwarp-status-error, 0 72% 60%));
  }

  .loading-overlay {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1rem;
    background: hsl(var(--miwarp-overlay, 0 0% 0% / 0.55));
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
  }

  .loading-spinner {
    font-size: 1.5rem;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
