<script lang="ts">
  import Icon from "./Icon.svelte";
  import { resolveIconName, type LucideIconName } from "$lib/lucide-icon";

  let {
    icon,
    fallback = "sparkles",
    size = "md",
    class: className = "",
  }: {
    icon?: string | null;
    fallback?: LucideIconName;
    size?: "xs" | "sm" | "md" | "lg" | "xl";
    class?: string;
  } = $props();

  const name = $derived(resolveIconName(icon, fallback));
</script>

<Icon name={name} {size} class={className} />
