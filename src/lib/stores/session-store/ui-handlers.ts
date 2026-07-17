/**
 * UI event handler functions extracted from SessionStore.
 *
 * Contains handleChatDone and handleChatDelta for pipe-exec mode.
 *
 * @module ui-handlers
 */
import * as api from "$lib/api";
import { dbgWarn } from "$lib/utils/debug";

// ── Store interface ──

export interface UIHandlerAPI {
  run: { id: string } | null;
  useStreamSession: boolean;
  phase: string;
  _setPhase(to: string): void;
}

// ── handleChatDone ──

export function handleChatDoneImpl(
  store: UIHandlerAPI,
  _done: { ok: boolean; code: number; error?: string },
): void {
  if (!store.run) return;

  if (!store.useStreamSession) {
    const runId = store.run.id;
    store._setPhase("completed");
    api
      .getRun(runId)
      .then((r) => {
        // Guard: only apply if we're still on the same run
        if (store.run?.id === runId) (store as unknown as { run: typeof r }).run = r;
      })
      .catch((e) => dbgWarn("store", "getRun after pipe-exec done failed:", e));
  }
}

// ── handleChatDelta ──

export function handleChatDeltaImpl(
  store: UIHandlerAPI,
  text: string,
  xtermRef?: { writeText(s: string): void },
): void {
  if (!store.run) return;
  if (!store.useStreamSession && xtermRef) {
    xtermRef.writeText(text);
  }
}
