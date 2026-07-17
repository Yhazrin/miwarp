<script lang="ts">
  import type { HookEvent, ContextSnapshot, SessionInfoData, FileEntry } from "$lib/types";
  import type { TimelineEntry } from "$lib/types";
  import type { TurnUsage } from "$lib/stores/types";
  import { LS_TOOLACTIVITY_WIDTH } from "$lib/utils/storage-keys";
  import { formatTokenCount, formatDuration } from "$lib/utils/format";
  import { dbg } from "$lib/utils/debug";
  import { sortTasksByPriority, formatElapsed } from "$lib/utils/task-sort";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import ContextHistoryPanel from "$lib/components/ContextHistoryPanel.svelte";
  import WorkspaceContextPanel from "$lib/components/WorkspaceContextPanel.svelte";
  import AgentTaskStack from "$lib/components/AgentTaskStack.svelte";
  import CodexProgressPanel from "$lib/components/CodexProgressPanel.svelte";
  import FilesPanel from "$lib/components/FilesPanel.svelte";
  import FilePreviewPane from "$lib/components/FilePreviewPane.svelte";
  import PreviewPanel from "$lib/components/PreviewPanel.svelte";
  import { onMount } from "svelte";
  import { fpsCounter, isPerfEnabled } from "$lib/utils/perf";
  import ScheduledTasksPanel from "$lib/components/ScheduledTasksPanel.svelte";
  import StatusIcon from "$lib/components/StatusIcon.svelte";
  import {
    extractFilesFromTimeline,
    extractFilesFromHooks,
    extractFilesFromPersisted,
    mergeFileEntries,
  } from "$lib/utils/file-entries";
  import type { TaskNotificationItem } from "$lib/stores/session-store.svelte";
  import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
  import type { ToolTurn, ToolActivityStats } from "./tool-activity-utils";
  import { buildTurns, computeToolStats } from "./tool-activity-utils";
  import ToolsTabPanel from "./ToolsTabPanel.svelte";
  import CollapsedIconRail from "./CollapsedIconRail.svelte";
  import ToolTabBar from "./ToolTabBar.svelte";

  let {
    timeline = [],
    tools = [],
    turnUsages = [],
    usageByTurn: usageByTurnProp = undefined,
    contextHistory = [],
    persistedFiles = [],
    sessionInfo = null,
    collapsed = false,
    onToggle,
    onScrollToTool,
    onScrollToTurn,
    requestedTab = $bindable(null as ToolActivityPanelTab | null),
    activeTab = $bindable("workspace" as ToolActivityPanelTab),
    panelIndicators = $bindable({
      context: false,
      files: false,
      tasks: false,
    }),
    backgroundTasks = new Map(),
    activeBackgroundTasks = [],
    cwd = "",
    runId = "",
    isRemote = false,
    requestedPreviewPath = $bindable(null as string | null),
    requestedPreviewUrl = $bindable(null as string | null),
    /** When SessionStatusBar hosts panel tabs, hide the duplicated icon row here. */
    underUnifiedCapsule = false,
    /**
     * When true, the panel skips all cwd-driven fetches (CLAUDE.md, memory,
     * git summary, file tree) and forwards the flag to child panels so they
     * short-circuit too. Chat page swaps ToolActivity out for
     * SplitSidebarPlaceholder while split mode is active, but the flag
     * exists as defense-in-depth for any other mount surface.
     */
    suspended = false,
  }: {
    timeline: TimelineEntry[];
    tools: HookEvent[];
    turnUsages?: TurnUsage[];
    usageByTurn?: Map<number, TurnUsage>;
    contextHistory?: ContextSnapshot[];
    persistedFiles?: unknown[];
    sessionInfo?: SessionInfoData | null;
    collapsed: boolean;
    onToggle: () => void;
    onScrollToTool?: (toolUseId: string) => void;
    onScrollToTurn?: (anchorId: string) => void;
    requestedTab?: ToolActivityPanelTab | null;
    activeTab?: ToolActivityPanelTab;
    panelIndicators?: { context: boolean; files: boolean; tasks: boolean };
    backgroundTasks?: Map<string, TaskNotificationItem>;
    activeBackgroundTasks?: TaskNotificationItem[];
    cwd?: string;
    runId?: string;
    isRemote?: boolean;
    requestedPreviewPath?: string | null;
    requestedPreviewUrl?: string | null;
    underUnifiedCapsule?: boolean;
    suspended?: boolean;
  } = $props();

  // ── Tab state (activeTab is $bindable — parent can host SessionPanelTabs in the status bar) ──

  // Lazy keep-alive: a tab is mounted on first activation and stays mounted thereafter.
  // Switching back to a previously-opened tab is then visibility-only (no remount).
  // Svelte 5: $state(Set) requires reassignment to trigger reactivity (mutation methods
  // alone won't), mirroring the existing collapsedTurns pattern below.
  let mountedTabs = $state(new Set<ToolActivityPanelTab>(["workspace"]));
  $effect(() => {
    if (!mountedTabs.has(activeTab)) {
      mountedTabs = new Set(mountedTabs).add(activeTab);
    }
  });

  // Perf: measure tab-switch frame cost.
  let _prevTab: ToolActivityPanelTab | null = null;
  $effect(() => {
    const cur = activeTab;
    const from = _prevTab;
    _prevTab = cur;
    if (from === null || from === cur) return;
    if (!isPerfEnabled()) return;
    const t0 = performance.now();
    requestAnimationFrame(() => {
      const dt = performance.now() - t0;
      if (dt > 1) dbg("perf", "tab-switch", { from, to: cur, ms: +dt.toFixed(2) });
    });
  });

  // ── External tab request ──
  $effect(() => {
    if (requestedTab) {
      activeTab = requestedTab;
      requestedTab = null;
    }
  });

  // ── Preview state ──
  let previewPath = $state<string | null>(null);
  let previewUrl = $state<string | null>(null);

  // External preview request → set path + switch tab; consume by setting $bindable to null
  $effect(() => {
    if (requestedPreviewPath) {
      previewPath = requestedPreviewPath;
      activeTab = "files";
      requestedPreviewPath = null;
    }
  });

  // Clear preview when run changes (different session — paths from previous run no longer relevant)
  $effect(() => {
    void runId;
    previewPath = null;
  });

  $effect(() => {
    if (requestedPreviewUrl) {
      previewUrl = requestedPreviewUrl;
      activeTab = "preview";
      requestedPreviewUrl = null;
    }
  });

  // ── Width state (browser-safe initialization) ──
  const WIDTH_MIN = 280;
  const WIDTH_MAX = 720;
  const WIDTH_DEFAULT = 420;
  const WIDTH_COLLAPSED = 0;

  function clampWidth(v: number): number {
    return Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, v));
  }

  let savedWidth = $state(WIDTH_DEFAULT);

  onMount(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(LS_TOOLACTIVITY_WIDTH);
    if (stored) {
      const n = parseInt(stored, 10);
      if (Number.isFinite(n)) savedWidth = clampWidth(n);
    }
  });

  let effectiveWidth = $derived(clampWidth(savedWidth));

  // ── Resize handle (VS Code-style: ghost line during drag, single commit on release) ──
  let resizing = $state(false);
  let ghostX = $state(0);
  let resizeStartX = 0;
  let resizeStartWidth = 0;
  let pendingWidth: number | null = null;
  let rafId: number | null = null;
  let asideEl: HTMLElement | undefined = $state();
  let dragFpsStop: (() => void) | null = null;

  function onResizeStart(e: PointerEvent) {
    resizing = true;
    resizeStartX = e.clientX;
    resizeStartWidth = effectiveWidth;
    pendingWidth = resizeStartWidth;
    ghostX = e.clientX;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
    dragFpsStop = fpsCounter("aside-drag");
  }

  function flushGhostFrame() {
    rafId = null;
  }

  function onResizeMove(e: PointerEvent) {
    if (!resizing) return;
    const delta = resizeStartX - e.clientX;
    pendingWidth = clampWidth(resizeStartWidth + delta);
    const wantedX = typeof window !== "undefined" ? window.innerWidth - pendingWidth : e.clientX;
    if (rafId === null && typeof window !== "undefined") {
      rafId = window.requestAnimationFrame(flushGhostFrame);
    }
    ghostX = wantedX;
  }

  function onResizeEnd(e: PointerEvent) {
    if (!resizing) return;
    resizing = false;
    if (rafId !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);

    if (pendingWidth !== null && pendingWidth !== savedWidth) {
      savedWidth = pendingWidth;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LS_TOOLACTIVITY_WIDTH, String(savedWidth));
      }
    }
    pendingWidth = null;
    dragFpsStop?.();
    dragFpsStop = null;
  }

  // ── Dual-source strategy ──

  // ── Background tasks (sorted: active first, then by recency) ──

  let sortedBgTasks = $derived(sortTasksByPriority([...backgroundTasks.values()]));

  let useTimeline = $derived(timeline.some((e) => e.kind === "tool"));

  // ── Turn grouping (timeline mode) ──

  /** Whether we need full turns computation (tools tab active and panel visible). */
  let needsFullTurns = $derived(!collapsed && activeTab === "tools" && useTimeline);

  let turns = $derived.by((): ToolTurn[] => {
    if (!needsFullTurns) {
      return [];
    }
    return buildTurns(timeline);
  });

  // ── HookEvent fallback (pipe/PTY mode) ──

  let hookToolEvents = $derived(tools.filter((e) => e.tool_name));

  // ── File entries (dual-source + persisted merge) ──
  // Only compute full fileEntries when files tab is active and panel is visible

  let fileEntries: FileEntry[] = $derived.by(() => {
    if (collapsed || activeTab !== "files") {
      if (useTimeline) {
        for (const e of timeline) {
          if (
            e.kind === "tool" &&
            (e.tool.tool_name === "Write" ||
              e.tool.tool_name === "Edit" ||
              e.tool.tool_name === "Bash")
          ) {
            return [];
          }
        }
      }
      return [];
    }
    const timelineFiles = useTimeline
      ? extractFilesFromTimeline(timeline)
      : extractFilesFromHooks(hookToolEvents);
    const persistedEntries = extractFilesFromPersisted(persistedFiles ?? []);
    return mergeFileEntries(
      { entries: timelineFiles, hasTemporalOrder: true },
      { entries: persistedEntries, hasTemporalOrder: false },
    );
  });

  $effect(() => {
    let hasFiles = false;
    if (useTimeline) {
      for (const e of timeline) {
        if (
          e.kind === "tool" &&
          (e.tool.tool_name === "Write" ||
            e.tool.tool_name === "Edit" ||
            e.tool.tool_name === "Bash")
        ) {
          hasFiles = true;
          break;
        }
      }
    }
    panelIndicators = {
      context: contextHistory.length > 0,
      files: hasFiles || (persistedFiles?.length ?? 0) > 0,
      tasks: activeBackgroundTasks.length > 0,
    };
  });

  // ── Summary + status counts (single-pass) ──
  // Only do full scan when tools tab is active; otherwise return lightweight indicator

  let toolStats = $derived.by((): ToolActivityStats => {
    // Lightweight path: when collapsed or not on tools tab, just count total
    if (collapsed || (activeTab !== "tools" && activeTab !== "workspace")) {
      if (!useTimeline) {
        return {
          summary: [],
          doneCount: 0,
          runningCount: 0,
          errorCount: 0,
          totalToolCount: 0,
          reads: 0,
          searches: 0,
          bash: 0,
          writes: 0,
        };
      }
      let total = 0;
      for (const entry of timeline) {
        if (entry.kind === "tool") total++;
      }
      return {
        summary: [],
        doneCount: 0,
        runningCount: 0,
        errorCount: 0,
        totalToolCount: total,
        reads: 0,
        searches: 0,
        bash: 0,
        writes: 0,
      };
    }

    return computeToolStats(turns, hookToolEvents, useTimeline);
  });

  // ── Per-turn usage lookup ──

  let _usageByTurn = $derived(
    usageByTurnProp ?? new Map(turnUsages.map((tu) => [tu.turnIndex, tu])),
  );

  // ── Collapsible turn state ──
  // Default: collapse all turns except the latest to reduce initial DOM count

  let collapsedTurns = $state(new Set<number>());

  let prevTurnCount = 0;
  $effect(() => {
    const count = turns.length;
    if (count !== prevTurnCount && count > 1) {
      const collapsed = new Set<number>();
      for (const turn of turns) {
        if (turn !== turns[turns.length - 1]) {
          collapsed.add(turn.turnIndex);
        }
      }
      collapsedTurns = collapsed;
    }
    prevTurnCount = count;
  });

  function toggleTurn(turnIndex: number) {
    if (collapsedTurns.has(turnIndex)) {
      collapsedTurns.delete(turnIndex);
    } else {
      collapsedTurns.add(turnIndex);
    }
    collapsedTurns = new Set(collapsedTurns);
  }

  function openCollapsedTab(tab: ToolActivityPanelTab) {
    activeTab = tab;
    onToggle();
  }

  $effect(() => {
    if (!isPerfEnabled()) return;
    dbg("tools", "sidebar updated", {
      useTimeline,
      turns: turns.length,
      hookTools: hookToolEvents.length,
      total: toolStats.totalToolCount,
      files: fileEntries.length,
    });
  });
