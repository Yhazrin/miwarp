<script lang="ts">
  import { onDestroy } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { themeStore } from "$lib/stores/theme-store.svelte";
  import { parseVisualBlock } from "../parse";
  import { renderMermaidSvg } from "../mermaid-loader";
  import { renderVegaLite, type VegaRenderHandle } from "../vega-loader";
  import { VISUAL_LIMITS } from "../limits";
  import type { VisualSummaryKey } from "../registry";
  import type { VisualBlockKind, VisualBlockTone } from "../types";
  import MiwarpProgressBlock from "./MiwarpProgressBlock.svelte";
  import MiwarpKpiBlock from "./MiwarpKpiBlock.svelte";
  import MiwarpTimelineBlock from "./MiwarpTimelineBlock.svelte";

  let {
    kind,
    source,
    summaryKey,
    tone = "default",
  }: {
    kind: VisualBlockKind;
    source: string;
    summaryKey: VisualSummaryKey;
    tone?: VisualBlockTone;
  } = $props();

  let rootEl: HTMLDivElement | undefined = $state();
  let canvasEl: HTMLDivElement | undefined = $state();
  let visibleOnce = $state(false);
  let renderState = $state<"idle" | "loading" | "ready" | "error">("idle");
  let expanded = $state(false);
  let needsCollapse = $state(false);
  let copied = $state(false);
  let mermaidSvg = $state("");

  let vegaHandle: VegaRenderHandle | null = null;
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  let renderToken = 0;

  const parsed = $derived(parseVisualBlock(kind, source));
  const summary = $derived(t(summaryKey));
  const isDark = $derived(themeStore.isDark);
  const showVisualization = $derived(renderState === "ready" && parsed.ok);
  const hostRoot = $derived(rootEl?.closest<HTMLElement>("[data-visual-block]") ?? null);

  const hostToneClass = $derived(
    tone === "on-primary" ? "visual-block-host--on-primary" : "visual-block-host--default",
  );

  function measureCollapse() {
    if (!canvasEl) return;
    needsCollapse = canvasEl.scrollHeight > VISUAL_LIMITS.COLLAPSE_HEIGHT_PX;
  }

  $effect(() => {
    const fallback = hostRoot?.querySelector<HTMLElement>(".visual-block-fallback");
    if (!fallback) return;
    fallback.classList.toggle("visual-block-fallback--hidden", showVisualization);
  });

  $effect(() => {
    if (!rootEl || visibleOnce) return;
    if (typeof IntersectionObserver === "undefined") {
      visibleOnce = true;
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          visibleOnce = true;
          obs.disconnect();
        }
      },
      { rootMargin: "200px 0px" },
    );
    obs.observe(rootEl);
    return () => obs.disconnect();
  });

  $effect(() => {
    if (!visibleOnce || !parsed.ok || !canvasEl) return;

    const block = parsed.block;
    if (
      block.kind === "miwarp-progress" ||
      block.kind === "miwarp-kpi" ||
      block.kind === "miwarp-timeline"
    ) {
      renderState = "ready";
      requestAnimationFrame(measureCollapse);
      return;
    }

    const token = ++renderToken;
    const dark = isDark;
    renderState = "loading";

    void (async () => {
      try {
        if (block.kind === "mermaid") {
          const id = `mermaid-${crypto.randomUUID().replace(/-/g, "")}`;
          const svg = await renderMermaidSvg(block.source, id, dark);
          if (token !== renderToken) return;
          mermaidSvg = svg;
        } else if (block.kind === "vega-lite") {
          vegaHandle?.dispose();
          vegaHandle = await renderVegaLite(canvasEl, block.spec, dark);
          if (token !== renderToken) {
            vegaHandle?.dispose();
            vegaHandle = null;
            return;
          }
        }
        if (token !== renderToken) return;
        renderState = "ready";
        requestAnimationFrame(measureCollapse);
      } catch {
        if (token !== renderToken) return;
        renderState = "error";
      }
    })();

    return () => {
      renderToken++;
      vegaHandle?.dispose();
      vegaHandle = null;
    };
  });

  async function copySource() {
    try {
      await navigator.clipboard.writeText(source);
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copied = false;
        copyTimer = null;
      }, 1500);
    } catch {
      /* ignore */
    }
  }

  onDestroy(() => {
    if (copyTimer) clearTimeout(copyTimer);
    vegaHandle?.dispose();
    vegaHandle = null;
  });
