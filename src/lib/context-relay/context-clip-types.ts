/**
 * Types for Context Relay / 会话接力功能
 */

export interface ContextClip {
  id: string;
  sourceRunId: string;
  sourceSessionId?: string;
  sourceType: "assistant_message" | "user_message" | "tool_result" | "selection" | "diff" | "file";
  sourceTitle?: string;
  sourceAnchorId?: string;
  content: string;
  summary?: string;
  metadata?: {
    toolName?: string;
    filePath?: string;
    command?: string;
    cwd?: string;
    model?: string;
    createdAt: string;
  };
}

export interface ContextRelayTarget {
  type: "current" | "new" | "session";
  sessionId?: string;
  runId?: string;
  runName?: string;
  /** For type="new": the working directory for the new session */
  cwd?: string;
  /** For type="new": the agent to use for the new session */
  agent?: string;
}

export interface ContextRelayPayload {
  clip: ContextClip;
  target: ContextRelayTarget;
  additionalInstructions?: string;
}

/** Build a context card (markdown) from a ContextClip */
export function buildContextCard(clip: ContextClip): string {
  const lines: string[] = [];

  // Source header
  const sourceTypeLabel: Record<ContextClip["sourceType"], string> = {
    assistant_message: "Assistant Message",
    user_message: "User Message",
    tool_result: "Tool Result",
    selection: "Selected Text",
    diff: "Diff",
    file: "File",
  };

  lines.push(`## ${sourceTypeLabel[clip.sourceType]}`);
  lines.push("");

  if (clip.sourceTitle) {
    lines.push(`**Source:** ${clip.sourceTitle}`);
  }

  if (clip.metadata?.toolName) {
    lines.push(`**Tool:** ${clip.metadata.toolName}`);
  }

  if (clip.metadata?.filePath) {
    lines.push(`**File:** \`${clip.metadata.filePath}\``);
  }

  if (clip.metadata?.command) {
    lines.push(`**Command:** \`${clip.metadata.command}\``);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(clip.content);

  return lines.join("\n");
}

/** Generate a unique ID */
export function generateClipId(): string {
  return `clip_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
