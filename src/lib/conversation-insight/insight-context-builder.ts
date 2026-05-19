/**
 * Builds a compact insight context from the current session for report generation.
 */

import type {
  InsightContext,
  InsightSession,
  InsightMessage,
  InsightToolCall,
  InsightFileChange,
  InsightError,
  InsightUsage,
  InsightMetadata,
} from "./insight-types";
import type { TaskRun, TimelineEntry, BusToolItem } from "$lib/types";
import type { UsageState } from "$lib/stores/types";

/**
 * Builds an InsightContext from the current session data.
 * This creates a compact representation suitable for report generation.
 */
export async function buildInsightContext(
  run: TaskRun,
  timeline: TimelineEntry[],
  usage: UsageState,
  numTurns: number,
): Promise<InsightContext> {
  const [messages, toolCalls, fileChanges, errors, permissionRequests] =
    extractFromTimeline(timeline);

  const session: InsightSession = {
    id: run.id,
    title: run.name || run.prompt?.slice(0, 80) || "Untitled Session",
    prompt: run.prompt,
    cwd: run.cwd,
    agent: run.agent,
    model: run.model || "unknown",
    status: run.status,
    startedAt: run.started_at,
    endedAt: run.ended_at,
    durationMs:
      run.ended_at && run.started_at
        ? new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()
        : undefined,
    branch: run.worktree_branch,
    worktreePath: run.worktree_path,
    parentRunId: run.parent_run_id,
    remoteHostName: run.remote_host_name,
  };

  const insightUsage: InsightUsage = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cost: usage.cost,
    turnCount: numTurns,
  };

  const metadata: InsightMetadata = {
    toolCallCount: toolCalls.length,
    fileChangeCount: fileChanges.length,
    errorCount: errors.length,
    permissionRequests: permissionRequests,
  };

  return {
    session,
    messages,
    toolCalls,
    fileChanges,
    errors,
    usage: insightUsage,
    metadata,
  };
}

type TimelineKind = TimelineEntry["kind"];

/**
 * Extracts structured data from the timeline.
 */
