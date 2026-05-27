<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    icon = "" as string,
    title = "",
    description = "",
    variant = "default" as "default" | "dashed",
    class: className = "",
    action,
  }: {
    icon?: string;
    title?: string;
    description?: string;
    variant?: "default" | "dashed";
    class?: string;
    action?: Snippet;
  } = $props();

  const wrapperClass = $derived(
    variant === "dashed"
      ? "rounded-lg border border-dashed p-8 text-center"
      : "",
  );
</script>

<div class="flex flex-col items-center justify-center gap-3 py-12 text-center {wrapperClass} {className}">
  {#if icon}
    <div class="text-4xl opacity-50">{icon}</div>
  {/if}
  {#if title}
    <h3 class="text-sm font-medium text-foreground">{title}</h3>
  {/if}
  {#if description}
    <p class="text-sm text-muted-foreground max-w-[280px]">{description}</p>
  {/if}
  {#if action}
    {@render action()}
  {/if}
</div>
