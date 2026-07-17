/**
 * Deterministic render-work budget for long-session timeline rendering.
 *
 * Used by perf tests and dev diagnostics to quantify mount/presentation cost
 * without a browser. Units are intentionally simple integers so regressions
 * are easy to spot in CI.
 */
import type { TimelineEntry } from "$lib/types";
import type { ProcessVisibility } from "$lib/utils/process-visibility";
import {
  computeTimelineMetadata,
  getInitialRenderLimit,
  RENDER_GROWTH_STEP,
  sliceVisibleTimeline,
  TAIL_LIVE_ENTRIES,
  type TimelineMetadata,
} from "$lib/chat/selectors/timeline-presentation";

export { RENDER_GROWTH_STEP, TAIL_LIVE_ENTRIES };

export interface RenderWorkBudget {
  /** DOM row mounts (one per visible timeline entry). */
  mountedEntries: number;
  /** Characters eligible for eager markdown parse (non-lazy / non-frozen). */
  eagerMarkdownChars: number;
  /** Full-timeline metadata scan units (one per entry in metadata pass). */
  metadataScanUnits: number;
  /** Visible-only burst/batch detection units. */
  visibleBurstScanUnits: number;
}

export interface LoadMoreSimulation {
  prevLimit: number;
  nextLimit: number;
  newlyMounted: number;
  hiddenRemaining: number;
}

/** Build a synthetic long timeline for benchmarks and tests. */
export function buildSyntheticTimeline(count: number): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (let i = 0; i < count; i++) {
    const id = `e-${i}`;
    if (i % 3 === 0) {
      entries.push({
        kind: "user",
        id,
        anchorId: `a-${id}`,
        content: `User message ${i} with enough text to simulate markdown cost.`,
        ts: `2025-01-01T00:${String(i % 60).padStart(2, "0")}:00Z`,
      });
    } else if (i % 3 === 1) {
      entries.push({
        kind: "assistant",
        id,
        anchorId: `a-${id}`,
        content: `Assistant reply ${i}\n\n\`\`\`ts\nconst x = ${i};\n\`\`\``,
        ts: `2025-01-01T00:${String(i % 60).padStart(2, "0")}:01Z`,
      });
    } else {
      entries.push({
        kind: "tool",
        id,
        anchorId: `a-${id}`,
        ts: `2025-01-01T00:${String(i % 60).padStart(2, "0")}:02Z`,
        tool: {
          tool_use_id: `tu-${id}`,
          tool_name: i % 6 === 0 ? "Bash" : "Read",
          input: { file_path: `/src/file-${i}.ts` },
          status: "success",
          output: { path: `/src/file-${i}.ts` },
        },
      });
    }
  }
  return entries;
}

function markdownChars(entry: TimelineEntry): number {
  if (entry.kind === "user" || entry.kind === "assistant") return entry.content.length;
  if (entry.kind === "command_output" || entry.kind === "separator") return entry.content.length;
  return 0;
}

/** Estimate render work for a presentation snapshot. */
export function estimateRenderWork(
  visibleTimeline: TimelineEntry[],
  metadata: TimelineMetadata,
  options?: { frozenTailOffset?: number },
): RenderWorkBudget {
  const frozenTailOffset = options?.frozenTailOffset ?? TAIL_LIVE_ENTRIES;
  const frozenCutoff = Math.max(0, visibleTimeline.length - frozenTailOffset);

  let eagerMarkdownChars = 0;
  for (let i = 0; i < visibleTimeline.length; i++) {
    if (i >= frozenCutoff) {
      eagerMarkdownChars += markdownChars(visibleTimeline[i]);
    }
  }

  return {
    mountedEntries: visibleTimeline.length,
    eagerMarkdownChars,
    metadataScanUnits: metadata.scanUnits,
    visibleBurstScanUnits: visibleTimeline.length,
  };
}

/** Legacy baseline: mount entire timeline on open (pre-v1.0.9 guided/developer). */
function legacyInitialRenderLimit(
  mode: ProcessVisibility,
  timeline: TimelineEntry[],
): number {
  if (mode === "output") return 100;
  return timeline.length > 0 ? timeline.length : 100;
}

/** Compare optimized vs legacy mount budgets for a long session open. */
export function compareOpenBudgets(
  timeline: TimelineEntry[],
  mode: ProcessVisibility = "developer",
): {
  legacy: RenderWorkBudget;
  optimized: RenderWorkBudget;
  mountReductionPct: number;
} {
  const metadata = computeTimelineMetadata(timeline);

  const legacyLimit = legacyInitialRenderLimit(mode, timeline);
  const legacyVisible = sliceVisibleTimeline(timeline, legacyLimit);
  const legacy = estimateRenderWork(legacyVisible, metadata);

  const optimizedLimit = getInitialRenderLimit(mode, timeline);
  const optimizedVisible = sliceVisibleTimeline(timeline, optimizedLimit);
  const optimized = estimateRenderWork(optimizedVisible, metadata);

  const mountReductionPct =
    legacy.mountedEntries === 0
      ? 0
      : Math.round((1 - optimized.mountedEntries / legacy.mountedEntries) * 100);

  return { legacy, optimized, mountReductionPct };
}

/** Simulate one progressive "load earlier" step. */
export function simulateLoadMoreEarlier(
  timelineLength: number,
  prevRenderLimit: number,
  step: number = RENDER_GROWTH_STEP,
): LoadMoreSimulation {
  const nextLimit = Math.min(prevRenderLimit + step, timelineLength);
  return {
    prevLimit: prevRenderLimit,
    nextLimit,
    newlyMounted: Math.max(0, nextLimit - prevRenderLimit),
    hiddenRemaining: Math.max(0, timelineLength - nextLimit),
  };
}
