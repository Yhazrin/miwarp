/**
 * Auto-name gating logic for chat sessions.
 *
 * Titles are generated asynchronously via a one-shot Claude print call
 * once the first turn reaches idle; `deriveAutoName` remains the fallback.
 */

/** Derive a fallback title from the first line of a prompt. Truncates at 40 chars. */
export function deriveAutoName(prompt: string): string {
  const firstLine = prompt.split("\n")[0].trim();
  if (!firstLine) return "";
  return firstLine.length > 40 ? firstLine.slice(0, 40) + "…" : firstLine;
}

export interface AutoNameState {
  phase: string;
  runId: string | undefined;
  runName: string | undefined;
  prompt: string | undefined;
  autoNameDone: boolean;
}

/**
 * Determine whether auto-title generation should start.
 *
 * Fires when:
 * - phase is "idle" (first turn finished)
 * - run exists with a prompt but no custom name yet
 * - auto-name has not already been attempted for this run
 * - prompt is not a slash command
 */
export function shouldTriggerAutoTitle(state: AutoNameState): boolean {
  if (state.phase !== "idle") return false;
  if (!state.runId) return false;
  if (state.runName?.trim()) return false;
  if (state.autoNameDone) return false;
  const prompt = state.prompt?.trim();
  if (!prompt) return false;
  if (prompt.startsWith("/")) return false;
  return true;
}

/** @deprecated Use {@link shouldTriggerAutoTitle} — kept for older tests/callers. */
export function shouldAutoName(state: AutoNameState): { fire: boolean; autoName?: string } {
  if (!shouldTriggerAutoTitle(state)) return { fire: false };
  const autoName = deriveAutoName(state.prompt ?? "");
  if (!autoName) return { fire: false };
  return { fire: true, autoName };
}
