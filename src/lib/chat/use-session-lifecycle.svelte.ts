/**
 * Composable: session lifecycle (stop / resume / fork).
 *
 * Extracts from +page.svelte:
 *   - handleStop()
 *   - handleResume(action, runId?, opts?)
 *   - stopForkProcess(sourceRunId)
 *   - handleForkCancel()
 *   - handleForkRetry()
 *   - forkOverlay state + forkElapsed $effect + fork phase watcher
 *   - middleware.subscribeCurrent registration
 *   - runId $effect (subscribe + loadRun)
 *   - resume URL param $effect
 *   - scrollTo URL param handling
 */
import { goto, replaceState } from "$app/navigation";
import { tick, untrack } from "svelte";
import { get } from "svelte/store";
import { page } from "$app/stores";
import * as api from "$lib/api";
import type { SessionStore } from "$lib/stores/session-store.svelte";
import type { EventMiddleware } from "$lib/stores/event-middleware";
import type { Attachment, SessionMode } from "$lib/types";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { t } from "$lib/i18n/index.svelte";

export interface ForkOverlay {
  active: boolean;
  sourceRunId: string;
  startedAt: number;
  error: string | null;
}

export interface ResumeOptions {
  initialMessage?: string;
  initialAttachments?: Attachment[];
}

