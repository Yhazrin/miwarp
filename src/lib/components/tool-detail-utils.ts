/**
 * Shared types and derived-state helpers for ToolDetailView.
 * Extracted to reduce component file size.
 */
import type { BusToolItem } from "$lib/types";
import { escapeHtml } from "$lib/utils/ansi";
import { hljs } from "$lib/utils/hljs-init";

// ── Interfaces ──

export interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface EditResultMeta {
  filePath: string;
  structuredPatch: PatchHunk[];
  oldString?: string;
  newString?: string;
  originalFile?: string;
  userModified?: boolean;
  replaceAll?: boolean;
}

export interface FileResultMeta {
  filePath: string;
  content: string;
  numLines: number;
  startLine: number;
  totalLines: number;
}

export interface BashResultMeta {
  stdout: string;
  stderr: string;
  interrupted: boolean;
  isImage: boolean;
  noOutputExpected: boolean;
}

export interface GlobResultMeta {
  filenames: string[];
  durationMs: number;
  numFiles: number;
  truncated: boolean;
}

export interface GrepResultMeta {
  mode: string;
  numFiles: number;
  filenames: string[];
  content?: string;
  numLines?: number;
}

export interface WebFetchResultMeta {
  bytes: number;
  code: number;
  codeText: string;
  result: string;
  durationMs: number;
  url: string;
}

export interface WebSearchResultMeta {
  query: string;
  results: Array<
    { tool_use_id: string; content: Array<{ title: string; url: string }> } | string
  >;
  durationSeconds: number;
}

export interface TaskResultMeta {
  status: string;
  totalToolUseCount?: number;
  totalDurationMs?: number;
  totalTokens?: number;
  agentId?: string;
  description?: string;
  outputFile?: string;
  prompt?: string;
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

export interface TodoWriteResultMeta {
  oldTodos: TodoItem[];
  newTodos: TodoItem[];
}

export interface SkillResultMeta {
  success: boolean;
  commandName: string;
  status?: string;
  agentId?: string;
  result?: string;
}

export interface ExitPlanResultMeta {
  plan?: string;
  filePath?: string;
  awaitingLeaderApproval?: boolean;
}

export interface NotebookEditResultMeta {
  new_source: string;
  cell_type: string;
  language: string;
  edit_mode: string;
  notebook_path: string;
  cell_id?: string;
  error?: string;
}

// ── Derived state extractors ──

export function extractEditResult(tool: BusToolItem): EditResultMeta | undefined {
  if (
    tool.tool_use_result != null &&
    typeof tool.tool_use_result === "object" &&
    "structuredPatch" in tool.tool_use_result
  ) {
    return tool.tool_use_result as unknown as EditResultMeta;
  }
  return undefined;
}

export function extractWriteResult(tool: BusToolItem): EditResultMeta | undefined {
  if (
    (tool.tool_name === "Write" || tool.tool_name === "write_file") &&
    tool.tool_use_result != null &&
    typeof tool.tool_use_result === "object" &&
    "structuredPatch" in tool.tool_use_result
  ) {
    return tool.tool_use_result as unknown as EditResultMeta;
  }
  return undefined;
}

export function extractBashResult(tool: BusToolItem): BashResultMeta | undefined {
  if (
    tool.tool_use_result != null &&
    typeof tool.tool_use_result === "object" &&
    "stdout" in tool.tool_use_result
  ) {
    return tool.tool_use_result as unknown as BashResultMeta;
  }
  return undefined;
}

export function extractGlobResult(tool: BusToolItem): GlobResultMeta | undefined {
  if (
    tool.tool_use_result != null &&
    typeof tool.tool_use_result === "object" &&
    "filenames" in tool.tool_use_result
  ) {
    return tool.tool_use_result as unknown as GlobResultMeta;
  }
  return undefined;
}

export function extractGrepResult(tool: BusToolItem): GrepResultMeta | undefined {
  if (
    tool.tool_use_result != null &&
    typeof tool.tool_use_result === "object" &&
    "numFiles" in tool.tool_use_result
  ) {
    return tool.tool_use_result as unknown as GrepResultMeta;
  }
  return undefined;
}

export function extractWebFetchResult(tool: BusToolItem): WebFetchResultMeta | undefined {
  if (
    tool.tool_use_result != null &&
    typeof tool.tool_use_result === "object" &&
    "code" in tool.tool_use_result &&
    "bytes" in tool.tool_use_result &&
    "codeText" in tool.tool_use_result
  ) {
    return tool.tool_use_result as unknown as WebFetchResultMeta;
  }
  return undefined;
}

export function extractWebSearchResult(tool: BusToolItem): WebSearchResultMeta | undefined {
  if (
    tool.tool_use_result != null &&
    typeof tool.tool_use_result === "object" &&
    "results" in tool.tool_use_result &&
    Array.isArray((tool.tool_use_result as Record<string, unknown>).results)
  ) {
    return tool.tool_use_result as unknown as WebSearchResultMeta;
  }
  return undefined;
}

export function extractTaskResult(tool: BusToolItem): TaskResultMeta | undefined {
  if (
    tool.tool_use_result != null &&
    typeof tool.tool_use_result === "object" &&
    "totalToolUseCount" in tool.tool_use_result
  ) {
    return tool.tool_use_result as unknown as TaskResultMeta;
  }
  if (
    tool.tool_use_result != null &&
    typeof tool.tool_use_result === "object" &&
    (tool.tool_use_result as Record<string, unknown>).status === "async_launched"
  ) {
    return tool.tool_use_result as unknown as TaskResultMeta;
  }
  return undefined;
}

export function extractTodoResult(tool: BusToolItem): TodoWriteResultMeta | undefined {
  if (
    tool.tool_use_result != null &&
    typeof tool.tool_use_result === "object" &&
    "newTodos" in tool.tool_use_result
  ) {
    return tool.tool_use_result as unknown as TodoWriteResultMeta;
  }
  return undefined;
}

export function extractSkillResult(tool: BusToolItem): SkillResultMeta | undefined {
  if (
    tool.tool_use_result != null &&
    typeof tool.tool_use_result === "object" &&
    "commandName" in tool.tool_use_result
  ) {
    return tool.tool_use_result as unknown as SkillResultMeta;
  }
  return undefined;
}

export function extractExitPlanResult(tool: BusToolItem): ExitPlanResultMeta | undefined {
  if (
    tool.tool_use_result != null &&
    typeof tool.tool_use_result === "object" &&
    "plan" in tool.tool_use_result
  ) {
    return tool.tool_use_result as unknown as ExitPlanResultMeta;
  }
  return undefined;
}

export function extractNotebookResult(tool: BusToolItem): NotebookEditResultMeta | undefined {
  if (
    tool.tool_use_result != null &&
    typeof tool.tool_use_result === "object" &&
    "new_source" in tool.tool_use_result
  ) {
    return tool.tool_use_result as unknown as NotebookEditResultMeta;
  }
  return undefined;
}

// ── Rendering helpers ──

/** Highlight entire code block — safe, never throws. */
export function highlightBlock(code: string, lang: string): string {
  if (!lang || !hljs.getLanguage(lang)) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language: lang }).value;
  } catch {
    return escapeHtml(code);
  }
}

