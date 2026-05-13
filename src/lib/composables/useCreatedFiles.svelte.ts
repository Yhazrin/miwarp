/**
 * Composable to extract files created during a session.
 */

import { sessionStore } from "$lib/stores";

export interface CreatedFile {
  path: string;
  name: string;
  tool: string;
  timestamp: number;
}

export function useCreatedFiles() {
  const createdFiles = $derived.by(() => {
    const files: CreatedFile[] = [];
    const seen = new Set<string>();

    for (const entry of sessionStore.timeline) {
      if (entry.kind !== "tool") continue;

      const tool = entry.tool;
      const isWriteTool =
        tool.tool_name === "Write" || tool.tool_name === "Edit" || tool.tool_name === "Bash";

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
          timestamp: ((entry as Record<string, unknown>).seq as number) ?? Date.now(),
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
