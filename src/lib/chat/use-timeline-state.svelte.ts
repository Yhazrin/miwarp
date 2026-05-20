/**
 * Composable that owns timeline rendering state and derived values.
 *
 * Extracted from +page.svelte to keep the page file focused on UI wiring.
 * Uses Svelte 5 runes (`$state`, `$derived`, `$effect`) for reactivity.
 */

import { untrack } from "svelte";
import type { SessionStore } from "$lib/stores/session-store.svelte";
import {
  useToolBurstCollapse,
  type BurstCollapseHandle,
} from "$lib/chat/use-tool-burst-collapse.svelte";
import {
  computeTimelinePresentation,
  getInitialRenderLimit,
} from "$lib/chat/selectors/timeline-presentation";
import type { ProcessVisibility } from "$lib/utils/process-visibility";
import { getCachedProcessVisibility } from "$lib/utils/process-visibility";
import { dbg } from "$lib/utils/debug";
import type { BusToolItem, TimelineEntry } from "$lib/types";
import type { ToolBurst } from "$lib/utils/tool-rendering";

// ── Context (dependency injection) ──

export interface TimelineStateContext {
  store: SessionStore;
  burstCollapse: BurstCollapseHandle;
  getProcessVisibility: () => ProcessVisibility;
  getChatAreaRef: () => HTMLDivElement | undefined;
  loadMoreEarlier: () => void;
  getSuppressLoadMoreRearm: () => boolean;
  setSuppressLoadMoreRearm: (v: boolean) => void;
  setFolderCwdOverride: (v: string) => void;
  reloadProjectData: (cwd: string) => void;
}

// ── Return type ──

export interface TimelineStateHandle {
  // Mutable state (getter + setter pairs)
  toolFilter: string | null;
  setToolFilter: (v: string | null) => void;
  renderLimit: number;
  setRenderLimit: (v: number) => void;
  loadingRunId: string | null;
  setLoadingRunId: (v: string | null) => void;
  loadingMore: boolean;
  setLoadingMore: (v: boolean) => void;
  loadMoreArmed: boolean;
  setLoadMoreArmed: (v: boolean) => void;

  // Derived timeline presentation values
  filteredTimeline: TimelineEntry[];
  visibleTimeline: TimelineEntry[];
  toolNamesInTimeline: string[];
  timelineIdIndex: Map<string, number>;
  lastClearSepId: string | null;
  latestPlanToolId: string | null;
  createdFiles: Array<{ path: string; name: string; tool: string; timestamp: number }>;
  hasCreatedFiles: boolean;
  batchGroups: Map<number, BusToolItem[]>;
  toolBursts: Map<number, ToolBurst>;
  userCountPrefix: Int32Array;

  // Burst collapse handle (expose for template access to reactive getters)
  burstCollapse: BurstCollapseHandle;
  toggleBurst: (key: string) => void;

  // DOM ref for IntersectionObserver binding
  topSentinel: HTMLDivElement | null;
  setTopSentinel: (v: HTMLDivElement | null) => void;
}

// ── Composable ──