/** Render code with line numbers. */
export function renderCodeWithLineNumbers(code: string, lang: string, startLine = 1): string {
  const lines = code.split("\n");
  const skipHighlight = lines.length > 500 || code.length > 100_000;
  const highlighted = skipHighlight ? escapeHtml(code) : highlightBlock(code, lang);
  return highlighted
    .split("\n")
    .map((line, i) => {
      const num = `<span class="tool-line-num">${startLine + i}</span>`;
      return `${num}${line}`;
    })
    .join("\n");
}

/** Render a diff hunk as a <table> with line numbers, +/- markers, and syntax highlighting. */
export function renderDiffHunk(hunk: PatchHunk, language: string): string {
  const cleanLines = hunk.lines.map((line) => {
    if (line.startsWith("+") || line.startsWith("-")) return line.slice(1);
    if (line.startsWith(" ")) return line.slice(1);
    return line;
  });

  const highlighted = highlightBlock(cleanLines.join("\n"), language);
  const hlLines = highlighted.split("\n");

  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;

  const rows = hunk.lines
    .map((rawLine, i) => {
      const content = hlLines[i] ?? escapeHtml(cleanLines[i]);

      if (rawLine.startsWith("-")) {
        const row =
          `<tr class="diff-row-removed">` +
          `<td class="diff-gutter">${oldLine}</td>` +
          `<td class="diff-gutter"></td>` +
          `<td class="diff-sign diff-sign-del">-</td>` +
          `<td class="diff-code">${content}</td></tr>`;
        oldLine++;
        return row;
      } else if (rawLine.startsWith("+")) {
        const row =
          `<tr class="diff-row-added">` +
          `<td class="diff-gutter"></td>` +
          `<td class="diff-gutter">${newLine}</td>` +
          `<td class="diff-sign diff-sign-add">+</td>` +
          `<td class="diff-code">${content}</td></tr>`;
        newLine++;
        return row;
      } else {
        const row =
          `<tr class="diff-row-context">` +
          `<td class="diff-gutter">${oldLine}</td>` +
          `<td class="diff-gutter">${newLine}</td>` +
          `<td class="diff-sign"> </td>` +
          `<td class="diff-code">${content}</td></tr>`;
        oldLine++;
        newLine++;
        return row;
      }
    })
    .join("");

  return `<table class="diff-table">${rows}</table>`;
}

/** Adjust hunk line numbers when they're 1-based but we know the real file position. */
export function adjustHunkLineNumbers(
  hunks: PatchHunk[],
  oldString: string | undefined,
  originalFile: string | undefined,
): PatchHunk[] {
  if (!originalFile || !oldString || hunks.length === 0) return hunks;
  const idx = originalFile.indexOf(oldString);
  if (idx === -1) return hunks;
  const realStartLine = originalFile.substring(0, idx).split("\n").length;
  if (hunks[0].oldStart === realStartLine) return hunks;
  const offset = realStartLine - hunks[0].oldStart;
  if (offset === 0) return hunks;
  return hunks.map((h) => ({
    ...h,
    oldStart: h.oldStart + offset,
    newStart: h.newStart + offset,
  }));
}

/** Check if content area exceeds collapsed height and needs expand toggle. */
export function countLines(text: string): number {
  return text.split("\n").length;
}
