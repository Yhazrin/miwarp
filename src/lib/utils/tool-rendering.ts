/**
 * Utility functions for rendering tool inputs/outputs in the chat UI.
 *
 * This module is split into focused sub-modules for maintainability:
 * - tool-batch-detection.ts: batch/burst detection, terminal/active status
 * - tool-plan-extraction.ts: plan file detection, content extraction, edit application
 *
 * This file re-exports everything for backward compatibility, plus contains
 * the remaining rendering utilities (output extraction, metadata, display helpers).
 */

// Re-export all sub-modules for backward compatibility
export * from "./tool-batch-detection";
export * from "./tool-plan-extraction";

import type { PermissionSuggestion } from "$lib/types";

/** Extract plain text from an array of content blocks (Anthropic format). */
function extractTextFromBlocks(blocks: unknown[]): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b): b is { type: "text"; text: string } => {
      return typeof b === "object" && b !== null && (b as Record<string, unknown>).type === "text";
    })
    .map((b) => b.text)
    .join("\n");
}

/** Extract display text from opaque tool output (handles string/object/array/null). */
export function extractOutputText(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  if (typeof output !== "object") return String(output);

  const obj = output as Record<string, unknown>;

  // Content blocks array (Anthropic API format)
  if (Array.isArray(obj.content)) {
    const text = extractTextFromBlocks(obj.content);
    if (text) return text;
  }
  // Direct content string
  if (typeof obj.content === "string" && obj.content) return obj.content;
  // Error fallback
  if (typeof obj.error === "string" && obj.error) return obj.error;
  // Array of content blocks at top level
  if (Array.isArray(output)) {
    const text = extractTextFromBlocks(output);
    if (text) return text;
  }
  // Last resort: JSON stringify
  try {
    return JSON.stringify(output);
  } catch {
    return "[unrenderable output]";
  }
}

/** Extract image content blocks (base64) from tool output, if any. */
export function extractImageBlocks(
  output: unknown,
): Array<{ type: "image"; source: { type: string; media_type: string; data: string } }> {
  if (output == null || typeof output !== "object") return [];
  const obj = output as Record<string, unknown>;
  const blocks = Array.isArray(obj.content) ? obj.content : Array.isArray(output) ? output : [];
  return blocks.filter(
    (b): b is { type: "image"; source: { type: string; media_type: string; data: string } } => {
      return typeof b === "object" && b !== null && (b as Record<string, unknown>).type === "image";
    },
  );
}

const EXT_LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  css: "css",
  scss: "scss",
  html: "html",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  toml: "toml",
  xml: "xml",
  svelte: "html",
  vue: "html",
};

/** Map a file path's extension to a highlight.js language name. */
export function getLanguageFromPath(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return "";
  const ext = filePath.slice(dot + 1).toLowerCase();
  return EXT_LANG_MAP[ext] ?? "";
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);

/** Check if a file path refers to an image type. */
export function isImagePath(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTS.has(filePath.slice(dot + 1).toLowerCase());
}

/**
 * Extract structured data from tool.output for team tools (TaskList, etc.).
 * Handles string-wrapped JSON, content blocks, and direct arrays/objects.
 */
export function extractStructuredOutput(output: unknown): unknown {
  if (!output) return null;
  if (typeof output === "string") {
    try {
      return JSON.parse(output);
    } catch {
      return output;
    }
  }
  if (Array.isArray(output)) return output;
  if (typeof output !== "object" || output === null) return output;
  const obj = output as Record<string, unknown>;
  if (obj.content != null) {
    if (typeof obj.content === "string") {
      try {
        return JSON.parse(obj.content);
      } catch {
        return obj.content;
      }
    }
    return obj.content;
  }
  return output;
}

const FRIENDLY_TOOL_NAMES: Record<string, string> = {
  // Claude Code tool names (PascalCase)
  Bash: "Run commands",
  Read: "Read files",
  Write: "Write files",
  Edit: "Edit files",
  Glob: "Find files",
  Grep: "Search content",
  WebFetch: "Fetch URLs",
  WebSearch: "Search web",
  Task: "Run sub-agent",
  Agent: "Spawn agent",
  Workflow: "Run workflow",
  ScheduleWakeup: "Schedule wakeup",
  ReportFindings: "Report findings",
  SendMessage: "Send message",
  AskUserQuestion: "Ask user",
  ExitPlanMode: "Exit plan mode",
  EnterPlanMode: "Enter plan mode",
  NotebookEdit: "Edit notebook",
  PowerShell: "Run PowerShell",
  Monitor: "Monitor events",
  // MiMo-Code tool names (lowercase)
  bash: "Run commands",
  read: "Read files",
  write: "Write files",
  edit: "Edit files",
  glob: "Find files",
  grep: "Search content",
  webfetch: "Fetch URLs",
  websearch: "Search web",
  codesearch: "Search code",
  actor: "Run sub-agent",
  skill: "Load skill",
  apply_patch: "Apply patch",
  multiedit: "Edit files",
  task: "Run task",
  memory: "Memory",
};

/** Map a tool name to a human-readable description. Falls back to the original name. */
export function friendlyToolName(name: string): string {
  return FRIENDLY_TOOL_NAMES[name] ?? name;
}

// ── Task (subagent) tool metadata extraction ──

export interface TaskToolMeta {
  subagentType: string;
  description?: string;
  model?: string;
  isolation?: string;
  prompt?: string;
}

