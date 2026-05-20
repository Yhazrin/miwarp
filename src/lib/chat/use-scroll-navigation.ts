import * as api from "$lib/api";
import { dbg } from "$lib/utils/debug";
import { yieldToMain } from "$lib/utils/yield";
import { getInitialRenderLimit } from "$lib/chat/selectors/timeline-presentation";
import type { ProcessVisibility } from "$lib/utils/process-visibility";
import type { SessionStore } from "$lib/stores/session-store.svelte";
import type { TimelineEntry } from "$lib/types";
import type { ToolBurst } from "$lib/utils/tool-rendering";
import type { BurstCollapseHandle } from "$lib/chat/use-tool-burst-collapse.svelte";

const RENDER_GROWTH_STEP = 100;
const SCROLL_BOTTOM_THRESHOLD = 40;

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
    getLoadingRunId,
    setLoadingRunId,
    getLoadingMore,
    setLoadingMore,
    getLoadMoreArmed,
    setLoadMoreArmed,
    setIsChatAutoScroll,
    getIsChatAutoScroll,
    setShowChatScrollHint,
    getScrollToInFlight,
    setScrollToInFlight,
    getSuppressLoadMoreRearm,
    setSuppressLoadMoreRearm,
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

  async function loadMoreEarlier() {
    if (getLoadingMore() || !getLoadMoreArmed()) return;
    setLoadingMore(true);
    setLoadMoreArmed(false);
    try {
      const chatArea = getChatAreaRef();
      const anchor = chatArea?.querySelector<HTMLElement>("[data-entry-id]") ?? null;
      const anchorId = anchor?.dataset.entryId ?? null;
      const beforeTop = anchor?.getBoundingClientRect().top ?? 0;
      const beforeScroll = chatArea?.scrollTop ?? 0;

      const ft = getFilteredTimeline();
      setRenderLimit(Math.min(getRenderLimit() + RENDER_GROWTH_STEP, ft.length));
      await tick();
      await yieldToMain();

      if (anchorId && chatArea) {
        let after: HTMLElement | null = null;
        try {
          after = chatArea.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(anchorId)}"]`);
        } catch {
          after =
            Array.from(chatArea.querySelectorAll<HTMLElement>("[data-entry-id]")).find(
              (el) => el.dataset.entryId === anchorId,
            ) ?? null;
        }
        if (after) {
          const afterTop = after.getBoundingClientRect().top;
          setSuppressLoadMoreRearm(true);
          chatArea.scrollTop = beforeScroll + (afterTop - beforeTop);
          await yieldToMain();
          setSuppressLoadMoreRearm(false);
        }
      }
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
          if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
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
  function handleChatScroll() {
    if (_scrollRafId) return; // coalesce multiple scroll events per frame
    _scrollRafId = requestAnimationFrame(() => {
      _scrollRafId = 0;
      const chatArea = getChatAreaRef();
      if (!chatArea) return;
      const dist = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
      const nearBottom = dist < SCROLL_BOTTOM_THRESHOLD;
      setIsChatAutoScroll(nearBottom);
      if (nearBottom) setShowChatScrollHint(false);
      if (!getLoadMoreArmed() && !getSuppressLoadMoreRearm()) setLoadMoreArmed(true);
    });
  }

  function scrollChatToBottom() {
    const chatArea = getChatAreaRef();
    if (chatArea) {
      chatArea.scrollTop = chatArea.scrollHeight;
      setShowChatScrollHint(false);
      setIsChatAutoScroll(true);
    }
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
      setTimeout(() => el.classList.remove("ring-2", "ring-primary/50"), 2000);
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
        el!.classList.remove("ring-2", "ring-primary/50");
      }, 2000);
    } else {
      dbg("chat", "scrollToMessage: element not found", { anchor: ts });
    }
  }

  return {
    cancelProgressive,
    expandRenderLimitTo,
    ensureBurstExpandedFor,
    loadMoreEarlier,
    loadRunProgressive,
    handleChatScroll,
    scrollChatToBottom,
    scrollToTool,
    scrollToMessage,
  };
}
