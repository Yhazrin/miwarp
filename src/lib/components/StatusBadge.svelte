<script lang="ts">
  import type { RunStatus } from "$lib/types";

  type DisplayStatus = Exclude<RunStatus, "idle"> | "waiting" | "done";

  let {
    status,
    attention = false,
    compact = false,
    shortLabel = false,
    subtle = false,
    class: className = "",
  }: {
    status: RunStatus;
    attention?: boolean;
    compact?: boolean;
    /** Use abbreviated status text for constrained widths (e.g. sidebar) */
    shortLabel?: boolean;
    /** Smaller, lower-contrast pill for list selection chrome */
    subtle?: boolean;
    class?: string;
  } = $props();

  const displayStatus: DisplayStatus = $derived(
    (status === "running" || status === "idle") && attention
      ? "waiting"
      : status === "idle"
        ? "done"
        : status,
  );

  // Map displayStatus to CSS variable-based styles (theme-adaptive via --miwarp-status-*)
  const statusStyles: Record<DisplayStatus, { bg: string; text: string; dot: string }> = {
    pending: {
      bg: "hsl(var(--miwarp-status-warning) / 0.2)",
      text: "hsl(var(--miwarp-status-warning) / 1)",
      dot: "hsl(var(--miwarp-status-warning))",
    },
    running: {
      bg: "hsl(var(--miwarp-status-info) / 0.2)",
      text: "hsl(var(--miwarp-status-info) / 1)",
      dot: "hsl(var(--miwarp-status-info))",
    },
    done: {
      bg: "hsl(var(--miwarp-status-success) / 0.2)",
      text: "hsl(var(--miwarp-status-success) / 1)",
      dot: "hsl(var(--miwarp-status-success))",
    },
    waiting: {
      bg: "hsl(var(--miwarp-status-warning) / 0.2)",
      text: "hsl(var(--miwarp-status-warning) / 1)",
      dot: "hsl(var(--miwarp-status-warning))",
    },
    completed: {
      bg: "hsl(var(--miwarp-status-success) / 0.2)",
      text: "hsl(var(--miwarp-status-success) / 1)",
      dot: "hsl(var(--miwarp-status-success))",
    },
    failed: {
      bg: "hsl(var(--miwarp-status-error) / 0.2)",
      text: "hsl(var(--miwarp-status-error) / 1)",
      dot: "hsl(var(--miwarp-status-error))",
    },
    stopped: {
      bg: "hsl(var(--miwarp-text-secondary) / 0.2)",
      text: "hsl(var(--miwarp-text-secondary) / 1)",
      dot: "hsl(var(--miwarp-text-secondary))",
    },
    error: {
      bg: "hsl(var(--miwarp-status-error) / 0.2)",
      text: "hsl(var(--miwarp-status-error) / 1)",
      dot: "hsl(var(--miwarp-status-error))",
    },
    waiting_input: {
      bg: "hsl(var(--miwarp-status-warning) / 0.2)",
      text: "hsl(var(--miwarp-status-warning) / 1)",
      dot: "hsl(var(--miwarp-status-warning))",
    },
    waiting_approval: {
      bg: "hsl(var(--miwarp-status-warning) / 0.2)",
      text: "hsl(var(--miwarp-status-warning) / 1)",
      dot: "hsl(var(--miwarp-status-warning))",
    },
  };

  const shortLabels: Partial<Record<DisplayStatus, string>> = {
    waiting: "wait",
    waiting_input: "input",
    waiting_approval: "approve",
    completed: "done",
  };

  const style = $derived.by(() => {
    const base = statusStyles[displayStatus];
    if (!subtle) return base;
    return {
      bg: base.bg.replace("/ 0.2)", "/ 0.08)"),
      text: base.text.replace("/ 1)", "/ 0.62)"),
      dot: base.dot,
    };
  });
  const isAnimated = $derived(displayStatus === "running" || displayStatus === "waiting");
  const displayText = $derived(
    shortLabel ? (shortLabels[displayStatus] ?? displayStatus) : displayStatus,
  );
</script>

{#if compact}
  <!-- Compact mode: dot only, with tooltip -->
  <span
    class="inline-block h-2 w-2 rounded-full shrink-0 {isAnimated
      ? displayStatus === 'running'
        ? 'animate-slow-pulse'
        : 'animate-pulse'
      : ''} {className}"
    style="background-color: {style.dot}"
    title={displayStatus}
  ></span>
{:else}
  <!-- Full pill mode -->
  <span
    class="inline-flex items-center {subtle
      ? 'gap-1 rounded-md px-1.5 py-px text-[10px] font-medium'
      : 'gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium'} {className}"
    style="background-color: {style.bg}; color: {style.text}"
  >
    <span
      class="{subtle ? 'h-1 w-1' : 'h-1.5 w-1.5'} rounded-full {isAnimated
        ? displayStatus === 'running'
          ? 'animate-slow-pulse'
          : 'animate-pulse'
        : ''}"
      style="background-color: {style.dot}"
    ></span>
    {displayText}
  </span>
{/if}
