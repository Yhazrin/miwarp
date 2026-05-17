/**
 * ContextClip builder: creates ContextClip from various sources
 */
import type { BusToolItem } from "$lib/types";
import type { ContextClip } from "./context-clip-types";
import { generateClipId, buildContextCard } from "./context-clip-types";

/** Build a clip from an assistant or user message */
export function buildMessageClip(opts: {
  runId: string;
  sessionId?: string;
  messageId: string;
  role: "assistant" | "user";
  content: string;
  model?: string;
  runName?: string;
}): ContextClip {
  return {
    id: generateClipId(),
    sourceRunId: opts.runId,
    sourceSessionId: opts.sessionId,
    sourceType: opts.role === "assistant" ? "assistant_message" : "user_message",
    sourceTitle: opts.runName,
    sourceAnchorId: opts.messageId,
    content: opts.content,
    metadata: {
      model: opts.model,
      createdAt: new Date().toISOString(),
    },
  };
}

/** Build a clip from a tool result (Bash, Read, Edit, Write, etc.) */
export function buildToolClip(opts: {
  runId: string;
  sessionId?: string;
  tool: BusToolItem;
  outputText?: string;
  runName?: string;
}): ContextClip {
  const toolName = opts.tool.tool_name;
  const input = opts.tool.input as Record<string, unknown> | undefined;

  // Extract relevant metadata based on tool type
  const metadata: ContextClip["metadata"] = {
    toolName,
    createdAt: new Date().toISOString(),
  };

  if (toolName === "Bash" || toolName === "bash") {
    metadata.command = String(input?.command ?? "");
    metadata.cwd = String(input?.cwd ?? "");
  } else if (toolName === "Read" || toolName === "Write" || toolName === "Edit") {
    metadata.filePath = String(input?.file_path ?? input?.path ?? "");
  }

  return {
    id: generateClipId(),
    sourceRunId: opts.runId,
    sourceSessionId: opts.sessionId,
    sourceType: "tool_result",
    sourceTitle: opts.runName,
    sourceAnchorId: opts.tool.tool_use_id,
    content: opts.outputText ?? extractToolOutput(opts.tool),
    summary: summarizeToolContent(toolName, input, opts.outputText),
    metadata,
  };
}

/** Build a clip from user selection */
export function buildSelectionClip(opts: {
  runId: string;
  sessionId?: string;
  text: string;
  contextBefore?: string;
  contextAfter?: string;
}): ContextClip {
  // Include context if provided
  let content = opts.text;
  if (opts.contextBefore || opts.contextAfter) {
    const parts: string[] = [];
    if (opts.contextBefore) parts.push(`...${opts.contextBefore}`);
    parts.push(opts.text);
    if (opts.contextAfter) parts.push(`${opts.contextAfter}...`);
    content = parts.join("\n");
  }

  return {
    id: generateClipId(),
    sourceRunId: opts.runId,
    sourceSessionId: opts.sessionId,
    sourceType: "selection",
    content,
    metadata: {
      createdAt: new Date().toISOString(),
    },
  };
}

/** Build a clip from a diff */
export function buildDiffClip(opts: {
  runId: string;
  sessionId?: string;
  diff: string;
  filePath?: string;
  runName?: string;
}): ContextClip {
  return {
    id: generateClipId(),
    sourceRunId: opts.runId,
    sourceSessionId: opts.sessionId,
    sourceType: "diff",
    sourceTitle: opts.runName,
    content: opts.diff,
    metadata: {
      filePath: opts.filePath,
      createdAt: new Date().toISOString(),
    },
  };
}

/** Extract output text from a tool */
function extractToolOutput(tool: BusToolItem): string {
  const result = tool.tool_use_result;
  if (!result) return "";

  if (typeof result === "object") {
    const r = result as Record<string, unknown>;

    // Handle Read tool
    if ("content" in r && typeof r.content === "string") {
      return r.content;
    }

    // Handle Bash tool
    if ("stdout" in r && typeof r.stdout === "string") {
      return r.stdout;
    }
    if ("output" in r && typeof r.output === "string") {
      return r.output;
    }

    // Handle glob results
    if ("filenames" in r && Array.isArray(r.filenames)) {
      return (r.filenames as string[]).join("\n");
    }

    // Handle grep results
    if ("matches" in r && Array.isArray(r.matches)) {
      return (r.matches as string[]).join("\n");
    }

    // Handle Task tool
    if ("result" in r && typeof r.result === "string") {
      return r.result;
    }

    // Fallback: stringify the whole result
    return JSON.stringify(r, null, 2);
  }

  return String(result);
}

/** Generate a short summary of tool content */
function summarizeToolContent(
  toolName: string,
  input: Record<string, unknown> | undefined,
  outputText?: string,
): string {
  const parts: string[] = [toolName];

  if (toolName === "Bash") {
    const cmd = String(input?.command ?? "").slice(0, 40);
    parts.push(`\`${cmd}${cmd.length > 40 ? "..." : ""}\``);
  } else if (toolName === "Read") {
    const path = String(input?.file_path ?? input?.path ?? "");
    parts.push(`\`${path.split("/").pop() ?? path}\``);
  } else if (toolName === "Edit" || toolName === "Write") {
    const path = String(input?.file_path ?? input?.path ?? "");
    parts.push(`\`${path.split("/").pop() ?? path}\``);
  }

  if (outputText) {
    const lines = outputText.split("\n").length;
    parts.push(`(${lines} lines)`);
  }

  return parts.join(" ");
}

/** Format a ContextClip as markdown for display in the relay modal */
export function formatClipAsMarkdown(clip: ContextClip): string {
  return buildContextCard(clip);
}
