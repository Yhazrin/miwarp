import type { SessionStore } from "$lib/stores/session-store.svelte";
import type { ForkOverlayState } from "$lib/chat/use-fork-lifecycle";

export interface ForkOverlayContext {
  store: SessionStore;
  t: (key: string) => string;
}

export interface ForkOverlayHandle {
  forkOverlay: ForkOverlayState | null;
  setForkOverlay: (v: ForkOverlayState | null) => void;
  forkElapsed: number;
}

export function createForkOverlay(ctx: ForkOverlayContext): ForkOverlayHandle {
  const { store, t } = ctx;

  let forkOverlay = $state<ForkOverlayState | null>(null);
  let forkElapsed = $state(0);

  // Fork overlay timer: tick elapsed seconds while active
  $effect(() => {
    if (forkOverlay?.active && !forkOverlay.error) {
      const interval = setInterval(() => {
        forkElapsed = Math.floor((Date.now() - forkOverlay!.startedAt) / 1000);
      }, 1000);
      return () => clearInterval(interval);
    } else {
      forkElapsed = 0;
    }
  });

  // Fork overlay phase watcher: show error on failure during step 1 (fork_oneshot).
  $effect(() => {
    if (!forkOverlay?.active) return;
    const phase = store.phase;
    if ((phase === "failed" || phase === "stopped") && !forkOverlay.error) {
      forkOverlay = { ...forkOverlay, error: store.error || t("chat_forkFailedFallback") };
    }
  });

  return {
    get forkOverlay() {
      return forkOverlay;
    },
    setForkOverlay: (v: ForkOverlayState | null) => {
      forkOverlay = v;
    },
    get forkElapsed() {
      return forkElapsed;
    },
  };
}
