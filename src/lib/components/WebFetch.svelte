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

<div class="flex flex-col gap-4 p-4 bg-miwarp-bg-surface rounded-lg max-h-full overflow-y-auto">
  <!-- Header -->
  <div class="flex flex-col gap-1 pb-2 border-b border-miwarp-border">
    <h3 class="m-0 text-xl font-semibold">{t("webfetch_title")}</h3>
    <span class="text-sm text-miwarp-text-secondary">{t("webfetch_subtitle")}</span>
  </div>

  <!-- URL Input -->
  <div class="flex flex-col gap-2">
    <div class="flex gap-2">
      <input
        type="text"
        bind:value={url}
        placeholder={t("webfetch_enterUrl")}
        onkeydown={handleKeyDown}
        class="flex-1 p-3 bg-miwarp-bg-deepest border border-miwarp-border rounded text-miwarp-text-primary text-sm focus:outline-none focus:border-miwarp-accent-primary"
      />
      <button type="button" class="rounded-lg px-6 py-3 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer border-none transition-colors" onclick={fetchUrl} disabled={isLoading || !url}>
        {isLoading ? t("webfetch_fetching") : t("webfetch_fetch")}
      </button>
    </div>
  </div>

  <!-- History -->
  {#if fetchHistory.length > 0}
    <div class="p-3 bg-miwarp-bg-deepest rounded-md">
      <div class="flex justify-between items-center mb-2">
        <span class="text-sm text-miwarp-text-secondary">{t("webfetch_recentUrls")}</span>
        <button type="button" class="text-muted-foreground hover:text-foreground text-sm px-2 py-1 bg-transparent border-none cursor-pointer transition-colors" onclick={() => (fetchHistory = [])}>
          {t("webfetch_clear")}
        </button>
      </div>
      <div class="flex flex-wrap gap-2">
        {#each fetchHistory as historyUrl}
          <button type="button" class="px-2 py-1 bg-miwarp-bg-surface border border-miwarp-border rounded text-miwarp-text-primary text-xs cursor-pointer max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap transition-all duration-150 hover:bg-miwarp-bg-elevated hover:border-miwarp-accent-primary" onclick={() => selectFromHistory(historyUrl)}>
            {historyUrl}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Results -->
  {#if statusCode !== null}
    <div class="p-3 bg-miwarp-bg-deepest rounded-md">
      <div class="flex justify-between items-center mb-2">
        <h4 class="m-0 text-sm text-miwarp-text-secondary">{t("webfetch_response")}</h4>
        <div class="flex gap-2 items-center">
          <span
            class="px-2 py-1 rounded text-xs font-semibold {statusCode < 400 ? 'bg-miwarp-status-success text-miwarp-accent-on-accent' : 'bg-miwarp-status-error text-miwarp-accent-on-accent'}"
          >
            {statusCode}
          </span>
          {#if contentType}
            <span class="text-xs text-miwarp-text-secondary">{contentType.split(";")[0]}</span>
          {/if}
        </div>
      </div>

      <!-- Toggle Headers -->
      <button type="button" class="rounded-lg px-4 py-2 text-sm bg-secondary text-secondary-foreground hover:bg-secondary/80 cursor-pointer border-none transition-colors mb-3" onclick={() => (showHeaders = !showHeaders)}>
        {showHeaders ? t("webfetch_hideHeaders") : t("webfetch_showHeaders")}
      </button>

      <!-- Headers -->
      {#if showHeaders && Object.keys(headers).length > 0}
        <div class="p-3 bg-miwarp-bg-surface rounded max-h-[150px] overflow-auto">
          {#each Object.entries(headers) as [key, value]}
            <div class="flex gap-2 py-1 text-xs border-b border-miwarp-border">
              <span class="text-miwarp-accent-primary font-medium min-w-[150px]">{key}:</span>
              <span class="text-miwarp-text-secondary break-all">{value}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Content Display -->
  {#if content}
    <div class="flex-1 flex flex-col min-h-0">
      <div class="flex justify-between items-center mb-2">
        <h4 class="m-0 text-sm text-miwarp-text-secondary">{t("webfetch_content")}</h4>
        <div class="flex gap-2">
          <button type="button" class="text-muted-foreground hover:text-foreground text-sm px-2 py-1 bg-transparent border-none cursor-pointer transition-colors" onclick={copyContent}> {t("webfetch_copy")} </button>
          <button type="button" class="text-muted-foreground hover:text-foreground text-sm px-2 py-1 bg-transparent border-none cursor-pointer transition-colors" onclick={clearContent}> {t("webfetch_clear")} </button>
        </div>
      </div>
      <div class="flex-1 bg-miwarp-bg-deepest rounded-md overflow-auto max-h-[300px]">
        <pre class="m-0 p-3 text-xs font-[Courier_New,monospace] whitespace-pre-wrap break-words text-miwarp-text-primary">{displayedContent}</pre>
      </div>
    </div>
  {/if}

  <!-- Error Display -->
  {#if error}
    <div class="flex items-center gap-2 p-3 bg-miwarp-status-error/10 border border-miwarp-status-error rounded-md">
      <span class="text-xl">⚠️</span>
      <span class="flex-1 text-sm text-miwarp-status-error">{error}</span>
      <button type="button" class="px-2 py-1 bg-transparent border-none text-muted-foreground hover:text-foreground cursor-pointer transition-colors" onclick={() => (error = null)} title={t("common_close")} aria-label={t("common_close")}> × </button>
    </div>
  {/if}

  <!-- Loading -->
  {#if isLoading}
    <div class="flex items-center justify-center gap-2 p-6 text-miwarp-text-secondary">
      <span class="text-2xl animate-spin">⏳</span>
      <span>{t("webfetch_fetchingContent")}</span>
    </div>
  {/if}
</div>
