import * as api from "$lib/api";
import { dbg } from "$lib/utils/debug";
import { yieldToMain } from "$lib/utils/yield";
import {
  getInitialRenderLimit,
  RENDER_GROWTH_STEP,
} from "$lib/chat/selectors/timeline-presentation";
import type { ProcessVisibility } from "$lib/utils/process-visibility";
import type { SessionStore } from "$lib/stores/session-store.svelte";
import type { TimelineEntry } from "$lib/types";
import type { ToolBurst } from "$lib/utils/tool-rendering";
import type { BurstCollapseHandle } from "$lib/chat/use-tool-burst-collapse.svelte";

const SCROLL_BOTTOM_THRESHOLD = 40;
/** Only load older messages when the user has scrolled to the top edge (not 200px early). */
const LOAD_MORE_TOP_THRESHOLD = 96;
/** Re-allow load-more only after the user scrolls away from the top zone. */
const LOAD_MORE_REARM_SCROLL = 240;

export interface ScrollNavigationContext {
  store: SessionStore;
  tick: () => Promise<void>;
  getChatAreaRef: () => HTMLDivElement | undefined;
  getFilteredTimeline: () => TimelineEntry[];
  getVisibleTimeline: () => TimelineEntry[];
  getToolBursts: () => Map<number, ToolBurst>;
  burstCollapse: BurstCollapseHandle;
  getProcessVisibility: () => ProcessVisibility;
  getRenderLimit: () => number;
  setRenderLimit: (v: number) => void;
  getToolFilter: () => string | null;
  setToolFilter: (v: string | null) => void;
  getLoadingRunId: () => string | null;
  setLoadingRunId: (v: string | null) => void;
  getLoadingMore: () => boolean;
  setLoadingMore: (v: boolean) => void;
  getLoadMoreArmed: () => boolean;
  setLoadMoreArmed: (v: boolean) => void;
  setIsChatAutoScroll: (v: boolean) => void;
  getIsChatAutoScroll: () => boolean;
  setShowChatScrollHint: (v: boolean) => void;
  getScrollToInFlight: () => boolean;
  setScrollToInFlight: (v: boolean) => void;
  getSuppressLoadMoreRearm: () => boolean;
  setSuppressLoadMoreRearm: (v: boolean) => void;
  /** Latch true when the user leaves the bottom — avoids toggling cv-auto at the threshold. */
  setReadingHistory?: (v: boolean) => void;
  setFolderCwdOverride: (v: string) => void;
  reloadProjectData: (cwd: string) => void;
  getPageUrl: () => URL;
  replaceState: (url: URL, state: Record<string, unknown>) => void;
}

