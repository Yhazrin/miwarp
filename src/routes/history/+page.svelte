<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { slide } from "svelte/transition";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { searchRuns } from "$lib/api";
  import type { RunSearchFilters, RunSearchResponse } from "$lib/types";
  import { t } from "$lib/i18n/index.svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { formatCostDisplay, relativeTime } from "$lib/utils/format";
  import Spinner from "$lib/components/Spinner.svelte";
  import SkeletonLine from "$lib/components/SkeletonLine.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";

  let filters = $state<RunSearchFilters>({});
  let response = $state<RunSearchResponse | null>(null);
  let loading = $state(true);
  let error = $state("");
  let showAdvancedFilters = $state(false);
  let requestId = 0;
  let searchInput = $state("");
  let searchMode = $state<"keyword" | "semantic">("keyword");
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Active status filter (quick pills)
  let activeStatusFilter = $state<string>("all");
  let stableTools = $state<{ value: string; count: number }[]>([]);

  const PAGE_SIZE = 50;

  // Derived display values
  let totalCostDisplay = $derived.by(() => {
    if (!response) return "$0.00";
    return `$${response.facets.totalCost.toFixed(2)}`;
  });

  function projectDisplayName(cwd: string): string {
    const parts = cwd.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || cwd;
  }

  const formatCost = formatCostDisplay;

  function statusColor(status: string): string {
    switch (status) {
      case "completed":
        return "bg-miwarp-status-success";
      case "failed":
        return "bg-miwarp-status-error";
      case "stopped":
        return "bg-miwarp-status-warning";
      case "running":
        return "bg-miwarp-status-info";
      case "idle":
        return "bg-miwarp-status-success";
      default:
        return "bg-muted-foreground/30";
    }
  }

  async function loadData(append = false) {
    const id = ++requestId;
    if (!append) loading = true;
    error = "";

    try {
      // Build API request from user-intent filters — never write back to `filters`
      const requestFilters: RunSearchFilters = {
        ...filters,
        limit: PAGE_SIZE,
        offset: append && response ? response.results.length : 0,
        // Explicitly set or clear statuses based on pill selection
        statuses:
          activeStatusFilter !== "all"
            ? [
                activeStatusFilter as
                  | "completed"
                  | "failed"
                  | "stopped"
                  | "running"
                  | "pending"
                  | "idle",
              ]
            : undefined,
      };

      dbg("history", "loadData", requestFilters);
      const res = await searchRuns(requestFilters);

      if (id !== requestId) return; // stale

      if (append && response) {
        response = {
          ...res,
          results: [...response.results, ...res.results],
        };
      } else {
        response = res;
      }

      // Capture stable tool order on first load (facets are computed from ALL entries)
      if (stableTools.length === 0 && res.facets?.tools?.length) {
        stableTools = res.facets.tools;
      }
    } catch (e) {
      if (id !== requestId) return;
      error = String(e);
      dbgWarn("history", "loadData error", e);
    } finally {
      if (id === requestId) loading = false;
    }
  }

  function onSearchInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      filters = { ...filters, query: searchInput || undefined };
      loadData();
    }, 300);
  }

  function onStatusFilter(status: string) {
    activeStatusFilter = status;
    loadData();
  }

  function onSortChange(field: "date" | "cost" | "tokens" | "turns") {
    if (filters.sortBy === field) {
      filters = { ...filters, sortAsc: !(filters.sortAsc ?? false) };
    } else {
      filters = { ...filters, sortBy: field, sortAsc: false };
    }
    loadData();
  }

  function onProjectFilter(project: string | undefined) {
    filters = { ...filters, projects: project ? [project] : undefined };
    loadData();
  }

  function onAgentFilter(agent: string | undefined) {
    filters = { ...filters, agents: agent ? [agent] : undefined };
    loadData();
  }

  function onToolToggle(tool: string) {
    const current = filters.tools ?? [];
    const next = current.includes(tool) ? current.filter((t) => t !== tool) : [...current, tool];
    filters = { ...filters, tools: next.length > 0 ? next : undefined };
    loadData();
  }

  let activeDateRange = $state<string>("all");

  function onDateRange(range: string) {
    activeDateRange = range;
    if (range === "all") {
      filters = { ...filters, dateFrom: undefined, dateTo: undefined };
    } else {
      const now = new Date();
      const to = now.toISOString().slice(0, 10);
      let from: string;
      if (range === "today") {
        from = to;
      } else if (range === "7d") {
        const d = new Date(now);
        d.setDate(d.getDate() - 6);
        from = d.toISOString().slice(0, 10);
      } else if (range === "30d") {
        const d = new Date(now);
        d.setDate(d.getDate() - 29);
        from = d.toISOString().slice(0, 10);
      } else {
        // 90d
        const d = new Date(now);
        d.setDate(d.getDate() - 89);
        from = d.toISOString().slice(0, 10);
      }
      filters = { ...filters, dateFrom: from, dateTo: to };
    }
    loadData();
  }

  function onCostChange(field: "costMin" | "costMax", value: string) {
    const num = value ? parseFloat(value) : undefined;
    filters = { ...filters, [field]: num };
    loadData();
  }

  function clearFilters() {
    filters = {};
    searchInput = "";
    activeStatusFilter = "all";
    activeDateRange = "all";
    stableTools = [];
    showAdvancedFilters = false;
    loadData();
  }

  function goToRun(runId: string) {
    goto(`/chat?run=${runId}`);
  }

  onMount(() => {
    // Read initial query from URL
    const q = $page.url.searchParams.get("q");
    if (q) {
      searchInput = q;
      filters = { query: q };
    }
    loadData();
  });

  onDestroy(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
  });
