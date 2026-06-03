<script lang="ts">
  import type { LucideIconName } from "$lib/lucide-icon";
  import { LUCIDE_PATHS } from "$lib/lucide-paths";

  let {
    name,
    size = "md",
    class: className = "",
  }: {
    name: LucideIconName;
    size?: "xs" | "sm" | "md" | "lg" | "xl";
    class?: string;
  } = $props();

  const sizeMap: Record<string, string> = {
    xs: "h-3 w-3",
    sm: "h-3.5 w-3.5",
    md: "h-4 w-4",
    lg: "h-5 w-5",
    xl: "h-10 w-10",
  };

  const parts = $derived(LUCIDE_PATHS[name] ?? LUCIDE_PATHS.sparkles);
</script>

<svg
  class="{sizeMap[size]} {className}"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each parts as part (part)}
    {#if part.t === "path"}
      <path d={part.d} />
    {:else if part.t === "circle"}
      <circle cx={part.cx} cy={part.cy} r={part.r} />
    {:else if part.t === "line"}
      <line x1={part.x1} y1={part.y1} x2={part.x2} y2={part.y2} />
    {:else if part.t === "polyline"}
      <polyline points={part.points} />
    {:else if part.t === "polygon"}
      <polygon points={part.points} />
    {:else if part.t === "rect"}
      <rect
        x={part.x}
        y={part.y}
        width={part.width}
        height={part.height}
        rx={part.rx}
        ry={part.rx}
      />
    {/if}
  {/each}
</svg>
