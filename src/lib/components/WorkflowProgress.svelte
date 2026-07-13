<!--
  WorkflowProgress — multi-phase progress visualization for Workflow tool.
  Parses phase names from the workflow script and maps subTimeline agents
  to their phases, rendering a segmented progress bar + agent status grid.
-->
<script lang="ts">
  import type { TimelineEntry } from "$lib/types";
  import Icon from "$lib/components/Icon.svelte";

  let {
    script,
    subTimeline = [],
    status = "running",
  }: {
    /** Workflow script content (from tool input). */
    script?: string;
    /** Child agent entries from the workflow execution. */
    subTimeline?: TimelineEntry[];
    /** Current tool status. */
    status?: string;
  } = $props();

  // ── Phase extraction from script ──

  interface PhaseInfo {
    name: string;
    agents: TimelineEntry[];
    completedCount: number;
    failedCount: number;
    runningCount: number;
    totalCount: number;
  }

  /** Extract phase names from workflow script: phase('Name') or phase("Name") */
  let phaseNames = $derived.by(() => {
    if (!script) return [];
    const names: string[] = [];
    // Match phase('...') or phase("...") calls
    const re = /phase\s*\(\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(script)) !== null) {
      names.push(m[1]);
    }
    // Deduplicate while preserving order
    return [...new Set(names)];
  });

  /** Extract agent labels from subTimeline (description or subagentType). */
  function getAgentLabel(entry: TimelineEntry): string {
    if (entry.kind !== "tool") return "";
    const input = entry.tool.input;
    return (
      (input.description as string) ||
      (input.subagent_type as string) ||
      (input.name as string) ||
      entry.tool.tool_name
    );
  }

  /**
   * Try to map each subTimeline agent to a phase by checking if the agent
   * label contains the phase name (case-insensitive). Falls back to evenly
   * distributing agents across phases.
   */
  let phases = $derived.by((): PhaseInfo[] => {
    const agentEntries = subTimeline.filter((e) => e.kind === "tool");
    if (phaseNames.length === 0) {
      // No phases detected — single "execution" phase
      return [
        {
          name: "",
          agents: agentEntries,
          ...countStatuses(agentEntries),
        },
      ];
    }

    // Initialize phases
    const phaseMap = phaseNames.map(
      (name): PhaseInfo => ({
        name,
        agents: [],
        completedCount: 0,
        failedCount: 0,
        runningCount: 0,
        totalCount: 0,
      }),
    );

    // Assign agents to phases by label matching
    const unmatched: TimelineEntry[] = [];
    for (const entry of agentEntries) {
      const label = getAgentLabel(entry).toLowerCase();
      let matched = false;
      for (const phase of phaseMap) {
        if (label.includes(phase.name.toLowerCase())) {
          phase.agents.push(entry);
          matched = true;
          break;
        }
      }
      if (!matched) unmatched.push(entry);
    }

    // Distribute unmatched agents evenly
    for (let i = 0; i < unmatched.length; i++) {
      const idx = i % phaseMap.length;
      phaseMap[idx].agents.push(unmatched[i]);
    }

    // Count statuses
    for (const phase of phaseMap) {
      const counts = countStatuses(phase.agents);
      phase.completedCount = counts.completedCount;
      phase.failedCount = counts.failedCount;
      phase.runningCount = counts.runningCount;
      phase.totalCount = counts.totalCount;
    }

    return phaseMap;
  });

  function countStatuses(entries: TimelineEntry[]) {
    let completedCount = 0;
    let failedCount = 0;
    let runningCount = 0;
    for (const e of entries) {
      if (e.kind !== "tool") continue;
      const s = e.tool.status;
      if (s === "success") completedCount++;
      else if (s === "running" || s === "ask_pending" || s === "permission_prompt") runningCount++;
      else failedCount++;
    }
    return {
      completedCount,
      failedCount,
      runningCount,
      totalCount: entries.length,
    };
  }

  /** Overall progress percentage. */
  let overallProgress = $derived.by(() => {
    const total = phases.reduce((s, p) => s + p.totalCount, 0);
    if (total === 0) return status === "success" ? 100 : 0;
    const done = phases.reduce((s, p) => s + p.completedCount, 0);
    return Math.round((done / total) * 100);
  });

  /** Phase status: "completed" | "running" | "pending" | "failed" */
  function phaseStatus(p: PhaseInfo): string {
    if (p.totalCount === 0) return "pending";
    if (p.failedCount > 0 && p.runningCount === 0 && p.completedCount === 0) return "failed";
    if (p.runningCount > 0) return "running";
    if (p.completedCount === p.totalCount) return "completed";
    if (p.completedCount > 0) return "running";
    return "pending";
  }
</script>

<div class="workflow-progress flex flex-col gap-2 py-1">
  <!-- Overall progress bar -->
  {#if phases.length > 1 || phases[0].totalCount > 0}
    <div class="flex items-center gap-2">
      <div class="flex-1 h-1.5 rounded-full bg-muted overflow-hidden flex">
        {#each phases as phase, i (phase.name || i)}
          {@const ps = phaseStatus(phase)}
          {@const width = phases.length > 0 ? `${100 / phases.length}%` : "100%"}
          <div
            class="h-full transition-colors duration-300 {i > 0
              ? 'border-l border-background'
              : ''}"
            style:width
            class:bg-miwarp-status-success={ps === "completed"}
            class:bg-miwarp-status-info={ps === "running"}
            class:bg-miwarp-status-error={ps === "failed"}
            class:bg-muted={ps === "pending"}
          >
            {#if ps === "running" && phase.totalCount > 0}
              <div
                class="h-full bg-miwarp-status-info/40 motion-sweep"
                style:width="{Math.round((phase.completedCount / phase.totalCount) * 100)}%"
              ></div>
            {/if}
          </div>
        {/each}
      </div>
      <span class="text-[10px] text-muted-foreground tabular-nums shrink-0">
        {overallProgress}%
      </span>
    </div>
  {/if}

  <!-- Phase detail chips -->
  {#if phases.length > 1}
    <div class="flex flex-wrap gap-1.5">
      {#each phases as phase, i (phase.name || i)}
        {@const ps = phaseStatus(phase)}
        <div
          class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors
            {ps === 'completed'
            ? 'bg-[hsl(var(--miwarp-status-success)/0.12)] text-miwarp-status-success'
            : ps === 'running'
              ? 'bg-[hsl(var(--miwarp-status-info)/0.12)] text-miwarp-status-info'
              : ps === 'failed'
                ? 'bg-[hsl(var(--miwarp-status-error)/0.12)] text-miwarp-status-error'
                : 'bg-muted text-muted-foreground/60'}"
        >
          {#if ps === "completed"}
            <Icon name="check" size="xs" class="shrink-0" />
          {:else if ps === "running"}
            <span class="h-2 w-2 rounded-full bg-miwarp-status-info motion-running-pulse shrink-0"
            ></span>
          {:else if ps === "failed"}
            <Icon name="x" size="xs" class="shrink-0" />
          {:else}
            <span class="h-2 w-2 rounded-full bg-muted-foreground/30 shrink-0"></span>
          {/if}
          <span class="truncate max-w-[100px]">{phase.name || `Phase ${i + 1}`}</span>
          {#if phase.totalCount > 0}
            <span class="opacity-60">{phase.completedCount}/{phase.totalCount}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
