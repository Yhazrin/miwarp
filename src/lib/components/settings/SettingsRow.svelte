<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    label,
    description,
    for: forId,
    class: className = "",
    inline = false,
    children,
  }: {
    label: string;
    description?: string;
    for?: string;
    class?: string;
    inline?: boolean;
    children: Snippet;
  } = $props();
</script>

<div class="flex items-center justify-between gap-4 py-1.5 {className}">
  <div class="min-w-0 flex-1">
    <label class="text-sm font-medium" for={forId}>{label}</label>
    {#if description}
      <p class="text-xs text-muted-foreground mt-0.5">{description}</p>
    {/if}
  </div>
  <div class="shrink-0 {inline ? '' : 'text-right'}">
    {@render children()}
  </div>
</div>
