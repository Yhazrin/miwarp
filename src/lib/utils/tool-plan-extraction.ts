/**
 * Plan content extraction — finds and applies edits to plan files in timelines.
 *
 * Pure functions for extracting Claude plan files (~/.claude/plans/*.md)
 * from tool timelines, applying Write/Edit operations, and managing
 * plan file paths.
 */

import type { BusToolItem } from "$lib/types";
import { dbg } from "$lib/utils/debug";

/**
 * Detect if a file path targets a Claude plan file (~/.claude/plans/*.md).
 * Matches both absolute paths (/.claude/plans/) and relative paths (.claude/plans/).
 */
export function isPlanFilePath(filePath: string): boolean {
  if (!filePath) return false;
  const normalized = filePath.replaceAll("\\", "/");
  return (
    (normalized.includes("/.claude/plans/") || normalized.startsWith(".claude/plans/")) &&
    normalized.endsWith(".md")
  );
}

/** Extract short plan name from a plan file path. Returns null if not a plan file. */
export function planFileName(filePath: string): string | null {
  if (!isPlanFilePath(filePath)) return null;
  const normalized = filePath.replaceAll("\\", "/");
  const name = (normalized.split("/").pop() || normalized).replace(/\.md$/, "");
  return name;
}

/** Extract the /.claude/plans/<name>.md suffix from a plan file path.
 *  Returns null if not a plan file. Works for both absolute and relative paths. */
export function planFileSuffix(filePath: string): string | null {
  if (!filePath) return null;
  const normalized = filePath.replaceAll("\\", "/");
  const idx = normalized.lastIndexOf("/.claude/plans/");
  if (idx >= 0 && normalized.endsWith(".md")) return normalized.slice(idx);
  if (normalized.startsWith(".claude/plans/") && normalized.endsWith(".md"))
    return "/" + normalized;
  return null;
}

/** Flatten timeline entries, inlining subTimeline tool entries from Agent/subagent
 *  tools so that Write/Edit operations inside subagents are visible to plan extraction. */
function flattenToolEntries(
  timeline: Array<{
    kind: string;
    tool?: BusToolItem;
    subTimeline?: Array<{
      kind: string;
      tool?: BusToolItem;
      subTimeline?: Array<{ kind: string; tool?: BusToolItem }>;
    }>;
  }>,
  endIndex: number,
): Array<{ kind: string; tool?: BusToolItem }> {
  const result: Array<{ kind: string; tool?: BusToolItem }> = [];
  for (let i = 0; i < endIndex; i++) {
    const entry = timeline[i];
    result.push(entry);
    // Inline subTimeline tool entries (from Agent/subagent tools)
    if (entry.kind === "tool" && entry.subTimeline) {
      for (const sub of entry.subTimeline) {
        if (sub.kind === "tool") result.push(sub);
        // Recurse one more level for nested subagents
        if (sub.kind === "tool" && sub.subTimeline) {
          for (const subsub of sub.subTimeline) {
            if (subsub.kind === "tool") result.push(subsub);
          }
        }
      }
    }
  }
  return result;
}

/** Extract final plan content from timeline entries before a given index.
 *  Finds the latest successful Write to a plan file, then applies
 *  subsequent successful Edits to the same file.
 *  Searches inside Agent/subagent subTimeline as well.
 *  Stops at any prior ExitPlanMode to avoid crossing plan rounds. */
