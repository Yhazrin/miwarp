<script lang="ts">
  /**
   * MermaidInteractive — wraps a rendered mermaid SVG with a transform layer
   * (pan + zoom + reset), a hover highlight, a node tooltip, and a
   * fullscreen overlay. Pure DOM/CSS transform, no mermaid API dependency,
   * so theme switches / re-renders are decoupled.
   *
   * The "send this node to AI" action (L6) is added in the follow-up task —
   * the stage already owns the node graph index so the new behavior can
   * hook into the same data without re-querying the DOM.
   */
  import { onDestroy } from "svelte";
  import { buildEdgeAdjacency, nodeIdFromElementId, parseNodeCommentMap } from "../mermaid-graph";
  import { getChatInputHandle } from "$lib/chat/chat-input-registry";
  import { t } from "$lib/i18n/index.svelte";

  let { svg, source = "" }: { svg: string; source?: string } = $props();

  const MIN_SCALE = 0.25;
  const MAX_SCALE = 4;
  const ZOOM_STEP = 1.25;
  const DRAG_THRESHOLD_PX = 3;

  let scale = $state(1);
  let translateX = $state(0);
  let translateY = $state(0);
  let isFullscreen = $state(false);

  let stageEl: HTMLDivElement | undefined = $state();
  let canvasEl: HTMLDivElement | undefined = $state();
  let fullscreenEl: HTMLDivElement | undefined = $state();

  // Drag state: `dragOrigin` and `dragPointerId` are raw event-handler
  // scratch space (no $state, written and read inside pointer handlers).
  // `dragStarted` is reactive because the stage's CSS class depends on it.
  let dragOrigin: { x: number; y: number; tx: number; ty: number } | null = null;
  let dragStarted = $state(false);
  let dragPointerId: number | null = null;

  // Compose the transform string once per tick; reactive $derived keeps
  // the matrix in sync with state without imperative DOM writes.
  const transform = $derived(`translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`);
  const scaleLabel = $derived(`${Math.round(scale * 100)}%`);

  function clampScale(value: number): number {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
  }

  function zoomAtPoint(anchorX: number, anchorY: number, nextScale: number): void {
    const stage = stageEl;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const localX = anchorX - rect.left;
    const localY = anchorY - rect.top;
    const clamped = clampScale(nextScale);
    if (clamped === scale) return;
    // Keep the anchor point stationary in stage space. The math:
    //   worldX = (localX - oldTx) / oldScale
    //   newTx  = localX - worldX * newScale
    const ratio = clamped / scale;
    translateX = localX - (localX - translateX) * ratio;
    translateY = localY - (localY - translateY) * ratio;
    scale = clamped;
  }

  function zoomIn(): void {
    const stage = stageEl;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, scale * ZOOM_STEP);
  }

  function zoomOut(): void {
    const stage = stageEl;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, scale / ZOOM_STEP);
  }

  function reset(): void {
    scale = 1;
    translateX = 0;
    translateY = 0;
  }

  function toggleFullscreen(): void {
    isFullscreen = !isFullscreen;
  }

  function closeFullscreen(): void {
    isFullscreen = false;
  }

  function handleWheel(e: WheelEvent): void {
    // Wheel must not scroll the chat behind the diagram.
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) return; // pinch-zoom on macOS trackpad
    // Trackpad pinch arrives as ctrlKey+wheel in Chromium; treat the same.
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomAtPoint(e.clientX, e.clientY, scale * factor);
  }

  function handlePointerDown(e: PointerEvent): void {
    // Don't grab drags that started on a node — those should hit-test the
    // node for future L6 (click-to-prompt) interactions. Background only.
    const target = e.target as Element | null;
    if (target?.closest(".node, .cluster, .edgeLabel, .flowchart-link, .edgePath, .marker")) {
      return;
    }
    dragOrigin = {
      x: e.clientX,
      y: e.clientY,
      tx: translateX,
      ty: translateY,
    };
    dragStarted = false;
    dragPointerId = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent): void {
    if (!dragOrigin || e.pointerId !== dragPointerId) return;
    const dx = e.clientX - dragOrigin.x;
    const dy = e.clientY - dragOrigin.y;
    if (!dragStarted) {
      // Only commit to a drag after the user has moved past the threshold —
      // this keeps small jitter from cancelling click handlers.
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragStarted = true;
    }
    translateX = dragOrigin.tx + dx;
    translateY = dragOrigin.ty + dy;
  }

  function handlePointerUp(e: PointerEvent): void {
    if (e.pointerId !== dragPointerId) return;
    const wasDrag = dragStarted;
    dragOrigin = null;
    dragStarted = false;
    dragPointerId = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released by the browser */
    }
    if (wasDrag) {
      // Suppress the synthetic click that follows a drag.
      e.stopPropagation();
    }
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      if (popover) closePopover();
      else closeFullscreen();
    }
  }

  // Reset transform when the SVG content changes (theme switch, new diagram).
  // Mermaid re-renders on every source change, so the previous zoom state
  // is no longer meaningful.
  let lastSvg: string | null = null;
  $effect(() => {
    if (svg !== lastSvg) {
      lastSvg = svg;
      scale = 1;
      translateX = 0;
      translateY = 0;
    }
  });

  // Esc to exit fullscreen works globally; we attach to the overlay only
  // to avoid catching keys meant for the chat input.
  $effect(() => {
    if (!isFullscreen) return;
    const overlay = fullscreenEl;
    if (!overlay) return;
    overlay.focus();
  });

  // ── Hover highlight + tooltip (L2 / L4) ─────────────────────────────
  // The comment map is derived from the raw mermaid source; the adjacency
  // map is built from the rendered DOM (`.flowchart-link` data-ids). Both
  // are recomputed on every svg / source change — they're cheap and the
  // previous indices are no longer valid once mermaid re-renders.
  const commentMap = $derived(parseNodeCommentMap(source));

  let tooltip = $state<{ x: number; y: number; text: string } | null>(null);
  let popover = $state<{
    x: number;
    y: number;
    nodeId: string;
    nodeText: string;
  } | null>(null);
  let copiedFlag = $state<string | null>(null);

  function clearHover(): void {
    tooltip = null;
  }

  function closePopover(): void {
    popover = null;
    copiedFlag = null;
  }

  function getNodeText(nodeEl: SVGGElement): string {
    // The visible label is split across one or more <tspan> children of
    // the <text> element inside the node group. Joining with a single
    // space is good enough for prompt-template use; users can edit.
    const textEl = nodeEl.querySelector("text");
    if (textEl?.textContent) {
      return textEl.textContent.replace(/\s+/g, " ").trim();
    }
    return nodeEl.id;
  }

  function handleNodeEnter(nodeEl: SVGGElement, nodeId: string): void {
    // Highlight the node itself.
    nodeEl.classList.add("is-hovered");
    // Highlight every edge that touches this node. Build the adjacency
    // lazily so the very first hover (which is often the first time the
    // user touches the diagram) doesn't pay a cost at mount time.
    const svgEl = nodeEl.ownerSVGElement;
    if (svgEl) {
      const adj = buildEdgeAdjacency(svgEl);
      const edges = adj.get(nodeId);
      if (edges) {
        for (const edge of edges) edge.classList.add("is-highlighted");
      }
    }
    // Tooltip with the source-level `// 注释` for this node, if any.
    const comment = commentMap.get(nodeId);
    if (comment && stageEl) {
      const nodeRect = nodeEl.getBoundingClientRect();
      const stageRect = stageEl.getBoundingClientRect();
      tooltip = {
        x: nodeRect.left - stageRect.left + nodeRect.width / 2,
        y: nodeRect.top - stageRect.top - 6,
        text: comment,
      };
    }
  }

  function handleNodeLeave(nodeEl: SVGGElement): void {
    nodeEl.classList.remove("is-hovered");
    const svgEl = nodeEl.ownerSVGElement;
    if (svgEl) {
      const highlighted = svgEl.querySelectorAll<SVGPathElement>(".flowchart-link.is-highlighted");
      for (const edge of highlighted) edge.classList.remove("is-highlighted");
    }
    clearHover();
  }

  function handleNodeDblClick(nodeEl: SVGGElement, nodeId: string): void {
    if (!stageEl) return;
    const nodeRect = nodeEl.getBoundingClientRect();
    const stageRect = stageEl.getBoundingClientRect();
    popover = {
      x: nodeRect.left - stageRect.left + nodeRect.width / 2,
      y: nodeRect.bottom - stageRect.top + 8,
      nodeId,
      nodeText: getNodeText(nodeEl),
    };
    copiedFlag = null;
  }

  async function copyToClipboard(text: string, flashKey: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copiedFlag = flashKey;
      setTimeout(() => {
        if (copiedFlag === flashKey) copiedFlag = null;
      }, 1500);
    } catch {
      // Clipboard write can fail in iframes / insecure contexts. Silently
      // ignore — the user can still select and copy manually.
    }
  }

  function sendToPrompt(): void {
    if (!popover) return;
    const handle = getChatInputHandle();
    if (!handle) return;
    const text = popover.nodeText;
    const template = t("visual_block_mermaid_promptTemplate", { text });
    handle.setValue(template);
    handle.focus();
    closePopover();
  }

  function handleStageClick(e: MouseEvent): void {
    if (!popover) return;
    const target = e.target as Element | null;
    if (target?.closest(".mermaid-popover")) return;
    closePopover();
  }

  // Bind / unbind hover + dblclick listeners on every render. The previous
  // SVG is discarded together with its listeners, so there's no leak even
  // on repeated theme switches.
  $effect(() => {
    if (!svg || !canvasEl) return;
    const svgEl = canvasEl.querySelector<SVGSVGElement>("svg");
    if (!svgEl) return;
    const nodes = Array.from(svgEl.querySelectorAll<SVGGElement>(".node"));
    const enterHandlers = new Map<SVGGElement, (e: Event) => void>();
    const leaveHandlers = new Map<SVGGElement, (e: Event) => void>();
    const dblClickHandlers = new Map<SVGGElement, (e: Event) => void>();
    for (const nodeEl of nodes) {
      const id = nodeIdFromElementId(nodeEl.id);
      if (!id) continue;
      const enter = () => handleNodeEnter(nodeEl, id);
      const leave = () => handleNodeLeave(nodeEl);
      const dbl = (e: Event) => {
        e.stopPropagation();
        handleNodeDblClick(nodeEl, id);
      };
      nodeEl.addEventListener("mouseenter", enter);
      nodeEl.addEventListener("mouseleave", leave);
      nodeEl.addEventListener("dblclick", dbl);
      enterHandlers.set(nodeEl, enter);
      leaveHandlers.set(nodeEl, leave);
      dblClickHandlers.set(nodeEl, dbl);
    }
    return () => {
      for (const [el, fn] of enterHandlers) el.removeEventListener("mouseenter", fn);
      for (const [el, fn] of leaveHandlers) el.removeEventListener("mouseleave", fn);
      for (const [el, fn] of dblClickHandlers) el.removeEventListener("dblclick", fn);
    };
  });

  // Clear the tooltip whenever the transform changes — the tooltip is
  // anchored to the node's hover-time screen position, and a pan/zoom
  // would leave it stuck in mid-air while the node moves out from under.
  $effect(() => {
    // Touch the three transform values so Svelte tracks them as deps.
    void scale;
    void translateX;
    void translateY;
    tooltip = null;
  });

  onDestroy(() => {
    dragOrigin = null;
  });
