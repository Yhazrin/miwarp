<script lang="ts">
  import type { Snippet } from "svelte";
  import type { LucideIconName } from "$lib/lucide-icon";
  import { resolveIconName } from "$lib/lucide-icon";
  import Icon from "./Icon.svelte";

  let {
    icon = "" as string,
    iconName,
    title = "",
    description = "",
    variant = "default" as "default" | "dashed",
    class: className = "",
    action,
    iconComponent,
  }: {
    /** @deprecated Use iconName — legacy emoji strings are migrated via resolveIconName */
    icon?: string;
    iconName?: LucideIconName;
    title?: string;
    description?: string;
    variant?: "default" | "dashed";
    class?: string;
    action?: Snippet;
    iconComponent?: Snippet;
  } = $props();

  const resolvedIcon = $derived(
    iconName ?? (icon ? resolveIconName(icon) : undefined),
  );

  const wrapperClass = $derived(
    variant === "dashed"
      ? "rounded-lg border border-dashed p-8 text-center"
      : "",
  );
</script>

<div class="flex flex-col items-center justify-center gap-3 py-12 text-center {wrapperClass} {className}">
  {#if iconComponent}
    {@render iconComponent()}
  {:else if resolvedIcon}
    <Icon name={resolvedIcon} size="xl" class="opacity-50 text-muted-foreground" />
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
