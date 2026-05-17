/**
 * MiWarp — Process Visibility (过程显示级别)
 *
 * Controls transcript detail density without changing agent execution.
 */

import type { BusToolItem } from "$lib/types";

export type ProcessVisibility = "output" | "guided" | "developer" | "expert";

const LEVELS: readonly ProcessVisibility[] = ["output", "guided", "developer", "expert"] as const;

export const PROCESS_VISIBILITY_LEVELS: readonly ProcessVisibility[] = LEVELS;

export function normalizeProcessVisibility(raw: string | undefined | null): ProcessVisibility {
  if (raw && (LEVELS as readonly string[]).includes(raw)) return raw as ProcessVisibility;
  return "developer";
}

/** In-chat extended thinking text (history + live panel). */
export function shouldShowExtendedThinkingBlock(mode: ProcessVisibility): boolean {
  return mode === "developer" || mode === "expert";
}

/** @deprecated Prefer shouldShowExtendedThinkingBlock */
export const shouldShowThinking = shouldShowExtendedThinkingBlock;

/** Detailed live block: slash handler, thinking verb, active tool name — not in Output. */
export function shouldShowRichLiveThinkingUI(mode: ProcessVisibility): boolean {
  return mode !== "output";
}

/** Minimal agent activity (Output only — avoids duplicating rich UI in Guided+). */
export function shouldShowCompactLiveActivityUI(mode: ProcessVisibility): boolean {
  return mode === "output";
}

/** @deprecated Prefer shouldShowRichLiveThinkingUI */
export function shouldShowLiveThinkingIndicator(mode: ProcessVisibility): boolean {
  return shouldShowRichLiveThinkingUI(mode);
}

/** Whether full inline tool cards are shown at all (vs hidden or summary-only). */
export function shouldShowInlineToolCards(mode: ProcessVisibility): boolean {
  return mode !== "output";
}

/** Prefer collapsed cards until user expands (Guided + Summary-like). */
export function shouldAutoCollapseToolCards(mode: ProcessVisibility): boolean {
  return mode === "guided";
}

/** One-line summaries only (Guided); Developer uses view mode; Expert full. */
export function shouldShowToolSummaryOnly(mode: ProcessVisibility): boolean {
  return mode === "guided";
}

/** Right activity rail: meaningful width vs minimized. */
export function shouldShowRightActivityPanel(mode: ProcessVisibility): boolean {
  return mode !== "output";
}

export function shouldShowRawDebug(mode: ProcessVisibility): boolean {
  return mode === "expert";
}

export function shouldShowTokenCostRibbon(mode: ProcessVisibility): boolean {
  return mode === "developer" || mode === "expert";
}

export function shouldShowCommandOutputTranscript(mode: ProcessVisibility): boolean {
  return mode === "developer" || mode === "expert";
}

export function shouldShowToolBurstHeaders(mode: ProcessVisibility): boolean {
  return mode !== "output";
}

export function shouldShowTranscriptToolFilter(mode: ProcessVisibility): boolean {
  return mode === "developer" || mode === "expert";
}

export function shouldShowViewModeToggle(mode: ProcessVisibility): boolean {
  return mode === "developer" || mode === "expert";
}

/** Ask / permission tools in Output always need the full inline card. */
export function isOutputModeInteractiveTool(
  tool: Pick<BusToolItem, "tool_name" | "status">,
): boolean {
  if (tool.status === "permission_prompt" || tool.status === "ask_pending") return true;
  if (tool.tool_name === "AskUserQuestion") return true;
  return false;
}

/** Output: one-line in-transcript row for non-interactive running tools (no heavy card). */
export function shouldUseTranscriptQuietToolRow(
  mode: ProcessVisibility,
  tool: Pick<BusToolItem, "tool_name" | "status">,
): boolean {
  return mode === "output" && tool.status === "running" && !isOutputModeInteractiveTool(tool);
}

/** Whether the full InlineToolCard should mount for this timeline tool (Output hides most). */
export function shouldShowFullTranscriptInlineToolCard(
  mode: ProcessVisibility,
  tool: Pick<BusToolItem, "tool_name" | "status">,
): boolean {
  if (mode !== "output") return true;
  if (tool.status === "permission_prompt" || tool.status === "ask_pending") return true;
  if (tool.status === "running") return isOutputModeInteractiveTool(tool);
  return false;
}

export interface TranscriptRunStats {
  readFiles: number;
  writeFiles: number;
  editFiles: number;
  bashRuns: number;
}

type TimelineSlice = { kind: string; tool?: { tool_name: string; status?: string } };

export function collectTranscriptToolStatsSinceAssistant(
  entries: TimelineSlice[],
  assistantIndex: number,
): TranscriptRunStats {
  const stats: TranscriptRunStats = {
    readFiles: 0,
    writeFiles: 0,
    editFiles: 0,
    bashRuns: 0,
  };
  for (let j = assistantIndex + 1; j < entries.length; j++) {
    const e = entries[j];
    if (e.kind === "user" || e.kind === "assistant") break;
    if (e.kind !== "tool" || !e.tool) continue;
    const name = e.tool.tool_name;
    const term = ["success", "error", "denied", "permission_denied"].includes(e.tool.status ?? "");
    if (name === "Read" && term) stats.readFiles += 1;
    else if (name === "Write" && term) stats.writeFiles += 1;
    else if ((name === "Edit" || name === "MultiEdit") && term) stats.editFiles += 1;
    else if (name === "Bash" && term) stats.bashRuns += 1;
  }
  return stats;
}

export function transcriptStatsNonEmpty(s: TranscriptRunStats): boolean {
  return s.readFiles > 0 || s.writeFiles > 0 || s.editFiles > 0 || s.bashRuns > 0;
}