</script>

<div
  bind:this={rootEl}
  class="visual-block-panel {hostToneClass}"
  data-visual-render-state={renderState}
>
  <div class="visual-block-toolbar">
    <span class="visual-block-kind" aria-hidden="true">{kind}</span>
    <span class="visual-block-summary sr-only">{summary}</span>
    <div class="visual-block-actions">
      <button type="button" class="visual-block-copy" onclick={copySource}>
        {copied ? t("visual_block_copied") : t("visual_block_copySource")}
      </button>
      {#if needsCollapse}
        <button
          type="button"
          class="visual-block-toggle"
          aria-expanded={expanded}
          onclick={() => (expanded = !expanded)}
        >
          {expanded ? t("visual_block_collapse") : t("visual_block_expand")}
        </button>
      {/if}
    </div>
  </div>

  <div
    class="visual-block-canvas"
    class:visual-block-canvas--collapsed={needsCollapse && !expanded}
    bind:this={canvasEl}
    role="img"
    aria-label={summary}
  >
    {#if !visibleOnce || renderState === "idle" || renderState === "loading"}
      <p class="visual-block-loading" aria-live="polite">{t("visual_block_loading")}</p>
    {:else if renderState === "error" || !parsed.ok}
      <p class="visual-block-error" role="alert">{t("visual_block_renderError")}</p>
    {:else if parsed.block.kind === "mermaid"}
      {@html mermaidSvg}
    {:else if parsed.block.kind === "miwarp-progress"}
      <MiwarpProgressBlock spec={parsed.block.spec} {tone} />
    {:else if parsed.block.kind === "miwarp-kpi"}
      <MiwarpKpiBlock spec={parsed.block.spec} {tone} />
    {:else if parsed.block.kind === "miwarp-timeline"}
      <MiwarpTimelineBlock spec={parsed.block.spec} {tone} />
    {/if}
  </div>
</div>

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .visual-block-panel {
    border-radius: 0.625rem;
    border: 1px solid hsl(var(--border) / 0.5);
    background: hsl(var(--muted) / 0.35);
    margin: 0.5rem 0;
    overflow: hidden;
  }

  .visual-block-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.3125rem 0.75rem;
    border-bottom: 1px solid hsl(var(--border) / 0.35);
  }

  .visual-block-kind {
    font-size: 0.6875rem;
    font-weight: 500;
    color: hsl(var(--muted-foreground));
    text-transform: lowercase;
  }

  .visual-block-actions {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-left: auto;
  }

  .visual-block-copy,
  .visual-block-toggle {
    font-size: 0.6875rem;
    color: hsl(var(--muted-foreground));
    background: transparent;
    border: none;
    border-radius: 0.375rem;
    padding: 0.125rem 0.5rem;
    cursor: pointer;
    font-family: inherit;
  }

  .visual-block-copy:hover,
  .visual-block-toggle:hover {
    color: hsl(var(--foreground));
    background: hsl(var(--accent));
  }

  .visual-block-canvas {
    padding: 0.75rem;
    overflow-x: auto;
    max-width: 100%;
  }

  .visual-block-canvas--collapsed {
    max-height: 320px;
    overflow-y: hidden;
    position: relative;
  }

  .visual-block-canvas--collapsed::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3rem;
    pointer-events: none;
    background: linear-gradient(to bottom, transparent, hsl(var(--muted) / 0.9));
  }

  .visual-block-loading,
  .visual-block-error {
    margin: 0;
    font-size: 0.8125rem;
    color: hsl(var(--muted-foreground));
  }

  :global(.visual-block-canvas svg) {
    max-width: 100%;
    height: auto;
  }

  :global(.visual-block-fallback--hidden) {
    display: none;
  }
</style>