</script>

<div class="mermaid-interactive">
  <div class="mermaid-toolbar" role="toolbar" aria-label={t("visual_block_mermaid_toolbar")}>
    <button
      type="button"
      class="mermaid-toolbar-btn"
      onclick={zoomOut}
      disabled={scale <= MIN_SCALE}
      aria-label={t("visual_block_mermaid_zoomOut")}
      title={t("visual_block_mermaid_zoomOut")}
    >
      −
    </button>
    <span class="mermaid-toolbar-scale" aria-live="polite">{scaleLabel}</span>
    <button
      type="button"
      class="mermaid-toolbar-btn"
      onclick={zoomIn}
      disabled={scale >= MAX_SCALE}
      aria-label={t("visual_block_mermaid_zoomIn")}
      title={t("visual_block_mermaid_zoomIn")}
    >
      +
    </button>
    <span class="mermaid-toolbar-divider" aria-hidden="true"></span>
    <button
      type="button"
      class="mermaid-toolbar-btn"
      onclick={reset}
      disabled={scale === 1 && translateX === 0 && translateY === 0}
      aria-label={t("visual_block_mermaid_reset")}
      title={t("visual_block_mermaid_reset")}
    >
      {t("visual_block_mermaid_reset")}
    </button>
    <button
      type="button"
      class="mermaid-toolbar-btn"
      onclick={toggleFullscreen}
      aria-label={t("visual_block_mermaid_fullscreen")}
      title={t("visual_block_mermaid_fullscreen")}
    >
      {isFullscreen
        ? t("visual_block_mermaid_exitFullscreen")
        : t("visual_block_mermaid_fullscreen")}
    </button>
  </div>

  <!--
    The stage is an interactive pan/zoom surface; svelte's a11y linter
    flags role="application" as non-interactive and refuses tabindex ≥ 0,
    but both are correct here — keyboard users need focus to receive
    wheel-zoom, and the canvas is the click target for popover dismiss.
  -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={stageEl}
    class="mermaid-stage"
    class:mermaid-stage--dragging={dragStarted}
    class:mermaid-stage--fullscreen={isFullscreen}
    role="application"
    aria-label={t("visual_block_mermaid_summary")}
    tabindex="0"
    onwheel={handleWheel}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
    onclick={handleStageClick}
    onkeydown={handleKey}
  >
    <div bind:this={canvasEl} class="mermaid-canvas" style="transform: {transform};">
      {@html svg}
    </div>

    {#if tooltip}
      <div class="mermaid-tooltip" role="tooltip" style="left: {tooltip.x}px; top: {tooltip.y}px;">
        {tooltip.text}
      </div>
    {/if}

    {#if popover}
      <div
        class="mermaid-popover"
        role="dialog"
        tabindex="-1"
        aria-label={t("visual_block_mermaid_popover")}
        style="left: {popover.x}px; top: {popover.y}px;"
      >
        <div class="mermaid-popover-text">{popover.nodeText}</div>
        <div class="mermaid-popover-actions">
          <button
            type="button"
            class="mermaid-popover-btn"
            onclick={() => copyToClipboard(popover!.nodeText, "text")}
          >
            {copiedFlag === "text" ? t("visual_block_copied") : t("visual_block_mermaid_copyText")}
          </button>
          <button
            type="button"
            class="mermaid-popover-btn"
            onclick={() => copyToClipboard(popover!.nodeId, "id")}
          >
            {copiedFlag === "id" ? t("visual_block_copied") : t("visual_block_mermaid_copyId")}
          </button>
          {#if getChatInputHandle()}
            <button
              type="button"
              class="mermaid-popover-btn mermaid-popover-btn--primary"
              onclick={sendToPrompt}
            >
              {t("visual_block_mermaid_sendToPrompt")}
            </button>
          {/if}
        </div>
      </div>
    {/if}

    {#if isFullscreen}
      <div
        bind:this={fullscreenEl}
        class="mermaid-fullscreen"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        onkeydown={handleKey}
      >
        <button
          type="button"
          class="mermaid-fullscreen-close"
          onclick={closeFullscreen}
          aria-label={`${t("visual_block_mermaid_exitFullscreen")} (Esc)`}
          title={`${t("visual_block_mermaid_exitFullscreen")} (Esc)`}
        >
          ✕
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .mermaid-interactive {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    width: 100%;
  }

  .mermaid-toolbar {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    background: hsl(var(--muted) / 0.45);
    border: 1px solid hsl(var(--border) / 0.3);
    border-radius: 0.375rem;
  }

  .mermaid-toolbar-btn {
    font-size: 0.75rem;
    line-height: 1;
    color: hsl(var(--muted-foreground));
    background: transparent;
    border: none;
    border-radius: 0.25rem;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    font-family: inherit;
    transition:
      color 0.15s,
      background-color 0.15s;
  }
  .mermaid-toolbar-btn:hover:not(:disabled) {
    color: hsl(var(--foreground));
    background: hsl(var(--accent));
  }
  .mermaid-toolbar-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .mermaid-toolbar-scale {
    min-width: 3rem;
    text-align: center;
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
    color: hsl(var(--muted-foreground));
  }

  .mermaid-toolbar-divider {
    width: 1px;
    height: 0.875rem;
    background: hsl(var(--border) / 0.4);
    margin: 0 0.25rem;
  }

  /* Stage — the pan/zoom viewport. Background drag only — pointer events
     on .node / .cluster / .edgeLabel propagate to children so future
     hover/click features keep working. */
  .mermaid-stage {
    position: relative;
    overflow: hidden;
    /* `grab` lets the user know the canvas is draggable; flips to `grabbing`
       while a drag is in flight via .mermaid-stage--dragging. */
    cursor: grab;
    touch-action: none;
    user-select: none;
    border-radius: 0.5rem;
    background: hsl(var(--background) / 0.35);
    border: 1px solid hsl(var(--border) / 0.18);
    /* Reserve some height so the stage has presence before the SVG paints. */
    min-height: 6rem;
  }
  .mermaid-stage--dragging {
    cursor: grabbing;
  }
  .mermaid-stage--fullscreen {
    position: fixed;
    inset: 0;
    z-index: 9999;
    border-radius: 0;
    background: hsl(var(--background));
    border: none;
  }

  .mermaid-canvas {
    transform-origin: 0 0;
    /* transform is set inline via the $derived `transform` constant so
       high-frequency drag updates don't run a CSS transition each tick. */
    will-change: transform;
  }

  /* Let the diagram's own <svg> fill the canvas, with a sensible default
     size so very small diagrams still center. The mermaid-rendered <svg>
     carries `width="100%"` so it stretches naturally. */
  .mermaid-canvas :global(svg) {
    display: block;
    margin: 0 auto;
    max-width: 100%;
    height: auto;
    font-family: inherit;
  }

  /* Fullscreen overlay scrim — sits above the stage but below the close
     button. Only rendered when isFullscreen; the body lock is the
     focus-trap on the overlay element via tabindex. */
  .mermaid-fullscreen {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  /* ── Hover highlight (L2) ─────────────────────────────────────────
     Stroke a bright outline around the hovered node, and lift the
     connected edges' stroke width so the relationship is unmistakable.
     The classes are added to mermaid-rendered <g> / <path> elements
     from the hover handlers above; because those elements are produced
     by {@html}, we need :global() to reach them. */
  .mermaid-canvas :global(.node.is-hovered) {
    cursor: pointer;
  }
  .mermaid-canvas :global(.node.is-hovered rect),
  .mermaid-canvas :global(.node.is-hovered circle),
  .mermaid-canvas :global(.node.is-hovered ellipse),
  .mermaid-canvas :global(.node.is-hovered polygon),
  .mermaid-canvas :global(.node.is-hovered path.basic),
  .mermaid-canvas :global(.node.is-hovered path.label-container) {
    stroke: hsl(var(--primary));
    stroke-width: 2px;
    filter: drop-shadow(0 0 6px hsl(var(--primary) / 0.45));
  }
  .mermaid-canvas :global(.flowchart-link.is-highlighted) {
    stroke: hsl(var(--primary));
    stroke-width: 2px;
    filter: drop-shadow(0 0 4px hsl(var(--primary) / 0.4));
  }
  .mermaid-canvas :global(.edgePath.is-highlighted .path) {
    stroke: hsl(var(--primary));
    stroke-width: 2px;
  }

  /* ── Node tooltip (L4) ──────────────────────────────────────────
     Floats above the diagram at the node's screen position, anchored
     to the bottom-center of the node. Stays inside the stage so it
     inherits the stage's positioning context (which flips to fixed
     in fullscreen mode without us doing anything special). */
  .mermaid-tooltip {
    position: absolute;
    transform: translate(-50%, -100%);
    max-width: 18rem;
    padding: 0.375rem 0.625rem;
    background: hsl(var(--popover));
    color: hsl(var(--popover-foreground));
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: 0.375rem;
    font-size: 0.75rem;
    line-height: 1.4;
    box-shadow:
      0 4px 12px hsl(var(--background) / 0.45),
      0 0 0 1px hsl(var(--border) / 0.1);
    pointer-events: none;
    z-index: 2;
    /* Soft fade in so the tooltip doesn't pop. */
    animation: mermaid-tooltip-in 120ms ease-out both;
  }
  @keyframes mermaid-tooltip-in {
    from {
      opacity: 0;
      transform: translate(-50%, calc(-100% + 4px));
    }
    to {
      opacity: 1;
      transform: translate(-50%, -100%);
    }
  }

  /* ── Node action popover (L6) ─────────────────────────────────────
     Anchored to the node's bottom-center, opens on dblclick. The first
     row shows the node's visible label so the user has a final chance
     to confirm before acting; the action row is a button group styled
     like the rest of the visual-block toolbar. */
  .mermaid-popover {
    position: absolute;
    transform: translateX(-50%);
    min-width: 12rem;
    max-width: 22rem;
    background: hsl(var(--popover));
    color: hsl(var(--popover-foreground));
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: 0.5rem;
    box-shadow:
      0 8px 24px hsl(var(--background) / 0.55),
      0 0 0 1px hsl(var(--border) / 0.1);
    z-index: 3;
    overflow: hidden;
    animation: mermaid-popover-in 140ms ease-out both;
  }
  @keyframes mermaid-popover-in {
    from {
      opacity: 0;
      transform: translate(-50%, -6px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%);
    }
  }
  .mermaid-popover-text {
    padding: 0.5rem 0.75rem;
    font-size: 0.8125rem;
    line-height: 1.35;
    border-bottom: 1px solid hsl(var(--border) / 0.35);
    color: hsl(var(--foreground));
    word-break: break-word;
  }
  .mermaid-popover-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    padding: 0.375rem;
  }
  .mermaid-popover-btn {
    flex: 1 1 auto;
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
    background: transparent;
    border: 1px solid hsl(var(--border) / 0.3);
    border-radius: 0.3125rem;
    padding: 0.3125rem 0.625rem;
    cursor: pointer;
    font-family: inherit;
    white-space: nowrap;
    transition:
      color 0.15s,
      background-color 0.15s,
      border-color 0.15s;
  }
  .mermaid-popover-btn:hover {
    color: hsl(var(--foreground));
    background: hsl(var(--accent));
    border-color: hsl(var(--border) / 0.5);
  }
  .mermaid-popover-btn--primary {
    color: hsl(var(--primary-foreground));
    background: hsl(var(--primary));
    border-color: hsl(var(--primary));
  }
  .mermaid-popover-btn--primary:hover {
    color: hsl(var(--primary-foreground));
    background: hsl(var(--primary) / 0.88);
    border-color: hsl(var(--primary) / 0.88);
  }
  .mermaid-fullscreen-close {
    position: absolute;
    top: 1rem;
    right: 1rem;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 9999px;
    background: hsl(var(--muted) / 0.85);
    color: hsl(var(--foreground));
    border: 1px solid hsl(var(--border) / 0.4);
    cursor: pointer;
    pointer-events: auto;
    font-size: 0.875rem;
    line-height: 1;
    transition:
      background-color 0.15s,
      transform 0.15s;
  }
  .mermaid-fullscreen-close:hover {
    background: hsl(var(--accent));
    transform: scale(1.05);
  }
</style>
