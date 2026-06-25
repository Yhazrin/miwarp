<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    active = false,
    onclick,
    preview,
    title,
    description,
    ariaPressed,
  }: {
    active?: boolean;
    onclick?: () => void;
    preview?: Snippet;
    title: string;
    description?: string;
    ariaPressed?: boolean;
  } = $props();
</script>

<button
  type="button"
  aria-pressed={ariaPressed ?? active}
  class="rounded-lg border p-3 text-left transition-colors {active
    ? 'border-primary/50 bg-muted/55 shadow-sm ring-1 ring-primary/20'
    : 'border-border/40 bg-background/40 hover:bg-muted/30'}"
  {onclick}
>
  {#if preview}
    <div class="mb-2.5">
      {@render preview()}
    </div>
  {/if}
  <div class="text-sm font-medium text-foreground">{title}</div>
  {#if description}
    <p class="mt-1 text-[11px] leading-snug text-muted-foreground">{description}</p>
  {/if}
</button>
