<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import * as api from "$lib/api";
  import type { UsageOverview, DailyAggregate } from "$lib/types";
  import { formatCost, formatTokenCount } from "$lib/utils/format";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import Card from "$lib/components/Card.svelte";
  import HeatmapCalendar from "$lib/components/HeatmapCalendar.svelte";
  import StackedModelChart from "$lib/components/StackedModelChart.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import SkeletonLine from "$lib/components/SkeletonLine.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { fmtDate, fmtNumber } from "$lib/i18n/format";

  let data = $state<UsageOverview | null>(null);
  let loading = $state(true);
  let error = $state("");
  let selectedDays = $state<number | undefined>(undefined); // undefined = all
  let heatmapDaily = $state<DailyAggregate[] | null>(null);
  let heatmapRequestId = 0;

  /** "app" = MiWarp runs only, "global" = all Claude Code sessions */
  let scope = $state<"app" | "global">("global");

  /** Monotonic counter to discard stale responses on rapid tab switching. */
  let requestId = 0;

  /** Whether to show the delayed first-load message (full scan taking > 500ms). */
  let showFullScanMessage = $state(false);

  /** Whether cache clear + rescan is in progress. */
  let refreshing = $state(false);

  const DATE_RANGES = [
    { label: "1d", days: 1 },
    { label: "7d", days: 7 },
    { label: "30d", days: 30 },
    { label: "90d", days: 90 },
    { label: "All", days: undefined as number | undefined },
  ];

  // Default chart mode: "messages" for global, "cost" for app
  let chartMode = $state<"cost" | "tokens" | "messages" | "sessions">("messages");

  let maxDailyValue = $derived.by(() => {
    if (!data?.daily.length) return 1;
    if (chartMode === "cost") {
      return Math.max(...data.daily.map((d) => d.costUsd), 0.01);
    }
    if (chartMode === "messages") {
      return Math.max(...data.daily.map((d) => d.messageCount ?? 0), 1);
    }
    if (chartMode === "sessions") {
      return Math.max(...data.daily.map((d) => d.sessionCount ?? 0), 1);
    }
    return Math.max(...data.daily.map((d) => d.inputTokens + d.outputTokens), 1);
  });

  // Sort state for run history
  let sortCol = $state<"date" | "cost" | "tokens" | "turns">("date");
  let sortAsc = $state(false);

  let sortedRuns = $derived.by(() => {
    if (!data?.runs) return [];
    const runs = [...data.runs];
    runs.sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "date":
          cmp = a.startedAt.localeCompare(b.startedAt);
          break;
        case "cost":
          cmp = a.totalCostUsd - b.totalCostUsd;
          break;
        case "tokens":
          cmp = a.inputTokens + a.outputTokens - (b.inputTokens + b.outputTokens);
          break;
        case "turns":
          cmp = a.numTurns - b.numTurns;
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return runs;
  });

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) {
      sortAsc = !sortAsc;
    } else {
      sortCol = col;
      sortAsc = false;
    }
  }

  function sortIndicator(col: typeof sortCol): string {
    if (sortCol !== col) return "";
    return sortAsc ? " \u25B2" : " \u25BC";
  }

  async function loadData(days?: number) {
    const thisRequest = ++requestId;
    if (!data) loading = true; // Only show full spinner on initial load
    error = "";
    showFullScanMessage = false;

    // Delayed indicator: show message if full scan takes > 500ms
    const delayTimer = setTimeout(() => {
      if (thisRequest === requestId) {
        showFullScanMessage = true;
      }
    }, 500);

    try {
      let result: UsageOverview;
      if (scope === "global") {
        result = await api.getGlobalUsageOverview(days);
      } else {
        result = await api.getUsageOverview(days);
      }

      // Discard stale response if user switched tabs/scope while we were loading
      if (thisRequest !== requestId) {
        dbg("usage", "discarded stale response", { thisRequest, currentRequest: requestId });
        return;
      }

      data = result;
      dbg("usage", "loadData", {
        scope,
        days,
        scanMode: data?.scanMode,
        dailyLen: data?.daily.length,
        firstDaily: data?.daily[0],
        totalRuns: data?.totalRuns,
        byModelLen: data?.byModel.length,
      });
    } catch (e) {
      if (thisRequest !== requestId) return;
      error = String(e);
    } finally {
      clearTimeout(delayTimer);
      if (thisRequest === requestId) {
        loading = false;
        showFullScanMessage = false;
      }
    }
  }

  async function loadHeatmapData() {
    const token = ++heatmapRequestId;
    try {
      const result = await api.getHeatmapDaily(scope);
      if (token === heatmapRequestId) {
        heatmapDaily = result;
        dbg("usage", "heatmap loaded", { scope, days: result.length });
      } else {
        dbg("usage", "heatmap discarded stale", { token, current: heatmapRequestId });
      }
    } catch (e) {
      if (token === heatmapRequestId) {
        heatmapDaily = null;
        dbgWarn("usage", "heatmap load failed", e);
      }
    }
  }

  function selectRange(days: number | undefined) {
    selectedDays = days;
    loadData(days);
  }

  function selectScope(s: "app" | "global") {
    scope = s;
    // Reset chart mode if current mode isn't available for this scope
    if (s === "app" && (chartMode === "messages" || chartMode === "sessions")) {
      chartMode = "cost";
    }
    loadData(selectedDays);
    loadHeatmapData();
  }

  async function refreshCache() {
    if (refreshing) return;
    refreshing = true;
    try {
      await api.clearUsageCache();
      await Promise.all([loadData(selectedDays), loadHeatmapData()]);
    } finally {
      refreshing = false;
    }
  }

  function formatDate(isoStr: string): string {
    return fmtDate(isoStr);
  }

  function formatShortDate(dateStr: string): string {
    // dateStr is "YYYY-MM-DD"
    return dateStr.slice(5); // "MM-DD"
  }

  function getDailyValue(day: DailyAggregate): number {
    if (chartMode === "cost") return day.costUsd;
    if (chartMode === "messages") return day.messageCount ?? 0;
    if (chartMode === "sessions") return day.sessionCount ?? 0;
    return day.inputTokens + day.outputTokens;
  }

  function getDailyTooltip(day: DailyAggregate): string {
    const date = day.date;
    if (chartMode === "cost") return `${date}\n${formatCost(day.costUsd)}`;
    if (chartMode === "messages")
      return `${date}\n${t("usage_tooltipMessages", { count: fmtNumber(day.messageCount ?? 0) })}`;
    if (chartMode === "sessions")
      return `${date}\n${t("usage_tooltipSessions", { count: String(day.sessionCount ?? 0) })}`;
    return `${date}\n${t("usage_tooltipTokens", { count: formatTokenCount(day.inputTokens + day.outputTokens) })}`;
  }

  function formatAxisValue(v: number): string {
    if (chartMode === "cost") return formatCost(v);
    if (chartMode === "tokens") return formatTokenCount(v);
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return v.toFixed(0);
  }

  onMount(() => {
    loadData(selectedDays);
    loadHeatmapData();
  });
