<script lang="ts">
  /**
   * WebFetch - Web content fetching and analysis component
   *
   * Provides UI for fetching web pages and extracting content.
   */
  import { t } from "$lib/i18n/index.svelte";

  interface WebFetchResult {
    content?: string;
    headers?: Record<string, string>;
    statusCode?: number;
  }

  const mcp__workspace__web_fetch = (
    globalThis as Record<string, unknown>
  ).mcp__workspace__web_fetch as
    | ((args: Record<string, unknown>) => Promise<WebFetchResult>)
    | undefined;

  let url = $state("");
  let isLoading = $state(false);
  let content = $state<string | null>(null);
  let error = $state<string | null>(null);
  let headers = $state<Record<string, string>>({});
  let statusCode = $state<number | null>(null);

  let fetchHistory = $state<string[]>([]);
  let showHeaders = $state(false);
  let contentType = $state<string>("");

  async function fetchUrl() {
    if (!url) return;

    // Auto-add protocol if missing
    let targetUrl = url;
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = "https://" + targetUrl;
    }

    isLoading = true;
    error = null;
    content = null;
    headers = {};
    statusCode = null;

    try {
      if (!mcp__workspace__web_fetch) {
        error = t("webfetch_unavailable");
        return;
      }

      const result = await mcp__workspace__web_fetch({
        url: targetUrl,
      });

      if (result) {
        content = result.content ?? null;
        headers = result.headers || {};
        statusCode = result.statusCode ?? null;
        contentType = headers["content-type"] || "";

        // Add to history
        if (!fetchHistory.includes(targetUrl)) {
          fetchHistory = [targetUrl, ...fetchHistory].slice(0, 10);
        }
      } else {
        error = t("webfetch_failed");
      }
    } catch (e) {
      error = e instanceof Error ? e.message : t("webfetch_unknownError");
    } finally {
      isLoading = false;
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      fetchUrl();
    }
  }

  function selectFromHistory(selectedUrl: string) {
    url = selectedUrl;
    fetchUrl();
  }

  function clearContent() {
    content = null;
    error = null;
    headers = {};
    statusCode = null;
  }

  function copyContent() {
    if (content) {
      navigator.clipboard.writeText(content);
    }
  }

  function formatContent(rawContent: string): string {
    // Try to format JSON
    if (contentType.includes("json")) {
      try {
        const parsed = JSON.parse(rawContent);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return rawContent;
      }
    }
    return rawContent;
  }

  let displayedContent = $derived(content ? formatContent(content) : "");
</script>

