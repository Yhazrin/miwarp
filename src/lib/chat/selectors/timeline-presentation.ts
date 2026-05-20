/**
 * Timeline presentation selector: computes filtered/visible timeline and related
 * annotations (tool names, bursts, batch groups, created files, etc.) in one pass.
 */
import type { TimelineEntry } from "$lib/types";
import type { BusToolItem, ToolBurst } from "$lib/utils/tool-rendering";
import { detectBatchGroups, detectToolBursts } from "$lib/utils/tool-rendering";

/** Distinct tool names in timeline, sorted. */
function selectSortedToolNames(timeline: TimelineEntry[]): string[] {
  const names = new Set<string>();
  for (const entry of timeline) {
    if (entry.kind === "tool") names.add(entry.tool.tool_name);
  }
  return [...names].sort();
}

/** Filter timeline by tool name; null means no filter. */
function filterTimelineByTool(
  timeline: TimelineEntry[],
  toolFilter: string | null,
): TimelineEntry[] {
  if (!toolFilter) return timeline;
  return timeline.filter((e) => e.kind !== "tool" || e.tool.tool_name === toolFilter);
}

/** Compute visible slice from filtered timeline using renderLimit. */
function computeVisibleSlice(filtered: TimelineEntry[], renderLimit: number): TimelineEntry[] {
  const start = Math.max(0, filtered.length - renderLimit);
  return filtered.slice(start);
}

/** Build a Map of visibleTimeline index → array of agent labels (from Batch groups). */
function computeBatchGroups(timeline: TimelineEntry[]): Map<number, string[]> {
  const raw = detectBatchGroups(timeline);
  const result = new Map<number, string[]>();
  for (const [startIdx, tools] of raw) {
    result.set(
      startIdx,
      tools.map((t) => t.tool_name),
    );
  }
  return result;
}

/** Build a Map of timeline index → ToolBurst. */
function computeToolBursts(timeline: TimelineEntry[]): Map<number, ToolBurst> {
  return detectToolBursts(timeline);
}

export interface TimelinePresentation {
  filteredTimeline: TimelineEntry[];
  visibleTimeline: TimelineEntry[];
  toolNames: string[];
  timelineIdIndex: Map<number, number>;
  lastClearSepId: string | null;
  latestPlanToolId: string | null;
  createdFiles: Array<{ path: string; name: string; tool: string; timestamp: number }>;
  batchGroups: Map<number, string[]>;
  toolBursts: Map<number, ToolBurst>;
  userCountPrefix: Int32Array;
}

interface CreatedFileRow {
  path: string;
  name: string;
  tool: string;
  timestamp: number;
}

/** Collect successful tool outputs that created a file path. */
function selectCreatedFiles(timeline: TimelineEntry[]): CreatedFileRow[] {
  const files: CreatedFileRow[] = [];
  const seen = new Set<string>();
  for (const entry of timeline) {
    if (entry.kind !== "tool") continue;
    const tool = entry.tool;
    if (tool.status !== "success") continue;
    const output = tool.output as Record<string, unknown> | undefined;
    if (!output) continue;
    const path =
      (output.path as string) || (output.file_path as string) || (output.created_path as string);
    if (path && !seen.has(path)) {
      seen.add(path);
      files.push({
        path,
        name: path.split("/").pop() ?? path,
        tool: tool.tool_name,
        timestamp: ((entry as Record<string, unknown>).seq as number) ?? Date.now(),
      });
    }
  }
  return files.sort((a, b) => a.timestamp - b.timestamp);
}

/** Prefix-sum of user message count across timeline entries. */
function computeUserCountPrefix(filtered: TimelineEntry[]): Int32Array {
  const arr = new Int32Array(filtered.length + 1);
  for (let i = 0; i < filtered.length; i++) {
    arr[i + 1] = arr[i] + (filtered[i].kind === "user" ? 1 : 0);
  }
  return arr;
}

function findLastClearSepId(timeline: TimelineEntry[]): string | null {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const e = timeline[i];
    if (e.kind === "clear") return e.id;
  }
  return null;
}

function findLatestPlanToolId(timeline: TimelineEntry[]): string | null {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const e = timeline[i];
    if (e.kind === "tool" && e.tool.tool_name === "Write") {
      const output = e.tool.output as Record<string, unknown> | undefined;
      if (
        output &&
        typeof output.created_path === "string" &&
        output.created_path.endsWith(".md")
      ) {
        return e.tool.tool_use_id ?? null;
      }
    }
  }
  return null;
}

/**
 * Compute the full timeline presentation object.
 *
 * @param timeline       Raw timeline entries
 * @param toolFilter     Tool name filter (null = no filter)
 * @param renderLimit    Max entries to show in visible slice
 * @param _toolCount     Unused, kept for signature compatibility
 */
export function computeTimelinePresentation(
  timeline: TimelineEntry[],
  toolFilter: string | null,
  renderLimit: number,
  _toolCount: number,
): TimelinePresentation {
  const filteredTimeline = filterTimelineByTool(timeline, toolFilter);
  const visibleTimeline = computeVisibleSlice(filteredTimeline, renderLimit);
  const toolNames = selectSortedToolNames(timeline);

  // Build timelineIdIndex: maps timeline index → position in filtered timeline
  const timelineIdIndex = new Map<number, number>();
  for (let i = 0; i < timeline.length; i++) {
    const filteredIdx = filteredTimeline.findIndex((e) => e.id === timeline[i].id);
    if (filteredIdx !== -1) {
      timelineIdIndex.set(i, filteredIdx);
    }
  }

  const lastClearSepId = findLastClearSepId(filteredTimeline);
  const latestPlanToolId = findLatestPlanToolId(filteredTimeline);
  const createdFiles = selectCreatedFiles(filteredTimeline);
  const batchGroups = computeBatchGroups(filteredTimeline);
  const toolBursts = computeToolBursts(filteredTimeline);
  const userCountPrefix = computeUserCountPrefix(filteredTimeline);

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

/** Initial render limit based on process visibility mode. */
export function getInitialRenderLimit(
  processVisibility: string,
  _timeline: TimelineEntry[],
): number {
  // Developer view shows more by default
  if (processVisibility === "developer") return 200;
  if (processVisibility === "output") return 50;
  return 100;
}
