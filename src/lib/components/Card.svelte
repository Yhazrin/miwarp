<script lang="ts">
  type Variant = "default" | "subtle" | "highlighted";

  let {
    variant = "default",
    class: className = "",
    children,
  }: {
    variant?: Variant;
    class?: string;
    children?: import("svelte").Snippet;
  } = $props();

  const variants: Record<Variant, string> = {
    default:
      "glass-card transition-all duration-200",
    subtle:
      "rounded-lg border border-transparent bg-[hsl(var(--miwarp-bg-surface)/0.5)] hover:bg-[hsl(var(--miwarp-bg-surface)/0.7)] hover:border-[hsl(var(--miwarp-glass-border)/0.15)] transition-all duration-200",
    highlighted:
      "glass-card glow-active transition-all duration-200",
  };
</script>

<div
  class="{variants[variant]} {className}"
  style={variant === "highlighted"
    ? "border-left: 3px solid; border-image: linear-gradient(180deg, hsl(var(--miwarp-accent-primary)), hsl(var(--miwarp-accent-violet))) 1;"
    : ""}
>
  {#if children}
    {@render children()}
  {/if}
</div>