</script>

<div class="flex h-full flex-col overflow-hidden">
  <!-- Header -->
  <div class="shrink-0 px-6 py-4">
    <h1 class="text-xl font-semibold text-sidebar-foreground">{t("history_title")}</h1>
    <p class="mt-1 text-sm text-sidebar-foreground/70">{t("history_subtitle")}</p>
  </div>

  <div class="flex-1 overflow-y-auto px-6 py-4">
    <!-- Search + Filter toggle -->
    <div class="mb-4 flex items-center gap-3">
      <div class="relative flex-1">
        <Icon
          name="search"
          class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sidebar-foreground/70"
        />
        <input
          type="text"
          bind:value={searchInput}
          oninput={onSearchInput}
          placeholder={searchMode === "semantic"
            ? t("history_searchPlaceholderSemantic")
            : t("history_searchPlaceholder")}
          class="w-full rounded-lg border border-sidebar-border bg-sidebar py-2 pl-10 pr-4 text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <div
        class="flex items-center rounded-lg border border-sidebar-border text-xs overflow-hidden"
      >
        <button
          type="button"
          onclick={() => {
            searchMode = "keyword";
          }}
          class="px-2.5 py-1.5 transition-colors {searchMode === 'keyword'
            ? 'bg-primary text-primary-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50'}"
        >
          {t("history_searchKeyword")}
        </button>
        <button
          type="button"
          onclick={() => {
            searchMode = "semantic";
          }}
          class="px-2.5 py-1.5 transition-colors {searchMode === 'semantic'
            ? 'bg-primary text-primary-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50'}"
          title={t("history_searchSemanticTooltip")}
        >
          {t("history_searchSemantic")}
          <span class="ml-0.5 text-[9px] opacity-70">&#946;</span>
        </button>
      </div>
      <button
        type="button"
        onclick={() => (showAdvancedFilters = !showAdvancedFilters)}
        class="flex items-center gap-1.5 rounded-lg border border-sidebar-border px-3 py-2 text-sm transition-colors {showAdvancedFilters
          ? 'bg-primary/10 text-primary'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50'}"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
        </svg>
        {showAdvancedFilters ? t("history_filtersHide") : t("history_filters")}
      </button>
    </div>

    <!-- Status pills -->
    <div class="mb-4 flex flex-wrap gap-2">
      {#each [{ key: "all", label: t("history_allStatuses") }, { key: "completed", label: t("history_statusCompleted") }, { key: "failed", label: t("history_statusFailed") }, { key: "stopped", label: t("history_statusStopped") }, { key: "running", label: t("history_statusRunning") }, { key: "idle", label: t("history_statusDone") }] as pill}
        <button
          type="button"
          onclick={() => onStatusFilter(pill.key)}
          class="rounded-full px-3 py-1 text-xs font-medium transition-colors {activeStatusFilter ===
          pill.key
            ? 'bg-primary text-primary-foreground'
            : 'bg-sidebar-accent/30 text-sidebar-foreground/70 hover:bg-sidebar-accent/50'}"
        >
          {pill.label}
        </button>
      {/each}
    </div>

    <!-- Advanced filters (collapsible) -->
    {#if showAdvancedFilters}
      <div
        class="mb-4 rounded-lg border border-sidebar-border bg-sidebar-accent/20 p-4"
        transition:slide={{ duration: 200 }}
      >
        <!-- Row 1: Dropdowns + Date range -->
        <div class="grid grid-cols-4 gap-3">
          <!-- Project -->
          <div>
            <label
              for="history-project-filter"
              class="mb-1.5 block text-xs font-medium text-sidebar-foreground/70"
              >{t("history_project")}</label
            >
            <div class="relative">
              <select
                id="history-project-filter"
                onchange={(e) => onProjectFilter(e.currentTarget.value || undefined)}
                class="h-8 w-full appearance-none rounded-md border border-sidebar-border bg-sidebar px-2.5 pr-7 text-[13px] text-sidebar-foreground transition-colors hover:border-sidebar-foreground/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                <option value="">{t("history_allProjects")}</option>
                {#if response?.facets}
                  {#each response.facets.projects as p}
                    <option value={p.value}>{projectDisplayName(p.value)} ({p.count})</option>
                  {/each}
                {/if}
              </select>
              <svg
                class="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground/70"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg
              >
            </div>
          </div>

          <!-- Agent -->
          <div>
            <label
              for="history-agent-filter"
              class="mb-1.5 block text-xs font-medium text-sidebar-foreground/70"
              >{t("history_agent")}</label
            >
            <div class="relative">
              <select
                id="history-agent-filter"
                onchange={(e) => onAgentFilter(e.currentTarget.value || undefined)}
                class="h-8 w-full appearance-none rounded-md border border-sidebar-border bg-sidebar px-2.5 pr-7 text-[13px] text-sidebar-foreground transition-colors hover:border-sidebar-foreground/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                <option value="">{t("history_allAgents")}</option>
                {#if response?.facets}
                  {#each response.facets.agents as a}
                    <option value={a.value}>{a.value} ({a.count})</option>
                  {/each}
                {/if}
              </select>
              <svg
                class="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground/70"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg
              >
            </div>
          </div>

          <!-- Date range presets -->
          <div class="col-span-2">
            <span class="mb-1.5 block text-xs font-medium text-sidebar-foreground/70"
              >{t("history_dateRange")}</span
            >
            <div class="flex gap-1">
              {#each [{ key: "all", label: t("history_dateAll") }, { key: "today", label: t("history_dateToday") }, { key: "7d", label: t("history_date7d") }, { key: "30d", label: t("history_date30d") }, { key: "90d", label: t("history_date90d") }] as opt}
                <button
                  type="button"
                  onclick={() => onDateRange(opt.key)}
                  class="h-8 rounded-md px-3 text-[13px] transition-colors {activeDateRange ===
                  opt.key
                    ? 'bg-sidebar-foreground/10 text-sidebar-foreground font-medium'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'}"
                >
                  {opt.label}
                </button>
              {/each}
            </div>
          </div>
        </div>

        <!-- Row 2: Cost range -->
        <div class="mt-3 grid grid-cols-4 gap-3">
          <div>
            <label
              for="history-cost-min"
              class="mb-1.5 block text-xs font-medium text-sidebar-foreground/70"
              >{t("history_costMin")}</label
            >
            <div class="relative">
              <span
                class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-sidebar-foreground/70"
                >$</span
              >
              <input
                id="history-cost-min"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                onchange={(e) => onCostChange("costMin", e.currentTarget.value)}
                class="h-8 w-full rounded-md border border-sidebar-border bg-sidebar pl-6 pr-2.5 text-[13px] text-sidebar-foreground transition-colors hover:border-sidebar-foreground/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
          </div>
          <div>
            <label
              for="history-cost-max"
              class="mb-1.5 block text-xs font-medium text-sidebar-foreground/70"
              >{t("history_costMax")}</label
            >
            <div class="relative">
              <span
                class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-sidebar-foreground/70"
                >$</span
              >
              <input
                id="history-cost-max"
                type="number"
                step="0.01"
                min="0"
                placeholder="∞"
                onchange={(e) => onCostChange("costMax", e.currentTarget.value)}
                class="h-8 w-full rounded-md border border-sidebar-border bg-sidebar pl-6 pr-2.5 text-[13px] text-sidebar-foreground transition-colors hover:border-sidebar-foreground/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
          </div>
          <!-- Clear filters button -->
          <div class="col-span-2 flex items-end justify-end">
            <button
              type="button"
              onclick={clearFilters}
              class="rounded-md px-3 py-1 text-xs text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              {t("history_clearFilters")}
            </button>
          </div>
        </div>

        <!-- Row 3: Tool chips -->
        {#if stableTools.length}
          <div class="mt-3 border-t border-sidebar-border/50 pt-3">
            <span class="mb-2 block text-xs font-medium text-sidebar-foreground/70"
              >{t("history_tools")}</span
            >
            <div class="flex flex-wrap gap-1.5">
              {#each stableTools as tool (tool.value)}
                <button
                  type="button"
                  onclick={() => onToolToggle(tool.value)}
                  class="rounded-md px-2 py-1 text-xs transition-colors {filters.tools?.includes(
                    tool.value,
                  )
                    ? 'bg-primary/15 text-primary border border-primary/30 font-medium'
                    : 'bg-sidebar-accent/50 text-sidebar-foreground/70 border border-transparent hover:bg-sidebar-accent hover:text-sidebar-foreground'}"
                >
                  {tool.value}
                  <span class="ml-0.5 text-sidebar-foreground/70">{tool.count}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Summary bar (always visible once we have data; subtle opacity during reload) -->
    {#if response}
      <div
        class="mb-3 flex items-center justify-between text-sm text-sidebar-foreground/70 transition-opacity"
        class:opacity-50={loading}
      >
        <span>
          {t("history_runsMatching", { count: String(response.totalMatching) })} · {totalCostDisplay}
          {t("history_totalCost")}
        </span>

        <!-- Sort buttons -->
        <div class="flex items-center gap-1">
          {#each [{ key: "date", label: t("history_sortDate") }, { key: "cost", label: t("history_sortCost") }, { key: "tokens", label: t("history_sortTokens") }, { key: "turns", label: t("history_sortTurns") }] as sortOpt}
            <button
              type="button"
              onclick={() => onSortChange(sortOpt.key as "date" | "cost" | "tokens" | "turns")}
              class="rounded px-2 py-0.5 text-xs transition-colors {filters.sortBy ===
                sortOpt.key ||
              (!filters.sortBy && sortOpt.key === 'date')
                ? 'bg-sidebar-accent/50 text-sidebar-foreground'
                : 'hover:bg-sidebar-accent/50'}"
            >
              {sortOpt.label}
              {#if filters.sortBy === sortOpt.key || (!filters.sortBy && sortOpt.key === "date")}
                <span class="ml-0.5">{filters.sortAsc ? "\u2191" : "\u2193"}</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Initial loading spinner (only when no data yet) -->
    {#if loading && !response}
      <div class="space-y-2">
        {#each Array(6) as _}
          <div class="rounded-lg border border-sidebar-border/50 bg-sidebar/50 p-3 space-y-2">
            <div class="flex items-center justify-between">
              <SkeletonLine width="40%" height="0.875rem" />
              <SkeletonLine width="4rem" height="1rem" rounded="rounded-full" />
            </div>
            <SkeletonLine width="60%" height="0.625rem" />
          </div>
        {/each}
      </div>
    {:else if error}
      <div
        class="rounded-lg border border-[hsl(var(--miwarp-status-error)/0.2)] bg-[hsl(var(--miwarp-status-error)/0.1)] p-4 text-sm text-miwarp-status-error"
      >
        {error}
      </div>
    {:else if response && response.results.length === 0 && !loading}
      <EmptyState iconName="search" title={t("history_noResults")} />
    {:else if response}
      <!-- Run cards (subtle opacity during reload to avoid layout jump) -->
      <div class="space-y-2 transition-opacity" class:opacity-50={loading}>
        {#each response.results as run}
          <button
            type="button"
            onclick={() => goToRun(run.runId)}
            class="w-full rounded-lg border border-sidebar-border bg-sidebar p-4 text-left transition-colors hover:bg-sidebar-accent/30"
          >
            <div class="flex items-start justify-between gap-3">
              <!-- Left side -->
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="h-2 w-2 shrink-0 rounded-full {statusColor(run.status)}"></span>
                  <span class="truncate text-sm font-medium text-sidebar-foreground">
                    {run.name || run.promptPreview || t("history_untitled")}
                  </span>
                  {#if run.hasErrors}
                    <span
                      class="rounded bg-[hsl(var(--miwarp-status-error)/0.15)] px-1.5 py-0.5 text-[10px] font-medium text-miwarp-status-error"
                    >
                      {t("history_errors")}
                    </span>
                  {/if}
                </div>
                <div class="mt-1 flex items-center gap-2 text-xs text-sidebar-foreground/70">
                  <span>{projectDisplayName(run.cwd)}</span>
                  <span>·</span>
                  <span>{relativeTime(run.startedAt)}</span>
                  {#if run.model}
                    <span>·</span>
                    <span>{run.model}</span>
                  {/if}
                </div>
                <!-- Tool chips -->
                {#if run.toolsUsed.length > 0}
                  <div class="mt-2 flex flex-wrap gap-1">
                    {#each run.toolsUsed.slice(0, 6) as tool}
                      <span
                        class="rounded bg-sidebar-accent px-1.5 py-0.5 text-[10px] text-sidebar-foreground/70"
                      >
                        {tool}
                      </span>
                    {/each}
                    {#if run.toolsUsed.length > 6}
                      <span
                        class="rounded bg-sidebar-accent px-1.5 py-0.5 text-[10px] text-sidebar-foreground/70"
                      >
                        +{run.toolsUsed.length - 6}
                      </span>
                    {/if}
                  </div>
                {/if}
              </div>

              <!-- Right side -->
              <div class="shrink-0 text-right">
                <div class="text-sm font-medium text-sidebar-foreground">
                  {formatCost(run.totalCostUsd)}
                </div>
                <div class="mt-0.5 text-xs text-sidebar-foreground/70">
                  {t("history_turns", { count: String(run.numTurns) })}
                </div>
                {#if run.filesTouchedCount > 0}
                  <div class="text-xs text-sidebar-foreground/70">
                    {t("history_files", { count: String(run.filesTouchedCount) })}
                  </div>
                {/if}
              </div>
            </div>
          </button>
        {/each}
      </div>

      <!-- Load more -->
      {#if response.results.length < response.totalMatching}
        <div class="mt-4 flex justify-center">
          <button
            type="button"
            onclick={() => loadData(true)}
            class="rounded-lg border border-sidebar-border px-4 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50 transition-colors"
            disabled={loading}
          >
            {#if loading}
              <Spinner size="sm" class="border-primary/30 border-t-transparent" />
            {:else}
              {t("history_loadMore")}
            {/if}
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>
