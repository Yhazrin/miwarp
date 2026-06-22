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

/** Initial visible window per process-visibility mode (progressive mount). */
export const INITIAL_RENDER_LIMIT_BY_MODE: Record<ProcessVisibility, number> = {
  output: 100,
  guided: 150,
  developer: 200,
  expert: 200,
};

const DEFAULT_INITIAL_RENDER_LIMIT = 150;
/** Number of older rows mounted per progressive scroll-up step. */
export const RENDER_GROWTH_STEP = 100;
/** Tail rows that remain live for streaming animation and eager markdown. */
export const TAIL_LIVE_ENTRIES = 3;

// ── Initial render limit ──

/**
 * Compute the initial `renderLimit` for progressive timeline rendering.
 * All modes cap the first paint to a bounded window; older rows load on
 * scroll-up via loadMoreEarlier (RENDER_GROWTH_STEP).
 */
export function getInitialRenderLimit(mode: ProcessVisibility, timeline: TimelineEntry[]): number {
  const cap = INITIAL_RENDER_LIMIT_BY_MODE[mode] ?? DEFAULT_INITIAL_RENDER_LIMIT;
  if (timeline.length === 0) return cap;
  return Math.min(timeline.length, cap);
}

/** Slice the filtered timeline to the progressive visible window. */
export function sliceVisibleTimeline(
  filteredTimeline: TimelineEntry[],
  renderLimit: number,
): TimelineEntry[] {
  if (renderLimit >= filteredTimeline.length) return filteredTimeline;
  return filteredTimeline.slice(filteredTimeline.length - renderLimit);
}

// ── Timeline metadata (full-timeline scans, cacheable separately) ──

export interface TimelineMetadata {
  toolNames: string[];
  timelineIdIndex: Map<string, number>;
  lastClearSepId: string | null;
  latestPlanToolId: string | null;
  createdFiles: Array<{ path: string; name: string; tool: string; timestamp: number }>;
  /** Units scanned while building metadata — for deterministic perf budgets. */
  scanUnits: number;
}

/**
 * Full-timeline metadata pass. Expensive but independent of renderLimit;
 * keep in its own $derived so scroll load-more does not re-scan.
 */
export function computeTimelineMetadata(timeline: TimelineEntry[]): TimelineMetadata {
  let scanUnits = 0;

  const nameSet = new Set<string>();
  for (const entry of timeline) {
    scanUnits++;
    if (entry.kind === "tool") nameSet.add(entry.tool.tool_name);
  }
  const toolNames = [...nameSet].sort();

  const timelineIdIndex = new Map<string, number>();
  for (let i = 0; i < timeline.length; i++) {
    timelineIdIndex.set(timeline[i].id, i);
  }

  let lastClearSepId: string | null = null;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const e = timeline[i];
    if (e.kind === "separator" && e.content === CONTEXT_CLEARED_MARKER) {
      lastClearSepId = e.id;
      break;
    }
  }

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

  const createdFiles: TimelineMetadata["createdFiles"] = [];
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

  return {
    toolNames,
    timelineIdIndex,
    lastClearSepId,
    latestPlanToolId,
    createdFiles,
    scanUnits,
  };
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
  metadata: TimelineMetadata;
}

/**
 * Compute visible-slice presentation. Pass precomputed metadata when the
 * timeline has not changed — avoids re-scanning 1000+ entries on load-more.
 */
export function computeTimelinePresentation(
  timeline: TimelineEntry[],
  toolFilter: string | null,
  renderLimit: number,
  metadataInput?: TimelineMetadata,
): TimelinePresentation {
  const metadata = metadataInput ?? computeTimelineMetadata(timeline);

  const filteredTimeline = toolFilter
    ? timeline.filter((e) => e.kind !== "tool" || e.tool.tool_name === toolFilter)
    : timeline;

  const visibleTimeline = sliceVisibleTimeline(filteredTimeline, renderLimit);

  const batchGroups = toolFilter
    ? new Map<number, BusToolItem[]>()
    : detectBatchGroups(visibleTimeline);

  const toolBursts = toolFilter
    ? (new Map<number, ToolBurst>() as Map<number, ToolBurst>)
    : detectToolBursts(visibleTimeline);

  const userCountPrefix = new Int32Array(filteredTimeline.length + 1);
  for (let i = 0; i < filteredTimeline.length; i++) {
    userCountPrefix[i + 1] = userCountPrefix[i] + (filteredTimeline[i].kind === "user" ? 1 : 0);
  }

  return {
    filteredTimeline,
    visibleTimeline,
    toolNames: metadata.toolNames,
    timelineIdIndex: metadata.timelineIdIndex,
    lastClearSepId: metadata.lastClearSepId,
    latestPlanToolId: metadata.latestPlanToolId,
    createdFiles: metadata.createdFiles,
    batchGroups,
    toolBursts,
    userCountPrefix,
    metadata,
  };
}
