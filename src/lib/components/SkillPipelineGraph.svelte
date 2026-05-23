<script lang="ts">
  import type {
    SkillPipeline,
    SkillPipelineStep,
    PipelineStepStatus,
  } from "$lib/types/skill-pipeline";

  interface Props {
    pipeline: SkillPipeline;
    executionState?: {
      currentStepIndex: number;
      stepStatuses: Record<string, PipelineStepStatus>;
    };
    compact?: boolean;
  }

  let { pipeline, executionState, compact = false }: Props = $props();

  // Layout constants
  const NODE_WIDTH = compact ? 100 : 140;
  const NODE_HEIGHT = compact ? 40 : 60;
  const H_GAP = compact ? 30 : 50;
  const V_GAP = compact ? 20 : 40;
  const PADDING = 20;

  /**
   * Calculate node positions using topological levels
   */
  const layout = $derived.by(() => {
    const steps = pipeline.steps;
    const levels: string[][] = [];
    const visited = new Set<string>();
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    // Build dependency graph
    for (const step of steps) {
      inDegree.set(step.skillName, step.dependsOn?.length || 0);
      for (const dep of step.dependsOn || []) {
        if (!dependents.has(dep)) dependents.set(dep, []);
        dependents.get(dep)!.push(step.skillName);
      }
    }

    // Topological sort by levels
    while (visited.size < steps.length) {
      const level: string[] = [];

      for (const step of steps) {
        if (!visited.has(step.skillName) && (inDegree.get(step.skillName) || 0) === 0) {
          level.push(step.skillName);
        }
      }

      if (level.length === 0) break;

      levels.push(level);

      for (const stepId of level) {
        visited.add(stepId);
        for (const dependent of dependents.get(stepId) || []) {
          inDegree.set(dependent, (inDegree.get(dependent) || 0) - 1);
        }
      }
    }

    // Calculate positions
    const positions = new Map<string, { x: number; y: number }>();
    let maxWidth = 0;

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const levelWidth = level.length * NODE_WIDTH + (level.length - 1) * H_GAP;
      maxWidth = Math.max(maxWidth, levelWidth);

      for (let j = 0; j < level.length; j++) {
        positions.set(level[j], {
          x: PADDING + j * (NODE_WIDTH + H_GAP),
          y: PADDING + i * (NODE_HEIGHT + V_GAP),
        });
      }
    }

    return {
      levels,
      positions,
      width: maxWidth + PADDING * 2,
      height: levels.length * NODE_HEIGHT + (levels.length - 1) * V_GAP + PADDING * 2,
    };
  });

  /**
   * Get SVG path for an edge between two nodes
   */
  function getEdgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
    const fromCenterX = from.x + NODE_WIDTH;
    const fromCenterY = from.y + NODE_HEIGHT / 2;
    const toCenterX = to.x;
    const toCenterY = to.y + NODE_HEIGHT / 2;

    const midX = (fromCenterX + toCenterX) / 2;

    return `M ${fromCenterX} ${fromCenterY}
            C ${midX} ${fromCenterY},
              ${midX} ${toCenterY},
              ${toCenterX} ${toCenterY}`;
  }

  /**
   * Get step status with fallback to execution state
   */
  function getStepStatus(step: SkillPipelineStep): PipelineStepStatus {
    if (executionState?.stepStatuses[step.skillName]) {
      return executionState.stepStatuses[step.skillName];
    }
    return "pending";
  }

  /**
   * Get step status display info
   */
  function getStatusInfo(status: PipelineStepStatus): {
    bgClass: string;
    borderClass: string;
    icon: string;
    label: string;
  } {
    switch (status) {
      case "running":
        return {
          bgClass: "fill-blue-500/20 stroke-blue-500",
          borderClass: "border-blue-500",
          icon: "▶",
          label: "Running",
        };
      case "completed":
        return {
          bgClass: "fill-green-500/20 stroke-green-500",
          borderClass: "border-green-500",
          icon: "✓",
          label: "Completed",
        };
      case "failed":
        return {
          bgClass: "fill-red-500/20 stroke-red-500",
          borderClass: "border-red-500",
          icon: "✗",
          label: "Failed",
        };
      case "skipped":
        return {
          bgClass: "fill-gray-500/20 stroke-gray-500",
          borderClass: "border-gray-500",
          icon: "○",
          label: "Skipped",
        };
      default:
        return {
          bgClass: "fill-muted/30 stroke-muted-foreground",
          borderClass: "border-border",
          icon: "○",
          label: "Pending",
        };
    }
  }

  /**
   * Check if a step should animate (is running)
   */
  function isRunning(status: PipelineStepStatus): boolean {
    return status === "running";
  }

  /**
   * Get total progress percentage
   */
  const progress = $derived.by(() => {
    if (!executionState) return 0;
    const totalSteps = pipeline.steps.length;
    const completedSteps = pipeline.steps.filter(
      (s) => executionState.stepStatuses[s.skillName] === "completed",
    ).length;
    return Math.round((completedSteps / totalSteps) * 100);
  });
</script>

