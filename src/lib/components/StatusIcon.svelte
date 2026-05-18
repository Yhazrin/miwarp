<script lang="ts">
  /**
   * Dual-signal status icon: combines color (status) + shape (process type).
   *
   * Based on Claude Cowork design patterns:
   * - Color = status (running/pending/error/done/waiting)
   * - Shape = process type (active/stopped/sleeping)
   *
   * Used by ToolActivity and InlineToolCard for tool status display.
   */
  let {
    status,
    processState = "active",
    size = "sm",
  }: {
    status: "done" | "error" | "running" | "other" | "pending" | "waiting";
    /** Process state affects the icon shape:
     * - "active": animated dot (running process)
     * - "stopped": static dot (exited process)
     * - "sleeping": diamond (waiting for input)
     */
    processState?: "active" | "stopped" | "sleeping";
    size?: "xs" | "sm" | "md";
  } = $props();

  const sizeClass: Record<string, string> = {
    xs: "h-2.5 w-2.5",
    sm: "h-3 w-3",
    md: "h-3.5 w-3.5",
  };

  // Color mapping based on status (first signal)
  const statusColors: Record<string, string> = {
    done: "text-[hsl(var(--miwarp-status-success))]",
    error: "text-destructive",
    running: "text-[hsl(var(--miwarp-status-info))]",
    pending: "text-[hsl(var(--miwarp-status-warning))]",
    waiting: "text-[hsl(var(--miwarp-status-warning))]",
    other: "text-muted-foreground/30",
  };

  // Shape indicator based on process state (second signal)
  const processShapes: Record<string, { icon: string; animate: boolean }> = {
    // Active process: spinning or pulsing
    active: { icon: "●", animate: true },
    // Stopped/exited process: static circle
    stopped: { icon: "•", animate: false },
    // Sleeping/waiting: diamond shape
    sleeping: { icon: "◆", animate: false },
  };

  const currentColor = $derived(statusColors[status] ?? statusColors.other);
  const currentShape = $derived(processShapes[processState] ?? processShapes.stopped);
</script>

{#if status === "done"}
  <!-- Done: checkmark with optional shape indicator -->
  <svg
    class="{sizeClass[size]} {currentColor} shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
  >
{:else if status === "error"}
  <!-- Error: X mark -->
  <svg
    class="{sizeClass[size]} {currentColor} shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    ><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg
  >
{:else if status === "running"}
  <!-- Running: spinner or pulsing dot based on process state -->
  {#if processState === "active"}
    <!-- Active process: spinning -->
    <div
      class="{sizeClass[size]} rounded-full border-2 {currentColor} border-t-transparent animate-spin shrink-0"
    ></div>
  {:else if processState === "sleeping"}
    <!-- Sleeping: diamond with slow pulse -->
    <span class="{sizeClass[size]} {currentColor} animate-slow-pulse shrink-0">◆</span>
  {:else}
    <!-- Stopped but running status (edge case): static dot -->
    <span class="{sizeClass[size]} {currentColor} shrink-0">●</span>
  {/if}
{:else if status === "waiting" || status === "pending"}
  <!-- Waiting: pulsing dot with shape indicator -->
  <span class="{sizeClass[size]} {currentColor} animate-pulse shrink-0">{currentShape.icon}</span>
{:else}
  <!-- Other: static dot with shape indicator -->
  <span class="{sizeClass[size]} {currentColor} shrink-0 {currentShape.animate ? 'animate-slow-pulse' : ''}">{currentShape.icon}</span>
{/if}
