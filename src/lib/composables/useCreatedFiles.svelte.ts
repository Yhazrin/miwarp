/**
 * Composable to extract files created during a session.
 */

export interface CreatedFile {
  path: string;
  name: string;
  tool: string;
  timestamp: number;
}

interface TimelineEntry {
  kind: string;
  tool: {
    tool_name: string;
    status: string;
    output?: Record<string, unknown>;
  };
  seq?: number;
}

export function useCreatedFiles(timeline: TimelineEntry[]) {
  const createdFiles = $derived.by(() => {
    const files: CreatedFile[] = [];
    const seen = new Set<string>();

    for (const entry of timeline) {
      if (entry.kind !== "tool") continue;

      const tool = entry.tool;

      if (tool.status !== "success" && tool.status !== "completed") continue;

      const output = tool.output as Record<string, unknown> | undefined;
      if (!output) continue;

      const path =
        (output.path as string) ||
        (output.file_path as string) ||
        (output.created_path as string) ||
        ((output.result as Record<string, unknown>)?.path as string);

      if (path && !seen.has(path)) {
        seen.add(path);
        files.push({
          path,
          name: path.split("/").pop() ?? path,
          tool: tool.tool_name,
          timestamp: entry.seq ?? Date.now(),
        });
      }
    }

    return files.sort((a, b) => a.timestamp - b.timestamp);
  });

  const createdFileCount = $derived(createdFiles.length);
  const hasCreatedFiles = $derived(createdFileCount > 0);

  return {
    createdFiles,
    createdFileCount,
    hasCreatedFiles,
  };
}
