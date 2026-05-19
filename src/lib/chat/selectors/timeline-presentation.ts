/**
 * Pure selectors for timeline rendering.
 *
 * Extracted from +page.svelte to keep the page file focused on UI wiring.
 * All functions are side-effect-free — they transform data, nothing more.
 */
import type { BusToolItem, TimelineEntry } from "$lib/types";
import type { ProcessVisibility } from "$lib/utils/process-visibility";
import {
  isPlanFilePath,
  detectBatchGroups,
  detectToolBursts,
  type ToolBurst,
} from "$lib/utils/tool-rendering";
import { CONTEXT_CLEARED_MARKER } from "$lib/utils/slash-commands";

// ── Constants ──

const INITIAL_RENDER_LIMIT = 100;

// ── Initial render limit ──

/**
 * Compute the initial `renderLimit` for progressive timeline rendering.
 * Returns a smaller window for "output" mode (fewer visible items), and
 * `Infinity` (show everything) for higher-fidelity modes.
 */
export function getInitialRenderLimit(mode: ProcessVisibility, timeline: TimelineEntry[]): number {
  if (mode === "output") return INITIAL_RENDER_LIMIT;
  return timeline.length > 0 ? timeline.length : INITIAL_RENDER_LIMIT;
}

// ── Timeline presentation ──

export interface TimelinePresentation {
  filteredTimeline: TimelineEntry[];
  visibleTimeline: TimelineEntry[];
  toolNames: string[];
  timelineIdIndex: Map<string, number>;
  lastClearSepId: string | null;
  latestPlanToolId: string | null;
  createdFiles: Array<{ path: string; name: string; tool: string; timestamp: number }>;
  batchGroups: Map<number, BusToolItem[]>;
  toolBursts: Map<number, ToolBurst>;
  userCountPrefix: Int32Array;
}

/**
 * Compute all derived timeline data in a single pass.
 *
 * This replaces what was previously a constellation of `$derived` blocks in
 * +page.svelte.  Keeping it as a plain function makes the logic testable
 * and avoids reactive-scope footguns.
 */
export function computeTimelinePresentation(
  timeline: TimelineEntry[],
  toolFilter: string | null,
  renderLimit: number,
  _toolCount: number,
): TimelinePresentation {
  // ── Filtered timeline ──
  const filteredTimeline = toolFilter
    ? timeline.filter((e) => e.kind !== "tool" || e.tool.tool_name === toolFilter)
    : timeline;

  // ── Visible timeline (progressive slice — last N entries) ──
  const visibleTimeline =
    renderLimit >= filteredTimeline.length
      ? filteredTimeline
      : filteredTimeline.slice(filteredTimeline.length - renderLimit);

  // ── Tool names in full timeline ──
  const nameSet = new Set<string>();
  for (const entry of timeline) {
    if (entry.kind === "tool") nameSet.add(entry.tool.tool_name);
  }
  const toolNames = [...nameSet].sort();

  // ── ID → index map ──
  const timelineIdIndex = new Map<string, number>();
  for (let i = 0; i < timeline.length; i++) {
    timelineIdIndex.set(timeline[i].id, i);
  }

  // ── Last context-cleared separator ──
  let lastClearSepId: string | null = null;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const e = timeline[i];
    if (e.kind === "separator" && e.content === CONTEXT_CLEARED_MARKER) {
      lastClearSepId = e.id;
      break;
    }
  }

  // ── Latest plan tool (for auto-expand) ──
  let latestPlanToolId: string | null = null;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const e = timeline[i];
    if (e.kind !== "tool" || !e.tool) continue;
    const fp = String(e.tool.input?.file_path ?? e.tool.input?.path ?? "");
    if ((e.tool.tool_name === "Write" || e.tool.tool_name === "Edit") && isPlanFilePath(fp)) {
      latestPlanToolId = e.tool.tool_use_id;
      break;
    }
  }

  // ── Created files ──
  const createdFiles: TimelinePresentation["createdFiles"] = [];
  const seenPaths = new Set<string>();
  for (const entry of timeline) {
    if (entry.kind !== "tool") continue;
    const tool = entry.tool;
    if (tool.status !== "success") continue;
    const output = tool.output as Record<string, unknown> | undefined;
    if (!output) continue;
    const path =
      (output.path as string) || (output.file_path as string) || (output.created_path as string);
    if (path && !seenPaths.has(path)) {
      seenPaths.add(path);
      createdFiles.push({
        path,
        name: path.split("/").pop() ?? path,
        tool: tool.tool_name,
        timestamp: ((entry as Record<string, unknown>).seq as number) ?? Date.now(),
      });
    }
  }
  createdFiles.sort((a, b) => a.timestamp - b.timestamp);

  // ── Batch groups (consecutive ≥3 Task tools) ──
  const batchGroups = toolFilter
    ? new Map<number, BusToolItem[]>()
    : detectBatchGroups(visibleTimeline);

  // ── Tool bursts ──
  const toolBursts = toolFilter
    ? (new Map<number, ToolBurst>() as Map<number, ToolBurst>)
    : detectToolBursts(visibleTimeline);

  // ── User-count prefix sum ──
  const userCountPrefix = new Int32Array(filteredTimeline.length + 1);
  for (let i = 0; i < filteredTimeline.length; i++) {
    userCountPrefix[i + 1] = userCountPrefix[i] + (filteredTimeline[i].kind === "user" ? 1 : 0);
  }

  return {
    filteredTimeline,
    visibleTimeline,
    toolNames,
    timelineIdIndex,
    lastClearSepId,
    latestPlanToolId,
    createdFiles,
    batchGroups,
    toolBursts,
    userCountPrefix,
  };
}