<div class="webfetch-panel">
  <!-- Header -->
  <div class="panel-header">
    <h3>{t("webfetch_title")}</h3>
    <span class="subtitle">{t("webfetch_subtitle")}</span>
  </div>

  <!-- URL Input -->
  <div class="fetch-form">
    <div class="url-input-group">
      <input
        type="text"
        bind:value={url}
        placeholder={t("webfetch_enterUrl")}
        onkeydown={handleKeyDown}
        class="url-input"
      />
      <button class="rounded-lg px-6 py-3 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer border-none transition-colors" onclick={fetchUrl} disabled={isLoading || !url}>
        {isLoading ? t("webfetch_fetching") : t("webfetch_fetch")}
      </button>
    </div>
  </div>

  <!-- History -->
  {#if fetchHistory.length > 0}
    <div class="history-section">
      <div class="history-header">
        <span class="history-label">{t("webfetch_recentUrls")}</span>
        <button class="text-muted-foreground hover:text-foreground text-sm px-2 py-1 bg-transparent border-none cursor-pointer transition-colors" onclick={() => (fetchHistory = [])}>
          {t("webfetch_clear")}
        </button>
      </div>
      <div class="history-list">
        {#each fetchHistory as historyUrl}
          <button class="history-item" onclick={() => selectFromHistory(historyUrl)}>
            {historyUrl}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Results -->
  {#if statusCode !== null}
    <div class="results-section">
      <div class="results-header">
        <h4>{t("webfetch_response")}</h4>
        <div class="results-meta">
          <span
            class="status-badge"
            class:success={statusCode < 400}
            class:error={statusCode >= 400}
          >
            {statusCode}
          </span>
          {#if contentType}
            <span class="content-type">{contentType.split(";")[0]}</span>
          {/if}
        </div>
      </div>

      <!-- Toggle Headers -->
      <button class="rounded-lg px-4 py-2 text-sm bg-secondary text-secondary-foreground hover:bg-secondary/80 cursor-pointer border-none transition-colors mb-3" onclick={() => (showHeaders = !showHeaders)}>
        {showHeaders ? t("webfetch_hideHeaders") : t("webfetch_showHeaders")}
      </button>

      <!-- Headers -->
      {#if showHeaders && Object.keys(headers).length > 0}
        <div class="headers-display">
          {#each Object.entries(headers) as [key, value]}
            <div class="header-row">
              <span class="header-key">{key}:</span>
              <span class="header-value">{value}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Content Display -->
  {#if content}
    <div class="content-section">
      <div class="content-header">
        <h4>{t("webfetch_content")}</h4>
        <div class="content-actions">
          <button class="text-muted-foreground hover:text-foreground text-sm px-2 py-1 bg-transparent border-none cursor-pointer transition-colors" onclick={copyContent}> {t("webfetch_copy")} </button>
          <button class="text-muted-foreground hover:text-foreground text-sm px-2 py-1 bg-transparent border-none cursor-pointer transition-colors" onclick={clearContent}> {t("webfetch_clear")} </button>
        </div>
      </div>
      <div class="content-display">
        <pre class="content-text">{displayedContent}</pre>
      </div>
    </div>
  {/if}

  <!-- Error Display -->
  {#if error}
    <div class="error-section">
      <span class="error-icon">⚠️</span>
      <span class="error-message">{error}</span>
      <button class="px-2 py-1 bg-transparent border-none text-muted-foreground hover:text-foreground cursor-pointer transition-colors" onclick={() => (error = null)} title={t("common_close")} aria-label={t("common_close")}> × </button>
    </div>
  {/if}

  <!-- Loading -->
  {#if isLoading}
    <div class="loading-section">
      <span class="loading-spinner">⏳</span>
      <span>{t("webfetch_fetchingContent")}</span>
    </div>
  {/if}
</div>

<style>
  .webfetch-panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    background: hsl(var(--miwarp-bg-surface));
    border-radius: 8px;
    max-height: 100%;
    overflow-y: auto;
  }

  .panel-header {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid hsl(var(--miwarp-border));
  }

  .panel-header h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .subtitle {
    font-size: 0.875rem;
    color: hsl(var(--miwarp-text-secondary));
  }

  .fetch-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .url-input-group {
    display: flex;
    gap: 0.5rem;
  }

  .url-input {
    flex: 1;
    padding: 0.75rem;
    background: hsl(var(--miwarp-bg-deepest));
    border: 1px solid hsl(var(--miwarp-border));
    border-radius: 4px;
    color: hsl(var(--miwarp-text-primary));
    font-size: 0.875rem;
  }

  .url-input:focus {
    outline: none;
    border-color: hsl(var(--miwarp-accent-primary));
  }

  .history-section {
    padding: 0.75rem;
    background: hsl(var(--miwarp-bg-deepest));
    border-radius: 6px;
  }

  .history-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .history-label {
    font-size: 0.875rem;
    color: hsl(var(--miwarp-text-secondary));
  }

  .history-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .history-item {
    padding: 0.25rem 0.5rem;
    background: hsl(var(--miwarp-bg-surface));
    border: 1px solid hsl(var(--miwarp-border));
    border-radius: 4px;
    color: hsl(var(--miwarp-text-primary));
    font-size: 0.75rem;
    cursor: pointer;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: background-color 0.15s ease, border-color 0.15s ease;
  }

  .history-item:hover {
    background: hsl(var(--miwarp-bg-elevated));
    border-color: hsl(var(--miwarp-accent-primary));
  }

  .results-section {
    padding: 0.75rem;
    background: hsl(var(--miwarp-bg-deepest));
    border-radius: 6px;
  }

  .results-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .results-header h4 {
    margin: 0;
    font-size: 0.875rem;
    color: hsl(var(--miwarp-text-secondary));
  }

  .results-meta {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .status-badge {
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .status-badge.success {
    background: hsl(var(--miwarp-status-success));
    color: hsl(var(--miwarp-accent-on-accent, 0 0% 100%));
  }

  .status-badge.error {
    background: hsl(var(--miwarp-status-error));
    color: hsl(var(--miwarp-accent-on-accent, 0 0% 100%));
  }

  .content-type {
    font-size: 0.75rem;
    color: hsl(var(--miwarp-text-secondary));
  }

  .headers-display {
    padding: 0.75rem;
    background: hsl(var(--miwarp-bg-surface));
    border-radius: 4px;
    max-height: 150px;
    overflow: auto;
  }

  .header-row {
    display: flex;
    gap: 0.5rem;
    padding: 0.25rem 0;
    font-size: 0.75rem;
    border-bottom: 1px solid hsl(var(--miwarp-border));
  }

  .header-key {
    color: hsl(var(--miwarp-accent-primary));
    font-weight: 500;
    min-width: 150px;
  }

  .header-value {
    color: hsl(var(--miwarp-text-secondary));
    word-break: break-all;
  }

  .content-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .content-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .content-header h4 {
    margin: 0;
    font-size: 0.875rem;
    color: hsl(var(--miwarp-text-secondary));
  }

  .content-actions {
    display: flex;
    gap: 0.5rem;
  }

  .content-display {
    flex: 1;
    background: hsl(var(--miwarp-bg-deepest));
    border-radius: 6px;
    overflow: auto;
    max-height: 300px;
  }

  .content-text {
    margin: 0;
    padding: 0.75rem;
    font-size: 0.75rem;
    font-family: "Courier New", monospace;
    white-space: pre-wrap;
    word-break: break-word;
    color: hsl(var(--miwarp-text-primary));
  }

  .error-section {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: hsl(var(--miwarp-status-error) / 0.1);
    border: 1px solid hsl(var(--miwarp-status-error));
    border-radius: 6px;
  }

  .error-icon {
    font-size: 1.25rem;
  }

  .error-message {
    flex: 1;
    font-size: 0.875rem;
    color: hsl(var(--miwarp-status-error));
  }

  .loading-section {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1.5rem;
    color: hsl(var(--miwarp-text-secondary));
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