/** * SkillPipelineGraph - Visual DAG representation of skill pipelines * * Features: * - Visual DAG
with nodes and edges * - Execution progress tracking with animated states * - Step status: pending,
running, completed, failed * - Dependency arrows with proper layout */
<div class="relative" style="min-width: {layout.width}px">
  {#if executionState}
    <!-- Progress bar -->
    <div class="mb-3">
      <div class="flex items-center justify-between text-xs text-muted-foreground mb-1">
        <span>Progress</span>
        <span>{progress}%</span>
      </div>
      <div class="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          class="h-full rounded-full bg-primary transition-all duration-300"
          style="width: {progress}%"
        ></div>
      </div>
    </div>
  {/if}

  <svg
    class="overflow-visible"
    width={layout.width}
    height={layout.height}
    viewBox="0 0 {layout.width} {layout.height}"
  >
    <!-- Edges (draw first so they appear behind nodes) -->
    <g class="edges">
      {#each pipeline.steps as step}
        {@const fromPos = layout.positions.get(step.skillName)}
        {#if fromPos && step.dependsOn}
          {#each step.dependsOn as depId}
            {@const toPos = layout.positions.get(depId)}
            {#if toPos}
              {@const status = getStepStatus(step)}
              {@const depStatus = getStepStatus(
                pipeline.steps.find((s) => s.skillName === depId) || step,
              )}
              <path
                d={getEdgePath(toPos, fromPos)}
                fill="none"
                stroke={status === "failed" || depStatus === "failed"
                  ? "hsl(var(--destructive))"
                  : status === "completed" || depStatus === "completed"
                    ? "hsl(var(--primary))"
                    : "hsl(var(--muted-foreground))"}
                stroke-width={compact ? 1.5 : 2}
                stroke-dasharray={status === "pending" ? "4,4" : "none"}
                opacity="0.6"
              />
              <!-- Arrow head -->
              <polygon
                points="{fromPos.x - 4},{fromPos.y + NODE_HEIGHT / 2 - 4} {fromPos.x},{fromPos.y +
                  NODE_HEIGHT / 2} {fromPos.x - 4},{fromPos.y + NODE_HEIGHT / 2 + 4}"
                fill={status === "failed"
                  ? "hsl(var(--destructive))"
                  : "hsl(var(--muted-foreground))"}
                opacity="0.8"
              />
            {/if}
          {/each}
        {/if}
      {/each}
    </g>

    <!-- Nodes -->
    <g class="nodes">
      {#each pipeline.steps as step}
        {@const pos = layout.positions.get(step.skillName)}
        {@const status = getStepStatus(step)}
        {@const statusInfo = getStatusInfo(status)}
        {#if pos}
          <g transform="translate({pos.x}, {pos.y})">
            <!-- Node background -->
            <rect
              x="0"
              y="0"
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
              rx={compact ? 4 : 8}
              class="fill-muted/30 {statusInfo.borderClass}"
              stroke-width={compact ? 1 : 2}
            />

            <!-- Running animation -->
            {#if isRunning(status)}
              <rect
                x="0"
                y="0"
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={compact ? 4 : 8}
                fill="none"
                stroke="hsl(var(--primary))"
                stroke-width="2"
                stroke-dasharray="8,4"
                class="animate-pulse"
              />
            {/if}

            <!-- Step name (truncated if needed) -->
            <text
              x={NODE_WIDTH / 2}
              y={NODE_HEIGHT / 2 - (compact ? 4 : 6)}
              text-anchor="middle"
              dominant-baseline="middle"
              class="fill-foreground text-xs {compact ? 'font-medium' : 'font-semibold'}"
            >
              {step.skillName.length > (compact ? 12 : 16)
                ? step.skillName.slice(0, compact ? 12 : 16) + "…"
                : step.skillName}
            </text>

            {#if !compact}
              <!-- Status indicator -->
              <g transform="translate({NODE_WIDTH - 16}, 8)">
                <circle cx="0" cy="0" r="6" class={statusInfo.bgClass} />
                <text
                  x="0"
                  y="0"
                  text-anchor="middle"
                  dominant-baseline="middle"
                  class="fill-foreground text-[10px]"
                >
                  {statusInfo.icon}
                </text>
              </g>

              <!-- Tooltip on hover -->
              <title>{step.skillName}: {statusInfo.label}</title>
            {/if}

            {#if compact}
              <!-- Compact status icon -->
              <text
                x={NODE_WIDTH - 8}
                y={NODE_HEIGHT / 2}
                text-anchor="end"
                dominant-baseline="middle"
                class="fill-foreground text-xs"
              >
                {statusInfo.icon}
              </text>
            {/if}
          </g>
        {/if}
      {/each}
    </g>
  </svg>

  <!-- Legend -->
  {#if !compact}
    <div class="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
      <div class="flex items-center gap-1">
        <div class="w-2.5 h-2.5 rounded-full bg-muted border border-border"></div>
        <span>Pending</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="w-2.5 h-2.5 rounded-full bg-blue-500/20 border border-blue-500"></div>
        <span>Running</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="w-2.5 h-2.5 rounded-full bg-green-500/20 border border-green-500"></div>
        <span>Completed</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500"></div>
        <span>Failed</span>
      </div>
    </div>
  {/if}
</div>

<style>
  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .animate-pulse {
    animation: pulse 1.5s ease-in-out infinite;
  }
</style>