</script>

<div class="h-full flex flex-col overflow-y-auto scrollbar-hide">
  <div class="max-w-[90%] mx-auto p-6 space-y-5 animate-slide-up flex-1">
    <!-- Scope tabs: App / Global -->
    <div class="flex items-center gap-4">
      <div class="flex gap-1 bg-sidebar-accent/30 rounded-lg p-0.5">
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-medium rounded-md transition-colors
          {scope === 'global'
            ? 'bg-sidebar text-sidebar-foreground shadow-sm'
            : 'text-sidebar-foreground/70 hover:text-sidebar-foreground'}"
          onclick={() => selectScope("global")}
        >
          {t("usage_scopeGlobal")}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-medium rounded-md transition-colors
          {scope === 'app'
            ? 'bg-sidebar text-sidebar-foreground shadow-sm'
            : 'text-sidebar-foreground/70 hover:text-sidebar-foreground'}"
          onclick={() => selectScope("app")}
        >
          {t("usage_scopeApp")}
        </button>
      </div>

      <!-- Date range tabs -->
      <div class="flex gap-1">
        {#each DATE_RANGES as range}
          <button
            type="button"
            class="px-3 py-1.5 text-xs font-medium rounded-md transition-colors
            {selectedDays === range.days
              ? 'bg-primary text-primary-foreground'
              : 'bg-sidebar-accent/50 text-sidebar-foreground/70 hover:bg-sidebar-accent'}"
            onclick={() => selectRange(range.days)}
          >
            {range.label}
          </button>
        {/each}
      </div>

      <!-- Refresh button (global scope only, stays in DOM to avoid layout shift) -->
      <button
        type="button"
        class="p-1.5 rounded-md text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors disabled:opacity-40 {scope !==
        'global'
          ? 'invisible'
          : ''}"
        title={t("usage_refreshTitle")}
        aria-label={t("usage_refreshTitle")}
        disabled={refreshing || scope !== "global"}
        onclick={refreshCache}
      >
        <Icon name="refresh-cw" size="md" class={refreshing ? "animate-spin" : ""} />
      </button>
    </div>

    {#if loading}
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {#each Array(4) as _}
            <div
              class="rounded-lg border border-sidebar-border/50 bg-sidebar/50 p-4 flex flex-col items-center gap-2"
            >
              <SkeletonLine width="4rem" height="2rem" rounded="rounded-md" />
              <SkeletonLine width="5rem" height="0.5rem" />
            </div>
          {/each}
        </div>
        <div class="rounded-lg border border-sidebar-border/50 bg-sidebar/50 p-4">
          <SkeletonLine width="8rem" height="1rem" class="mb-3" />
          <div class="grid grid-cols-7 gap-1">
            {#each Array(49) as _}
              <SkeletonLine height="1.25rem" rounded="rounded-sm" />
            {/each}
          </div>
        </div>
        {#if showFullScanMessage}
          <p class="text-sm text-sidebar-foreground/70 animate-fade-in text-center">
            {t("usage_firstLoadMessage")}
          </p>
        {/if}
      </div>
    {:else if error}
      <div
        class="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center justify-between gap-3"
      >
        <span>{error}</span>
        <button
          type="button"
          class="shrink-0 rounded-md border border-destructive/30 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
          onclick={() => loadData()}
        >
          {t("common_retry")}
        </button>
      </div>
    {:else if data}
      <!-- Summary cards -->
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card class="p-4 flex flex-col items-center justify-center text-center gap-1">
          <p class="text-3xl font-bold tabular-nums tracking-tight">
            {formatCost(data.totalCostUsd)}
          </p>
          <p class="text-[10px] text-sidebar-foreground/70 font-medium uppercase tracking-wider">
            {t("usage_totalCost")}
          </p>
        </Card>
        <Card class="p-4 flex flex-col items-center justify-center text-center gap-1">
          <p class="text-3xl font-bold tabular-nums tracking-tight">
            {formatTokenCount(data.totalTokens)}
          </p>
          <p class="text-[10px] text-sidebar-foreground/70 font-medium uppercase tracking-wider">
            {t("usage_totalTokens")}
          </p>
        </Card>
        <Card class="p-4 flex flex-col items-center justify-center text-center gap-1">
          <p class="text-3xl font-bold tabular-nums tracking-tight">{data.totalRuns}</p>
          <p class="text-[10px] text-sidebar-foreground/70 font-medium uppercase tracking-wider">
            {scope === "global" ? t("usage_sessions") : t("usage_runs")}
          </p>
        </Card>
        <Card class="p-4 flex flex-col items-center justify-center text-center gap-1">
          {#if data.currentStreak > 0}
            <p class="text-3xl font-bold tabular-nums tracking-tight">
              {data.currentStreak}<span
                class="text-base font-normal text-sidebar-foreground/70 ml-0.5">d</span
              >
            </p>
            <p class="text-[10px] text-sidebar-foreground/70 font-medium uppercase tracking-wider">
              {t("usage_currentStreak", { count: String(data.longestStreak) })}
            </p>
          {:else}
            <p class="text-3xl font-bold tabular-nums tracking-tight">
              {data.activeDays}<span class="text-base font-normal text-sidebar-foreground/70 ml-0.5"
                >d</span
              >
            </p>
            <p class="text-[10px] text-sidebar-foreground/70 font-medium uppercase tracking-wider">
              {scope === "global" ? t("usage_sessions") : t("usage_runs")}
            </p>
          {/if}
        </Card>
      </div>

      <!-- Activity Heatmap (always 52 weeks, independent of date filter) -->
      {#if heatmapDaily}
        <Card class="p-6 space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-sidebar-foreground/70 uppercase tracking-wider">
              {t("usage_activityHeatmap")}
            </h2>
            <div class="flex gap-3 text-xs text-sidebar-foreground/70">
              {#if data.activeDays > 0}
                <span>{t("usage_activeDays", { count: String(data.activeDays) })}</span>
              {/if}
              {#if data.longestStreak > 0}
                <span>{t("usage_longestStreak", { count: String(data.longestStreak) })}</span>
              {/if}
            </div>
          </div>
          <HeatmapCalendar daily={heatmapDaily} metric={chartMode} />
        </Card>
      {/if}

      <!-- Daily trend chart -->
      <Card class="p-6 space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-sidebar-foreground/70 uppercase tracking-wider">
            {t("usage_dailyTrend")}
          </h2>
          <div class="flex gap-1">
            <button
              type="button"
              class="px-2 py-0.5 text-[10px] font-medium rounded transition-colors
              {chartMode === 'cost'
                ? 'bg-primary/20 text-primary'
                : 'text-sidebar-foreground/70 hover:text-sidebar-foreground'}"
              onclick={() => (chartMode = "cost")}
            >
              {t("usage_chartCost")}
            </button>
            <button
              type="button"
              class="px-2 py-0.5 text-[10px] font-medium rounded transition-colors
              {chartMode === 'tokens'
                ? 'bg-primary/20 text-primary'
                : 'text-sidebar-foreground/70 hover:text-sidebar-foreground'}"
              onclick={() => (chartMode = "tokens")}
            >
              {t("usage_chartTokens")}
            </button>
            {#if scope === "global"}
              <button
                type="button"
                class="px-2 py-0.5 text-[10px] font-medium rounded transition-colors
                {chartMode === 'messages'
                  ? 'bg-primary/20 text-primary'
                  : 'text-sidebar-foreground/70 hover:text-sidebar-foreground'}"
                onclick={() => (chartMode = "messages")}
              >
                {t("usage_chartMessages")}
              </button>
              <button
                type="button"
                class="px-2 py-0.5 text-[10px] font-medium rounded transition-colors
                {chartMode === 'sessions'
                  ? 'bg-primary/20 text-primary'
                  : 'text-sidebar-foreground/70 hover:text-sidebar-foreground'}"
                onclick={() => (chartMode = "sessions")}
              >
                {t("usage_chartSessions")}
              </button>
            {/if}
          </div>
        </div>
        {#if data.daily.length > 0}
          {#if scope === "global" && chartMode === "tokens" && data.daily.some((d) => d.modelBreakdown)}
            <StackedModelChart daily={data.daily} />
          {:else}
            <div class="flex h-40">
              <!-- Y-axis labels -->
              <div
                class="flex flex-col justify-between items-end pr-2 text-[10px] text-sidebar-foreground/70 tabular-nums shrink-0 py-0.5"
              >
                <span>{formatAxisValue(maxDailyValue)}</span>
                <span>{formatAxisValue(maxDailyValue / 2)}</span>
                <span>0</span>
              </div>
              <!-- Bars + X-axis -->
              <div class="flex-1 flex flex-col min-w-0">
                <div
                  class="flex-1 flex gap-[2px] border-l border-b border-sidebar-border/50 relative"
                >
                  <!-- 50% gridline -->
                  <div
                    class="absolute inset-x-0 top-1/2 border-t border-sidebar-border/30 pointer-events-none"
                  ></div>
                  {#each data.daily.slice(-30) as day (day.date)}
                    {@const value = getDailyValue(day)}
                    {@const pct = Math.max((value / maxDailyValue) * 100, 2)}
                    <div
                      class="flex-1 min-w-0 flex items-end group cursor-default"
                      title={getDailyTooltip(day)}
                    >
                      <div
                        class="w-full rounded-t bg-primary/60 group-hover:bg-primary transition-colors"
                        style="height: {pct}%"
                      ></div>
                    </div>
                  {/each}
                </div>
                <!-- X-axis date labels -->
                <div class="flex gap-[2px] mt-1">
                  {#each data.daily.slice(-30) as day, i}
                    {@const showLabel =
                      data.daily.slice(-30).length <= 10 ||
                      i % Math.ceil(data.daily.slice(-30).length / 10) === 0}
                    <div class="flex-1 min-w-0 text-center">
                      {#if showLabel}
                        <span class="text-[10px] text-sidebar-foreground/70 tabular-nums">
                          {formatShortDate(day.date)}
                        </span>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          {/if}
        {:else}
          <p class="text-sm text-sidebar-foreground/70">{t("usage_noDailyData")}</p>
        {/if}
      </Card>

      <!-- By Model -->
      <Card class="p-6 space-y-4">
        <h2 class="text-sm font-semibold text-sidebar-foreground/70 uppercase tracking-wider">
          {t("usage_byModel")}
        </h2>
        {#if data.byModel.length > 0}
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-xs text-sidebar-foreground/70 border-b border-sidebar-border">
                  <th class="text-left py-2 font-medium">{t("usage_thModel")}</th>
                  {#if scope === "app"}
                    <th class="text-right py-2 font-medium">{t("usage_thRuns")}</th>
                  {/if}
                  <th class="text-right py-2 font-medium">{t("usage_thInTokens")}</th>
                  <th class="text-right py-2 font-medium">{t("usage_thOutTokens")}</th>
                  <th class="text-right py-2 font-medium">{t("usage_thCacheRead")}</th>
                  <th class="text-right py-2 font-medium">{t("usage_thCacheWrite")}</th>
                  <th class="text-right py-2 font-medium">{t("usage_thCost")}</th>
                  <th class="text-right py-2 font-medium w-24">%</th>
                </tr>
              </thead>
              <tbody>
                {#each data.byModel as modelRow (modelRow.model)}
                  <tr class="border-b border-sidebar-border/50 hover:bg-sidebar-accent/30">
                    <td
                      class="py-2 font-mono text-xs truncate max-w-[180px]"
                      title={modelRow.model}
                    >
                      {modelRow.model}
                    </td>
                    {#if scope === "app"}
                      <td class="py-2 text-right tabular-nums">{modelRow.runs}</td>
                    {/if}
                    <td class="py-2 text-right tabular-nums font-mono text-xs">
                      {formatTokenCount(modelRow.inputTokens)}
                    </td>
                    <td class="py-2 text-right tabular-nums font-mono text-xs">
                      {formatTokenCount(modelRow.outputTokens)}
                    </td>
                    <td
                      class="py-2 text-right tabular-nums font-mono text-xs text-sidebar-foreground/70"
                    >
                      {formatTokenCount(modelRow.cacheReadTokens)}
                    </td>
                    <td
                      class="py-2 text-right tabular-nums font-mono text-xs text-sidebar-foreground/70"
                    >
                      {formatTokenCount(modelRow.cacheWriteTokens)}
                    </td>
                    <td class="py-2 text-right tabular-nums font-mono text-xs">
                      {formatCost(modelRow.costUsd)}
                    </td>
                    <td class="py-2 text-right">
                      <div class="flex items-center justify-end gap-2">
                        <div class="w-12 h-1.5 bg-sidebar-accent/40 rounded-full overflow-hidden">
                          <div
                            class="h-full bg-primary rounded-full"
                            style="width: {Math.min(modelRow.pct, 100)}%"
                          ></div>
                        </div>
                        <span
                          class="text-xs tabular-nums text-sidebar-foreground/70 w-8 text-right"
                        >
                          {modelRow.pct.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <p class="text-sm text-sidebar-foreground/70">{t("usage_noModelData")}</p>
        {/if}
      </Card>

      <!-- Run History (App mode only) -->
      {#if scope === "app"}
        <Card class="p-6 space-y-4">
          <h2 class="text-sm font-semibold text-sidebar-foreground/70 uppercase tracking-wider">
            {t("usage_runHistory")}
          </h2>
          {#if sortedRuns.length > 0}
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-xs text-sidebar-foreground/70 border-b border-sidebar-border">
                    <th
                      class="text-left py-2 font-medium cursor-pointer select-none hover:text-sidebar-foreground"
                      onclick={() => toggleSort("date")}
                    >
                      {t("usage_thDate")}{sortIndicator("date")}
                    </th>
                    <th class="text-left py-2 font-medium">{t("usage_thName")}</th>
                    <th class="text-left py-2 font-medium">{t("usage_thModel")}</th>
                    <th
                      class="text-right py-2 font-medium cursor-pointer select-none hover:text-sidebar-foreground"
                      onclick={() => toggleSort("tokens")}
                    >
                      {t("usage_thTokens")}{sortIndicator("tokens")}
                    </th>
                    <th
                      class="text-right py-2 font-medium cursor-pointer select-none hover:text-sidebar-foreground"
                      onclick={() => toggleSort("cost")}
                    >
                      {t("usage_thCost")}{sortIndicator("cost")}
                    </th>
                    <th
                      class="text-right py-2 font-medium cursor-pointer select-none hover:text-sidebar-foreground"
                      onclick={() => toggleSort("turns")}
                    >
                      {t("usage_thTurns")}{sortIndicator("turns")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {#each sortedRuns as run}
                    <tr
                      class="border-b border-sidebar-border/50 hover:bg-sidebar-accent/30 cursor-pointer"
                      role="button"
                      tabindex="0"
                      onclick={() => goto(`/chat?run=${run.runId}`)}
                      onkeydown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          goto(`/chat?run=${run.runId}`);
                        }
                      }}
                    >
                      <td class="py-2 text-xs text-sidebar-foreground/70 whitespace-nowrap">
                        {formatDate(run.startedAt)}
                      </td>
                      <td class="py-2 truncate max-w-[200px]" title={run.name}>
                        {run.name}
                      </td>
                      <td
                        class="py-2 font-mono text-xs text-sidebar-foreground/70 truncate max-w-[120px]"
                        title={run.model ?? run.agent}
                      >
                        {run.model ?? run.agent}
                      </td>
                      <td class="py-2 text-right tabular-nums font-mono text-xs">
                        {formatTokenCount(run.inputTokens + run.outputTokens)}
                      </td>
                      <td class="py-2 text-right tabular-nums font-mono text-xs">
                        {formatCost(run.totalCostUsd)}
                      </td>
                      <td class="py-2 text-right tabular-nums">
                        {run.numTurns}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            <p class="text-sm text-sidebar-foreground/70">
              {t("usage_noUsageData")}
            </p>
          {/if}
        </Card>
      {/if}
    {/if}
  </div>
</div>
