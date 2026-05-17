import type { TimelineEntry } from "$lib/types";
import { extractPlanContent, isPlanFilePath, planFileName } from "$lib/utils/tool-rendering";

export function buildTimelineIdIndex(timeline: TimelineEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < timeline.length; i++) {
    map.set(timeline[i].id, i);
  }
  return map;
}

/** Latest Write/Edit to a plan file — for auto-expand styling. */
export function selectLatestPlanToolUseId(timeline: TimelineEntry[]): string | null {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const e = timeline[i];
    if (e.kind !== "tool" || !e.tool) continue;
    const fp = String(e.tool.input?.file_path ?? e.tool.input?.path ?? "");
    if ((e.tool.tool_name === "Write" || e.tool.tool_name === "Edit") && isPlanFilePath(fp)) {
      return e.tool.tool_use_id;
    }
  }
  return null;
}

/** Plan body for ExitPlanMode inline card (pure; no logging). */
export function selectExitPlanInlineContent(
  timeline: TimelineEntry[],
  entryId: string,
  timelineIdIndex: Map<string, number>,
): { content: string; fileName: string } | null {
  const idx = timelineIdIndex.get(entryId);
  if (idx == null) return null;
  const fromWrites = extractPlanContent(timeline, idx);
  if (fromWrites) return fromWrites;
  const entry = timeline[idx];
  if (entry?.kind === "tool" && entry.tool.status === "success") {
    const toolResult = entry.tool.tool_use_result as
      | { plan?: string; filePath?: string }
      | undefined;
    if (toolResult?.plan && typeof toolResult.plan === "string") {
      const fp = String(toolResult.filePath ?? "");
      const name = isPlanFilePath(fp) ? (planFileName(fp) ?? "plan") : "plan";
      return { content: toolResult.plan, fileName: name };
    }
  }
  return null;
}
