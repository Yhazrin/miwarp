import type { TimelineEntry } from "$lib/types";

/** Matches `CreatedFiles` needs; extra fields kept for sorting / future UI. */
export interface ChatCreatedFileRow {
  path: string;
  name: string;
  tool: string;
  timestamp: number;
}

/** Pure: collect successful tool outputs that created a file path. */
export function selectCreatedFilesFromTimeline(timeline: TimelineEntry[]): ChatCreatedFileRow[] {
  const files: ChatCreatedFileRow[] = [];
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
