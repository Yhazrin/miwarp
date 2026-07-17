/**
 * Tool batch and burst detection — identifies groups of consecutive tools in timelines.
 *
 * Pure functions for detecting Task/Agent batch groups and generic tool bursts
 * in chat timelines. Used by BatchProgressBar and timeline collapse logic.
 */

import type { BusToolItem } from "$lib/types";

/** Tool is in a terminal state — no further status changes expected. */
export function isToolTerminal(status: BusToolItem["status"]): boolean {
  return (
    status === "success" ||
    status === "error" ||
    status === "denied" ||
    status === "permission_denied"
  );
}

/** Tool is actively working or awaiting interaction. */
export function isToolActive(status: BusToolItem["status"]): boolean {
  return status === "running" || status === "ask_pending" || status === "permission_prompt";
}

/** Whether a tool's subTimeline should be visible by default (no user override).
 *  All tools with subTimelines auto-collapse when in terminal state. */
export function shouldShowSubTimeline(
  status: BusToolItem["status"],
  hasSubTimeline: boolean,
): boolean {
  if (!hasSubTimeline) return false;
  return !isToolTerminal(status);
}

/** Aggregate batch tool statuses in a single pass. */
export function aggregateBatchStatus(tools: BusToolItem[]): {
  completed: number;
  failed: number;
  running: number;
  total: number;
} {
  let completed = 0,
    failed = 0,
    running = 0;
  for (const t of tools) {
    if (t.status === "success") completed++;
    else if (isToolTerminal(t.status)) failed++;
    else if (isToolActive(t.status)) running++;
  }
  return { completed, failed, running, total: tools.length };
}

/** Detect consecutive runs of agent-like tools (Task/Agent, ≥3) in a timeline for batch progress display.
 *  Returns Map<startIndex, BusToolItem[]>. */
export function detectBatchGroups(
  timeline: Array<{ kind: string; tool?: BusToolItem }>,
): Map<number, BusToolItem[]> {
  const agentTools = new Set(["Task", "Agent"]);
  const groups = new Map<number, BusToolItem[]>();
  let i = 0;
  while (i < timeline.length) {
    const entry = timeline[i];
    if (entry.kind === "tool" && entry.tool && agentTools.has(entry.tool.tool_name)) {
      const start = i;
      const tools: BusToolItem[] = [];
      while (
        i < timeline.length &&
        timeline[i].kind === "tool" &&
        timeline[i].tool &&
        agentTools.has(timeline[i].tool!.tool_name)
      ) {
        tools.push(timeline[i].tool!);
        i++;
      }
      if (tools.length >= 3) groups.set(start, tools);
    } else {
      i++;
    }
  }
  return groups;
}

// ── Tool Burst Collapse ──

export interface ToolBurst {
  /** Stable key: first tool's tool_use_id (survives timeline index shifts). */
  key: string;
  startIndex: number;
  endIndex: number; // inclusive
  tools: BusToolItem[];
  /** Per-tool_name count summary, ordered by first appearance. */
  summary: Array<{ toolName: string; count: number }>;
  stats: { completed: number; failed: number; running: number; total: number };
}

const BURST_EXCLUDE = new Set([
  "Task",
  "Agent",
  "Workflow",
  "ScheduleWakeup",
  "ReportFindings",
  "SendMessage",
  "AskUserQuestion",
  "ExitPlanMode",
  "EnterPlanMode",
]);

/**
 * Detect "tool burst" segments: consecutive tool entries (regardless of tool_name)
 * in the timeline, excluding Task (handled by BatchProgressBar) and interactive tools.
 * Returns Map<startIndex, ToolBurst>.
 */
export function detectToolBursts(
  timeline: Array<{ kind: string; tool?: BusToolItem }>,
  minSize = 4,
): Map<number, ToolBurst> {
  const bursts = new Map<number, ToolBurst>();
  let i = 0;
  while (i < timeline.length) {
    const entry = timeline[i];
    if (entry.kind === "tool" && entry.tool && !BURST_EXCLUDE.has(entry.tool.tool_name)) {
      const start = i;
      const tools: BusToolItem[] = [];
      while (
        i < timeline.length &&
        timeline[i].kind === "tool" &&
        timeline[i].tool &&
        !BURST_EXCLUDE.has(timeline[i].tool!.tool_name)
      ) {
        tools.push(timeline[i].tool!);
        i++;
      }
      // Skip burst at index 0 — may be truncated by renderLimit, key would be unstable
      if (tools.length >= minSize && start > 0) {
        const seen = new Map<string, number>();
        for (const t of tools) {
          seen.set(t.tool_name, (seen.get(t.tool_name) ?? 0) + 1);
        }
        const summary = Array.from(seen, ([toolName, count]) => ({ toolName, count }));
        bursts.set(start, {
          key: tools[0].tool_use_id,
          startIndex: start,
          endIndex: start + tools.length - 1,
          tools,
          summary,
          stats: aggregateBatchStatus(tools),
        });
      }
    } else {
      i++;
    }
  }
  return bursts;
}
