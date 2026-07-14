<script lang="ts">
  import { renderMarkdown, stabilizeStreamingMarkdown } from "$lib/utils/markdown";
  import { readFileBase64 } from "$lib/api";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { mountVisualBlocks } from "$lib/visual-blocks";
  import { onDestroy } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import StreamingVisualContent from "$lib/visual-blocks/components/StreamingVisualContent.svelte";

  const MARKDOWN_HTML_CACHE_MAX = 256;
  const MARKDOWN_HTML_CACHE_MAX_SOURCE_CHARS = 32_000;
  const markdownHtmlCache = new Map<string, string>();

  function cachedRenderMarkdown(text: string): string {
    // Avoid retaining very large source + HTML pairs for the lifetime of the
    // app. They still render correctly; they simply bypass the shared cache.
    if (text.length > MARKDOWN_HTML_CACHE_MAX_SOURCE_CHARS) {
      return renderMarkdown(text);
    }

    const hit = markdownHtmlCache.get(text);
    if (hit !== undefined) {
      // Refresh insertion order so frequently viewed messages stay cached.
      markdownHtmlCache.delete(text);
      markdownHtmlCache.set(text, hit);
      return hit;
    }

    const html = renderMarkdown(text);
    if (markdownHtmlCache.size >= MARKDOWN_HTML_CACHE_MAX) {
      const oldest = markdownHtmlCache.keys().next().value;
      if (oldest !== undefined) markdownHtmlCache.delete(oldest);
    }
    markdownHtmlCache.set(text, html);
    return html;
  }

  let {
    text = "",
    streaming = false,
    basePath = "",
    class: className = "",
    lazy = true,
    tone = "default",
  }: {
    text?: string;
    streaming?: boolean;
    basePath?: string;
    class?: string;
    /** When true (default), defer markdown parsing until element enters viewport.
     *  Off-screen entries render raw <pre> until then. Pass false for places where
     *  the content is always visible and lazy-render would just add a re-render. */
    lazy?: boolean;
    /** Text on primary-filled surfaces (e.g. user chat bubble). */
    tone?: "default" | "on-primary";
  } = $props();

  const proseClasses = $derived(
    tone === "on-primary"
      ? `prose prose-sm max-w-none
      prose-p:text-primary-foreground prose-p:leading-relaxed
      prose-a:text-primary-foreground prose-a:underline prose-a:underline-offset-2 prose-a:opacity-90
      prose-code:rounded prose-code:bg-primary-foreground/15 prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:text-primary-foreground prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
      prose-pre:m-0 prose-pre:p-0 prose-pre:bg-transparent prose-pre:border-0
      prose-li:text-primary-foreground prose-strong:text-primary-foreground`
      : `prose prose-sm dark:prose-invert max-w-none
      prose-p:text-foreground prose-p:leading-relaxed
      prose-a:text-primary prose-a:underline prose-a:underline-offset-2
      prose-code:rounded prose-code:bg-muted/70 prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
      prose-pre:m-0 prose-pre:p-0 prose-pre:bg-transparent prose-pre:border-0
      prose-li:text-foreground`,
  );

  let container: HTMLDivElement | undefined = $state();
  let lazyEl: HTMLElement | undefined = $state();
  /** Set to true once element has been intersection-observed near the viewport.
   *  Sticky — once true, stays true (so scrolling away doesn't un-parse content). */
  let visibleOnce = $state(false);

  // Sync visibleOnce when lazy prop changes
  $effect(() => {
    if (!lazy) visibleOnce = true;
  });

  // ── Lazy markdown rendering: skip parse until element is near viewport ──
  // Off-screen MarkdownContent shows raw <pre>{text}</pre>. When IntersectionObserver
  // detects approach (within 300px rootMargin), we flip visibleOnce → markdown parse.
  // This eliminates the ~150-200ms total of synchronous md-render at chat-page mount
  // when timeline has dozens of historical entries.
  $effect(() => {
    if (!lazy || streaming || visibleOnce) return;
    const el = lazyEl;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // No IntersectionObserver (e.g., very old WebView) — fall back to immediate parse.
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
      { rootMargin: "300px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  });

  // ── Streaming: rAF text coalesce + throttled markdown snapshot ──
  // Height stability: no trailing plain append, slower throttle, fence stabilize,
  // and a min-height ratchet so reparse never shrinks the bubble mid-stream.
  let displayText = $state("");
  let markdownSnapshot = $state("");
  let streamMinHeightPx = $state(0);
  let rafId: number | null = null;
  let streamMdTimer: ReturnType<typeof setTimeout> | null = null;
  let heightRatchetRaf: number | null = null;
  let streamPending = "";
  /** Non-reactive: first-paint gate (avoid reading markdownSnapshot inside the text effect). */
  let hasStreamMdSnapshot = false;

  function streamMarkdownIntervalMs(len: number): number {
    if (len < 2_000) return 90;
    if (len < 8_000) return 140;
    return 200;
  }

  function cancelPendingFrame() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function clearStreamMarkdownTimer() {
    if (streamMdTimer !== null) {
      clearTimeout(streamMdTimer);
      streamMdTimer = null;
    }
  }

  function clearHeightRatchetRaf() {
    if (heightRatchetRaf !== null) {
      cancelAnimationFrame(heightRatchetRaf);
      heightRatchetRaf = null;
    }
  }

  function scheduleStreamingFlush() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      displayText = streamPending;
      if (displayText !== streamPending) {
        scheduleStreamingFlush();
      }
    });
  }

  function flushMarkdownSnapshot(next: string) {
    clearStreamMarkdownTimer();
    markdownSnapshot = next;
    hasStreamMdSnapshot = next.length > 0;
  }

  function scheduleMarkdownSnapshot(next: string) {
    if (!next) {
      flushMarkdownSnapshot("");
      return;
    }
    if (!hasStreamMdSnapshot) {
      flushMarkdownSnapshot(next);
      return;
    }
    if (streamMdTimer !== null) return;
    const atBlockBoundary = /\n\n[\s\S]{0,24}$/.test(next) || next.endsWith("\n```");
    const delay = atBlockBoundary
      ? Math.min(48, streamMarkdownIntervalMs(next.length))
      : streamMarkdownIntervalMs(next.length);
    streamMdTimer = setTimeout(() => {
      streamMdTimer = null;
      const latest = streamPending || displayText;
      if (latest !== markdownSnapshot) {
        markdownSnapshot = latest;
      }
    }, delay);
  }

  $effect(() => {
    if (!streaming) {
      cancelPendingFrame();
      clearStreamMarkdownTimer();
      clearHeightRatchetRaf();
      streamPending = "";
      hasStreamMdSnapshot = false;
      streamMinHeightPx = 0;
      displayText = text;
      markdownSnapshot = text;
      return;
    }

    streamPending = text;

    if (displayText === "" && streamPending !== "") {
      displayText = streamPending;
    }
    scheduleStreamingFlush();
    scheduleMarkdownSnapshot(streamPending);
  });

  onDestroy(() => {
    cancelPendingFrame();
    clearStreamMarkdownTimer();
    clearHeightRatchetRaf();
  });

  // Lazy history stays gated; live streaming always renders when visible / forced.
  let renderMarkdownNow = $derived(streaming || visibleOnce);
  let html = $derived(
    renderMarkdownNow && markdownSnapshot
      ? cachedRenderMarkdown(
          streaming ? stabilizeStreamingMarkdown(markdownSnapshot) : markdownSnapshot,
        )
      : "",
  );

  // Ratchet min-height upward after each streaming paint.
  $effect(() => {
    if (!streaming || !container || !html) return;
    clearHeightRatchetRaf();
    heightRatchetRaf = requestAnimationFrame(() => {
      heightRatchetRaf = null;
      if (!container) return;
      const h = container.offsetHeight;
      if (h > streamMinHeightPx) streamMinHeightPx = h;
    });
    return () => clearHeightRatchetRaf();
  });

  $effect(() => {
    // Skip visual-block remount while streaming — {@html} replaces often enough
    // that remounting mermaid/vega each tick is too expensive.
    if (!container || !html || !renderMarkdownNow || streaming) return;
    let unmountVisual: (() => void) | undefined;
    try {
      unmountVisual = mountVisualBlocks(container, { tone });
    } catch {
      // Keep fallback code blocks visible; never break chat markdown rendering.
    }
    return () => unmountVisual?.();
  });

  $effect(() => {
    if (!container || !html || streaming) return;

    const buttons = container.querySelectorAll<HTMLButtonElement>("[data-code-copy]");
    const cleanups: Array<() => void> = [];

    buttons.forEach((btn) => {
      btn.textContent = t("markdown_copy");
      const handler = async () => {
        const codeEl = btn.closest(".code-block")?.querySelector("pre code");
        if (!codeEl) return;
        try {
          await navigator.clipboard.writeText(codeEl.textContent || "");
          btn.textContent = t("markdown_copied");
          btn.classList.add("copied");
          setTimeout(() => {
            btn.textContent = t("markdown_copy");
            btn.classList.remove("copied");
          }, 1500);
        } catch {
          // Silently fail
        }
      };
      btn.addEventListener("click", handler);
      cleanups.push(() => btn.removeEventListener("click", handler));
    });

    return () => {
      cleanups.forEach((fn) => fn());
    };
  });

  // ── Collapsible code blocks ──
  // After HTML is rendered, find [data-collapsible] code blocks and add:
  // - A wrapper with max-height for collapse
  // - A gradient fade overlay
  // - A toggle button
  const COLLAPSE_VISIBLE_LINES = 8;
  const expandedBlocks = new Set<string>();

  function applyCollapsibleBlocks() {
    if (!container) return;
    const blocks = container.querySelectorAll<HTMLElement>(".code-block[data-collapsible]");
    blocks.forEach((block, index) => {
      // Skip if already processed
      if (block.dataset.collapsibleApplied) return;
      block.dataset.collapsibleApplied = "true";

      const pre = block.querySelector("pre");
      if (!pre) return;
      const preEl = pre; // narrow for closure

      const key = `md-code-${index}-${(block.querySelector("code")?.textContent || "").slice(0, 80)}`;
      const isExpanded = expandedBlocks.has(key);

      // Wrap <pre> in a collapsible container
      const wrapper = document.createElement("div");
      wrapper.className = "code-block-collapsible";
      preEl.parentNode?.insertBefore(wrapper, preEl);
      wrapper.appendChild(preEl);

      // Add gradient fade overlay inside wrapper
      const fade = document.createElement("div");
      fade.className = "code-block-fade";
      wrapper.appendChild(fade);

      // Create toggle button
      const toggleBtn = document.createElement("button");
      toggleBtn.className = "code-block-toggle";
      toggleBtn.type = "button";

      // Calculate collapsed height based on line-height
      const lineHeight = parseFloat(getComputedStyle(preEl).lineHeight) || 18.4; // 0.8125rem * 1.45 ≈ 18.4px
      const collapsedHeight = COLLAPSE_VISIBLE_LINES * lineHeight;

      function setExpanded(expanded: boolean) {
        if (expanded) {
          block.dataset.expanded = "true";
          wrapper.style.maxHeight = `${preEl.scrollHeight}px`;
          toggleBtn.textContent = t("markdown_showLess");
          expandedBlocks.add(key);
        } else {
          block.dataset.expanded = "false";
          wrapper.style.maxHeight = `${collapsedHeight}px`;
          toggleBtn.textContent = t("markdown_showMore");
          expandedBlocks.delete(key);
        }
      }

      toggleBtn.addEventListener("click", () => {
        const isCurrentlyExpanded = block.dataset.expanded === "true";
        setExpanded(!isCurrentlyExpanded);
      });

      // Insert toggle button after the wrapper (at the bottom of the code block)
      block.appendChild(toggleBtn);

      // Set initial state
      setExpanded(isExpanded);
    });
  }

  $effect(() => {
    if (!container || !html || streaming) return;
    // Use rAF to let the DOM settle after {@html} injection
    const raf = requestAnimationFrame(() => {
      applyCollapsibleBlocks();
    });
    return () => cancelAnimationFrame(raf);
  });

  // Resolve relative image paths against basePath (for Explorer file preview)
  $effect(() => {
    if (!container || !html || !basePath || streaming) return;

    const imgs = container.querySelectorAll<HTMLImageElement>("img");
    for (const img of imgs) {
      const src = img.getAttribute("src");
      if (!src) continue;
      // Skip URLs, data URIs, and absolute paths
      if (/^(https?:|data:|blob:)/.test(src)) continue;
      if (src.startsWith("/") || /^[a-zA-Z]:/.test(src)) continue;

      // Construct absolute path: normalize to forward slashes for Rust PathBuf
      const abs = basePath.replace(/\\/g, "/") + "/" + src.replace(/\\/g, "/");
      dbg("markdown", "resolve-img", { src, abs });

      readFileBase64(abs)
        .then(([base64, mime]) => {
          img.src = `data:${mime};base64,${base64}`;
        })
        .catch((e) => {
          dbgWarn("markdown", "img-load-failed", { src, abs, error: e });
        });
    }
  });
</script>

{#if !renderMarkdownNow}
  <!-- Off-screen / pre-visible: plain streaming fallback (no markdown parse). -->
  <div bind:this={lazyEl}>
    <StreamingVisualContent text={displayText} {tone} class={className} />
  </div>
{:else if streaming && !html}
  <div bind:this={lazyEl}>
    <StreamingVisualContent text={displayText} {tone} class={className} />
  </div>
{:else}
  <div
    bind:this={container}
    class="streaming-md-root {proseClasses} {className}"
    class:streaming-md-live={streaming}
    style:min-height={streaming && streamMinHeightPx > 0 ? `${streamMinHeightPx}px` : undefined}
  >
    {@html html}
  </div>
{/if}

<style>
  /* Keep streaming layout from oscillating when {@html} swaps mid-token. */
  .streaming-md-live {
    contain: layout style;
  }

  .streaming-md-live :global(p) {
    margin-top: 0.5em;
    margin-bottom: 0.5em;
  }

  .streaming-md-live :global(p:first-child) {
    margin-top: 0;
  }

  .streaming-md-live :global(p:last-child) {
    margin-bottom: 0;
  }
</style>