</script>

<!--
  Outer wrapper is ALWAYS mounted: width animates between a slim icon rail and effectiveWidth.
  The expanded panel inside stays in the DOM at full width but is visually clipped + hidden when
  collapsed, so CodeMirror (FilePreviewPane) is never torn down on collapse toggle.
-->
{#if resizing}
  <!-- Ghost line during drag: zero-cost preview, no layout reflow elsewhere -->
  <div
    class="fixed top-0 bottom-0 z-[9999] pointer-events-none bg-primary"
    style="left: {ghostX - 1}px; width: 3px; box-shadow: 0 0 8px hsl(var(--primary) / 0.6);"
  ></div>
{/if}
<aside
  bind:this={asideEl}
  class="tool-activity-aside relative h-full overflow-hidden {collapsed
    ? 'bg-transparent'
    : 'bg-background/40 backdrop-blur-[28px] [backdrop-filter:blur(28px)_saturate(180%)] [-webkit-backdrop-filter:blur(28px)_saturate(180%)]'}"
  style="width: {collapsed
    ? WIDTH_COLLAPSED + 'px'
    : effectiveWidth + 'px'}; contain: layout style; clip-path: inset(0);"
>
  {#if collapsed}
    <div
      class="absolute inset-1 z-30 flex flex-col items-center gap-1 rounded-2xl border border-[hsl(var(--miwarp-glass-border)/0.1)] bg-background/55 px-1 py-1.5 backdrop-blur-2xl shadow-[0_4px_20px_rgba(0,0,0,0.12),inset_0_1px_0_hsl(var(--miwarp-glass-border)/0.07)]"
    >
      <button
        type="button"
        class="relative flex h-8 w-8 items-center justify-center rounded-xl transition-colors {activeTab ===
        'workspace'
          ? 'bg-accent/30 text-foreground'
          : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground'}"
        onclick={() => openCollapsedTab("workspace")}
        title={t("toolActivity_tabWorkspace")}
      >
        <Icon name="home" size="sm" />
      </button>
      <button
        type="button"
        class="relative flex h-8 w-8 items-center justify-center rounded-xl transition-colors {activeTab ===
        'tools'
          ? 'bg-accent/30 text-foreground'
          : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground'}"
        onclick={() => openCollapsedTab("tools")}
        title={t("toolActivity_tabActivity")}
      >
        <Icon name="wrench" size="sm" />
      </button>
      <button
        type="button"
        class="relative flex h-8 w-8 items-center justify-center rounded-xl transition-colors {activeTab ===
        'context'
          ? 'bg-accent/30 text-foreground'
          : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground'}"
        onclick={() => openCollapsedTab("context")}
        title={t("toolActivity_tabContext")}
      >
        <Icon name="clock" size="sm" />
        {#if contextHistory.length > 0}
          <span class="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-miwarp-status-success"
          ></span>
        {/if}
      </button>
      <button
        type="button"
        class="relative flex h-8 w-8 items-center justify-center rounded-xl transition-colors {activeTab ===
        'files'
          ? 'bg-accent/30 text-foreground'
          : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground'}"
        onclick={() => openCollapsedTab("files")}
        title={t("toolActivity_tabFiles")}
      >
        <Icon name="file" size="sm" />
        {#if fileEntries.length > 0}
          <span class="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-miwarp-status-warning"
          ></span>
        {/if}
      </button>
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-xl transition-colors {activeTab ===
        'preview'
          ? 'bg-accent/30 text-foreground'
          : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground'}"
        onclick={() => openCollapsedTab("preview")}
        title={t("toolActivity_tabPreview")}
      >
        <Icon name="monitor" size="sm" />
      </button>
      <button
        type="button"
        class="relative flex h-8 w-8 items-center justify-center rounded-xl transition-colors {activeTab ===
        'tasks'
          ? 'bg-accent/30 text-foreground'
          : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground'}"
        onclick={() => openCollapsedTab("tasks")}
        title={t("toolActivity_tabTasks")}
      >
        <Icon name="check-square" size="sm" />
        {#if activeBackgroundTasks.length > 0}
          <span
            class="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-miwarp-status-info"
          ></span>
        {/if}
      </button>
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-xl transition-colors {activeTab ===
        'scheduled-tasks'
          ? 'bg-accent/30 text-foreground'
          : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground'}"
        onclick={() => openCollapsedTab("scheduled-tasks")}
        title={t("sessionControl_panelScheduledTasks")}
      >
        <Icon name="clock" size="sm" />
      </button>
      <button
        type="button"
        class="mt-auto flex h-8 w-8 items-center justify-center rounded-xl bg-accent/20 text-foreground transition-colors hover:bg-accent/30"
        onclick={onToggle}
        title={t("toolActivity_expand")}
      >
        <Icon name="chevron-right" size="sm" />
      </button>
    </div>
  {/if}
  <!-- Always-mounted expanded panel (hidden + translated off-canvas when collapsed) -->
  <div
    class="tool-activity-aside-inner absolute top-0 left-0 h-full flex flex-col"
    style="width: {effectiveWidth}px; transform: translateX({collapsed
      ? '100%'
      : '0'}); visibility: {collapsed ? 'hidden' : 'visible'}; pointer-events: {collapsed
      ? 'none'
      : 'auto'};"
    aria-hidden={collapsed}
  >
    <!-- Resize handle on the left edge -->
    <div
      role="separator"
      aria-orientation="vertical"
      tabindex="-1"
      class="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-20 {resizing
        ? 'bg-primary/50'
        : ''}"
      onpointerdown={onResizeStart}
      onpointermove={onResizeMove}
      onpointerup={onResizeEnd}
      onpointercancel={onResizeEnd}
    ></div>
    <!-- Header: icon tabs (hidden when parent shows SessionPanelTabs in status bar) -->
    {#if !underUnifiedCapsule}
      <ToolTabBar
        {activeTab}
        onTabChange={(tab) => (activeTab = tab)}
        {onToggle}
        {contextHistory}
        {fileEntries}
        {activeBackgroundTasks}
      />
    {/if}

    <!-- Lazy keep-alive: each tab mounts on first activation and stays mounted (visibility-only after).
         Tab content is absolutely positioned within this relative wrapper so all mounted tabs share
         the same layout slot but only the active one is visible/interactive. -->
    <div
      class="relative mx-1.5 my-1.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/30 bg-background/30 backdrop-blur-xl"
    >
      {#if mountedTabs.has("workspace")}
        <div
          class="absolute inset-0 flex flex-col"
          style="visibility: {activeTab === 'workspace'
            ? 'visible'
            : 'hidden'}; pointer-events: {activeTab === 'workspace' ? 'auto' : 'none'};"
        >
          <WorkspaceContextPanel
            {cwd}
            {runId}
            {toolStats}
            onSwitchToActivity={() => (activeTab = "tools")}
            onSwitchToFiles={() => (activeTab = "files")}
            {suspended}
          />
          <!-- v1.0.6 / 4.8: Agent task stack (compact progress view) -->
          {#if runId}
            <div class="px-3 pb-2">
              <AgentTaskStack {runId} />
            </div>
          {/if}
        </div>
      {/if}
      {#if mountedTabs.has("tasks")}
        <div
          class="absolute inset-0 flex flex-col"
          style="visibility: {activeTab === 'tasks'
            ? 'visible'
            : 'hidden'}; pointer-events: {activeTab === 'tasks' ? 'auto' : 'none'};"
        >
          <!-- v1.0.6 / 5.2: Codex Progress panel (todo tracking) -->
          <div class="border-b border-border/30">
            <CodexProgressPanel {runId} />
          </div>
          <!-- Background tasks panel -->
          <div class="flex-1 overflow-y-auto scrollbar-hide p-4">
            {#if backgroundTasks.size === 0}
              <div class="flex items-center justify-center h-32 text-xs text-muted-foreground/50">
                {t("bgTask_empty")}
              </div>
            {:else}
              <div class="py-1 space-y-1">
                {#each sortedBgTasks as item (item.task_id)}
                  {@const isDone = item.status === "completed"}
                  {@const isFailed = item.status === "failed" || item.status === "error"}
                  {@const isActive = !isDone && !isFailed}
                  {@const rawData = (item.data as Record<string, unknown> | undefined)?.data as
                    | Record<string, unknown>
                    | undefined}
                  {@const usage = rawData?.usage as
                    | { duration_ms?: number; tool_uses?: number; total_tokens?: number }
                    | undefined}
                  {@const toolUseId = item.tool_use_id}
                  <button
                    type="button"
                    class="w-full text-left mx-1.5 rounded px-2 py-1.5 transition-colors {isDone
                      ? 'text-foreground/40 hover:bg-accent/30'
                      : isFailed
                        ? 'bg-destructive/5 text-foreground/50 hover:bg-destructive/10'
                        : 'bg-[hsl(var(--miwarp-status-info)/0.05)] text-foreground/70 hover:bg-[hsl(var(--miwarp-status-info)/0.1)]'}"
                    onclick={() => {
                      if (toolUseId) onScrollToTool?.(toolUseId);
                    }}
                    title={toolUseId ? t("toolActivity_scrollToTool") : ""}
                  >
                    <div class="flex items-center gap-2">
                      <StatusIcon
                        status={isActive ? "running" : isDone ? "done" : "error"}
                        size="sm"
                      />
                      <span class="flex-1 min-w-0 truncate text-[11px]"
                        >{item.summary || item.message}</span
                      >
                      {#if isActive}
                        <span class="shrink-0 text-[10px] text-foreground/30 tabular-nums"
                          >{formatElapsed(item.startedAt)}</span
                        >
                      {/if}
                    </div>
                    {#if usage && (usage.tool_uses || usage.total_tokens || usage.duration_ms)}
                      <div class="mt-0.5 text-[10px] text-muted-foreground/60 pl-5">
                        {#if usage.tool_uses}{usage.tool_uses} tools{/if}
                        {#if usage.tool_uses && usage.duration_ms}
                          ·
                        {/if}
                        {#if usage.duration_ms}{formatDuration(usage.duration_ms)}{/if}
                        {#if (usage.tool_uses || usage.duration_ms) && usage.total_tokens}
                          ·
                        {/if}
                        {#if usage.total_tokens}{formatTokenCount(usage.total_tokens)} tok{/if}
                      </div>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/if}
      {#if mountedTabs.has("context")}
        <div
          class="absolute inset-0 flex flex-col"
          style="visibility: {activeTab === 'context'
            ? 'visible'
            : 'hidden'}; pointer-events: {activeTab === 'context' ? 'auto' : 'none'};"
        >
          <ContextHistoryPanel history={contextHistory} {turnUsages} {sessionInfo} />
        </div>
      {/if}
      {#if mountedTabs.has("files")}
        <div
          class="absolute inset-0 flex flex-col"
          style="visibility: {activeTab === 'files'
            ? 'visible'
            : 'hidden'}; pointer-events: {activeTab === 'files' ? 'auto' : 'none'};"
        >
          <div class="flex flex-1 flex-col min-h-0">
            <div
              class="flex-shrink-0 max-h-[40vh] overflow-y-auto border-b border-border/50 scrollbar-hide"
            >
              <FilesPanel
                {fileEntries}
                {onScrollToTool}
                onPreview={(p) => (previewPath = p)}
                selectedPath={previewPath ?? undefined}
              />
            </div>
            <div class="flex-1 min-h-0 overflow-hidden">
              <FilePreviewPane
                {cwd}
                path={previewPath ?? ""}
                mode="preview"
                editable={false}
                {isRemote}
                scopeKey={runId}
                active={activeTab === "files"}
              />
            </div>
          </div>
        </div>
      {/if}
      {#if mountedTabs.has("preview")}
        <div
          class="absolute inset-0 flex flex-col"
          style="visibility: {activeTab === 'preview'
            ? 'visible'
            : 'hidden'}; pointer-events: {activeTab === 'preview' ? 'auto' : 'none'};"
        >
          <PreviewPanel
            active={activeTab === "preview" && !collapsed}
            bind:requestedUrl={previewUrl}
          />
        </div>
      {/if}
      {#if mountedTabs.has("scheduled-tasks")}
        <div
          class="absolute inset-0 flex flex-col"
          style="visibility: {activeTab === 'scheduled-tasks'
            ? 'visible'
            : 'hidden'}; pointer-events: {activeTab === 'scheduled-tasks' ? 'auto' : 'none'};"
        >
          <ScheduledTasksPanel {cwd} />
        </div>
      {/if}
      {#if mountedTabs.has("tools")}
        <div
          class="absolute inset-0 flex flex-col"
          style="visibility: {activeTab === 'tools'
            ? 'visible'
            : 'hidden'}; pointer-events: {activeTab === 'tools' ? 'auto' : 'none'};"
        >
          <ToolsTabPanel
            {toolStats}
            {turns}
            {hookToolEvents}
            {useTimeline}
            {collapsedTurns}
            {toggleTurn}
            {onScrollToTool}
            {onScrollToTurn}
            bind:activeTab
          />
        </div>
      {/if}
    </div>
  </div>
  {#if collapsed}
    <!-- Collapsed: thin icon rail overlay (absolute, only mounted when collapsed) -->
    <CollapsedIconRail
      {activeTab}
      {onToggle}
      onSwitchTab={(tab) => {
        activeTab = tab;
        onToggle();
      }}
      {activeBackgroundTasks}
      totalToolCount={toolStats.totalToolCount}
    />
  {/if}
</aside>
