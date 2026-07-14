import * as api from "$lib/api";
import { EVT_RUNS_CHANGED } from "$lib/utils/bus-events";
import { dbg } from "$lib/utils/debug";
import type { SessionStore } from "$lib/stores/session-store.svelte";
import type { Attachment, SessionMode, TaskRun } from "$lib/types";

export interface ForkOverlayState {
  active: boolean;
  sourceRunId: string;
  startedAt: number;
  error: string | null;
}

export interface ForkLifecycleContext {
  store: SessionStore;
  middleware: { subscribeCurrent(id: string, store: SessionStore): void };
  goto: (path: string, opts?: { replaceState?: boolean }) => void;
  loadRunProgressive: (
    id: string,
    xtermRef?: { clear(): void; writeText(s: string): void },
  ) => Promise<void>;
  getResuming: () => boolean;
  setResuming: (v: boolean) => void;
  getForkOverlay: () => ForkOverlayState | null;
  setForkOverlay: (v: ForkOverlayState | null) => void;
  setLastContinuableRun: (v: TaskRun | null) => void;
  t: (key: string, params?: Record<string, string>) => string;
}

export function createForkLifecycle(ctx: ForkLifecycleContext) {
  const {
    store,
    middleware,
    goto,
    loadRunProgressive,
    getResuming,
    setResuming,
    getForkOverlay,
    setForkOverlay,
    setLastContinuableRun,
    t: _t,
  } = ctx;

  async function stopForkProcess(sourceRunId: string) {
    if (store.run && store.run.id !== sourceRunId) {
      try {
        await api.stopSession(store.run.id);
      } catch {
        /* best-effort */
      }
    }
  }

  async function handleResume(
    mode: SessionMode,
    overrideRunId?: string,
    initialMessage?: string,
    initialAttachments?: Attachment[],
  ) {
    const targetRunId = overrideRunId ?? store.run?.id;
    if (!targetRunId || getResuming() || store.resumeInFlight) return;
    setResuming(true);

    if (mode === "fork") {
      setForkOverlay({
        active: true,
        sourceRunId: targetRunId,
        startedAt: Date.now(),
        error: null,
      });
    }

    try {
      if (mode !== "fork") {
        middleware.subscribeCurrent(targetRunId, store);
      }
      const resultId = await store.resumeSession(
        targetRunId,
        mode,
        initialMessage,
        initialAttachments,
      );
      if (resultId) {
        middleware.subscribeCurrent(resultId, store);
        if (mode === "fork") {
          if (!getForkOverlay()) {
            dbg("chat", "fork: cancelled during fork_oneshot, skipping step 2");
          } else {
            setForkOverlay(null);
            goto(`/chat?run=${resultId}`, { replaceState: true });
            try {
              await store.connectSession(resultId);
            } catch (e) {
              store.error = String(e);
            }
          }
        } else {
          goto(`/chat?run=${resultId}`, { replaceState: true });
        }
      } else if (mode === "fork") {
        dbg("chat", "fork failed, keeping overlay for retry/cancel");
      } else {
        setLastContinuableRun(null);
        goto(`/chat?run=${targetRunId}`, { replaceState: true });
      }
      window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
    } catch (e) {
      if (mode === "fork" && getForkOverlay()) {
        setForkOverlay({ ...getForkOverlay()!, error: String(e) });
      }
    } finally {
      setResuming(false);
    }
  }

  async function handleForkCancel() {
    const overlay = getForkOverlay();
    if (!overlay) return;
    const sourceRunId = overlay.sourceRunId;
    await stopForkProcess(sourceRunId);
    setForkOverlay(null);
    store.error = "";
    goto(`/chat?run=${sourceRunId}`, { replaceState: true });
    await loadRunProgressive(sourceRunId);
    window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
  }

  async function handleForkRetry() {
    const overlay = getForkOverlay();
    if (!overlay || getResuming()) return;
    const sourceRunId = overlay.sourceRunId;
    await stopForkProcess(sourceRunId);
    setForkOverlay({ active: true, sourceRunId, startedAt: Date.now(), error: null });
    store.error = "";
    await handleResume("fork", sourceRunId);
  }

  return {
    handleResume,
    handleForkCancel,
    handleForkRetry,
    stopForkProcess,
  };
}
