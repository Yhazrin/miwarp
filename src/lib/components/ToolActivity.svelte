<script lang="ts">
  import type { HookEvent, ContextSnapshot, SessionInfoData, FileEntry } from "$lib/types";
  import type { TimelineEntry, BusToolItem } from "$lib/types";
  import type { TurnUsage } from "$lib/stores/types";
  import { getToolColor } from "$lib/utils/tool-colors";
  import { truncate, formatTokenCount, formatDuration } from "$lib/utils/format";
  import { getToolDetail as getToolDetailRaw } from "$lib/utils/tool-rendering";
  import { dbg } from "$lib/utils/debug";
  import { t } from "$lib/i18n/index.svelte";
  import ContextHistoryPanel from "$lib/components/ContextHistoryPanel.svelte";
  import WorkspaceContextPanel from "$lib/components/WorkspaceContextPanel.svelte";
  import FilesPanel from "$lib/components/FilesPanel.svelte";
  import FilePreviewPane from "$lib/components/FilePreviewPane.svelte";
  import PreviewPanel from "$lib/components/PreviewPanel.svelte";
  import { onMount } from "svelte";
  import { fpsCounter, isPerfEnabled } from "$lib/utils/perf";
  import SessionInfoPanel from "$lib/components/SessionInfoPanel.svelte";
  import StatusIcon from "$lib/components/StatusIcon.svelte";
  import {
    extractFilesFromTimeline,
    extractFilesFromHooks,
    extractFilesFromPersisted,
    mergeFileEntries,
  } from "$lib/utils/file-entries";
  import { extractTaskToolMeta, type TaskToolMeta } from "$lib/utils/tool-rendering";
  import type { TaskNotificationItem } from "$lib/stores/session-store.svelte";

  let {
    timeline = [],
    tools = [],
    turnUsages = [],
    contextHistory = [],
    persistedFiles = [],
    sessionInfo = null,
    collapsed = false,
    onToggle,
    onScrollToTool,
    onScrollToTurn,
    requestedTab = $bindable(
      null as "workspace" | "tools" | "context" | "files" | "info" | "tasks" | "preview" | null,
    ),
    backgroundTasks = new Map(),
    activeBackgroundTasks = [],
    cwd = "",
    runId = "",
    isRemote = false,
    requestedPreviewPath = $bindable(null as string | null),
    requestedPreviewUrl = $bindable(null as string | null),
  }: {
    timeline: TimelineEntry[];
    tools: HookEvent[];
    turnUsages?: TurnUsage[];
    contextHistory?: ContextSnapshot[];
    persistedFiles?: unknown[];
    sessionInfo?: SessionInfoData | null;
    collapsed: boolean;
    onToggle: () => void;
    onScrollToTool?: (toolUseId: string) => void;
    onScrollToTurn?: (anchorId: string) => void;
    requestedTab?:
      | "workspace"
      | "tools"
      | "context"
      | "files"
      | "info"
      | "tasks"
      | "preview"
      | null;
    backgroundTasks?: Map<string, TaskNotificationItem>;
    activeBackgroundTasks?: TaskNotificationItem[];
    cwd?: string;
    runId?: string;
    isRemote?: boolean;
    requestedPreviewPath?: string | null;
    requestedPreviewUrl?: string | null;
  } = $props();

  // ── Tab state ──
  type SidebarPanel = "workspace" | "tools" | "context" | "files" | "info" | "tasks" | "preview";
  let activeTab: SidebarPanel = $state("workspace");

  function toolTabBtn(active: boolean, compact: boolean): string {
    const shell = compact
      ? "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors"
      : "relative shrink-0 rounded-lg p-1.5 transition-colors";
    return active
      ? `${shell} bg-muted/75 text-foreground shadow-sm ring-1 ring-border/50`
      : `${shell} text-muted-foreground hover:bg-muted/45 hover:text-foreground`;
  }

  // Lazy keep-alive: a tab is mounted on first activation and stays mounted thereafter.
  // Switching back to a previously-opened tab is then visibility-only (no remount).
  // Svelte 5: $state(Set) requires reassignment to trigger reactivity (mutation methods
  // alone won't), mirroring the existing collapsedTurns pattern below.
  let mountedTabs = $state(new Set<SidebarPanel>(["workspace"]));
  $effect(() => {
    if (!mountedTabs.has(activeTab)) {
      mountedTabs = new Set(mountedTabs).add(activeTab);
    }
  });

  // Perf: measure tab-switch frame cost. Tracks the gap between activeTab change and the next
  // animation frame — proxy for "how much work was queued by switching".
  // Gated by isPerfEnabled() so non-debug runs don't pay performance.now() + rAF overhead.
  let _prevTab: SidebarPanel | null = null;
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
  // Note: auto-widening on previewPath change was removed because the width change forced
  // chat-main to reflow its thousands of message nodes every time previewPath transitioned,
  // causing perceptible lag. Users drag the handle to adjust (persisted to localStorage).
  // Default bumped from 320 → 420 to give more reasonable starting room for code preview;
  // 320 was too narrow for typical lines. Users can still drag narrower if desired.
  const WIDTH_MIN = 280;
  const WIDTH_MAX = 720;
  const WIDTH_DEFAULT = 420;
  const WIDTH_COLLAPSED = 44;

  function clampWidth(v: number): number {
    return Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, v));
  }

  let savedWidth = $state(WIDTH_DEFAULT);

  onMount(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("ocv:toolactivity-width");
    if (stored) {
      const n = parseInt(stored, 10);
      if (Number.isFinite(n)) savedWidth = clampWidth(n);
    }
  });

  let effectiveWidth = $derived(clampWidth(savedWidth));

  // ── Resize handle (VS Code-style: ghost line during drag, single commit on release) ──
  // Why this approach: in-place live resize forces chat-main reflow on every pointermove,
  // which is too expensive with thousands of chat DOM nodes. Instead, during drag we DON'T
  // move any panel — only render a fixed-position vertical line at the cursor that previews
  // the new boundary. On release we commit savedWidth ONCE → single reflow.
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
    // ghostX state already updated; this is just a frame-aligned re-render gate.
  }

  function onResizeMove(e: PointerEvent) {
    if (!resizing) return;
    const delta = resizeStartX - e.clientX; // dragging left grows the panel
    pendingWidth = clampWidth(resizeStartWidth + delta);
    // Snap ghost line to the new panel boundary (clamped). Aside is on the right side of
    // the viewport, so its left edge after commit = window.innerWidth - pendingWidth.
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
        window.localStorage.setItem("ocv:toolactivity-width", String(savedWidth));
      }
    }
    pendingWidth = null;
    dragFpsStop?.();
    dragFpsStop = null;
  }

  // ── Helpers ──

  function getToolDetail(tool: BusToolItem): string {
    return truncate(getToolDetailRaw(tool.input as Record<string, unknown>), 50);
  }

  function getHookDetail(event: HookEvent): string {
    return truncate(getToolDetailRaw(event.tool_input as Record<string, unknown>), 50);
  }

  type StatusCategory = "done" | "running" | "error" | "other";

  function categorizeBusStatus(status: string): StatusCategory {
    switch (status) {
      case "success":
        return "done";
      case "running":
        return "running";
      case "error":
      case "denied":
      case "permission_denied":
        return "error";
      case "ask_pending":
      case "permission_prompt":
        return "other";
      default:
        return "other";
    }
  }

  function categorizeHookStatus(status: string | undefined): StatusCategory {
    if (!status) return "other";
    switch (status) {
      case "done":
      case "success":
        return "done";
      case "running":
      case "pending":
        return "running";
      case "error":
      case "denied":
        return "error";
      default:
        return "other";
    }
  }

  // ── Tree structure for hierarchical tool display ──

  interface ToolNode {
    tool: BusToolItem;
    children: ToolNode[];
  }

  /** Build a tree from TimelineEntries, preserving parent→child hierarchy. */
  function buildToolTree(entries: TimelineEntry[], seen: Set<string>): ToolNode[] {
    const result: ToolNode[] = [];
    for (const entry of entries) {
      if (entry.kind === "tool" && !seen.has(entry.tool.tool_use_id)) {
        seen.add(entry.tool.tool_use_id);
        result.push({
          tool: entry.tool,
          children: entry.subTimeline ? buildToolTree(entry.subTimeline, seen) : [],
        });
      }
    }
    return result;
  }

  /** Flatten tree nodes for counting/statistics. */
  function flattenNodes(nodes: ToolNode[]): BusToolItem[] {
    const result: BusToolItem[] = [];
    for (const node of nodes) {
      result.push(node.tool);
      if (node.children.length > 0) result.push(...flattenNodes(node.children));
    }
    return result;
  }

  /** Recursively count all nodes in a tree. */
  function countToolNodes(nodes: ToolNode[]): number {
    let count = 0;
    for (const node of nodes) count += 1 + countToolNodes(node.children);
    return count;
  }

  // ── Dual-source strategy ──

  // ── Background tasks (sorted: active first, then by recency) ──

  let sortedBgTasks = $derived.by(() => {
    const items = [...backgroundTasks.values()];
    return items.sort((a, b) => {
      const aActive =
        a.status !== "completed" && a.status !== "failed" && a.status !== "error" ? 0 : 1;
      const bActive =
        b.status !== "completed" && b.status !== "failed" && b.status !== "error" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return b.startedAt - a.startedAt;
    });
  });

  function bgElapsed(startedAt: number): string {
    const ms = Date.now() - startedAt;
    if (ms < 1000) return "<1s";
    return `${Math.floor(ms / 1000)}s`;
  }

  let useTimeline = $derived(timeline.some((e) => e.kind === "tool"));

  // ── Turn grouping (timeline mode) ──

  interface ToolTurn {
    turnIndex: number;
    userPreview: string;
    tools: ToolNode[];
    anchorId?: string;
  }

  let turns = $derived.by(() => {
    if (!useTimeline) return [];
    const result: ToolTurn[] = [];
    let currentTools: ToolNode[] = [];
    let currentPreview = "";
    let currentAnchorId: string | undefined;
    let turnIdx = 0;
    // Defensive dedup: CLI can emit events with missing parent_tool_use_id,
    // causing the same tool_use_id to appear in both main timeline and a subTimeline.
    // Track seen IDs to prevent each_key_duplicate crashes in {#each} blocks.
    const seen = new Set<string>();

    for (const entry of timeline) {
      if (entry.kind === "separator") continue;
      if (entry.kind === "user") {
        // Flush previous turn (guard: don't flush initial empty state)
        if (currentTools.length > 0 || currentPreview || currentAnchorId) {
          result.push({
            turnIndex: turnIdx,
            userPreview: currentPreview,
            tools: currentTools,
            anchorId: currentAnchorId,
          });
        }
        turnIdx++;
        currentPreview = entry.content.slice(0, 40);
        currentAnchorId = entry.anchorId;
        currentTools = [];
      } else if (entry.kind === "tool") {
        if (!seen.has(entry.tool.tool_use_id)) {
          seen.add(entry.tool.tool_use_id);
          currentTools.push({
            tool: entry.tool,
            children: entry.subTimeline ? buildToolTree(entry.subTimeline, seen) : [],
          });
        }
      }
    }
    // Flush last turn
    if (currentTools.length > 0 || currentPreview || currentAnchorId) {
      result.push({
        turnIndex: turnIdx,
        userPreview: currentPreview,
        tools: currentTools,
        anchorId: currentAnchorId,
      });
    }
    return result;
  });

  // ── HookEvent fallback (pipe/PTY mode) ──

  let hookToolEvents = $derived(tools.filter((e) => e.tool_name));

  // ── File entries (dual-source + persisted merge) ──

  let fileEntries: FileEntry[] = $derived.by(() => {
    const timelineFiles = useTimeline
      ? extractFilesFromTimeline(timeline)
      : extractFilesFromHooks(hookToolEvents);
    const persistedEntries = extractFilesFromPersisted(persistedFiles ?? []);
    return mergeFileEntries(
      { entries: timelineFiles, hasTemporalOrder: true },
      { entries: persistedEntries, hasTemporalOrder: false },
    );
  });

  // ── Subagent extraction (for info tab) ──

  interface SubagentInfo {
    toolUseId: string;
    meta: TaskToolMeta;
    status: string;
    durationMs?: number;
    toolCount: number;
  }

  let subagents: SubagentInfo[] = $derived.by(() => {
    if (!useTimeline) return [];
    const result: SubagentInfo[] = [];
    for (const turn of turns) {
      for (const node of flattenNodes(turn.tools)) {
        if (node.tool_name === "Task") {
          const meta = extractTaskToolMeta(node.input);
          if (!meta) continue;
          // Count nested tools from the result
          let toolCount = 0;
          let durationMs: number | undefined;
          const tur = node.tool_use_result as Record<string, unknown> | undefined;
          if (tur && typeof tur === "object") {
            if ("totalToolUseCount" in tur) toolCount = tur.totalToolUseCount as number;
            if ("totalDurationMs" in tur) durationMs = tur.totalDurationMs as number;
          }
          result.push({
            toolUseId: node.tool_use_id,
            meta,
            status: node.status,
            durationMs,
            toolCount,
          });
        }
      }
    }
    return result;
  });

  // ── Tool category grouping ──

  const READ_TOOLS = new Set(["Read", "read_file"]);
  const SEARCH_TOOLS = new Set([
    "Grep",
    "Glob",
    "search_files",
    "list_directory",
    "WebFetch",
    "WebSearch",
  ]);
  const BASH_TOOLS = new Set(["Bash", "bash", "PowerShell"]);
  const WRITE_TOOLS = new Set([
    "Write",
    "Edit",
    "write_file",
    "edit_file",
    "MultiEdit",
    "NotebookEdit",
  ]);

  function categorizeTool(name: string): "read" | "search" | "bash" | "write" | "other" {
    if (READ_TOOLS.has(name)) return "read";
    if (SEARCH_TOOLS.has(name)) return "search";
    if (BASH_TOOLS.has(name)) return "bash";
    if (WRITE_TOOLS.has(name)) return "write";
    return "other";
  }

  // ── Summary + status counts (single-pass) ──

  let toolStats = $derived.by(() => {
    const counts: Record<string, number> = {};
    let done = 0,
      running = 0,
      errors = 0,
      total = 0;
    let reads = 0,
      searches = 0,
      bashCmds = 0,
      writes = 0;
    if (useTimeline) {
      for (const turn of turns) {
        for (const t of flattenNodes(turn.tools)) {
          counts[t.tool_name] = (counts[t.tool_name] ?? 0) + 1;
          total++;
          const cat = categorizeBusStatus(t.status);
          if (cat === "done") done++;
          else if (cat === "running") running++;
          else if (cat === "error") errors++;
          const group = categorizeTool(t.tool_name);
          if (group === "read") reads++;
          else if (group === "search") searches++;
          else if (group === "bash") bashCmds++;
          else if (group === "write") writes++;
        }
      }
    } else {
      for (const ev of hookToolEvents) {
        const name = ev.tool_name ?? "other";
        counts[name] = (counts[name] ?? 0) + 1;
        total++;
        const cat = categorizeHookStatus(ev.status);
        if (cat === "done") done++;
        else if (cat === "running") running++;
        else if (cat === "error") errors++;
        const group = categorizeTool(name);
        if (group === "read") reads++;
        else if (group === "search") searches++;
        else if (group === "bash") bashCmds++;
        else if (group === "write") writes++;
      }
    }
    return {
      summary: Object.entries(counts).sort((a, b) => b[1] - a[1]),
      doneCount: done,
      runningCount: running,
      errorCount: errors,
      totalToolCount: total,
      reads,
      searches,
      bash: bashCmds,
      writes,
    };
  });

  // ── Per-turn category breakdown ──
  interface TurnCategoryBreakdown {
    reads: number;
    searches: number;
    bash: number;
    writes: number;
    errors: number;
  }

  function getTurnBreakdown(turn: ToolTurn): TurnCategoryBreakdown {
    let reads = 0,
      searches = 0,
      bashCmds = 0,
      writes = 0,
      errs = 0;
    for (const t of flattenNodes(turn.tools)) {
      const group = categorizeTool(t.tool_name);
      if (group === "read") reads++;
      else if (group === "search") searches++;
      else if (group === "bash") bashCmds++;
      else if (group === "write") writes++;
      if (categorizeBusStatus(t.status) === "error") errs++;
    }
    return { reads, searches, bash: bashCmds, writes, errors: errs };
  }

  // ── Per-turn usage lookup ──

  let usageByTurn = $derived(new Map(turnUsages.map((tu) => [tu.turnIndex, tu])));

  // ── Collapsible turn state ──
  // Default: collapse all turns except the latest to reduce initial DOM count

  let collapsedTurns = $state(new Set<number>());

  // Auto-collapse older turns when turn count changes (session load / new turn)
  let prevTurnCount = 0;
  $effect(() => {
    const count = turns.length;
    if (count !== prevTurnCount && count > 1) {
      const collapsed = new Set<number>();
      for (const turn of turns) {
        // Collapse all except the last turn
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

  function openCollapsedTab(tab: SidebarPanel) {
    activeTab = tab;
    onToggle();
  }

  $effect(() => {
    dbg("tools", "sidebar updated", {
      useTimeline,
      turns: turns.length,
      hookTools: hookToolEvents.length,
      total: toolStats.totalToolCount,
      files: fileEntries.length,
    });
  });
</script>

{#snippet statusIcon(category: StatusCategory)}
  <StatusIcon status={category} size="sm" />
{/snippet}

{#snippet categoryIcon(color: string, iconPath: string)}
  <span class="flex h-3 w-3 shrink-0 items-center justify-center rounded {color}">
    <svg
      class="h-1.5 w-1.5 text-white"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"><path d={iconPath} /></svg
    >
  </span>
{/snippet}

{#snippet toolNodeView(node: ToolNode)}
  {@const style = getToolColor(node.tool.tool_name)}
  {@const detail = getToolDetail(node.tool)}
  {@const cat = categorizeBusStatus(node.tool.status)}
  <button
    class="w-full text-left px-2.5 py-1 hover:bg-accent/50 rounded-sm transition-colors group {cat ===
    'error'
      ? 'border-l-2 border-l-[hsl(var(--miwarp-status-error)/0.4)] bg-[hsl(var(--miwarp-status-error)/0.03)]'
      : ''}"
    onclick={() => onScrollToTool?.(node.tool.tool_use_id)}
    title={t("toolActivity_scrollToTool")}
  >
    <div class="flex items-center gap-1.5">
      {@render statusIcon(cat)}
      <div class="flex h-4 w-4 shrink-0 items-center justify-center rounded {style.bg}">
        <svg
          class="h-2.5 w-2.5 {style.text}"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d={style.icon} />
        </svg>
      </div>
      <span class="text-[11px] font-medium text-foreground shrink-0">{node.tool.tool_name}</span>
      {#if detail}
        <span
          class="text-[10px] text-muted-foreground truncate min-w-0 opacity-70 group-hover:opacity-100"
          >{detail}</span
        >
      {/if}
    </div>
  </button>
  {#if node.children.length > 0}
    <div class="ml-5 border-l-2 border-[hsl(var(--miwarp-status-info)/0.25)]">
      {#each node.children as child (child.tool.tool_use_id)}
        {@render toolNodeView(child)}
      {/each}
    </div>
  {/if}
{/snippet}

<!--
  Outer wrapper is ALWAYS mounted: width animates between a slim icon rail and effectiveWidth.
  The expanded panel inside stays in the DOM at full width but is visually clipped + hidden when
  collapsed, so CodeMirror (FilePreviewPane) is never torn down on collapse toggle. This is the
  fix for "files tab + click expand briefly hangs".
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
  class="relative h-full overflow-hidden {collapsed
    ? 'bg-transparent'
    : 'miwarp-toolactivity-glass'}"
  style="width: {collapsed
    ? WIDTH_COLLAPSED + 'px'
    : effectiveWidth + 'px'}; contain: layout style; clip-path: inset(0);"
>
  {#if collapsed}
    <div
      class="absolute inset-0 z-30 flex flex-col items-center gap-1 px-1 py-1.5 backdrop-blur-md bg-background/40"
    >
      <div
        class="flex w-full flex-col items-center gap-1 rounded-2xl border border-border/40 bg-muted/20 p-1"
      >
        <button
          class={toolTabBtn(activeTab === "workspace", true)}
          onclick={() => openCollapsedTab("workspace")}
          title={t("toolActivity_tabWorkspace")}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </button>
        <button
          class={toolTabBtn(activeTab === "tools", true)}
          onclick={() => openCollapsedTab("tools")}
          title={t("toolActivity_tabActivity")}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
            />
          </svg>
        </button>
        <button
          class="{toolTabBtn(activeTab === 'context', true)} relative"
          onclick={() => openCollapsedTab("context")}
          title={t("toolActivity_tabContext")}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          {#if contextHistory.length > 0}
            <span
              class="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[hsl(var(--miwarp-status-success))]"
            ></span>
          {/if}
        </button>
        <button
          class="{toolTabBtn(activeTab === 'files', true)} relative"
          onclick={() => openCollapsedTab("files")}
          title={t("toolActivity_tabFiles")}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          {#if fileEntries.length > 0}
            <span
              class="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[hsl(var(--miwarp-status-warning))]"
            ></span>
          {/if}
        </button>
        <button
          class={toolTabBtn(activeTab === "preview", true)}
          onclick={() => openCollapsedTab("preview")}
          title={t("toolActivity_tabPreview")}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
        </button>
        <button
          class={toolTabBtn(activeTab === "info", true)}
          onclick={() => openCollapsedTab("info")}
          title={t("toolActivity_tabInfo")}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </button>
        <button
          class="{toolTabBtn(activeTab === 'tasks', true)} relative"
          onclick={() => openCollapsedTab("tasks")}
          title={t("toolActivity_tabTasks")}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          {#if activeBackgroundTasks.length > 0}
            <span
              class="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--miwarp-status-info))]"
            ></span>
          {/if}
        </button>
      </div>
      <button
        class="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/35 bg-muted/25 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        onclick={onToggle}
        title={t("toolActivity_expand")}
      >
        <svg
          class="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  {/if}
  <!-- Always-mounted expanded panel (hidden + translated off-canvas when collapsed) -->
  <div
    class="absolute top-0 left-0 h-full flex flex-col transition-transform duration-200"
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
    <!-- Header: icon tabs -->
    <div class="mt-3 mx-1.5 mb-1 flex items-center justify-between gap-2">
      <div
        class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-xl border border-border/40 bg-muted/15 p-1 pr-2"
      >
        <!-- Workspace icon -->
        <button
          class={toolTabBtn(activeTab === "workspace", false)}
          onclick={() => (activeTab = "workspace")}
          title={t("toolActivity_tabWorkspace")}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </button>
        <!-- Activity (tools) icon -->
        <button
          class={toolTabBtn(activeTab === "tools", false)}
          onclick={() => (activeTab = "tools")}
          title={t("toolActivity_tabActivity")}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
            />
          </svg>
        </button>
        <!-- Context icon -->
        <button
          class="{toolTabBtn(activeTab === 'context', false)} relative"
          onclick={() => (activeTab = "context")}
          title={t("toolActivity_tabContext")}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          {#if contextHistory.length > 0}
            <span
              class="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--miwarp-status-success))]"
            ></span>
          {/if}
        </button>
        <!-- Files icon -->
        <button
          class="{toolTabBtn(activeTab === 'files', false)} relative"
          onclick={() => (activeTab = "files")}
          title={t("toolActivity_tabFiles")}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          {#if fileEntries.length > 0}
            <span
              class="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--miwarp-status-warning))]"
            ></span>
          {/if}
        </button>
        <!-- Preview icon -->
        <button
          class={toolTabBtn(activeTab === "preview", false)}
          onclick={() => (activeTab = "preview")}
          title={t("toolActivity_tabPreview")}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
        </button>
        <!-- Info icon -->
        <button
          class={toolTabBtn(activeTab === "info", false)}
          onclick={() => (activeTab = "info")}
          title={t("toolActivity_tabInfo")}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </button>
        <!-- Tasks icon -->
        <button
          class="{toolTabBtn(activeTab === 'tasks', false)} relative"
          onclick={() => (activeTab = "tasks")}
          title={t("toolActivity_tabTasks")}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          {#if activeBackgroundTasks.length > 0}
            <span
              class="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--miwarp-status-info))] animate-pulse"
            ></span>
          {/if}
        </button>
      </div>
      <button
        class="shrink-0 rounded-lg border border-border/35 bg-muted/20 p-1.5 text-muted-foreground transition-colors hover:bg-muted/35 hover:text-foreground"
        onclick={onToggle}
        title={t("toolActivity_collapse")}
      >
        <svg
          class="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
    </div>

    <!-- Lazy keep-alive: each tab mounts on first activation and stays mounted (visibility-only after).
         Tab content is absolutely positioned within this relative wrapper so all mounted tabs share
         the same layout slot but only the active one is visible/interactive. -->
    <div class="relative mx-1.5 mb-1.5 flex min-h-0 flex-1 flex-col overflow-hidden">
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
            {sessionInfo}
            {contextHistory}
            {turnUsages}
            {toolStats}
            onSwitchToActivity={() => (activeTab = "tools")}
            onSwitchToFiles={() => (activeTab = "files")}
          />
        </div>
      {/if}
      {#if mountedTabs.has("tasks")}
        <div
          class="absolute inset-0 flex flex-col"
          style="visibility: {activeTab === 'tasks'
            ? 'visible'
            : 'hidden'}; pointer-events: {activeTab === 'tasks' ? 'auto' : 'none'};"
        >
          <!-- Background tasks panel -->
          <div class="flex-1 overflow-y-auto">
            {#if backgroundTasks.size === 0}
              <div class="flex items-center justify-center h-32 text-xs text-muted-foreground/50">
                {t("bgTask_empty")}
              </div>
            {:else}
              <div class="py-1 space-y-0.5">
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
                          >{bgElapsed(item.startedAt)}</span
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
            <p
              class="shrink-0 px-2.5 py-1.5 text-[10px] text-muted-foreground border-b border-border/40 leading-snug"
            >
              {t("toolActivity_sessionFilesHint")}
            </p>
            <div class="flex-shrink-0 max-h-[40vh] overflow-y-auto border-b border-border/50">
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
      {#if mountedTabs.has("info")}
        <div
          class="absolute inset-0 flex flex-col overflow-y-auto"
          style="visibility: {activeTab === 'info'
            ? 'visible'
            : 'hidden'}; pointer-events: {activeTab === 'info' ? 'auto' : 'none'};"
        >
          <!-- Subagents section (shown above session info when Task tools exist) -->
          {#if subagents.length > 0}
            <div class="px-3 py-2 border-b border-border/50">
              <div
                class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5"
              >
                {t("tool_subagents", { count: String(subagents.length) })}
              </div>
              <div class="space-y-1.5">
                {#each subagents as sa (sa.toolUseId)}
                  {@const isDone = sa.status === "success"}
                  {@const isError = sa.status === "error" || sa.status === "denied"}
                  {@const isRunning = !isDone && !isError}
                  <button
                    class="w-full text-left rounded-md border border-border/50 bg-background/50 px-2.5 py-1.5 hover:bg-accent/30 transition-colors"
                    onclick={() => onScrollToTool?.(sa.toolUseId)}
                    title={t("toolActivity_scrollTo")}
                  >
                    <div class="flex items-center gap-1.5">
                      <span class="text-[11px] font-medium text-foreground"
                        >{sa.meta.subagentType}</span
                      >
                      {#if sa.meta.model}
                        <span
                          class="text-[10px] px-1 py-0.5 rounded bg-[hsl(var(--miwarp-status-info)/0.15)] text-[hsl(var(--miwarp-status-info))] font-medium"
                          >{sa.meta.model}</span
                        >
                      {/if}
                      <span class="ml-auto">
                        {#if isDone}
                          <StatusIcon status="done" size="sm" />
                        {:else if isError}
                          <StatusIcon status="error" size="sm" />
                        {:else if isRunning}
                          <StatusIcon status="running" size="sm" />
                        {/if}
                      </span>
                    </div>
                    {#if sa.meta.description}
                      <div class="text-[10px] text-muted-foreground truncate mt-0.5">
                        {sa.meta.description}
                      </div>
                    {/if}
                    {#if sa.toolCount > 0 || sa.durationMs != null}
                      <div class="text-[10px] text-muted-foreground/60 mt-0.5">
                        {#if sa.toolCount > 0}{sa.toolCount} tools{/if}
                        {#if sa.toolCount > 0 && sa.durationMs != null}
                          ·
                        {/if}
                        {#if sa.durationMs != null}{formatDuration(sa.durationMs)}{/if}
                      </div>
                    {/if}
                  </button>
                {/each}
              </div>
            </div>
          {/if}
          <SessionInfoPanel info={sessionInfo} {activeTab} />
        </div>
      {/if}
      {#if mountedTabs.has("tools")}
        <div
          class="absolute inset-0 flex flex-col"
          style="visibility: {activeTab === 'tools'
            ? 'visible'
            : 'hidden'}; pointer-events: {activeTab === 'tools' ? 'auto' : 'none'};"
        >
          <!-- Tools panel -->
          <!-- Overview: compact single-line session stats -->
          {#if toolStats.totalToolCount > 0}
            <div
              class="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border/50 text-[10px]"
            >
              <span class="font-medium text-foreground"
                >{t("toolActivity_totalTools", { count: String(toolStats.totalToolCount) })}</span
              >
              {#if toolStats.reads > 0}
                <span class="text-muted-foreground/40">&middot;</span>
                <span class="flex items-center gap-0.5 text-blue-500 dark:text-blue-400">
                  {@render categoryIcon(
                    "bg-blue-500",
                    "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
                  )}
                  {toolStats.reads}
                </span>
              {/if}
              {#if toolStats.searches > 0}
                <span class="text-muted-foreground/40">&middot;</span>
                <span class="flex items-center gap-0.5 text-purple-500 dark:text-purple-400">
                  {@render categoryIcon(
                    "bg-purple-500",
                    "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35",
                  )}
                  {toolStats.searches}
                </span>
              {/if}
              {#if toolStats.bash > 0}
                <span class="text-muted-foreground/40">&middot;</span>
                <span class="flex items-center gap-0.5 text-emerald-500 dark:text-emerald-400">
                  {@render categoryIcon("bg-emerald-500", "M4 17l6-6-6-6M12 19h8")}
                  {toolStats.bash}
                </span>
              {/if}
              {#if toolStats.writes > 0}
                <span class="text-muted-foreground/40">&middot;</span>
                <span class="flex items-center gap-0.5 text-amber-500 dark:text-amber-400">
                  {@render categoryIcon(
                    "bg-amber-500",
                    "M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
                  )}
                  {toolStats.writes}
                </span>
              {/if}
              {#if toolStats.errorCount > 0}
                <span class="text-muted-foreground/40">&middot;</span>
                <span class="flex items-center gap-0.5 text-[hsl(var(--miwarp-status-error))]">
                  <StatusIcon status="error" size="xs" />
                  {toolStats.errorCount}
                </span>
              {/if}
            </div>
          {/if}

          <!-- Summary chips -->
          {#if toolStats.summary.length > 1}
            <div class="flex flex-wrap gap-1 px-2.5 py-1.5 border-b border-border/50">
              {#each toolStats.summary as [name, count]}
                {@const style = getToolColor(name)}
                <span
                  class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded {style.bg} {style.text} font-medium"
                >
                  {name}
                  <span class="opacity-70">{count}</span>
                </span>
              {/each}
            </div>
          {/if}

          <!-- Tool list -->
          <div class="flex-1 overflow-y-auto py-0.5">
            {#if toolStats.totalToolCount === 0}
              <div class="flex flex-col items-center justify-center h-32 px-4 text-center">
                <svg
                  class="h-8 w-8 text-muted-foreground/20 mb-2"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
                  />
                </svg>
                <p class="text-xs text-muted-foreground/50">{t("toolActivity_noToolCalls")}</p>
                <p class="text-[10px] text-muted-foreground/30 mt-1">
                  {t("toolActivity_emptyHint")}
                </p>
              </div>
            {:else if useTimeline}
              <!-- Timeline mode: grouped by turn -->
              {#each turns as turn (turn.turnIndex)}
                {@const isCollapsed = collapsedTurns.has(turn.turnIndex)}
                {@const tu = usageByTurn.get(turn.turnIndex)}
                {@const hasTools = turn.tools.length > 0}
                {@const turnHasError =
                  hasTools &&
                  flattenNodes(turn.tools).some((t) => categorizeBusStatus(t.status) === "error")}
                <!-- Turn header: div with two sibling buttons (no nesting) -->
                <div
                  class="flex items-center w-full px-2.5 py-1.5 hover:bg-accent/50 transition-colors border-b border-border/30 {turnHasError
                    ? 'border-l-2 border-l-[hsl(var(--miwarp-status-error)/0.5)]'
                    : ''}"
                >
                  <button
                    class="flex-1 flex items-center gap-1.5 text-left min-w-0"
                    onclick={() => {
                      if (hasTools) {
                        toggleTurn(turn.turnIndex);
                      } else if (turn.anchorId) {
                        dbg("tool-activity", "scroll to turn (no tools)", {
                          turnIndex: turn.turnIndex,
                          anchorId: turn.anchorId,
                        });
                        onScrollToTurn?.(turn.anchorId);
                      }
                    }}
                  >
                    {#if hasTools}
                      <svg
                        class="h-3 w-3 text-muted-foreground/50 shrink-0 transition-transform {isCollapsed
                          ? ''
                          : 'rotate-90'}"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    {/if}
                    <span class="text-[11px] font-medium text-muted-foreground truncate">
                      {#if turn.userPreview}
                        {t("toolActivity_turn", { index: String(turn.turnIndex) })}
                        <span class="text-foreground/70">{truncate(turn.userPreview, 25)}</span>
                      {:else}
                        <span class="text-muted-foreground/60"
                          >{t("toolActivity_systemResume")}</span
                        >
                      {/if}
                    </span>
                    <span class="ml-auto flex items-center gap-1.5 shrink-0">
                      {#if tu}
                        <span class="text-[10px] text-muted-foreground"
                          >{formatTokenCount(tu.inputTokens + tu.outputTokens)}</span
                        >
                      {/if}
                      {#if hasTools}
                        {@const bk = getTurnBreakdown(turn)}
                        <span class="flex items-center gap-1 text-[10px]">
                          {#if bk.reads > 0}<span class="text-blue-500/70 dark:text-blue-400/70"
                              >{bk.reads}R</span
                            >{/if}
                          {#if bk.searches > 0}<span
                              class="text-purple-500/70 dark:text-purple-400/70"
                              >{bk.searches}S</span
                            >{/if}
                          {#if bk.bash > 0}<span
                              class="text-emerald-500/70 dark:text-emerald-400/70">{bk.bash}B</span
                            >{/if}
                          {#if bk.writes > 0}<span class="text-amber-500/70 dark:text-amber-400/70"
                              >{bk.writes}W</span
                            >{/if}
                          <span
                            class="px-1 py-0.5 rounded-full bg-muted text-muted-foreground font-medium"
                            >{countToolNodes(turn.tools)}</span
                          >
                        </span>
                      {/if}
                      {#if turnHasError}
                        <span class="text-[hsl(var(--miwarp-status-error)/0.7)]">
                          <StatusIcon status="error" size="xs" />
                        </span>
                      {/if}
                    </span>
                  </button>
                  {#if turn.anchorId}
                    <button
                      class="shrink-0 ml-1 p-0.5 rounded text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-colors"
                      onclick={() => {
                        dbg("tool-activity", "scroll to turn", {
                          turnIndex: turn.turnIndex,
                          anchorId: turn.anchorId,
                        });
                        onScrollToTurn?.(turn.anchorId!);
                      }}
                      title={t("toolActivity_scrollToTurn")}
                    >
                      <svg
                        class="h-3 w-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        ><circle cx="12" cy="12" r="3" /><path
                          d="M12 2v4m0 12v4M2 12h4m12 0h4"
                        /></svg
                      >
                    </button>
                  {/if}
                </div>

                <!-- Tools in this turn (only render if turn has tools) -->
                {#if hasTools && !isCollapsed}
                  <div class="py-0.5">
                    {#each turn.tools as node (node.tool.tool_use_id)}
                      {@render toolNodeView(node)}
                    {/each}
                  </div>
                {/if}
              {/each}
            {:else}
              <!-- HookEvent fallback mode (pipe/PTY) -->
              {#each hookToolEvents as event, ei (ei)}
                {@const style = getToolColor(event.tool_name ?? "")}
                {@const detail = getHookDetail(event)}
                {@const cat = categorizeHookStatus(event.status)}
                <div class="px-2.5 py-1">
                  <div class="flex items-center gap-1.5">
                    {@render statusIcon(cat)}
                    <div
                      class="flex h-4 w-4 shrink-0 items-center justify-center rounded {style.bg}"
                    >
                      <svg
                        class="h-2.5 w-2.5 {style.text}"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d={style.icon} />
                      </svg>
                    </div>
                    <span class="text-[11px] font-medium text-foreground shrink-0"
                      >{event.tool_name ?? event.hook_type}</span
                    >
                    {#if detail}
                      <span class="text-[10px] text-muted-foreground truncate min-w-0"
                        >{detail}</span
                      >
                    {/if}
                  </div>
                </div>
              {/each}
            {/if}
          </div>

          <!-- Stats footer -->
          {#if toolStats.totalToolCount > 0}
            <div class="border-t border-border px-3 py-1.5">
              <div class="flex items-center gap-3 text-[11px]">
                {#if toolStats.doneCount > 0}
                  <span class="flex items-center gap-1 text-[hsl(var(--miwarp-status-success))]">
                    <StatusIcon status="done" size="sm" />
                    {toolStats.doneCount}
                  </span>
                {/if}
                {#if toolStats.runningCount > 0}
                  <span class="flex items-center gap-1 text-muted-foreground">
                    <StatusIcon status="running" size="sm" />
                    {toolStats.runningCount}
                  </span>
                {/if}
                {#if toolStats.errorCount > 0}
                  <span class="flex items-center gap-1 text-destructive">
                    <StatusIcon status="error" size="sm" />
                    {toolStats.errorCount}
                  </span>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</aside>
