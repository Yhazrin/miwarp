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
    case 'Bash': {
      const cmd = (input.command as string) || '';
      const short = cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
      const exitCode = (result?.exit_code as number) ?? undefined;
      if (exitCode !== undefined) {
        return exitCode === 0 ? `Ran: ${short}` : `Failed (exit ${exitCode}): ${short}`;
      }
      return `Running: ${short}`;
    }
    case 'Read': {
      const path = (input.file_path as string) || '';
      const fileName = path.split(/[/\\]/).pop() || path;
      const lines = (result?.content as string)?.split('\n').length;
      return lines ? `Read ${fileName} (${lines} lines)` : `Reading ${fileName}`;
    }
    case 'Write': {
      const path = (input.file_path as string) || '';
      const fileName = path.split(/[/\\]/).pop() || path;
      return `Wrote ${fileName}`;
    }
    case 'Edit': {
      const path = (input.file_path as string) || '';
      const fileName = path.split(/[/\\]/).pop() || path;
      const oldStr = (input.old_string as string) || '';
      const newStr = (input.new_string as string) || '';
      const linesChanged = Math.abs(newStr.split('\n').length - oldStr.split('\n').length);
      return linesChanged > 0 ? `Edited ${fileName} (±${linesChanged} lines)` : `Edited ${fileName}`;
    }
    case 'MultiEdit': {
      const path = (input.file_path as string) || '';
      const fileName = path.split(/[/\\]/).pop() || path;
      const edits = (input.edits as unknown[])?.length || 0;
      return `Edited ${fileName} (${edits} changes)`;
    }
    case 'Grep': {
      const pattern = (input.pattern as string) || '';
      const count = (result?.count as number) ?? undefined;
      const matches = count !== undefined ? ` — ${count} matches` : '';
      return `Searched: "${pattern}"${matches}`;
    }
    case 'Glob': {
      const pattern = (input.pattern as string) || '';
      const files = (result?.files as string[])?.length;
      return files !== undefined ? `Found ${files} files matching ${pattern}` : `Searching ${pattern}`;
    }
    case 'WebFetch': {
      const url = (input.url as string) || '';
      try {
        const host = new URL(url).hostname;
        return `Fetched ${host}`;
      } catch {
        return `Fetched ${url.slice(0, 40)}`;
      }
    }
    case 'WebSearch': {
      const query = (input.query as string) || '';
      return `Searched web: "${query}"`;
    }
    case 'Agent': {
      const desc = (input.description as string) || '';
      return `Launched agent: ${desc}`;
    }
    case 'AskUserQuestion': {
      return 'Waiting for your response';
    }
    case 'ExitPlanMode': {
      return 'Proposing a plan';
    }
    case 'Task': {
      const action = (input.action as string) || '';
      const subject = (input.subject as string) || '';
      return `Task ${action}: ${subject}`;
    }
    case 'NotebookEdit': {
      const path = (input.notebook_path as string) || '';
      const fileName = path.split(/[/\\]/).pop() || path;
      return `Edited notebook ${fileName}`;
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
    case 'running': return 'Running';
    case 'completed': return 'Done';
    case 'failed': return 'Failed';
    case 'ask_pending': return 'Waiting';
    case 'permission_prompt': return 'Needs approval';
    default: return '';
  }
}
