<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    status,
    label,
    description,
    class: className = "",
    children,
  }: {
    status: "ok" | "warning" | "error" | "loading" | "inactive";
    label: string;
    description?: string;
    class?: string;
    children?: Snippet;
  } = $props();

  const statusColors = {
    ok: "bg-emerald-500",
    warning: "bg-amber-500",
    error: "bg-red-500",
    loading: "bg-amber-400 animate-pulse",
    inactive: "bg-muted-foreground/30",
  };
</script>

<div
  class="flex items-center gap-3 rounded-lg border border-border/40 bg-background/40 px-3 py-2.5 {className}"
>
  <span class="h-2 w-2 shrink-0 rounded-full {statusColors[status]}"></span>
  <div class="min-w-0 flex-1">
    <p class="text-sm font-medium">{label}</p>
    {#if description}
      <p class="text-[11px] text-muted-foreground/60">{description}</p>
    {/if}
  </div>
  {#if children}
    <div class="shrink-0">
      {@render children()}
    </div>
  {/if}
</div>