/** Extract agent metadata from a Task tool's input object. Returns null if not a Task tool input. */
export function extractTaskToolMeta(input: unknown): TaskToolMeta | null {
  if (input == null || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const subagentType = obj.subagent_type ?? obj.subagentType;
  if (typeof subagentType !== "string") return null;
  return {
    subagentType,
    description: typeof obj.description === "string" ? obj.description : undefined,
    model: typeof obj.model === "string" ? obj.model : undefined,
    isolation: typeof obj.isolation === "string" ? obj.isolation : undefined,
    prompt:
      typeof obj.prompt === "string"
        ? obj.prompt.length > 200
          ? obj.prompt.slice(0, 200) + "…"
          : obj.prompt
        : undefined,
  };
}

// ── Agent tool metadata extraction (Claude Code 2.0+) ──

export interface AgentToolMeta {
  /** Agent label for display (name prop or generated from description). */
  name?: string;
  /** What the agent is doing. */
  description?: string;
  /** Model override for this agent. */
  model?: string;
  /** Isolation mode: "worktree" | "remote" | undefined. */
  isolation?: "worktree" | "remote" | string;
  /** Permission mode override. */
  permissionMode?: string;
  /** Whether the agent runs in background. */
  runInBackground?: boolean;
  /** Team name if part of a multi-agent team. */
  teamName?: string;
  /** Prompt preview (truncated). */
  prompt?: string;
  /** Whether this is an ultracode workflow agent. */
  isUltracode?: boolean;
}

/** Extract metadata from an Agent tool's input object. Returns null if not an Agent tool input. */
export function extractAgentToolMeta(input: unknown): AgentToolMeta | null {
  if (input == null || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  // Agent tool has a "prompt" field (required) — use it as the distinguishing marker
  if (typeof obj.prompt !== "string") return null;
  // Must also have subagent_type or description to be an Agent (not just any tool with prompt)
  const hasAgentMarker =
    typeof obj.subagent_type === "string" ||
    typeof obj.description === "string" ||
    typeof obj.name === "string" ||
    typeof obj.isolation === "string" ||
    typeof obj.model === "string" ||
    typeof obj.run_in_background === "boolean";
  if (!hasAgentMarker) return null;

  return {
    name: typeof obj.name === "string" ? obj.name : undefined,
    description: typeof obj.description === "string" ? obj.description : undefined,
    model: typeof obj.model === "string" ? obj.model : undefined,
    isolation: typeof obj.isolation === "string" ? obj.isolation : undefined,
    permissionMode: typeof obj.mode === "string" ? obj.mode : undefined,
    runInBackground: typeof obj.run_in_background === "boolean" ? obj.run_in_background : undefined,
    teamName: typeof obj.team_name === "string" ? obj.team_name : undefined,
    prompt:
      typeof obj.prompt === "string"
        ? obj.prompt.length > 200
          ? obj.prompt.slice(0, 200) + "…"
          : obj.prompt
        : undefined,
    isUltracode: Boolean(
      obj.isUltracode === true ||
      (typeof obj.description === "string" && obj.description.toLowerCase().includes("ultracode")),
    ),
  };
}

/** Unified extraction: returns AgentToolMeta for Agent tools, TaskToolMeta for Task tools, null otherwise. */
function extractAgentLikeMeta(
  toolName: string,
  input: unknown,
): AgentToolMeta | TaskToolMeta | null {
  if (toolName === "Agent") return extractAgentToolMeta(input);
  if (toolName === "Task") return extractTaskToolMeta(input);
  return null;
}

// ── Tool Render Level ──

/** Tools whose output is the primary content (auto-expand, accent border). */
const LEVEL_2_TOOLS = new Set(["Bash", "bash", "Edit", "edit_file", "Write", "write_file"]);

/**
 * Determine the render level for a tool card.
 * Level 1 = one-liner (info tools), Level 2 = inline content (output tools), Level 3 = interactive card.
 */
export function getToolRenderLevel(toolName: string, status: string): 1 | 2 | 3 {
  // AskUserQuestion is always Level 3 (all states: active, done, denied)
  if (toolName === "AskUserQuestion") return 3;
  // Interactive statuses: user must approve/deny
  if (status === "permission_prompt") return 3;
  // Output-focused tools (including cross-provider aliases)
  if (LEVEL_2_TOOLS.has(toolName)) return 2;
  // Everything else
  return 1;
}

// ── Permission / tool input utilities ──

/** Extract a human-readable detail string from tool input (file path, command, pattern, etc.). */
export function getToolDetail(input: Record<string, unknown> | undefined): string {
  if (!input || Object.keys(input).length === 0) return "";
  return (
    (input.file_path as string) ??
    (input.notebook_path as string) ??
    (input.path as string) ??
    (input.command as string) ??
    (input.pattern as string) ??
    (input.query as string) ??
    (input.url as string) ??
    (input.description as string) ??
    (input.prompt as string) ??
    (input.team_name as string) ??
    (input.subject as string) ??
    (input.taskId != null || input.task_id != null
      ? `#${input.taskId ?? input.task_id}`
      : undefined) ??
    (input.skill as string) ??
    (input.recipient as string) ??
    ""
  );
}

/** Format a permission suggestion label for display.
 *  Requires a `t` translation function since this runs outside Svelte component context. */
export function formatSuggestionLabel(
  s: PermissionSuggestion,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  if (s.type === "addRules" && s.rules?.length && s.behavior === "allow") {
    return t("inline_alwaysAllow") + ` ${s.rules[0]}`;
  }
  if (s.type === "setMode" && s.mode) {
    return t("inline_switchToMode", { mode: s.mode });
  }
  if (s.type === "addDirectories" && s.directories?.length) {
    return t("inline_addDirectory", { dir: s.directories[0] });
  }
  if (s.type === "additionalContext") {
    return t("inline_applyHookContext");
  }
  return `Apply: ${s.type}`;
}

/** Copy text to clipboard with legacy fallback for Tauri WebView. */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}
