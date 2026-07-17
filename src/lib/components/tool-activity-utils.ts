/**
 * Shared types and pure helper functions for ToolActivity.
 * Extracted from ToolActivity.svelte to reduce component size.
 */
import type { HookEvent, TimelineEntry } from "$lib/types";
import type { BusToolItem } from "$lib/types";
import { truncate } from "$lib/utils/format";
import { getToolDetail as getToolDetailRaw } from "$lib/utils/tool-rendering";

// ── Types ──

export type StatusCategory = "done" | "running" | "error" | "other";

export interface ToolNode {
  tool: BusToolItem;
  children: ToolNode[];
}

export interface ToolTurn {
  turnIndex: number;
  userPreview: string;
  tools: ToolNode[];
  anchorId?: string;
}

export interface TurnCategoryBreakdown {
  reads: number;
  searches: number;
  bash: number;
  writes: number;
  errors: number;
}

export interface ToolActivityStats {
  summary: [string, number][];
  doneCount: number;
  runningCount: number;
  errorCount: number;
  totalToolCount: number;
  reads: number;
  searches: number;
  bash: number;
  writes: number;
}

// ── Constants ──

const READ_TOOLS = new Set(["Read", "read_file"]);
const SEARCH_TOOLS = new Set([
  "Grep",
  "Glob",
  "search_files",
  "list_directory",
  "WebFetch",
  "WebSearch",
]);
const BASH_TOOLS = new Set(["Bash", "bash", "PowerShell"]);
const WRITE_TOOLS = new Set([
  "Write",
  "Edit",
  "write_file",
  "edit_file",
  "MultiEdit",
  "NotebookEdit",
]);

// ── Helper functions ──

export function getToolDetail(tool: BusToolItem): string {
  return truncate(getToolDetailRaw(tool.input as Record<string, unknown>), 50);
}

export function getHookDetail(event: HookEvent): string {
  return truncate(getToolDetailRaw(event.tool_input as Record<string, unknown>), 50);
}

export function categorizeBusStatus(status: string): StatusCategory {
  switch (status) {
    case "success":
      return "done";
    case "running":
      return "running";
    case "error":
    case "denied":
    case "permission_denied":
      return "error";
    case "ask_pending":
    case "permission_prompt":
      return "other";
    default:
      return "other";
  }
}

export function categorizeHookStatus(status: string | undefined): StatusCategory {
  if (!status) return "other";
  switch (status) {
    case "done":
    case "success":
      return "done";
    case "running":
    case "pending":
      return "running";
    case "error":
    case "denied":
      return "error";
    default:
      return "other";
  }
}

function categorizeTool(name: string): "read" | "search" | "bash" | "write" | "other" {
  if (READ_TOOLS.has(name)) return "read";
  if (SEARCH_TOOLS.has(name)) return "search";
  if (BASH_TOOLS.has(name)) return "bash";
  if (WRITE_TOOLS.has(name)) return "write";
  return "other";
}

/** Build a tree from TimelineEntries, preserving parent→child hierarchy. */
function buildToolTree(entries: TimelineEntry[], seen: Set<string>): ToolNode[] {
  const result: ToolNode[] = [];
  for (const entry of entries) {
    if (entry.kind === "tool" && !seen.has(entry.tool.tool_use_id)) {
      seen.add(entry.tool.tool_use_id);
      result.push({
        tool: entry.tool,
        children: entry.subTimeline ? buildToolTree(entry.subTimeline, seen) : [],
      });
    }
  }
  return result;
}

/** Flatten tree nodes for counting/statistics. */
export function flattenNodes(nodes: ToolNode[]): BusToolItem[] {
  const result: BusToolItem[] = [];
  for (const node of nodes) {
    result.push(node.tool);
    if (node.children.length > 0) result.push(...flattenNodes(node.children));
  }
  return result;
}

/** Recursively count all nodes in a tree. */
export function countToolNodes(nodes: ToolNode[]): number {
  let count = 0;
  for (const node of nodes) count += 1 + countToolNodes(node.children);
  return count;
}

