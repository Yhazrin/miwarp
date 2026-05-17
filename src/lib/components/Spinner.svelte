<script lang="ts">
  let {
    size = "md",
    class: className = "",
  }: {
    size?: "xs" | "sm" | "md" | "lg" | "xl";
    class?: string;
  } = $props();

  const sizeClass = {
    xs: "h-3 w-3 border",
    sm: "h-3.5 w-3.5 border-2",
    md: "h-5 w-5 border-2",
    lg: "h-6 w-6 border-2",
    xl: "h-8 w-8 border-2",
  }[size];
</script>

<div
  class="animate-spin rounded-full {sizeClass} border-current border-t-transparent {className}"
></div>
