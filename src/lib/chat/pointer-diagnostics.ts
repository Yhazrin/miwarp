/**
 * DEV-only diagnostics for clicks that appear to hit a different stacked element than the event target
 * or pass through macOS/WebKit drag regions. Does not ship behavior to production bundles meaningfully.
 */
import { get } from "svelte/store";
import { page } from "$app/stores";
import { dbg } from "$lib/utils/debug";
import { isWindowDragInteractiveTarget } from "$lib/utils/window-drag";

export function installChatPointerDiagnostics(opts: {
  getPageDragActive: () => boolean;
  getDragProcessingCount: () => number;
  getRunId: () => string | undefined;
  getPhase: () => string;
}): () => void {
  if (!import.meta.env.DEV) return () => {};

  function onMouseDownCapture(ev: MouseEvent) {
    if (ev.button !== 0 || ev.defaultPrevented) return;
    const top = document.elementFromPoint(ev.clientX, ev.clientY);
    const t = ev.target;
    let mismatch = false;
    if (t instanceof Node && top instanceof Node && t !== top) {
      mismatch = !(top instanceof Element &&
      t instanceof Node &&
      typeof (top as Element).contains === "function"
        ? (top as Element).contains(t as Node)
        : false);
    }
    const dragRegionHit = top instanceof Element ? top.closest("[data-tauri-drag-region]") : null;
    const topInteractive = top instanceof HTMLElement && isWindowDragInteractiveTarget(top);

    const shouldLog =
      opts.getPageDragActive() ||
      opts.getDragProcessingCount() > 0 ||
      (!!dragRegionHit && !topInteractive) ||
      mismatch;

    if (!shouldLog) return;

    const p = get(page);
    dbg("pointer-diag", "mousedown (dev)", {
      mismatch,
      pageDragActive: opts.getPageDragActive(),
      dragProcessingCount: opts.getDragProcessingCount(),
      runId: opts.getRunId(),
      phase: opts.getPhase(),
      routePath: `${p.url.pathname}${p.url.search}`,
      targetTag: t instanceof HTMLElement ? t.tagName : typeof t,
      topTag: top instanceof HTMLElement ? top.tagName : typeof top,
      dragRegionAncestor: dragRegionHit
        ? `${(dragRegionHit as HTMLElement).tagName}.${(dragRegionHit as HTMLElement).className}`
        : null,
      topWindowDragMatched: opts.getPageDragActive() ? "(see overlay/drag)" : undefined,
      elementFromPointClass:
        top instanceof HTMLElement ? top.getAttribute("class")?.slice(0, 80) : undefined,
    });
  }

  window.addEventListener("mousedown", onMouseDownCapture, true);
  return () => window.removeEventListener("mousedown", onMouseDownCapture, true);
}
