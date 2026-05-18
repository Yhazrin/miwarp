import type { BusToolItem, TimelineEntry } from "$lib/types";
import { formatDuration } from "$lib/utils/format";

export type ProcessVisibility = "output" | "guided" | "developer" | "expert";

/** Last-known visibility for instant first paint before `getUserSettings()` resolves. */
const PROCESS_VISIBILITY_LS_KEY = "ocv:process-visibility";

export const PROCESS_VISIBILITY_LEVELS: ProcessVisibility[] = [
  "output",
  "guided",
  "developer",
  "expert",
];

export function normalizeProcessVisibility(value: unknown): ProcessVisibility {
  if (
    value === "output" ||
    value === "guided" ||
    value === "developer" ||
    value === "expert"
  ) {
    return value;
  }
  return "developer";
}

/** Read persisted visibility (same-tab / next visit). Invalid or missing → developer. */
export function getCachedProcessVisibility(): ProcessVisibility {
  if (typeof localStorage === "undefined") return "developer";
  try {
    return normalizeProcessVisibility(localStorage.getItem(PROCESS_VISIBILITY_LS_KEY));
  } catch {
    return "developer";
  }
}

export function persistCachedProcessVisibility(mode: ProcessVisibility): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PROCESS_VISIBILITY_LS_KEY, mode);
  } catch {
    /* ignore quota / private mode */
  }
}

export function shouldShowThinking(mode: ProcessVisibility): boolean {
  return mode === "developer" || mode === "expert";
}

export function shouldShowToolCards(mode: ProcessVisibility): boolean {
  return mode === "guided" || mode === "developer" || mode === "expert";
}

export function shouldUseCompactToolCards(mode: ProcessVisibility): boolean {
  return mode === "guided";
}

export function shouldHideToolCards(mode: ProcessVisibility): boolean {
  return mode === "output";
}

export function shouldShowRightActivityPanel(mode: ProcessVisibility): boolean {
  return mode !== "output";
}

export function shouldShowRawDebug(mode: ProcessVisibility): boolean {
  return mode === "expert";
}

export function shouldShowContextDetails(mode: ProcessVisibility): boolean {
  return mode === "developer" || mode === "expert";
}

export function shouldShowFullToolPayload(mode: ProcessVisibility): boolean {
  return mode === "expert";
}

export function shouldShowAgentTaskStack(mode: ProcessVisibility): boolean {
  return mode === "guided" || mode === "developer" || mode === "expert";
}

/** User must see / act (permissions, questions, failures). Never hide these in Output. */
export function isProcessVisibilityCriticalTool(tool: BusToolItem): boolean {
  return (
    tool.status === "permission_prompt" ||
    tool.status === "ask_pending" ||
    tool.status === "error" ||
    tool.status === "permission_denied" ||
    tool.status === "denied" ||
    tool.tool_name === "AskUserQuestion" ||
    tool.tool_name === "ExitPlanMode"
  );
}

/** Nested agent runs keep full inline chrome so sub-timeline stays usable. */
export function isProcessVisibilityStructuralTool(tool: BusToolItem): boolean {
  return tool.tool_name === "Agent" || tool.tool_name === "Task";
}

/** Output mode: only critical + structural tools mount full InlineToolCard; routine tools use no card (no flash). */
export function shouldMountFullToolCardInOutputMode(tool: BusToolItem): boolean {
  return isProcessVisibilityCriticalTool(tool) || isProcessVisibilityStructuralTool(tool);
}

/** Guided: routine tools use compact timeline row; critical/structural use full card. */
export function shouldMountFullToolCardInGuidedMode(tool: BusToolItem): boolean {
  return isProcessVisibilityCriticalTool(tool) || isProcessVisibilityStructuralTool(tool);
}

export function timelineHasHiddenRoutineWorkRunning(entries: TimelineEntry[]): boolean {
  for (const e of entries) {
    if (e.kind !== "tool") continue;
    if (e.tool.status !== "running") continue;
    if (shouldMountFullToolCardInOutputMode(e.tool)) continue;
    return true;
  }
  return false;
}