function extractFromTimeline(
  timeline: TimelineEntry[],
): [InsightMessage[], InsightToolCall[], InsightFileChange[], InsightError[], number] {
  const messages: InsightMessage[] = [];
  const toolCalls: InsightToolCall[] = [];
  const fileChanges: InsightFileChange[] = [];
  const errors: InsightError[] = [];
  let permissionRequests = 0;

  for (const entry of timeline) {
    const timestamp = entry.ts;

    switch (entry.kind) {
      case "user":
        if (entry.content) {
          messages.push({
            role: "user",
            content: entry.content.slice(0, 2000),
            timestamp,
          });
        }
        break;

      case "assistant":
        if (entry.content) {
          messages.push({
            role: "assistant",
            content: entry.content.slice(0, 2000),
            timestamp,
          });
        }
        break;

      case "tool": {
        const tool = entry.tool;
        const toolCall: InsightToolCall = {
          name: tool.tool_name,
          input: JSON.stringify(tool.input || {}).slice(0, 500),
          success: tool.status === "success",
          timestamp,
        };

        if (tool.duration_ms) {
          toolCall.durationMs = tool.duration_ms;
        }

        // Extract file changes from common tool calls
        if (
          tool.tool_name === "Write" ||
          tool.tool_name === "MultiWrite" ||
          tool.tool_name === "Edit"
        ) {
          const inputStr = JSON.stringify(tool.input || {});
          const pathMatch = inputStr.match(/"path"\s*:\s*"([^"]+)"/);
          if (pathMatch) {
            fileChanges.push({
              path: pathMatch[1],
              type:
                tool.tool_name === "Write" || tool.tool_name === "MultiWrite"
                  ? "created"
                  : "modified",
              timestamp,
            });
          }
        } else if (tool.tool_name === "Bash") {
          const inputStr = JSON.stringify(tool.input || {});
          // Detect git commands that modify files
          if (
            inputStr.includes("git add") ||
            inputStr.includes("git commit") ||
            inputStr.includes("mv ") ||
            inputStr.includes("rm ")
          ) {
            const cmdMatch = inputStr.match(/command"?\s*:\s*"([^"]+)"/);
            if (cmdMatch) {
              const fileMatch = cmdMatch[1].match(/(?:mv|rm)\s+(.+)/);
              if (fileMatch) {
                fileChanges.push({
                  path: fileMatch[1].trim(),
                  type: cmdMatch[1].includes("rm ") ? "deleted" : "modified",
                  timestamp,
                });
              }
            }
          }
        }

        if (tool.output) {
          toolCall.output = JSON.stringify(tool.output).slice(0, 500);
        }

        // Track errors
        if (tool.status === "error") {
          errors.push({
            message: `Tool ${tool.tool_name} failed: ${tool.output ? JSON.stringify(tool.output).slice(0, 200) : "unknown error"}`,
            timestamp,
            resolved: false,
          });
        }

        // Track permission requests
        if (tool.status === "permission_prompt" || tool.status === "permission_denied") {
          permissionRequests++;
        }

        toolCalls.push(toolCall);
        break;
      }

      case "command_output":
        if (entry.content) {
          // Check for error indicators in command output
          const content = entry.content;
          if (content.includes("error") || content.includes("Error") || content.includes("ERROR")) {
            errors.push({
              message: `Command output: ${content.slice(0, 200)}`,
              timestamp,
              resolved: false,
            });
          }
        }
        break;
    }
  }

  // Deduplicate file changes by path
  const seenPaths = new Set<string>();
  const uniqueFileChanges = fileChanges.filter((fc) => {
    if (seenPaths.has(fc.path)) return false;
    seenPaths.add(fc.path);
    return true;
  });

  return [messages, toolCalls, uniqueFileChanges, errors, permissionRequests];
}

/**
 * Builds a compact prompt context for the AI model to generate the insight report.
 */
export function buildInsightPromptContext(context: InsightContext): string {
  const { session, messages, toolCalls, fileChanges, errors, usage, metadata } = context;

  // Build file change summary
  const fileChangeSummary =
    fileChanges.length > 0
      ? fileChanges.map((fc) => `${fc.type}: ${fc.path}`).join("\n")
      : "No file changes recorded";

  // Build tool calls summary (grouped by name)
  const toolCallGroups = new Map<string, number>();
  for (const tc of toolCalls) {
    toolCallGroups.set(tc.name, (toolCallGroups.get(tc.name) || 0) + 1);
  }
  const toolCallSummary = Array.from(toolCallGroups.entries())
    .map(([name, count]) => `${name}: ${count}`)
    .join("\n");

  // Build errors summary
  const errorSummary =
    errors.length > 0 ? errors.map((e) => `- ${e.message}`).join("\n") : "No errors recorded";

  return `
# Session Information
- Title: ${session.title}
- Agent: ${session.agent}
- Model: ${session.model}
- CWD: ${session.cwd}
- Status: ${session.status}
- Started: ${session.startedAt}
- Duration: ${session.durationMs ? `${Math.round(session.durationMs / 1000)}s` : "N/A"}
- Branch: ${session.branch || "N/A"}
${session.worktreePath ? `- Worktree: ${session.worktreePath}` : ""}

# Messages (${messages.length} total)
${messages.map((m) => `${m.role}: ${m.content.slice(0, 500)}${m.content.length > 500 ? "..." : ""}`).join("\n\n")}

# Tool Calls (${metadata.toolCallCount} total)
${toolCallSummary || "No tool calls"}

# File Changes (${metadata.fileChangeCount} total)
${fileChangeSummary}

# Errors (${metadata.errorCount})
${errorSummary}

# Usage
- Input tokens: ${usage.inputTokens}
- Output tokens: ${usage.outputTokens}
- Cache read: ${usage.cacheReadTokens}
- Cache write: ${usage.cacheWriteTokens}
- Cost: $${usage.cost.toFixed(4)}
- Turns: ${usage.turnCount}

# Permission Requests: ${metadata.permissionRequests}
`.trim();
}
