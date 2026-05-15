<script lang="ts">
  import { type AgentPhase, getPhaseLabel, getPhaseColor } from "$lib/utils/phase-detection";
  import { t } from "$lib/i18n/index.svelte";

  let {
    phase,
    elapsed,
    compact = false,
  }: {
    phase: AgentPhase;
    elapsed?: number; // seconds
    compact?: boolean;
  } = $props();

  function formatElapsed(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
</script>

<div
  class="flex items-center gap-1.5"
  role="status"
  aria-label={t("phaseIndicator_agentPhase", { phase: getPhaseLabel(phase) })}
>
  <!-- Phase dot with glow for active phases -->
  <span
    class="inline-block h-2 w-2 rounded-full shrink-0"
    class:animate-pulse={phase === "executing"}
    style:background={getPhaseColor(phase)}
    style:box-shadow={phase === "executing" ? `0 0 8px ${getPhaseColor(phase)}40` : "none"}
  ></span>

  {#if !compact}
    <span class="text-[11px] font-medium" style:color={getPhaseColor(phase)}>
      {getPhaseLabel(phase)}
    </span>
  {/if}

  {#if elapsed !== undefined && elapsed > 0}
    <span class="text-[10px] text-muted-foreground tabular-nums">
      {formatElapsed(elapsed)}
    </span>
  {/if}
</div>
