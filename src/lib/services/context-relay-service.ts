/**
 * v1.0.6 / 4.1 Context Relay: bridge between selection events and the
 * context relay store. Listens for browser selection changes and
 * exposes a `relaySelectionToStore()` helper that other surfaces
 * (chat bubble long-press, tool output copy button) can call.
 */
import { contextRelayStore } from "$lib/stores/context-relay-store.svelte";
import { buildClipDraft, readActiveSelection } from "./context-clip-builder";
import type { ContextClipSource } from "./context-clip-types";

export interface RelaySelectionOptions {
  source: ContextClipSource;
  label?: string;
  runId?: string;
}

/** Capture the active selection and push it onto the relay queue. */
export function relaySelectionToStore(opts: RelaySelectionOptions): boolean {
  const text = readActiveSelection();
  if (!text) return false;
  try {
    const draft = buildClipDraft({
      text,
      source: opts.source,
      label: opts.label,
      runId: opts.runId,
    });
    contextRelayStore.add(draft);
    return true;
  } catch {
    return false;
  }
}

/** Push an arbitrary string (e.g. tool output). */
export function relayTextToStore(text: string, opts: RelaySelectionOptions): boolean {
  if (!text.trim()) return false;
  try {
    const draft = buildClipDraft({ text, ...opts });
    contextRelayStore.add(draft);
    return true;
  } catch {
    return false;
  }
}
