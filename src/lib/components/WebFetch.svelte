<script lang="ts">
  /**
   * WebFetch - Web content fetching and analysis component
   *
   * Provides UI for fetching web pages and extracting content.
   */
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const mcp__workspace__web_fetch = (globalThis as any).mcp__workspace__web_fetch as (
    args: any,
  ) => Promise<any>;

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
      const result = await mcp__workspace__web_fetch({
        url: targetUrl,
      });

      if (result) {
        content = result.content;
        headers = result.headers || {};
        statusCode = result.statusCode;
        contentType = headers["content-type"] || "";

        // Add to history
        if (!fetchHistory.includes(targetUrl)) {
          fetchHistory = [targetUrl, ...fetchHistory].slice(0, 10);
        }
      } else {
        error = "Failed to fetch URL";
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Unknown error occurred";
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
    <h3>Web Fetch</h3>
    <span class="subtitle">Fetch and analyze web content</span>
  </div>

  <!-- URL Input -->
  <div class="fetch-form">
    <div class="url-input-group">
      <input
        type="text"
        bind:value={url}
        placeholder="Enter URL to fetch..."
        onkeydown={handleKeyDown}
        class="url-input"
      />
      <button class="btn btn-primary" onclick={fetchUrl} disabled={isLoading || !url}>
        {isLoading ? "Fetching..." : "Fetch"}
      </button>
    </div>
  </div>

  <!-- History -->
  {#if fetchHistory.length > 0}
    <div class="history-section">
      <div class="history-header">
        <span class="history-label">Recent URLs</span>
        <button class="btn btn-text" onclick={() => (fetchHistory = [])}> Clear </button>
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
        <h4>Response</h4>
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
      <button class="btn btn-secondary toggle-headers" onclick={() => (showHeaders = !showHeaders)}>
        {showHeaders ? "Hide" : "Show"} Headers
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
        <h4>Content</h4>
        <div class="content-actions">
          <button class="btn btn-text" onclick={copyContent}> Copy </button>
          <button class="btn btn-text" onclick={clearContent}> Clear </button>
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
      <button class="btn btn-icon" onclick={() => (error = null)}> × </button>
    </div>
  {/if}

  <!-- Loading -->
  {#if isLoading}
    <div class="loading-section">
      <span class="loading-spinner">⏳</span>
      <span>Fetching content...</span>
    </div>
  {/if}
</div>

<style>
  .webfetch-panel {
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
    flex-direction: column;
    gap: 0.25rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--color-border, #333);
  }

  .panel-header h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .subtitle {
    font-size: 0.875rem;
    color: var(--color-text-secondary, #888);
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
    background: var(--color-background, #0a0a0a);
    border: 1px solid var(--color-border, #333);
    border-radius: 4px;
    color: var(--color-text, white);
    font-size: 0.875rem;
  }

  .url-input:focus {
    outline: none;
    border-color: var(--color-primary, #6366f1);
  }

  .btn {
    padding: 0.75rem 1.5rem;
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

  .btn-text {
    background: transparent;
    color: var(--color-text-secondary, #888);
    padding: 0.25rem 0.5rem;
  }

  .btn-text:hover {
    color: var(--color-text, white);
  }

  .btn-icon {
    padding: 0.25rem 0.5rem;
    background: transparent;
    border: none;
    color: var(--color-text-secondary, #888);
    cursor: pointer;
  }

  .btn-icon:hover {
    color: var(--color-text, white);
  }

  .history-section {
    padding: 0.75rem;
    background: var(--color-background, #0a0a0a);
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
    color: var(--color-text-secondary, #888);
  }

  .history-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .history-item {
    padding: 0.25rem 0.5rem;
    background: var(--color-surface, #1a1a1a);
    border: 1px solid var(--color-border, #333);
    border-radius: 4px;
    color: var(--color-text, white);
    font-size: 0.75rem;
    cursor: pointer;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-item:hover {
    background: var(--color-hover, #222);
    border-color: var(--color-primary, #6366f1);
  }

  .results-section {
    padding: 0.75rem;
    background: var(--color-background, #0a0a0a);
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
    color: var(--color-text-secondary, #888);
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
    background: var(--color-success, #44ff44);
    color: black;
  }

  .status-badge.error {
    background: var(--color-error, #ff4444);
    color: white;
  }

  .content-type {
    font-size: 0.75rem;
    color: var(--color-text-secondary, #888);
  }

  .toggle-headers {
    margin-bottom: 0.75rem;
  }

  .headers-display {
    padding: 0.75rem;
    background: var(--color-surface, #1a1a1a);
    border-radius: 4px;
    max-height: 150px;
    overflow: auto;
  }

  .header-row {
    display: flex;
    gap: 0.5rem;
    padding: 0.25rem 0;
    font-size: 0.75rem;
    border-bottom: 1px solid var(--color-border, #333);
  }

  .header-key {
    color: var(--color-primary, #6366f1);
    font-weight: 500;
    min-width: 150px;
  }

  .header-value {
    color: var(--color-text-secondary, #888);
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
    color: var(--color-text-secondary, #888);
  }

  .content-actions {
    display: flex;
    gap: 0.5rem;
  }

  .content-display {
    flex: 1;
    background: var(--color-background, #0a0a0a);
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
    color: var(--color-text, white);
  }

  .error-section {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: rgba(255, 68, 68, 0.1);
    border: 1px solid var(--color-error, #ff4444);
    border-radius: 6px;
  }

  .error-icon {
    font-size: 1.25rem;
  }

  .error-message {
    flex: 1;
    font-size: 0.875rem;
    color: var(--color-error, #ff4444);
  }

  .loading-section {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1.5rem;
    color: var(--color-text-secondary, #888);
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
