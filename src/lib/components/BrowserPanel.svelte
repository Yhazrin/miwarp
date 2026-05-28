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

<div class="flex flex-col gap-4 p-4 bg-miwarp-bg-elevated rounded-lg max-h-full overflow-y-auto">
  <!-- Header -->
  <div class="flex justify-between items-center pb-2 border-b border-miwarp-border">
    <h3 class="m-0 text-xl font-semibold">{t("browser_automation")}</h3>
    <div class="flex items-center gap-2 text-sm">
      <span class="w-2 h-2 rounded-full {connected ? 'bg-miwarp-status-success' : 'bg-miwarp-status-error'}"></span>
      {connected ? t("browser_connected") : t("browser_disconnected")}
    </div>
  </div>

  <!-- Connection Section -->
  {#if !connected}
    <div class="p-3 bg-miwarp-bg-deepest rounded-md">
      <h4 class="mb-3 text-sm text-miwarp-text-secondary">{t("browser_connect")}</h4>
      <button type="button" class="rounded-lg px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer border-none transition-colors" onclick={handleConnectBrowser}>
        {t("browser_listBrowsers")}
      </button>

      {#if browsers.length > 0}
        <div class="flex flex-col gap-2 mt-3">
          {#each browsers as browser}
            <button type="button" class="flex items-center gap-3 p-3 bg-miwarp-bg-deepest border border-miwarp-border rounded-md cursor-pointer transition-all duration-150 hover:bg-miwarp-bg-surface hover:border-miwarp-accent-primary" onclick={() => browserStore.connect(browser)}>
              <span class="text-2xl">🌐</span>
              <div class="flex-1 flex flex-col">
                <span class="font-medium">{browser.displayName}</span>
                <span class="text-xs text-miwarp-text-secondary">{browser.platform}</span>
              </div>
              {#if browser.isThisComputer}
                <span class="px-2 py-1 bg-miwarp-status-success text-miwarp-accent-on-accent text-xs rounded">{t("browser_thisDevice")}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <!-- Browser Controls -->
    <div class="p-3 bg-miwarp-bg-deepest rounded-md">
      <!-- Back/Forward/Refresh -->
      <div class="flex gap-1">
        <button type="button" class="p-2 bg-transparent border border-miwarp-border cursor-pointer rounded transition-all duration-150 hover:not-disabled:bg-miwarp-bg-surface" onclick={handleGoBack} title={t("browser_goBack")} aria-label={t("browser_goBack")}> ← </button>
        <button type="button" class="p-2 bg-transparent border border-miwarp-border cursor-pointer rounded transition-all duration-150 hover:not-disabled:bg-miwarp-bg-surface" onclick={handleGoForward} title={t("browser_goForward")} aria-label={t("browser_goForward")}>
          →
        </button>
        <button type="button" class="p-2 bg-transparent border border-miwarp-border cursor-pointer rounded transition-all duration-150 hover:not-disabled:bg-miwarp-bg-surface" onclick={handleRefresh} title={t("browser_refresh")} aria-label={t("browser_refresh")}>
          ↻
        </button>
      </div>

      <!-- URL Bar -->
      <div class="flex gap-2 mt-2">
        <input
          type="text"
          bind:value={urlInput}
          placeholder={t("browser_enterUrl")}
          onkeydown={handleKeyDown}
          class="flex-1 p-2 bg-miwarp-bg-deepest border border-miwarp-border rounded text-miwarp-text-primary text-sm focus:outline-none focus:border-miwarp-accent-primary"
        />
        <button type="button" class="rounded-lg px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer border-none transition-colors" onclick={handleNavigate} disabled={isNavigating}>
          {isNavigating ? "..." : t("browser_go")}
        </button>
      </div>
    </div>

    <!-- Tabs -->
    <div class="p-2 bg-miwarp-bg-deepest rounded-md">
      <div class="flex gap-1 overflow-x-auto p-1">
        {#each tabs as tab}
          <button type="button"
            class="flex items-center gap-2 py-2 px-3 bg-transparent border border-transparent rounded text-miwarp-text-secondary cursor-pointer whitespace-nowrap max-w-[150px] transition-all duration-150 hover:bg-miwarp-bg-surface {tab.id === activeTabId ? 'bg-miwarp-accent-primary text-miwarp-accent-on-accent' : ''}"
            onclick={() => handleSelectTab(tab.id)}
          >
            <span class="overflow-hidden text-ellipsis">{tab.title || t("browser_newTab")}</span>
            <span
              class="px-1 bg-transparent border-none text-inherit cursor-pointer text-base opacity-70 hover:opacity-100"
              role="button"
              tabindex="0"
              aria-label={t("browser_closeTab")}
              onclick={(e) => handleCloseTab(tab.id, e)}
              onkeydown={(e) => {
                if (e.key === "Enter") handleCloseTab(tab.id, e);
              }}
            >
              ×
            </span>
          </button>
        {/each}
        <button type="button" class="p-2 bg-transparent border border-miwarp-border cursor-pointer rounded transition-all duration-150 hover:not-disabled:bg-miwarp-bg-surface shrink-0 text-xl" onclick={handleCreateTab} title={t("browser_newTab")} aria-label={t("browser_newTab")}>
          +
        </button>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="p-3 bg-miwarp-bg-deepest rounded-md flex gap-2 flex-wrap">
      {#each quickActions as action}
        <button type="button" class="rounded-lg px-4 py-2 text-sm bg-secondary text-secondary-foreground hover:bg-secondary/80 cursor-pointer border-none transition-colors" onclick={() => handleQuickAction(action.action)}>
          <span class="mr-1">{action.icon}</span>
          {action.label}
        </button>
      {/each}
    </div>

    <!-- Search -->
    <div class="p-3 bg-miwarp-bg-deepest rounded-md">
      <input
        id="search-input"
        type="text"
        bind:value={searchQuery}
        placeholder={t("browser_findElements")}
        class="flex-1 p-2 bg-miwarp-bg-deepest border border-miwarp-border rounded text-miwarp-text-primary text-sm focus:outline-none focus:border-miwarp-accent-primary"
      />
      <button type="button" class="rounded-lg px-4 py-2 text-sm bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer border-none transition-colors" onclick={handleFind} disabled={isFinding}>
        {isFinding ? "..." : t("browser_find")}
      </button>

      {#if foundElements.length > 0}
        <div class="mt-3 p-3 bg-miwarp-bg-deepest rounded">
          <h5 class="mb-2 text-sm text-miwarp-text-secondary">{t("browser_foundElements", { count: String(foundElements.length) })}</h5>
          {#each foundElements as element}
            <div class="flex gap-2 py-1 text-xs border-b border-miwarp-border">
              <span class="text-miwarp-accent-primary font-mono">{element.ref}</span>
              {#if element.text}
                <span class="text-miwarp-text-secondary overflow-hidden text-ellipsis">{element.text}</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Page Content Preview -->
    {#if pageContent}
      <div class="p-3 bg-miwarp-bg-deepest rounded-md max-h-[200px] overflow-hidden">
        <h4 class="mb-3 text-sm text-miwarp-text-secondary">{t("browser_pageContent")}</h4>
        <div class="max-h-[150px] overflow-auto bg-miwarp-bg-deepest rounded p-2">
          <pre class="m-0 text-xs whitespace-pre-wrap break-words">{pageContent.text.slice(0, 500)}{pageContent.text.length > 500
              ? "..."
              : ""}</pre>
        </div>
        <div class="mt-2 text-xs text-miwarp-text-secondary">
          {t("browser_elementsDetected", { count: String(pageContent.elements.length) })}
        </div>
      </div>
    {/if}

    <!-- Last Screenshot -->
    {#if browserStore.state.lastScreenshot}
      <div class="p-2 bg-miwarp-bg-deepest rounded-md">
        <h4 class="mb-3 text-sm text-miwarp-text-secondary">{t("browser_lastScreenshot")}</h4>
        <div class="flex justify-center">
          <img
            src={browserStore.state.lastScreenshot.imageUrl}
            alt={t("browser_pageScreenshot")}
            class="max-w-full max-h-[200px] rounded border border-miwarp-border"
          />
        </div>
      </div>
    {/if}
  {/if}

  <!-- Error Display -->
  {#if error}
    <div class="p-3 rounded-md flex items-center gap-2 bg-miwarp-status-error/10 border border-miwarp-status-error">
      <span class="text-xl">⚠️</span>
      <span class="flex-1 text-sm text-miwarp-status-error">{error}</span>
      <button type="button"
        class="p-2 bg-transparent border border-miwarp-border cursor-pointer rounded transition-all duration-150 hover:not-disabled:bg-miwarp-bg-surface"
        onclick={() => browserStore.dispatch({ type: "SET_ERROR", error: null })}
      >
        ×
      </button>
    </div>
  {/if}

  <!-- Loading Indicator -->
  {#if isLoading}
    <div class="flex items-center justify-center gap-2 p-4 bg-miwarp-overlay absolute inset-0">
      <span class="text-2xl animate-spin">⏳</span>
      <span>{t("browser_loading")}</span>
    </div>
  {/if}
</div>
