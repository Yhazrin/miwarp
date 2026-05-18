/**
 * Composable: progressive timeline rendering.
 *
 * Manages the "start small, grow on scroll" strategy for large timelines.
 * The IntersectionObserver on `topSentinel` triggers `loadMoreEarlier` when
 * the user scrolls near the top of the rendered entries.
 */
import { tick } from "svelte";
import { dbg } from "$lib/utils/debug";
import { yieldToMain } from "$lib/utils/yield";
import type { TimelineEntry } from "$lib/types";
import type { ToolBurst } from "$lib/utils/tool-rendering";

const INITIAL_RENDER_LIMIT = 100;
const RENDER_GROWTH_STEP = 100;

export function useProgressiveTimeline(opts: {
  filteredTimeline: () => TimelineEntry[];
  chatAreaRef: () => HTMLDivElement | undefined;
  burstHiddenIndices: () => Set<number>;
  toolBursts: () => Map<number, ToolBurst>;
  manualOverrides: () => Map<string, boolean>;
  onManualOverridesChange: (next: Map<string, boolean>) => void;
}) {
  let renderLimit = $state(INITIAL_RENDER_LIMIT);
  let progressiveGen = 0;
  let loadingMore = $state(false);
  let loadMoreArmed = $state(true);
  let _suppressLoadMoreRearm = false;

  let topSentinel = $state<HTMLDivElement | null>(null);
  let _topObserver: IntersectionObserver | null = null;

  const visibleTimeline = $derived.by(() => {
    const ft = opts.filteredTimeline();
    if (renderLimit >= ft.length) return ft;
    return ft.slice(ft.length - renderLimit);
  });

  // Sentinel IntersectionObserver: grows renderLimit when user scrolls near top
  $effect(() => {
    const sentinel = topSentinel;
    const container = opts.chatAreaRef();
    if (!sentinel || !container) {
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
        const hidden = opts.filteredTimeline().length - renderLimit;
        if (hidden <= 0) return;
        dbg("chat", "progressive-load-more", { renderLimit, hidden });
        void loadMoreEarlier();
      },
      { root: container, rootMargin: "200px 0px 0px 0px", threshold: 0 },
    );
    _topObserver.observe(sentinel);
    return () => {
      _topObserver?.disconnect();
      _topObserver = null;
    };
  });

  function cancelProgressive() {
    progressiveGen++;
  }

  function nextProgressiveGen(): number {
    return ++progressiveGen;
  }

  function expandRenderLimitTo(targetIndex: number, margin = 50) {
    const ft = opts.filteredTimeline();
    if (targetIndex < 0 || targetIndex >= ft.length) return;
    if (renderLimit === Infinity) return;
    const needed = ft.length - targetIndex + margin;
    if (renderLimit < needed) renderLimit = Math.min(needed, ft.length);
  }

  async function ensureBurstExpandedFor(visibleIdx: number) {
    if (!opts.burstHiddenIndices().has(visibleIdx)) return;
    for (const [, burst] of opts.toolBursts()) {
      if (visibleIdx >= burst.startIndex && visibleIdx <= burst.endIndex) {
        const next = new Map(opts.manualOverrides());
        next.set(burst.key, true);
        opts.onManualOverridesChange(next);
        await tick();
        return;
      }
    }
  }

  async function loadMoreEarlier() {
    if (loadingMore || !loadMoreArmed) return;
    loadingMore = true;
    loadMoreArmed = false;
    const container = opts.chatAreaRef();
    try {
      const anchor = container?.querySelector<HTMLElement>("[data-entry-id]") ?? null;
      const anchorId = anchor?.dataset.entryId ?? null;
      const beforeTop = anchor?.getBoundingClientRect().top ?? 0;
      const beforeScroll = container?.scrollTop ?? 0;

      renderLimit = Math.min(renderLimit + RENDER_GROWTH_STEP, opts.filteredTimeline().length);
      await tick();
      await yieldToMain();

      if (anchorId && container) {
        let after: HTMLElement | null = null;
        try {
          after = container.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(anchorId)}"]`);
        } catch {
          after =
            Array.from(container.querySelectorAll<HTMLElement>("[data-entry-id]")).find(
              (el) => el.dataset.entryId === anchorId,
            ) ?? null;
        }
        if (after) {
          const afterTop = after.getBoundingClientRect().top;
          _suppressLoadMoreRearm = true;
          container.scrollTop = beforeScroll + (afterTop - beforeTop);
          await yieldToMain();
          _suppressLoadMoreRearm = false;
        }
      }
    } finally {
      loadingMore = false;
    }
  }

  function rearmLoadMore() {
    if (!loadMoreArmed && !_suppressLoadMoreRearm) loadMoreArmed = true;
  }

  /** Reset all progressive state for a new run. Returns the generation counter. */
  function resetForNewRun(): number {
    renderLimit = INITIAL_RENDER_LIMIT;
    loadingMore = false;
    loadMoreArmed = true;
    return nextProgressiveGen();
  }

  return {
    get renderLimit() {
      return renderLimit;
    },
    set renderLimit(v: number) {
      renderLimit = v;
    },
    get loadingMore() {
      return loadingMore;
    },
    get loadMoreArmed() {
      return loadMoreArmed;
    },
    get progressiveGen() {
      return progressiveGen;
    },
    get topSentinel() {
      return topSentinel;
    },
    set topSentinel(v: HTMLDivElement | null) {
      topSentinel = v;
    },
    get visibleTimeline() {
      return visibleTimeline;
    },
    INITIAL_RENDER_LIMIT,
    cancelProgressive,
    nextProgressiveGen,
    expandRenderLimitTo,
    ensureBurstExpandedFor,
    loadMoreEarlier,
    rearmLoadMore,
    resetForNewRun,
  };
}
