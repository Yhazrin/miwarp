<script lang="ts">
  import {
    getSemanticSearch,
    type SearchResult,
    detectLanguage,
  } from "$lib/services/semantic-search/index";
  import { t } from "$lib/i18n/index.svelte";

  let {
    cwd = "",
    onSelectResult,
    class: className = "",
  }: {
    cwd?: string;
    onSelectResult?: (result: SearchResult) => void;
    class?: string;
  } = $props();

  const search = getSemanticSearch();

  let query = $state("");
  let results = $state<SearchResult[]>([]);
  let isSearching = $state(false);
  let showResults = $state(false);
  let stats = $state({ documentCount: 0, uniqueTerms: 0, avgTokensPerDoc: 0 });

  // Debounced search
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;

  function handleInput() {
    if (searchTimeout) clearTimeout(searchTimeout);

    if (query.length < 2) {
      results = [];
      showResults = false;
      return;
    }

    searchTimeout = setTimeout(() => {
      performSearch();
    }, 300);
  }

  function performSearch() {
    isSearching = true;

    try {
      results = search.search(query, {
        maxResults: 10,
        minScore: 0.1,
        includeSnippets: true,
        snippetLength: 120,
      });
      stats = search.getStats();
      showResults = true;
    } finally {
      isSearching = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      showResults = false;
      query = "";
    }
  }

  function selectResult(result: SearchResult) {
    onSelectResult?.(result);
    showResults = false;
    query = "";
  }

  function highlightMatch(text: string, query: string): string {
    if (!query) return text;

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    return text.replace(regex, '<mark class="bg-yellow-500/30">$1</mark>');
  }

  function getLanguageIcon(lang: string): string {
    const icons: Record<string, string> = {
      typescript: "🔷",
      javascript: "🟨",
      python: "🐍",
      rust: "🦀",
      go: "🐹",
      java: "☕",
      csharp: "🔶",
      cpp: "🔵",
    };
    return icons[lang] || "📄";
  }
</script>

<div class="semantic-search {className}">
  <!-- Search input -->
  <div class="relative">
    <div class="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg border border-border/50">
      <svg
        class="w-4 h-4 text-muted-foreground"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>

      <input
        type="text"
        bind:value={query}
        oninput={handleInput}
        onkeydown={handleKeydown}
        placeholder={t("semantic.searchPlaceholder") || "Search code with natural language..."}
        class="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
      />

      {#if isSearching}
        <div
          class="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin"
        ></div>
      {:else if query.length > 0}
        <button
          class="text-muted-foreground hover:text-foreground"
          onclick={() => {
            query = "";
            showResults = false;
          }}
        >
          <svg
            class="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      {/if}
    </div>

    <!-- Results dropdown -->
    {#if showResults && results.length > 0}
      <div
        class="absolute top-full left-0 right-0 mt-2 bg-popover border border-border rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto"
      >
        <div
          class="px-3 py-2 border-b border-border/50 flex items-center justify-between text-xs text-muted-foreground"
        >
          <span>{results.length} results</span>
          <span>{stats.documentCount} files indexed</span>
        </div>

        {#each results as result (result.document.id)}
          <button
            class="w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors border-b border-border/30 last:border-b-0"
            onclick={() => selectResult(result)}
          >
            <div class="flex items-start gap-2">
              <span class="text-base flex-shrink-0"
                >{getLanguageIcon(result.document.language)}</span
              >
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-foreground truncate">
                    {result.document.path.split("/").pop()}
                  </span>
                  <span class="text-xs text-muted-foreground truncate">
                    {result.document.path}
                  </span>
                </div>

                {#if result.snippet}
                  <div class="mt-1 text-xs text-muted-foreground line-clamp-2">
                    {@html highlightMatch(result.snippet, query)}
                  </div>
                {/if}

                <div class="mt-1 flex items-center gap-2">
                  <span class="text-xs text-primary font-mono">
                    {result.score.toFixed(2)} match
                  </span>
                  <span class="text-xs text-muted-foreground">
                    {result.document.lineCount} lines
                  </span>
                </div>
              </div>
            </div>
          </button>
        {/each}
      </div>
    {/if}

    {#if showResults && results.length === 0 && query.length >= 2}
      <div
        class="absolute top-full left-0 right-0 mt-2 p-4 bg-popover border border-border rounded-lg shadow-xl z-50"
      >
        <div class="text-center text-sm text-muted-foreground">
          {t("semantic.noResults") || "No results found for your query"}
        </div>
      </div>
    {/if}
  </div>

  <!-- Stats bar (when expanded) -->
  {#if stats.documentCount > 0}
    <div class="mt-2 text-xs text-muted-foreground flex items-center gap-4">
      <span>{stats.documentCount} files indexed</span>
      <span>·</span>
      <span>{stats.uniqueTerms} terms</span>
      <span>·</span>
      <span>{stats.avgTokensPerDoc.toFixed(0)} avg tokens/doc</span>
    </div>
  {/if}
</div>

<style>
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .animate-spin {
    animation: spin 0.8s linear infinite;
  }
</style>