export function useSessionLifecycle(opts: {
  store: SessionStore;
  middleware: EventMiddleware;
  goto: typeof goto;
  replaceState: typeof replaceState;
  /** The page-level forkOverlay state (get/set so composable can mutate it). */
  forkOverlay: {
    get: () => ForkOverlay | null;
    set: (v: ForkOverlay | null) => void;
  };
  /** Shared scroll-in-flight flag from page. */
  getScrollToInFlight: () => boolean;
  setScrollToInFlight: (v: boolean) => void;
  /** Injects handleResume into useChatController. */
  registerResume: (
    fn: (mode: SessionMode, runId?: string, opts?: ResumeOptions) => Promise<void>,
  ) => void;
  /** Called by the page's runId $effect to load a run. */
  loadRunProgressive: (runId: string, xtermRef: unknown) => Promise<void>;
  /** Called by the page's runId $effect for empty runs. */
  cancelProgressive: () => void;
  /** Scrolls chat to a given timestamp entry. */
  scrollToMessage: (ts: string) => Promise<void>;
  middlewareReady: { get: () => boolean };
}) {
  const {
    store,
    middleware,
    goto,
    replaceState,
    forkOverlay,
    getScrollToInFlight,
    setScrollToInFlight,
    registerResume,
    loadRunProgressive,
    cancelProgressive,
    scrollToMessage,
    middlewareReady,
  } = opts;

  // ── Local lifecycle state ──
  let resuming = $state(false);

  // ── handleStop ──
  async function handleStop() {
    await store.stop();
    window.dispatchEvent(new Event("ocv:runs-changed"));
  }

  // ── handleResume ──
  async function handleResume(mode: SessionMode, overrideRunId?: string, opts?: ResumeOptions) {
    const targetRunId = overrideRunId ?? store.run?.id;
    if (!targetRunId || resuming) return;
    resuming = true;

    // Fork: activate overlay immediately for progress feedback
    if (mode === "fork") {
      forkOverlay.set({
        active: true,
        sourceRunId: targetRunId,
        startedAt: Date.now(),
        error: null,
      });
    }

    try {
      // Fork: don't subscribe to source — backend emits RunState(stopped)
      // for the source which would interfere with the fork state machine.
      if (mode !== "fork") {
        middleware.subscribeCurrent(targetRunId, store);
      }
      const resultId = await store.resumeSession(
        targetRunId,
        mode,
        opts?.initialMessage,
        opts?.initialAttachments,
      );
      if (resultId) {
        middleware.subscribeCurrent(resultId, store);
        if (mode === "fork") {
          // Check if user cancelled during fork_oneshot
          if (!forkOverlay.get()) {
            dbg("chat", "fork: cancelled during fork_oneshot, skipping step 2");
          } else {
            // Step 1 complete — dismiss overlay, use normal session startup UI for step 2
            forkOverlay.set(null);
            goto(`/chat?run=${resultId}`, { replaceState: true });
            // Step 2: establish stream-json connection (shows "Starting session..." spinner)
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
        // Fork failed — don't clear overlay or navigate away.
        // The phase watcher $effect will show the error in the overlay.
        // User can Retry or Cancel from there.
        dbg("chat", "fork failed, keeping overlay for retry/cancel");
      } else {
        // Non-fork resume failed — stay on the target run's view instead of
        // navigating to blank new-session page (the run's history is still useful).
        goto(`/chat?run=${targetRunId}`, { replaceState: true });
      }
      window.dispatchEvent(new Event("ocv:runs-changed"));
    } catch (e) {
      // Fork sync failure → show error in overlay instead of error bar
      if (mode === "fork" && forkOverlay.get()) {
        forkOverlay.set({ ...forkOverlay.get()!, error: String(e) });
      }
    } finally {
      resuming = false;
    }
  }

  // Register handleResume so useChatController can call it
  registerResume(handleResume);

  // ── Fork helpers ──

  /** Stop the fork run's process (if it exists and isn't the source run). */
  async function stopForkProcess(sourceRunId: string) {
    if (store.run && store.run.id !== sourceRunId) {
      try {
        await api.stopSession(store.run.id);
      } catch {
        /* best-effort */
      }
    }
  }

  async function handleForkCancel() {
    const fo = forkOverlay.get();
    if (!fo) return;
    const sourceRunId = fo.sourceRunId;
    await stopForkProcess(sourceRunId);
    forkOverlay.set(null);
    store.error = "";
    goto(`/chat?run=${sourceRunId}`, { replaceState: true });
    await loadRunProgressive(sourceRunId, null);
    window.dispatchEvent(new Event("ocv:runs-changed"));
  }

  async function handleForkRetry() {
    const fo = forkOverlay.get();
    if (!fo || resuming) return;
    const sourceRunId = fo.sourceRunId;
    await stopForkProcess(sourceRunId);
    forkOverlay.set({ active: true, sourceRunId, startedAt: Date.now(), error: null });
    store.error = "";
    await handleResume("fork", sourceRunId);
  }

  // ── Fork overlay elapsed timer ──
  let forkElapsed = $state(0);
  $effect(() => {
    const fo = forkOverlay.get();
    if (fo?.active && !fo.error) {
      const interval = setInterval(() => {
        forkElapsed = Math.floor((Date.now() - fo.startedAt) / 1000);
      }, 1000);
      return () => clearInterval(interval);
    } else {
      forkElapsed = 0;
    }
  });

  // Fork overlay phase watcher: show error on failure during step 1 (fork_oneshot).
  // Overlay is dismissed explicitly by handleResume after step 1 succeeds.
  $effect(() => {
    const fo = forkOverlay.get();
    if (!fo?.active) return;
    const phase = store.phase;
    if ((phase === "failed" || phase === "stopped") && !fo.error) {
      forkOverlay.set({ ...fo, error: store.error || t("chat_forkFailedFallback") });
    }
  });

  // ── runId $effect (subscribe + loadRun) ──
  $effect(() => {
    if (!middlewareReady.get()) return;
    const id = get(page).url.searchParams.get("run") ?? "";
    const hasResume = get(page).url.searchParams.has("resume");
    untrack(() => {
      middleware.subscribeCurrent(id, store);

      if (store.resumeInFlight || resuming) {
        dbg("effect", "skip loadRun — resume in progress");
        return;
      }
      if (hasResume) return;

      if (!id) {
        store.loadRun("", undefined);
        cancelProgressive();
        return;
      }

      if (store.run?.id === id && store.phase !== "empty" && store.phase !== "loading") {
        dbg("effect", "skip loadRun — run already in singleton store", id, store.phase);
        const scrollTo = get(page).url.searchParams.get("scrollTo");
        if (scrollTo) {
          const clean = new URL(get(page).url);
          clean.searchParams.delete("scrollTo");
          replaceState(clean, {});
          tick().then(() => scrollToMessage(scrollTo));
        }
        return;
      }

      loadRunProgressive(id, undefined);
    });
  });

  // Handle scrollTo for already-loaded runs
  $effect(() => {
    if (!middlewareReady.get()) return;
    const scrollTo = get(page).url.searchParams.get("scrollTo");
    if (!scrollTo) return;
    untrack(() => {
      if (getScrollToInFlight()) return;
      if (store.phase === "loading") return;
      const clean = new URL(get(page).url);
      clean.searchParams.delete("scrollTo");
      replaceState(clean, {});
      tick().then(() => scrollToMessage(scrollTo));
    });
  });

  // Consume ?resume= URL param
  $effect(() => {
    const url = get(page).url;
    const paramRunId = url.searchParams.get("run");
    const resumeMode = url.searchParams.get("resume") as SessionMode | null;

    if (paramRunId && resumeMode) {
      const clean = new URL(url);
      clean.searchParams.delete("resume");
      replaceState(clean, {});

      untrack(() => {
        handleResume(resumeMode, paramRunId);
      });
    }
  });

  return {
    handleStop,
    handleResume,
    stopForkProcess,
    handleForkCancel,
    handleForkRetry,
    forkElapsed: { get: () => forkElapsed },
    resuming: { get: () => resuming },
  };
}
