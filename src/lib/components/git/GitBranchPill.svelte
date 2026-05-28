<script lang="ts">
  let {
    name,
    variant = "default" as "default" | "remote" | "base" | "current",
    maxWidth = "8rem",
  }: {
    name: string;
    variant?: "default" | "remote" | "base" | "current";
    maxWidth?: string;
  } = $props();

  const variantClass = $derived.by(() => {
    switch (variant) {
      case "remote":
        return "bg-[hsl(var(--miwarp-status-info)/0.1)] text-miwarp-status-info border-[hsl(var(--miwarp-status-info)/0.22)]";
      case "base":
        return "bg-muted/40 text-muted-foreground border-border/50";
      case "current":
        return "bg-[hsl(var(--miwarp-accent-primary)/0.1)] text-miwarp-accent-primary border-[hsl(var(--miwarp-accent-primary)/0.25)]";
      default:
        return "bg-background/70 text-foreground/85 border-border/55";
    }
  });
</script>

<span
  class="inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[10px] font-medium font-mono leading-none {variantClass}"
  style:max-width={maxWidth}
  title={name}
>
  <span class="truncate">{name}</span>
</span>