export function useTimelineState(ctx: TimelineStateContext): TimelineStateHandle {
  const { store, burstCollapse, getProcessVisibility, getChatAreaRef, loadMoreEarlier } = ctx;

  // ── Mutable state ──

  let toolFilter = $state<string | null>(null);
  let renderLimit = $state(getInitialRenderLimit(getCachedProcessVisibility(), []));
  let loadingRunId = $state<string | null>(null);
  let loadingMore = $state(false);
  let loadMoreArmed = $state(true);

  // DOM ref for IntersectionObserver — bindable via bind:this from the template.
  let topSentinel = $state<HTMLDivElement | null>(null);

  // ── Derived: timeline presentation ──

  const timelinePresentation = $derived.by(() =>
    computeTimelinePresentation(
      store.timeline,
      toolFilter,
      renderLimit,
      store.tools.filter((e) => e.tool_name).length,
    ),
  );

  const filteredTimeline = $derived(timelinePresentation.filteredTimeline);
  const visibleTimeline = $derived(timelinePresentation.visibleTimeline);
  const toolNamesInTimeline = $derived(timelinePresentation.toolNames);
  const timelineIdIndex = $derived(timelinePresentation.timelineIdIndex);
  const lastClearSepId = $derived(timelinePresentation.lastClearSepId);
  const latestPlanToolId = $derived(timelinePresentation.latestPlanToolId);
  const createdFiles = $derived(timelinePresentation.createdFiles);
  const hasCreatedFiles = $derived(createdFiles.length > 0);
  const batchGroups = $derived(timelinePresentation.batchGroups);
  const toolBursts = $derived(timelinePresentation.toolBursts);
  const userCountPrefix = $derived(timelinePresentation.userCountPrefix);

  // ── Batch groups debug logging ──

  let _lastBatchSig = "";
  $effect(() => {
    const size = batchGroups.size;
    const agents = size > 0 ? [...batchGroups.values()].reduce((s, g) => s + g.length, 0) : 0;
    const sig = `${size}:${agents}`;
    if (sig !== _lastBatchSig) {
      _lastBatchSig = sig;
      if (size > 0) dbg("chat", "batchGroups", { groupCount: size, totalAgents: agents });
    }
  });

  // ── Tool burst visual state sync ──
  // Compute a content-based signature so we only call syncStates when burst
  // *content* changes, not on every new Map reference from the selector.

  const toolBurstSig = $derived.by(() => {
    const parts: string[] = [];
    for (const [idx, burst] of toolBursts) {
      const statuses = burst.tools.map((tool) => tool.status).join(",");
      parts.push(`${idx}:${burst.key}:${burst.stats.running}:${burst.stats.total}:${statuses}`);
    }
    return parts.join("|");
  });

  $effect(() => {
    const _ = toolBurstSig;
    untrack(() => burstCollapse.syncStates());
  });

  // Reset burst collapse on run switch — only when runId actually changes.
  let prevRunId: string | undefined = undefined;
  $effect(() => {
    const runId = store.run?.id;
    if (runId !== prevRunId) {
      prevRunId = runId;
      burstCollapse.reset();
    }
  });

  const toggleBurst = burstCollapse.toggleBurst;

  // ── Filter reset on run change ──

  $effect(() => {
    const _ = store.run?.id;
    toolFilter = null;
  });

  // ── Top-sentinel IntersectionObserver ──
  // When the sentinel element enters the chat viewport, trigger loading more
  // earlier timeline entries (progressive rendering).

  let _topObserver: IntersectionObserver | null = null;

  $effect(() => {
    const sentinel = topSentinel;
    const chatArea = getChatAreaRef();

    if (!sentinel || !chatArea) {
      _topObserver?.disconnect();
      _topObserver = null;
      return;
    }

    _topObserver?.disconnect();
    _topObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (!loadMoreArmed || loadingMore) return;
        const hidden = filteredTimeline.length - renderLimit;
        if (hidden <= 0) return;
        dbg("chat", "progressive-load-more", { renderLimit, hidden });
        void loadMoreEarlier();
      },
      { root: chatArea, rootMargin: "200px 0px 0px 0px", threshold: 0 },
    );
    _topObserver.observe(sentinel);

    return () => {
      _topObserver?.disconnect();
      _topObserver = null;
    };
  });

  // ── Public API ──

  return {
    get toolFilter() {
      return toolFilter;
    },
    setToolFilter: (v: string | null) => {
      toolFilter = v;
    },
    get renderLimit() {
      return renderLimit;
    },
    setRenderLimit: (v: number) => {
      renderLimit = v;
    },
    get loadingRunId() {
      return loadingRunId;
    },
    setLoadingRunId: (v: string | null) => {
      loadingRunId = v;
    },
    get loadingMore() {
      return loadingMore;
    },
    setLoadingMore: (v: boolean) => {
      loadingMore = v;
    },
    get loadMoreArmed() {
      return loadMoreArmed;
    },
    setLoadMoreArmed: (v: boolean) => {
      loadMoreArmed = v;
    },

    get filteredTimeline() {
      return filteredTimeline;
    },
    get visibleTimeline() {
      return visibleTimeline;
    },
    get toolNamesInTimeline() {
      return toolNamesInTimeline;
    },
    get timelineIdIndex() {
      return timelineIdIndex;
    },
    get lastClearSepId() {
      return lastClearSepId;
    },
    get latestPlanToolId() {
      return latestPlanToolId;
    },
    get createdFiles() {
      return createdFiles;
    },
    get hasCreatedFiles() {
      return hasCreatedFiles;
    },
    get batchGroups() {
      return batchGroups;
    },
    get toolBursts() {
      return toolBursts;
    },
    get userCountPrefix() {
      return userCountPrefix;
    },

    burstCollapse,
    toggleBurst,

    get topSentinel() {
      return topSentinel;
    },
    setTopSentinel: (v: HTMLDivElement | null) => {
      topSentinel = v;
    },
  };
}
