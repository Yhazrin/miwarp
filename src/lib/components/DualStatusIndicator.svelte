<script lang="ts">
  let {
    state = "idle",
    processStatus = "active",
    size = "sm",
    label,
  }: {
    state?: "running" | "needs-input" | "idle" | "completed" | "failed" | "stopped";
    processStatus?: "active" | "exited" | "sleeping";
    size?: "xs" | "sm" | "md";
    label?: string;
  } = $props();

  const stateColors: Record<string, string> = {
    running: "hsl(var(--miwarp-status-info))",
    "needs-input": "hsl(var(--miwarp-status-warning))",
    idle: "hsl(var(--muted-foreground))",
    completed: "hsl(var(--miwarp-status-success))",
    failed: "hsl(var(--miwarp-status-error))",
    stopped: "hsl(var(--muted-foreground))",
  };

  const sizes: Record<string, number> = { xs: 10, sm: 12, md: 16 };
  const currentSize = $derived(sizes[size]);
  const color = $derived(stateColors[state]);
  const isActive = $derived(state === "running" || state === "needs-input");
</script>

<span
  class="inline-flex items-center justify-center shrink-0"
  style:width="{currentSize}px"
  style:height="{currentSize}px"
  role="status"
  aria-label={label || `Status: ${state}, Process: ${processStatus}`}
  title={label || `${state} (${processStatus})`}
>
  {#if processStatus === "exited"}
    <!-- Small dot for exited processes -->
    <span
      class="inline-block rounded-full"
      style:width="{currentSize * 0.5}px"
      style:height="{currentSize * 0.5}px"
      style:background={color}
      style:opacity="0.6"
    ></span>
  {:else if processStatus === "sleeping"}
    <!-- Diamond for loop/sleeping -->
    <span
      class="inline-block"
      style:width="{currentSize * 0.65}px"
      style:height="{currentSize * 0.65}px"
      style:background={color}
      style:transform="rotate(45deg)"
      class:animate-slow-pulse={isActive}
    ></span>
  {:else}
    <!-- Star/burst for active processes -->
    <svg
      width={currentSize}
      height={currentSize}
      viewBox="0 0 16 16"
      class:animate-slow-pulse={isActive}
    >
      <path
        d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11 6.5 7.5 3 6l3.5-1.5z"
        fill={color}
        stroke={color}
        stroke-width="0.5"
        stroke-linejoin="round"
      />
    </svg>
  {/if}
</span>
