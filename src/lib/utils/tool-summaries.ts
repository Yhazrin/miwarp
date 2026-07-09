import { t } from "$lib/i18n/index.svelte";

/**
 * Generate a one-line summary for a tool call.
 * Used in normal view mode to collapse tool calls into readable descriptions.
 */
export function getToolSummary(
  toolName: string,
  input: Record<string, unknown>,
  result?: Record<string, unknown>,
): string {
  switch (toolName) {
    case "Bash": {
      const cmd = (input.command as string) || "";
      const short = cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd;
      const exitCode = (result?.exit_code as number) ?? undefined;
      if (exitCode !== undefined) {
        return exitCode === 0
          ? t("tool_ran", { cmd: short })
          : t("tool_failed", { code: String(exitCode), cmd: short });
      }
      return t("tool_running", { cmd: short });
    }
    case "Read": {
      const path = (input.file_path as string) || "";
      const fileName = path.split(/[/\\]/).pop() || path;
      const lines = (result?.content as string)?.split("\n").length;
      return lines
        ? t("tool_read", { file: fileName, lines: String(lines) })
        : t("tool_reading", { file: fileName });
    }
    case "Write": {
      const path = (input.file_path as string) || "";
      const fileName = path.split(/[/\\]/).pop() || path;
      return t("tool_wrote", { file: fileName });
    }
    case "Edit": {
      const path = (input.file_path as string) || "";
      const fileName = path.split(/[/\\]/).pop() || path;
      const oldStr = (input.old_string as string) || "";
      const newStr = (input.new_string as string) || "";
      const linesChanged = Math.abs(newStr.split("\n").length - oldStr.split("\n").length);
      return linesChanged > 0
        ? t("tool_editedLines", { file: fileName, lines: String(linesChanged) })
        : t("tool_edited", { file: fileName });
    }
    case "MultiEdit": {
      const path = (input.file_path as string) || "";
      const fileName = path.split(/[/\\]/).pop() || path;
      const edits = (input.edits as unknown[])?.length || 0;
      return t("tool_editedChanges", { file: fileName, edits: String(edits) });
    }
    case "Grep": {
      const pattern = (input.pattern as string) || "";
      const count = (result?.count as number) ?? undefined;
      return count !== undefined
        ? t("tool_searchedMatches", { pattern, count: String(count) })
        : t("tool_searched", { pattern });
    }
    case "Glob": {
      const pattern = (input.pattern as string) || "";
      const files = (result?.files as string[])?.length;
      return files !== undefined
        ? t("tool_found", { count: String(files), pattern })
        : t("tool_searching", { pattern });
    }
    case "WebFetch": {
      const url = (input.url as string) || "";
      try {
        const host = new URL(url).hostname;
        return t("tool_fetched", { host });
      } catch {
        return t("tool_fetched", { host: url.slice(0, 40) });
      }
    }
    case "WebSearch": {
      const query = (input.query as string) || "";
      return t("tool_searchedWeb", { query });
    }
    case "Agent": {
      const desc = (input.description as string) || "";
      return t("tool_launchedAgent", { desc });
    }
    case "Workflow": {
      const name = (input.name as string) || "";
      const desc = (input.description as string) || "";
      if (name) return t("tool_workflowNamed", { name });
      if (desc) return t("tool_workflowNamed", { name: desc.slice(0, 60) });
      return t("tool_workflowRunning");
    }
    case "AskUserQuestion": {
      return t("tool_waitingResponse");
    }
    case "ExitPlanMode": {
      return t("tool_proposingPlan");
    }
    case "Task": {
      const action = (input.action as string) || "";
      const subject = (input.subject as string) || "";
      return t("tool_task", { action, subject });
    }
    case "NotebookEdit": {
      const path = (input.notebook_path as string) || "";
      const fileName = path.split(/[/\\]/).pop() || path;
      return t("tool_editedNotebook", { file: fileName });
    }
    default:
      return `${toolName}`;
  }
}

/**
 * Format elapsed time for display
 */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/**
 * Get a short status label
 */
export function getStatusLabel(status: string): string {
  switch (status) {
    case "running":
      return t("tool_status_running");
    case "completed":
      return t("tool_status_done");
    case "failed":
      return t("tool_status_failed");
    case "ask_pending":
      return t("tool_status_waiting");
    case "permission_prompt":
      return t("tool_status_approval");
    default:
      return "";
  }
}