/** Per-turn category breakdown. */
export function getTurnBreakdown(turn: ToolTurn): TurnCategoryBreakdown {
  let reads = 0,
    searches = 0,
    bashCmds = 0,
    writes = 0,
    errs = 0;
  for (const t of flattenNodes(turn.tools)) {
    const group = categorizeTool(t.tool_name);
    if (group === "read") reads++;
    else if (group === "search") searches++;
    else if (group === "bash") bashCmds++;
    else if (group === "write") writes++;
    if (categorizeBusStatus(t.status) === "error") errs++;
  }
  return { reads, searches, bash: bashCmds, writes, errors: errs };
}

/** Build turns from timeline entries. */
export function buildTurns(timeline: TimelineEntry[]): ToolTurn[] {
  const result: ToolTurn[] = [];
  let currentTools: ToolNode[] = [];
  let currentPreview = "";
  let currentAnchorId: string | undefined;
  let turnIdx = 0;
  const seen = new Set<string>();

  for (const entry of timeline) {
    if (entry.kind === "separator") continue;
    if (entry.kind === "user") {
      if (currentTools.length > 0 || currentPreview || currentAnchorId) {
        result.push({
          turnIndex: turnIdx,
          userPreview: currentPreview,
          tools: currentTools,
          anchorId: currentAnchorId,
        });
      }
      turnIdx++;
      currentPreview = entry.content.slice(0, 40);
      currentAnchorId = entry.anchorId;
      currentTools = [];
    } else if (entry.kind === "tool") {
      if (!seen.has(entry.tool.tool_use_id)) {
        seen.add(entry.tool.tool_use_id);
        currentTools.push({
          tool: entry.tool,
          children: entry.subTimeline ? buildToolTree(entry.subTimeline, seen) : [],
        });
      }
    }
  }
  if (currentTools.length > 0 || currentPreview || currentAnchorId) {
    result.push({
      turnIndex: turnIdx,
      userPreview: currentPreview,
      tools: currentTools,
      anchorId: currentAnchorId,
    });
  }
  return result;
}

/** Compute tool statistics from turns or hook events. */
export function computeToolStats(
  turns: ToolTurn[],
  hookToolEvents: HookEvent[],
  useTimeline: boolean,
): ToolActivityStats {
  const counts: Record<string, number> = {};
  let done = 0,
    running = 0,
    errors = 0,
    total = 0;
  let reads = 0,
    searches = 0,
    bashCmds = 0,
    writes = 0;

  if (useTimeline) {
    for (const turn of turns) {
      for (const t of flattenNodes(turn.tools)) {
        counts[t.tool_name] = (counts[t.tool_name] ?? 0) + 1;
        total++;
        const cat = categorizeBusStatus(t.status);
        if (cat === "done") done++;
        else if (cat === "running") running++;
        else if (cat === "error") errors++;
        const group = categorizeTool(t.tool_name);
        if (group === "read") reads++;
        else if (group === "search") searches++;
        else if (group === "bash") bashCmds++;
        else if (group === "write") writes++;
      }
    }
  } else {
    for (const ev of hookToolEvents) {
      const name = ev.tool_name ?? "other";
      counts[name] = (counts[name] ?? 0) + 1;
      total++;
      const cat = categorizeHookStatus(ev.status);
      if (cat === "done") done++;
      else if (cat === "running") running++;
      else if (cat === "error") errors++;
      const group = categorizeTool(name);
      if (group === "read") reads++;
      else if (group === "search") searches++;
      else if (group === "bash") bashCmds++;
      else if (group === "write") writes++;
    }
  }
  return {
    summary: Object.entries(counts).sort((a, b) => b[1] - a[1]),
    doneCount: done,
    runningCount: running,
    errorCount: errors,
    totalToolCount: total,
    reads,
    searches,
    bash: bashCmds,
    writes,
  };
}
