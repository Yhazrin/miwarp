/**
 * Composable that owns thinking spinner state and slash command processing indicator.
 *
 * Extracted from +page.svelte to keep the page file focused on UI wiring.
 */

import type { SessionStore } from "$lib/stores/session-store.svelte";
import { randomSpinnerVerb } from "$lib/utils/spinner-verbs";

export interface ThinkingTimerContext {
  store: SessionStore;
}

export interface ThinkingTimerHandle {
  thinkingElapsed: number;
  thinkingExpanded: boolean;
  setThinkingExpanded: (v: boolean) => void;
  thinkingVisible: boolean;
  spinnerVerb: string;
  processingSlashCmd: string | null;
  setProcessingSlashCmd: (v: string | null) => void;
  slashCmdSeenRunning: boolean;
  setSlashCmdSeenRunning: (v: boolean) => void;
}

export function useThinkingTimer(ctx: ThinkingTimerContext): ThinkingTimerHandle {
  const { store } = ctx;

  let thinkingElapsed = $state(0);
  let thinkingExpanded = $state(false);
  let spinnerVerb = $state(randomSpinnerVerb());
  let thinkingVerbPicked = false;
  let thinkingVisible = $state(false);

  let processingSlashCmd = $state<string | null>(null);
  let slashCmdSeenRunning = $state(false);

  // Next thinking stream starts collapsed; also fold when a turn ends and text clears.
  $effect(() => {
    if (!store.thinkingText) {
      thinkingExpanded = false;
    }
  });

  // Slash command processing indicator — shown before thinkingVisible kicks in.
  $effect(() => {
    if (!processingSlashCmd) return;
    if (store.isRunning) slashCmdSeenRunning = true;
    if (
      store.streamingText.trim() ||
      store.thinkingText ||
      store.error ||
      store.phase === "failed" ||
      store.phase === "completed" ||
      store.phase === "stopped" ||
      (slashCmdSeenRunning && store.phase === "idle")
    ) {
      processingSlashCmd = null;
      slashCmdSeenRunning = false;
    }
  });

  // Thinking timer with debounced visibility
  $effect(() => {
    if (store.isThinking) {
      const base = store.thinkingStartMs || Date.now();
      if (!thinkingVerbPicked) {
        spinnerVerb = randomSpinnerVerb();
        thinkingVerbPicked = true;
      }
      const showTimer = setTimeout(() => {
        thinkingVisible = true;
      }, 80);
      thinkingElapsed = Math.max(0, Math.floor((Date.now() - base) / 1000));
      const interval = setInterval(() => {
        thinkingElapsed = Math.max(0, Math.floor((Date.now() - base) / 1000));
      }, 1000);
      return () => {
        clearTimeout(showTimer);
        clearInterval(interval);
      };
    } else {
      thinkingElapsed = 0;
      thinkingVisible = false;
      thinkingVerbPicked = false;
    }
  });

  return {
    get thinkingElapsed() {
      return thinkingElapsed;
    },
    get thinkingExpanded() {
      return thinkingExpanded;
    },
    set thinkingExpanded(v: boolean) {
      thinkingExpanded = v;
    },
    setThinkingExpanded: (v: boolean) => {
      thinkingExpanded = v;
    },
    get thinkingVisible() {
      return thinkingVisible;
    },
    get spinnerVerb() {
      return spinnerVerb;
    },
    get processingSlashCmd() {
      return processingSlashCmd;
    },
    setProcessingSlashCmd: (v: string | null) => {
      processingSlashCmd = v;
    },
    get slashCmdSeenRunning() {
      return slashCmdSeenRunning;
    },
    setSlashCmdSeenRunning: (v: boolean) => {
      slashCmdSeenRunning = v;
    },
  };
}
