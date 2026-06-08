<script lang="ts">
  /**
   * v1.0.6 / 6.5: Minimal link card component.
   * Renders a clickable link with title and URL in a compact card style.
   * Used for WebSearch results, artifact links, and inline references.
   */

  let {
    title = "",
    url = "",
    class: className = "",
  }: {
    title?: string;
    url?: string;
    class?: string;
  } = $props();

  // Extract domain for display
  const domain = $derived(() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  });
</script>

<a
  href={url}
  target="_blank"
  rel="noopener noreferrer"
  class="group flex items-center gap-2 rounded-md border border-border/40 bg-card/30 px-2.5 py-1.5
    text-xs transition-colors hover:border-border/60 hover:bg-card/60 {className}"
>
  <span class="min-w-0 flex-1 truncate text-foreground/80 group-hover:text-foreground">
    {title || url}
  </span>
  {#if domain()}
    <span class="shrink-0 text-[10px] text-muted-foreground/50">{domain()}</span>
  {/if}
</a>
