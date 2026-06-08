<script lang="ts">
  /**
   * v1.0.6 / 5.4: Document-level Markdown renderer.
   * Unlike MarkdownContent (chat bubble, streaming-friendly), this component
   * targets the right-side Preview / artifact / long file view.
   *
   * Features over MarkdownContent:
   * - Auto-extracted TOC (heading outline)
   * - GitHub-style callouts (> [!NOTE] / [!WARNING] / [!TIP])
   * - Image lightbox (click to enlarge)
   * - Lazy rendering for large documents (IntersectionObserver)
   * - File link interception (no page navigation)
   */
  import { renderMarkdown } from "$lib/utils/markdown";
  import { extractToc, type TocEntry } from "$lib/utils/markdown-outline";
  import { t } from "$lib/i18n/index.svelte";
  import { onMount } from "svelte";

  let {
    text = "",
    basePath = "",
    class: className = "",
    showToc = false,
    onFileClick,
  }: {
    text?: string;
    basePath?: string;
    class?: string;
    /** Show a table-of-contents sidebar. */
    showToc?: boolean;
    /** Callback when an internal file link is clicked. */
    onFileClick?: (path: string) => void;
  } = $props();

  let container: HTMLDivElement | undefined = $state();
  let visibleOnce = $state(false);
  let lazyEl: HTMLElement | undefined = $state();

  // TOC
  const toc = $derived<TocEntry[]>(extractToc(text));

  // HTML rendering (deferred until visible)
  let html = $derived(visibleOnce && text ? renderMarkdown(text) : "");

  // Lightbox state
  let lightboxSrc = $state<string | null>(null);

  // Lazy rendering: skip parse until element is near viewport
  $effect(() => {
    if (!lazyEl) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          visibleOnce = true;
          obs.disconnect();
        }
      },
      { rootMargin: "500px 0px" },
    );
    obs.observe(lazyEl);
    return () => obs.disconnect();
  });

  // Post-render: wire up copy buttons, callouts, lightbox, file links
  $effect(() => {
    if (!container || !html) return;
    const raf = requestAnimationFrame(() => {
      if (!container) return;

      // Copy buttons
      container.querySelectorAll<HTMLButtonElement>("[data-code-copy]").forEach((btn) => {
        btn.textContent = t("markdown_copy");
        btn.onclick = async () => {
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
            /* ignore */
          }
        };
      });

      // Image lightbox
      container.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
        img.style.cursor = "zoom-in";
        img.onclick = () => {
          lightboxSrc = img.src;
        };
      });

      // Internal file links
      container.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
        const href = a.getAttribute("href") ?? "";
        // Intercept relative paths and local files
        if (href.startsWith("/") || /^[a-zA-Z]:/.test(href) || !/^https?:/.test(href)) {
          a.onclick = (e) => {
            e.preventDefault();
            onFileClick?.(href);
          };
        }
      });

      // Callout blocks: convert blockquotes with [!NOTE] etc. into styled callouts
      container.querySelectorAll<HTMLQuoteElement>("blockquote").forEach((bq) => {
        const firstLine = bq.querySelector("p")?.textContent?.trim() ?? "";
        const calloutMatch = firstLine.match(/^\[!(NOTE|WARNING|TIP|IMPORTANT|CAUTION)\]\s*/i);
        if (calloutMatch) {
          const type = calloutMatch[1].toUpperCase();
          const icon =
            type === "NOTE" ? "📝" : type === "WARNING" ? "⚠️" : type === "TIP" ? "💡" : type === "IMPORTANT" ? "❗" : "🔴";
          bq.classList.add("callout", `callout-${type.toLowerCase()}`);
          const firstP = bq.querySelector("p");
          if (firstP) {
            firstP.innerHTML = `<span class="callout-icon">${icon}</span> <strong>${type}:</strong> ${firstP.innerHTML.replace(/^\[!(NOTE|WARNING|TIP|IMPORTANT|CAUTION)\]\s*/i, "")}`;
          }
        }
      });
    });
    return () => cancelAnimationFrame(raf);
  });
</script>

<div class="mi-markdown-renderer flex gap-4 {className}" bind:this={lazyEl}>
  {#if showToc && toc.length > 0}
    <nav class="toc-sidebar w-40 shrink-0 overflow-y-auto border-r border-border/30 pr-3 text-xs">
      <p class="mb-2 font-semibold uppercase tracking-wide text-muted-foreground">
        {t("markdown_toc") || "Contents"}
      </p>
      {#each toc as entry (entry.id)}
        <a
          href="#{entry.id}"
          class="block truncate py-0.5 text-muted-foreground/70 transition-colors hover:text-foreground"
          style="padding-left: {(entry.level - 1) * 0.75}rem"
        >
          {entry.text}
        </a>
      {/each}
    </nav>
  {/if}

  <div class="mi-markdown-body min-w-0 flex-1 prose prose-sm dark:prose-invert max-w-none" bind:this={container}>
    {#if html}
      {@html html}
    {:else}
      <div class="animate-pulse space-y-2 py-4">
        <div class="h-4 w-3/4 rounded bg-muted"></div>
        <div class="h-4 w-1/2 rounded bg-muted"></div>
        <div class="h-4 w-5/6 rounded bg-muted"></div>
      </div>
    {/if}
  </div>
</div>

<!-- Lightbox overlay -->
{#if lightboxSrc}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
    onclick={() => (lightboxSrc = null)}
    onkeydown={(e) => e.key === "Escape" && (lightboxSrc = null)}
  >
    <img
      src={lightboxSrc}
      alt=""
      class="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
    />
  </div>
{/if}

<style>
  :global(.callout) {
    border-left-width: 4px !important;
    padding: 0.75rem 1rem !important;
    margin: 1rem 0 !important;
    border-radius: 0.375rem !important;
  }
  :global(.callout-note) {
    border-left-color: hsl(var(--miwarp-status-info)) !important;
    background: hsl(var(--miwarp-status-info) / 0.08) !important;
  }
  :global(.callout-warning) {
    border-left-color: hsl(var(--miwarp-status-warning)) !important;
    background: hsl(var(--miwarp-status-warning) / 0.08) !important;
  }
  :global(.callout-tip) {
    border-left-color: hsl(var(--miwarp-status-success)) !important;
    background: hsl(var(--miwarp-status-success) / 0.08) !important;
  }
  :global(.callout-important) {
    border-left-color: hsl(var(--miwarp-status-error)) !important;
    background: hsl(var(--miwarp-status-error) / 0.08) !important;
  }
  :global(.callout-caution) {
    border-left-color: hsl(var(--miwarp-status-warning)) !important;
    background: hsl(var(--miwarp-status-warning) / 0.08) !important;
  }
  :global(.callout-icon) {
    margin-right: 0.25rem;
  }

  .toc-sidebar a {
    text-decoration: none;
  }
  .toc-sidebar a:hover {
    text-decoration: underline;
  }
</style>