export function createScrollNavigation(ctx: ScrollNavigationContext) {
  const {
    store,
    tick,
    getChatAreaRef,
    getFilteredTimeline,
    getVisibleTimeline,
    getToolBursts,
    burstCollapse,
    getProcessVisibility,
    getRenderLimit,
    setRenderLimit,
    getToolFilter,
    setToolFilter,
    setLoadingRunId,
    getLoadingMore,
    setLoadingMore,
    getLoadMoreArmed,
    setLoadMoreArmed,
    setIsChatAutoScroll,
    setShowChatScrollHint,
    setScrollToInFlight,
    getSuppressLoadMoreRearm,
    setSuppressLoadMoreRearm,
    setReadingHistory,
    setFolderCwdOverride,
    reloadProjectData,
    getPageUrl,
    replaceState,
  } = ctx;

  let progressiveGen = 0;

  function cancelProgressive() {
    progressiveGen++;
    setLoadingRunId(null);
    setScrollToInFlight(false);
  }

  function expandRenderLimitTo(targetIndex: number, margin = 50) {
    const ft = getFilteredTimeline();
    if (targetIndex < 0 || targetIndex >= ft.length) return;
    if (getRenderLimit() === Infinity) return;
    const needed = ft.length - targetIndex + margin;
    if (getRenderLimit() < needed) setRenderLimit(Math.min(needed, ft.length));
  }

  async function ensureBurstExpandedFor(visibleIdx: number) {
    if (!burstCollapse.collapsedIndices.has(visibleIdx)) return;
    const bursts = getToolBursts();
    for (const [, burst] of bursts) {
      if (visibleIdx >= burst.startIndex && visibleIdx <= burst.endIndex) {
        burstCollapse.toggleBurst(burst.key);
        await tick();
        return;
      }
    }
  }

  /** First timeline row intersecting the viewport (anchor for scroll restoration). */
  function getViewportAnchor(chatArea: HTMLElement): HTMLElement | null {
    const rootTop = chatArea.getBoundingClientRect().top + 1;
    for (const el of chatArea.querySelectorAll<HTMLElement>("[data-entry-id]")) {
      if (el.getBoundingClientRect().bottom > rootTop) return el;
    }
    return null;
  }

  async function loadMoreEarlier() {
    if (getLoadingMore() || !getLoadMoreArmed()) return;
    const chatArea = getChatAreaRef();
    if (!chatArea) return;

    const ft = getFilteredTimeline();
    const prevRenderLimit = getRenderLimit();
    const nextLimit = Math.min(prevRenderLimit + RENDER_GROWTH_STEP, ft.length);
    if (nextLimit <= prevRenderLimit) return;

    setLoadingMore(true);
    setLoadMoreArmed(false);
    try {
      const anchorEl = getViewportAnchor(chatArea);
      const anchorTop = anchorEl?.getBoundingClientRect().top ?? 0;
      const prevScrollTop = chatArea.scrollTop;
      const prevScrollHeight = chatArea.scrollHeight;

      setRenderLimit(nextLimit);
      await tick();

      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );

      setSuppressLoadMoreRearm(true);
      if (anchorEl?.isConnected) {
        const afterTop = anchorEl.getBoundingClientRect().top;
        chatArea.scrollTop = prevScrollTop + (afterTop - anchorTop);
      } else {
        const heightDelta = chatArea.scrollHeight - prevScrollHeight;
        if (heightDelta > 0) chatArea.scrollTop = prevScrollTop + heightDelta;
      }
      await yieldToMain();
      setSuppressLoadMoreRearm(false);
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadRunProgressive(
    id: string,
    xtermRef?: { clear(): void; writeText(s: string): void },
  ) {
    setToolFilter(null);
    setRenderLimit(getInitialRenderLimit(getProcessVisibility(), store.timeline));
    setLoadingMore(false);
    setLoadMoreArmed(true);
    const gen = ++progressiveGen;
    setLoadingRunId(id);

    const url = getPageUrl();
    const scrollTo = url.searchParams.get("scrollTo");
    if (scrollTo) setScrollToInFlight(true);

    try {
      await store.loadRun(id, xtermRef);
      if (gen !== progressiveGen) return;
      if (id) setFolderCwdOverride("");

      setRenderLimit(getInitialRenderLimit(getProcessVisibility(), store.timeline));

      if (id && store.effectiveCwd) {
        reloadProjectData(store.effectiveCwd);
      }
      if (gen !== progressiveGen) return;

      if (store.mcpServers.length > 0) {
        try {
          const disabledNames = await api.getDisabledMcpServers();
          if (gen !== progressiveGen) return;
          if (disabledNames.length > 0) {
            const disabledSet = new Set(disabledNames);
            const patched = store.mcpServers.map((s) =>
              disabledSet.has(s.name) && s.status !== "disabled" ? { ...s, status: "disabled" } : s,
            );
            if (patched.some((s, i) => s !== store.mcpServers[i])) {
              store.updateMcpServers(patched);
              dbg("chat", "patched MCP disabled state", { disabledNames });
            }
          }
        } catch {
          // non-critical
        }
      }

      if (gen !== progressiveGen) return;
      dbg("chat", "loadRun complete", {
        timeline: getFilteredTimeline().length,
        renderLimit: getRenderLimit(),
        gen,
      });

      if (scrollTo) {
        await tick();
        if (gen !== progressiveGen) return;
        scrollToMessage(scrollTo);
        const clean = new URL(url);
        clean.searchParams.delete("scrollTo");
        replaceState(clean, {});
      } else {
        await tick();
        if (gen !== progressiveGen) return;
        requestAnimationFrame(() => {
          if (gen !== progressiveGen) return;
          const chatArea = getChatAreaRef();
          if (chatArea) {
            markAutoScroll();
            chatArea.scrollTop = chatArea.scrollHeight;
          }
        });
      }
    } finally {
      if (gen === progressiveGen) {
        setLoadingRunId(null);
        if (scrollTo) setScrollToInFlight(false);
      } else if (scrollTo) {
        setScrollToInFlight(false);
      }
    }
  }

  let _scrollRafId = 0;
  // Timestamp of last programmatic scroll-to-bottom (from auto-scroll effect
  // or scrollChatToBottom button).  handleChatScroll suppresses its
  // "not-at-bottom" detection for AUTO_SCROLL_SUPPRESS_MS after this to
  // prevent a race where the scroll handler fires before layout has settled
  // and incorrectly disables auto-scroll, causing the button to flicker.
  let _lastAutoScrollMs = 0;
  const AUTO_SCROLL_SUPPRESS_MS = 600;

  /** Mark that a programmatic auto-scroll just happened. Call this from the
   *  auto-scroll effect and from scrollChatToBottom(). */
  function markAutoScroll() {
    _lastAutoScrollMs = performance.now();
  }

  function handleChatScroll() {
    if (_scrollRafId) return; // coalesce multiple scroll events per frame
    _scrollRafId = requestAnimationFrame(() => {
      _scrollRafId = 0;
      const chatArea = getChatAreaRef();
      if (!chatArea) return;
      const dist = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
      const nearBottom = dist < SCROLL_BOTTOM_THRESHOLD;

      // After a programmatic scroll-to-bottom, suppress the distance check
      // for a short window.  Layout shifts (content-visibility toggling,
      // streaming text reflow) can make dist > threshold even though we
      // just scrolled to the bottom.
      const justAutoScrolled = performance.now() - _lastAutoScrollMs < AUTO_SCROLL_SUPPRESS_MS;
      if (justAutoScrolled && !nearBottom) {
        // We're in the suppress window and not at bottom — likely a stale
        // measurement.  Keep auto-scroll active.
        setIsChatAutoScroll(true);
        setReadingHistory?.(false);
        return;
      }

      setIsChatAutoScroll(nearBottom);
      if (nearBottom) {
        setReadingHistory?.(false);
        setShowChatScrollHint(false);
        if (!getLoadingMore()) setLoadMoreArmed(true);
        return;
      }

      setReadingHistory?.(true);

      if (
        !getLoadingMore() &&
        !getSuppressLoadMoreRearm() &&
        chatArea.scrollTop > LOAD_MORE_REARM_SCROLL
      ) {
        setLoadMoreArmed(true);
      }

      const hidden = getFilteredTimeline().length - getRenderLimit();
      if (hidden > 0 && chatArea.scrollTop <= LOAD_MORE_TOP_THRESHOLD) {
        if (!getLoadMoreArmed()) setLoadMoreArmed(true);
        if (!getLoadingMore()) void loadMoreEarlier();
      }
    });
  }

  function scrollChatToBottom() {
    const chatArea = getChatAreaRef();
    if (!chatArea) return;

    // Temporarily make all content-visibility:auto elements visible so
    // scrollHeight includes their full height — without this, the browser
    // skips layout for off-screen .cv-auto items and scrollTop lands short.
    const cvEls = Array.from(chatArea.querySelectorAll<HTMLElement>(".cv-auto"));
    for (const c of cvEls) c.style.contentVisibility = "visible";

    markAutoScroll();
    chatArea.scrollTop = chatArea.scrollHeight;
    setShowChatScrollHint(false);
    setIsChatAutoScroll(true);
    setReadingHistory?.(false);

    // Restore content-visibility after the browser has painted the scroll
    requestAnimationFrame(() => {
      for (const c of cvEls) c.style.contentVisibility = "";
    });
  }

  async function scrollToTool(toolUseId: string) {
    if (getToolFilter()) {
      setToolFilter(null);
      await tick();
    }
    const ft = getFilteredTimeline();
    const ftIdx = ft.findIndex((e) => e.kind === "tool" && e.tool.tool_use_id === toolUseId);
    if (ftIdx < 0) return;
    expandRenderLimitTo(ftIdx);
    await tick();
    const visibleIdx = getVisibleTimeline().findIndex(
      (e) => e.kind === "tool" && e.tool.tool_use_id === toolUseId,
    );
    if (visibleIdx >= 0) await ensureBurstExpandedFor(visibleIdx);
    const el = document.getElementById("tool-" + toolUseId);
    if (el) {
      const container = getChatAreaRef();
      const cvEls = container
        ? Array.from(container.querySelectorAll<HTMLElement>(".cv-auto"))
        : [];
      for (const c of cvEls) c.style.contentVisibility = "visible";
      el.getBoundingClientRect();
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary/50");
      requestAnimationFrame(() => {
        for (const c of cvEls) c.style.contentVisibility = "";
      });
      setTimeout(() => {
        try {
          el.classList.remove("ring-2", "ring-primary/50");
        } catch {
          /* element removed from DOM */
        }
      }, 2000);
    }
  }

  async function scrollToMessage(ts: string) {
    dbg("chat", "scrollToMessage", { ts });
    if (getToolFilter()) {
      setToolFilter(null);
      await tick();
    }
    const match = store.timeline.find(
      (e) =>
        e.ts === ts || e.anchorId === ts || (e.kind === "user" && e.cliUuid === ts) || e.id === ts,
    );
    if (!match) return;
    const ft = getFilteredTimeline();
    const ftIdx = ft.findIndex((e) => e.id === match.id);
    if (ftIdx < 0) return;
    expandRenderLimitTo(ftIdx);
    await tick();
    const visibleIdx = getVisibleTimeline().findIndex((e) => e.id === match.id);
    if (visibleIdx >= 0) await ensureBurstExpandedFor(visibleIdx);
    const el = document.getElementById("msg-" + match.anchorId);
    if (el) {
      const container = getChatAreaRef();
      const cvEls = container
        ? Array.from(container.querySelectorAll<HTMLElement>(".cv-auto"))
        : [];
      for (const c of cvEls) c.style.contentVisibility = "visible";
      el.getBoundingClientRect();
      el.scrollIntoView({ behavior: "instant", block: "center" });
      el.classList.add("ring-2", "ring-primary/50");
      requestAnimationFrame(() => {
        for (const c of cvEls) c.style.contentVisibility = "";
      });
      setTimeout(() => {
        try {
          el.classList.remove("ring-2", "ring-primary/50");
        } catch {
          /* element removed from DOM */
        }
      }, 2000);
    } else {
      dbg("chat", "scrollToMessage: element not found", { anchor: ts });
    }
  }

  /** Call before scroll events (wheel up) so auto-scroll does not fight the gesture. */
  function latchReadingHistory() {
    setIsChatAutoScroll(false);
    setReadingHistory?.(true);
    setShowChatScrollHint(false);
  }

  function handleChatWheel(e: WheelEvent) {
    if (e.deltaY < 0) latchReadingHistory();
  }

  return {
    cancelProgressive,
    expandRenderLimitTo,
    ensureBurstExpandedFor,
    loadMoreEarlier,
    loadRunProgressive,
    handleChatScroll,
    handleChatWheel,
    latchReadingHistory,
    markAutoScroll,
    scrollChatToBottom,
    scrollToTool,
    scrollToMessage,
  };
}
