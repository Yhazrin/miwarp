import type { BusToolItem, TimelineEntry } from "$lib/types";
import { CONTEXT_CLEARED_MARKER } from "$lib/utils/slash-commands";

export type ProcessVisibility = "output" | "guided" | "developer" | "expert";

/** Last-known visibility for instant first paint before `getUserSettings()` resolves. */
const PROCESS_VISIBILITY_LS_KEY = "ocv:process-visibility";

export const PROCESS_VISIBILITY_LEVELS: ProcessVisibility[] = ["output", "expert"];

/**
 * Canonicalize the legacy four-level setting into the two user-facing presets.
 * - output / guided   -> output (conversation-first)
 * - developer / expert -> expert (show everything)
 */
export function normalizeProcessVisibility(value: unknown): ProcessVisibility {
  if (value === "output" || value === "guided") return "output";
  if (value === "developer" || value === "expert") return "expert";
  return "expert";
}

/** Read persisted visibility (same-tab / next visit). Invalid or missing → chat-first. */
export function getCachedProcessVisibility(): ProcessVisibility {
  if (typeof localStorage === "undefined") return "output";
  try {
    return normalizeProcessVisibility(localStorage.getItem(PROCESS_VISIBILITY_LS_KEY));
  } catch {
    return "output";
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
  return normalizeProcessVisibility(mode) === "expert";
}

export function shouldShowToolCards(mode: ProcessVisibility): boolean {
  return normalizeProcessVisibility(mode) === "expert";
}

export function shouldUseCompactToolCards(_mode: ProcessVisibility): boolean {
  return false;
}

export function shouldHideToolCards(mode: ProcessVisibility): boolean {
  return normalizeProcessVisibility(mode) === "output";
}

export function shouldShowRawDebug(mode: ProcessVisibility): boolean {
  return normalizeProcessVisibility(mode) === "expert";
}

export function shouldShowContextDetails(mode: ProcessVisibility): boolean {
  return normalizeProcessVisibility(mode) === "expert";
}

export function shouldShowFullToolPayload(mode: ProcessVisibility): boolean {
  return normalizeProcessVisibility(mode) === "expert";
}

export function shouldShowAgentTaskStack(mode: ProcessVisibility): boolean {
  return normalizeProcessVisibility(mode) === "expert";
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
  if (tool.status === "error" || tool.status === "denied" || tool.status === "permission_denied") {
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

export function shouldShowTimelineCommandOutput(mode: ProcessVisibility, content: string): boolean {
  if (mode !== "output") return true;
  const c = content.trimStart();
  if (c.includes("## Context Usage")) return true;
  if (c.includes("Total cost:") && c.includes("Total duration")) return true;
  if (c.startsWith("Version ") && c.includes("•")) return true;
  return false;
}

/** Context-reset divider (not compaction / Ralph / command output blocks). */
export function isTimelineSeparatorContent(content: string): boolean {
  const c = content.trim();
  if (!c) return false;
  if (c.includes(CONTEXT_CLEARED_MARKER)) return true;
  if (/^context cleared\b/i.test(c)) return true;
  return false;
}
