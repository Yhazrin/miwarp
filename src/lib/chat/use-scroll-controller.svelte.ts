/**
 * Composable: scroll-to message/tool within the chat area.
 *
 * Manages scroll-to navigation (both tool cards and message entries) with
 * burst expansion, filter clearing, and progressive render limit expansion.
 */
import { tick } from "svelte";
import { dbg } from "$lib/utils/debug";
import type { TimelineEntry } from "$lib/types";
import type { ToolBurst } from "$lib/utils/tool-rendering";

export function useScrollController(opts: {
  chatAreaRef: () => HTMLDivElement | undefined;
  getStore: () => { timeline: TimelineEntry[] };
  getFilteredTimeline: () => TimelineEntry[];
  getVisibleTimeline: () => TimelineEntry[];
  getToolFilter: () => string | null;
  setToolFilter: (v: string | null) => void;
  expandRenderLimitTo: (targetIndex: number, margin?: number) => void;
  ensureBurstExpandedFor: (visibleIndex: number) => Promise<void>;
}) {
  async function scrollToTool(toolUseId: string) {
    if (opts.getToolFilter()) {
      opts.setToolFilter(null);
      await tick();
    }
    const ft = opts.getFilteredTimeline();
    const ftIdx = ft.findIndex((e) => e.kind === "tool" && e.tool.tool_use_id === toolUseId);
    if (ftIdx < 0) return;
    opts.expandRenderLimitTo(ftIdx);
    await tick();
    const visibleIdx = opts
      .getVisibleTimeline()
      .findIndex((e) => e.kind === "tool" && e.tool.tool_use_id === toolUseId);
    if (visibleIdx >= 0) await opts.ensureBurstExpandedFor(visibleIdx);
    const el = document.getElementById("tool-" + toolUseId);
    if (el) {
      const container = opts.chatAreaRef();
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
    if (opts.getToolFilter()) {
      opts.setToolFilter(null);
      await tick();
    }
    const match = opts
      .getStore()
      .timeline.find(
        (e) =>
          e.ts === ts ||
          e.anchorId === ts ||
          (e.kind === "user" && e.cliUuid === ts) ||
          e.id === ts,
      );
    if (!match) return;
    const ft = opts.getFilteredTimeline();
    const ftIdx = ft.findIndex((e) => e.id === match.id);
    if (ftIdx < 0) return;
    opts.expandRenderLimitTo(ftIdx);
    await tick();
    const visibleIdx = opts.getVisibleTimeline().findIndex((e) => e.id === match.id);
    if (visibleIdx >= 0) await opts.ensureBurstExpandedFor(visibleIdx);
    const el = document.getElementById("msg-" + match.anchorId);
    if (el) {
      const container = opts.chatAreaRef();
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
        el.classList.remove("ring-2", "ring-primary/50");
      }, 2000);
    } else {
      dbg("chat", "scrollToMessage: element not found", { anchor: ts });
    }
  }

  return { scrollToTool, scrollToMessage };
}
