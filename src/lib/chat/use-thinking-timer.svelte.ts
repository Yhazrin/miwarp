import type { SessionStore } from "$lib/stores/session-store.svelte";

const SPINNER_VERBS = [
  "Thinking",
  "Reasoning",
  "Analyzing",
  "Processing",
  "Computing",
  "Deliberating",
  "Pondering",
  "Reflecting",
];

function randomSpinnerVerb(): string {
  return SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)]!;
}

export function useThinkingTimer(store: SessionStore) {
  let thinkingElapsed = $state(0);
  let thinkingExpanded = $state(false);
  let spinnerVerb = $state(randomSpinnerVerb());
  let thinkingVerbPicked = false;
  let thinkingVisible = $state(false);

  $effect(() => {
    if (!store.thinkingText) {
      thinkingExpanded = false;
    }
  });

  $effect(() => {
    if (store.isThinking) {
      const base = store.thinkingStartMs || Date.now();
      if (!thinkingVerbPicked) {
        spinnerVerb = randomSpinnerVerb();
        thinkingVerbPicked = true;
      }
      const showTimer = setTimeout(() => {
        thinkingVisible = true;
      }, 300);
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
    set thinkingElapsed(v: number) {
      thinkingElapsed = v;
    },
    get thinkingExpanded() {
      return thinkingExpanded;
    },
    set thinkingExpanded(v: boolean) {
      thinkingExpanded = v;
    },
    get spinnerVerb() {
      return spinnerVerb;
    },
    get thinkingVisible() {
      return thinkingVisible;
    },
  };
}