export function guidedToolRowStatusIconKind(
  tool: BusToolItem,
): "done" | "error" | "running" | "other" {
  if (tool.status === "success") return "done";
  if (
    tool.status === "error" ||
    tool.status === "denied" ||
    tool.status === "permission_denied"
  ) {
    return "error";
  }
  if (
    tool.status === "running" ||
    tool.status === "permission_prompt" ||
    tool.status === "ask_pending"
  ) {
    return "running";
  }
  return "other";
}

function pushFlattenTools(
  entry: Extract<TimelineEntry, { kind: "tool" }>,
  out: BusToolItem[],
): void {
  out.push(entry.tool);
  if (entry.subTimeline) {
    for (const st of entry.subTimeline) {
      if (st.kind === "tool") pushFlattenTools(st, out);
    }
  }
}

/** Tools in this assistant turn: between previous user/assistant boundary and this assistant. */
export function collectToolsBeforeAssistant(
  timeline: TimelineEntry[],
  assistantIndex: number,
): BusToolItem[] {
  let start = 0;
  for (let i = assistantIndex - 1; i >= 0; i--) {
    const e = timeline[i];
    if (e.kind === "user" || e.kind === "assistant") {
      start = i + 1;
      break;
    }
  }
  const out: BusToolItem[] = [];
  for (let i = start; i < assistantIndex; i++) {
    const e = timeline[i];
    if (e.kind === "tool") pushFlattenTools(e, out);
  }
  return out;
}

const READ_NAMES = new Set([
  "Read",
  "Grep",
  "Glob",
  "grep",
  "glob",
  "NotebookRead",
  "WebFetch",
  "WebSearch",
]);

const CMD_NAMES = new Set(["Bash", "bash"]);

const EDIT_NAMES = new Set(["Write", "Edit", "MultiEdit", "EditNotebook", "NotebookEdit"]);

export interface RunProcessStats {
  reads: number;
  commands: number;
  edits: number;
  errors: number;
  durationMs: number;
}

export function computeRunProcessStats(tools: BusToolItem[]): RunProcessStats {
  let reads = 0;
  let commands = 0;
  let edits = 0;
  let errors = 0;
  let durationMs = 0;
  for (const t of tools) {
    const name = t.tool_name;
    if (READ_NAMES.has(name)) reads += 1;
    else if (CMD_NAMES.has(name)) commands += 1;
    else if (EDIT_NAMES.has(name)) edits += 1;

    if (
      t.status === "error" ||
      t.status === "denied" ||
      t.status === "permission_denied"
    ) {
      errors += 1;
    }
    if (typeof t.duration_ms === "number" && t.duration_ms > 0) durationMs += t.duration_ms;
  }
  return { reads, commands, edits, errors, durationMs };
}

export function formatProcessRunSummaryLine(
  stats: RunProcessStats,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  const parts: string[] = [];
  if (stats.reads > 0) {
    parts.push(t("processRunSummary_reads", { n: String(stats.reads) }));
  }
  if (stats.commands > 0) {
    parts.push(t("processRunSummary_commands", { n: String(stats.commands) }));
  }
  if (stats.edits > 0) {
    parts.push(t("processRunSummary_edits", { n: String(stats.edits) }));
  }
  if (stats.errors > 0) {
    parts.push(t("processRunSummary_errors", { n: String(stats.errors) }));
  }
  const body = parts.length > 0 ? parts.join(t("processRunSummary_sep")) : t("processRunSummary_noTools");
  const time =
    stats.durationMs > 0
      ? t("processRunSummary_timePrefix", { time: formatDuration(stats.durationMs) })
      : "";
  return t("processRunSummary_full", { body, time: time ? `${t("processRunSummary_sep")}${time}` : "" });
}

export function shouldShowTimelineCommandOutput(
  mode: ProcessVisibility,
  content: string,
): boolean {
  if (mode !== "output") return true;
  const c = content.trimStart();
  if (c.includes("## Context Usage")) return true;
  if (c.includes("Total cost:") && c.includes("Total duration")) return true;
  if (c.startsWith("Version ") && c.includes("•")) return true;
  return false;
}
