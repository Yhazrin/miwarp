<script lang="ts">
  import { fmtNumber } from "$lib/i18n/format";

  interface ContextSegment {
    type: "system" | "env" | "claudeMd" | "files" | "tools";
    used: number; // tokens used
    max: number; // max capacity
    label: string; // i18n key for segment label
    color: string; // CSS color class
  }

  let {
    totalUsed = 0,
    totalMax = 200000,
    segments = [] as ContextSegment[],
    warningLevel = "normal" as "normal" | "moderate" | "high" | "critical",
    compactCount = 0,
    microcompactCount = 0,
    showDetails = false,
    onCompactDetails,
  }: {
    /** Total tokens used */
    totalUsed?: number;
    /** Total context window size (e.g., 200000) */
    totalMax?: number;
    /** Individual segment breakdown */
    segments?: ContextSegment[];
    /** Warning level for overall context */
    warningLevel?: "normal" | "moderate" | "high" | "critical";
    /** Number of full compactions */
    compactCount?: number;
    /** Number of micro compactions */
    microcompactCount?: number;
    /** Whether to show detailed segment breakdown */
    showDetails?: boolean;
    /** Callback when user clicks for compact details */
    onCompactDetails?: () => void;
  } = $props();

  const utilization = $derived(Math.min(1, totalUsed / totalMax));
  const pct = $derived(Math.round(utilization * 100));

  const barColor = $derived(
    warningLevel === "critical"
      ? "bg-red-500"
      : warningLevel === "high"
        ? "bg-orange-500"
        : warningLevel === "moderate"
          ? "bg-amber-500"
          : "bg-emerald-500",
  );

  const textColor = $derived(
    warningLevel === "critical"
      ? "text-red-500"
      : warningLevel === "high"
        ? "text-orange-500"
        : warningLevel === "moderate"
          ? "text-amber-500"
          : "text-foreground/60",
  );

  // Segment colors (matching segment types)
  const segmentColors: Record<ContextSegment["type"], string> = {
    system: "bg-violet-500",
    env: "bg-blue-500",
    claudeMd: "bg-emerald-500",
    files: "bg-amber-500",
    tools: "bg-orange-500",
  };

  // Calculate segment widths as percentage of total bar
  const segmentWidths = $derived.by(() => {
    if (segments.length === 0 || totalUsed === 0) return [];

    // Normalize to totalUsed
    const total = segments.reduce((sum, s) => sum + s.used, 0) || totalUsed;

    return segments.map((s) => ({
      ...s,
      width: Math.round((s.used / total) * 100),
      pctOfMax: Math.round((s.used / totalMax) * 100),
    }));
  });
</script>

/** * ContextWindowBar: Visualizes context window usage with colored segments. * * Inspired by Codex
Claude Cowork's context window visualization. * Shows breakdown of: system prompt, environment,
CLAUDE.md, files, tools output. */
<div class="context-window-bar flex flex-col gap-1.5">
  <!-- Header: usage bar + stats -->
  <div class="flex items-center gap-3">
    <!-- Segmented bar -->
    <div class="flex-1 h-3 rounded-full bg-foreground/10 overflow-hidden flex">
      {#if segmentWidths.length > 0}
        <!-- Show segmented breakdown -->
        {#each segmentWidths as seg (seg.type)}
          {#if seg.width > 0}
            <div
              class="h-full transition-all duration-500 {segmentColors[seg.type]}"
              style="width: {seg.width}%"
              title="{seg.label}: {fmtNumber(seg.used)} tokens ({seg.pctOfMax}%)"
            ></div>
          {/if}
        {/each}
      {:else}
        <!-- Fallback: simple utilization bar -->
        <div
          class="h-full rounded-full transition-all duration-500 {barColor}"
          style="width: {pct}%"
        ></div>
      {/if}
    </div>

    <!-- Stats -->
    <div class="flex items-center gap-2 text-xs">
      <span class="{textColor} tabular-nums">{pct}%</span>
      <span class="text-foreground/40 tabular-nums">/ {fmtNumber(totalMax)}</span>

      {#if compactCount > 0 || microcompactCount > 0}
        <button
          class="text-[10px] text-miwarp-status-info hover:text-miwarp-status-info/80 transition-colors {onCompactDetails
            ? 'cursor-pointer'
            : 'cursor-default'}"
          onclick={onCompactDetails}
          title="Compactions: {compactCount} full, {microcompactCount} micro"
        >
          ↓{compactCount}+{microcompactCount}
        </button>
      {/if}
    </div>
  </div>

  <!-- Detailed breakdown (optional) -->
  {#if showDetails && segmentWidths.length > 0}
    <div class="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
      {#each segmentWidths as seg (seg.type)}
        <div class="flex items-center gap-1">
          <span class="inline-block h-2 w-2 rounded-sm {segmentColors[seg.type]}"></span>
          <span class="text-foreground/60">{seg.label}</span>
          <span class="text-foreground/80 tabular-nums">{fmtNumber(seg.used)}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>
