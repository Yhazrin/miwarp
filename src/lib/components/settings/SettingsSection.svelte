<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title,
    description,
    class: className = "",
    actions,
    children,
  }: {
    title: string;
    description?: string;
    class?: string;
    actions?: Snippet;
    children: Snippet;
  } = $props();
</script>

<div class="rounded-xl border border-border/40 bg-background/40 overflow-hidden {className}">
  <div class="flex items-center justify-between px-4 py-3 border-b border-border/30">
    <div class="min-w-0">
      <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
      {#if description}
        <p class="text-[11px] text-muted-foreground/60 mt-0.5">{description}</p>
      {/if}
    </div>
    {#if actions}
      <div class="shrink-0 ml-3">
        {@render actions()}
      </div>
    {/if}
  </div>
  <div class="p-4 space-y-3">
    {@render children()}
  </div>
</div>
