<script lang="ts">
  /**
   * v1.0.6 / 6.2: 9x9 icon tile used by the Extensions Center.
   *
   * Visual contract (kept tight so the marketplace still looks like
   * one cohesive product even with mixed source content):
   *   - 9rem × 9rem rounded container
   *   - large 2xl Lucide icon
   *   - light/glass surface
   *   - "type guide" pill (e.g. plugins / skills / hooks / mcp)
   */
  import Icon from "./Icon.svelte";
  import type { LucideIconName } from "$lib/lucide-icon";

  let {
    icon,
    title,
    description = "",
    badge = "",
    href = null,
    onClick,
  }: {
    icon: LucideIconName;
    title: string;
    description?: string;
    badge?: string;
    href?: string | null;
    onClick?: () => void;
  } = $props();

  function handle() {
    if (onClick) onClick();
    else if (href) window.location.href = href;
  }
</script>

<button
  type="button"
  class="group relative flex h-36 w-36 flex-col items-center justify-center
    rounded-2xl border border-border/60 bg-card/50 p-3 text-center
    transition-all hover:border-primary/40 hover:bg-card/80
    focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  onclick={handle}
  aria-label={title}
>
  {#if badge}
    <span
      class="absolute left-2 top-2 rounded-full bg-muted px-1.5 py-0.5 text-[9px]
        font-medium uppercase tracking-wide text-muted-foreground"
    >
      {badge}
    </span>
  {/if}
  <div
    class="mb-2 flex h-12 w-12 items-center justify-center rounded-xl
      bg-muted/70 text-miwarp-accent-violet transition-colors
      group-hover:text-miwarp-accent-blue"
  >
    <Icon name={icon} size="lg" />
  </div>
  <div class="text-xs font-medium text-foreground">{title}</div>
  {#if description}
    <div class="mt-0.5 line-clamp-2 text-[10px] leading-tight text-muted-foreground/80">
      {description}
    </div>
  {/if}
</button>
