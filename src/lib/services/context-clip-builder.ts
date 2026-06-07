/**
 * v1.0.6 / 4.1: convert a raw selection (browser `Selection` or plain text)
 * into a `ContextClip` draft. Keeps the builder decoupled from any UI
 * component so it can be unit-tested.
 */
import type { ContextClipDraft, ContextClipSource } from "./context-clip-types";

export interface BuildClipInput {
  text: string;
  source: ContextClipSource;
  label?: string;
  runId?: string;
}

const MAX_TEXT_LEN = 8000;

export function buildClipDraft(input: BuildClipInput): ContextClipDraft {
  const trimmed = (input.text ?? "").trim();
  if (!trimmed) {
    throw new Error("buildClipDraft: text is empty");
  }
  return {
    text: trimmed.length > MAX_TEXT_LEN ? trimmed.slice(0, MAX_TEXT_LEN) : trimmed,
    source: input.source,
    label: input.label?.trim() || undefined,
    runId: input.runId,
  };
}

/** Extract the currently selected text from the active window (if any). */
export function readActiveSelection(): string {
  if (typeof window === "undefined" || !window.getSelection) return "";
  const sel = window.getSelection();
  if (!sel) return "";
  return sel.toString();
}