export function extractPlanContent(
  timeline: Array<{
    kind: string;
    tool?: BusToolItem;
    subTimeline?: Array<{
      kind: string;
      tool?: BusToolItem;
      subTimeline?: Array<{ kind: string; tool?: BusToolItem }>;
    }>;
  }>,
  beforeIndex: number,
): { content: string; fileName: string } | null {
  // Flatten timeline: inline subTimeline entries so Write/Edit inside agents are visible
  const flat = flattenToolEntries(timeline, beforeIndex);

  // 1. Search backwards for latest successful plan Write, stop at completed ExitPlanMode
  let writeIndex = -1;
  let baseContent: string | null = null;
  let baseSuffix: string | null = null;
  let baseName: string | null = null;

  for (let i = flat.length - 1; i >= 0; i--) {
    const entry = flat[i];
    if (entry.kind !== "tool" || !entry.tool) continue;

    // Boundary: completed ExitPlanMode (previous round)
    // Use its tool_use_result.plan as base content if available (cross-round editing)
    if (entry.tool.tool_name === "ExitPlanMode" && entry.tool.status === "success") {
      const result = entry.tool.tool_use_result as { plan?: string; filePath?: string } | undefined;
      if (result?.plan && typeof result.plan === "string") {
        const fp = result.filePath ?? "";
        writeIndex = i;
        baseContent = result.plan;
        baseSuffix = isPlanFilePath(fp) ? planFileSuffix(fp) : null;
        baseName = isPlanFilePath(fp) ? planFileName(fp) : "plan";
        dbg("plan", "extractPlanContent: using plan from completed ExitPlanMode", {
          i,
          name: baseName,
        });
      } else {
        dbg("plan", "extractPlanContent: hit completed ExitPlanMode without plan content", { i });
      }
      break;
    }

    if (entry.tool.status !== "success") continue;
    const fp = String(entry.tool.input?.file_path ?? entry.tool.input?.path ?? "");
    if (!isPlanFilePath(fp)) continue;

    if (entry.tool.tool_name === "Write" && typeof entry.tool.input?.content === "string") {
      writeIndex = i;
      baseContent = entry.tool.input.content as string;
      baseSuffix = planFileSuffix(fp);
      baseName = planFileName(fp);
      dbg("plan", "extractPlanContent: found base Write", { i, name: baseName });
      break;
    }
  }

  if (writeIndex < 0 || !baseContent || !baseName) return null;

  // 2. Apply subsequent successful Edits to the same plan file
  let content = baseContent;
  for (let i = writeIndex + 1; i < flat.length; i++) {
    const entry = flat[i];
    if (entry.kind !== "tool" || !entry.tool) continue;
    if (entry.tool.status !== "success") continue;
    const fp = String(entry.tool.input?.file_path ?? entry.tool.input?.path ?? "");
    if (!isPlanFilePath(fp)) continue;
    // Compare suffix path (/.claude/plans/<name>.md) for cross-format compatibility
    // When baseSuffix is null (e.g. from ExitPlanMode without filePath), accept any plan file
    if (baseSuffix && planFileSuffix(fp) !== baseSuffix) continue;

    if (entry.tool.tool_name === "Write" && typeof entry.tool.input?.content === "string") {
      content = entry.tool.input.content as string;
      dbg("plan", "extractPlanContent: overwrite by later Write", { i });
    } else if (
      entry.tool.tool_name === "Edit" &&
      typeof entry.tool.input?.old_string === "string"
    ) {
      const oldStr = entry.tool.input.old_string as string;
      const newStr = (entry.tool.input?.new_string as string) ?? "";
      if (content.includes(oldStr)) {
        content = content.replace(oldStr, newStr);
        dbg("plan", "extractPlanContent: applied Edit", { i });
      } else {
        dbg("plan", "extractPlanContent: Edit old_string not found, skipped", { i });
      }
    }
  }

  return { content, fileName: baseName };
}

/** Apply forward Edits to an approved plan's content.
 *  Starting after the given index, scan forward for successful
 *  Write/Edit to the same plan file and apply them.
 *  This keeps the approved plan card up-to-date when the plan file
 *  is edited after approval in the same session. */
export function applyPlanEditsForward(
  timeline: Array<{
    kind: string;
    tool?: BusToolItem;
    subTimeline?: Array<{
      kind: string;
      tool?: BusToolItem;
      subTimeline?: Array<{ kind: string; tool?: BusToolItem }>;
    }>;
  }>,
  afterIndex: number,
  basePlan: string,
  planFilePath?: string,
): string {
  const baseSuffix =
    planFilePath && isPlanFilePath(planFilePath) ? planFileSuffix(planFilePath) : null;
  let content = basePlan;

  function applyTool(tool: BusToolItem): void {
    if (tool.status !== "success") return;
    const fp = String(tool.input?.file_path ?? tool.input?.path ?? "");
    if (!isPlanFilePath(fp)) return;
    if (baseSuffix && planFileSuffix(fp) !== baseSuffix) return;

    if (tool.tool_name === "Write" && typeof tool.input?.content === "string") {
      content = tool.input.content as string;
      dbg("plan", "applyPlanEditsForward: overwrite by later Write");
    } else if (tool.tool_name === "Edit" && typeof tool.input?.old_string === "string") {
      const oldStr = tool.input.old_string as string;
      const newStr = (tool.input?.new_string as string) ?? "";
      if (content.includes(oldStr)) {
        content = content.replace(oldStr, newStr);
        dbg("plan", "applyPlanEditsForward: applied Edit");
      }
    }
  }

  for (let i = afterIndex + 1; i < timeline.length; i++) {
    const entry = timeline[i];
    if (entry.kind !== "tool" || !entry.tool) continue;
    applyTool(entry.tool);
    // Also check subTimeline (agent/subagent)
    if (entry.subTimeline) {
      for (const sub of entry.subTimeline) {
        if (sub.kind === "tool" && sub.tool) applyTool(sub.tool);
        if (sub.subTimeline) {
          for (const subsub of sub.subTimeline) {
            if (subsub.kind === "tool" && subsub.tool) applyTool(subsub.tool);
          }
        }
      }
    }
  }

  return content;
}
