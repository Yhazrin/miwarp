<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";

  let {
    size = "md",
    class: className = "",
  }: {
    size?: "xxs" | "xs" | "sm" | "md" | "lg" | "xl";
    class?: string;
  } = $props();

  const sizeMap: Record<string, string> = {
    xxs: "h-2 w-2 border",
    xs: "h-3 w-3 border",
    sm: "h-4 w-4 border-2",
    md: "h-5 w-5 border-2",
    lg: "h-6 w-6 border-2",
    xl: "h-8 w-8 border-2",
  };
</script>

<div
  class="animate-spin rounded-full {sizeMap[size]} border-primary/30 border-t-primary {className}"
  role="status"
>
  <span class="sr-only">{t("common_loading")}</span>
</div>
