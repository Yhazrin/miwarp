/**
 * Burst visual state management — adds settling/collapsing transition phases
 * to avoid hard-switch flicker when tool cards collapse into a burst header.
 *
 * State machine:
 *   expanded → settling → collapsing → collapsed
 *
 * - expanded:    tool cards visible, burst header hidden
 * - settling:    all tools completed, keep expanded for N ms to let user see completion
 * - collapsing:  tool cards animating out, burst header animating in
 * - collapsed:   only header visible, tool cards unmounted
 */

import { tick } from "svelte";
import type { ToolBurst } from "$lib/utils/tool-rendering";
import { dbg, dbgWarn } from "$lib/utils/debug";

// ── Config ───────────────────────────────────────────────────────────────────

const SETTLING_MS = 400; // hold expanded after completion before collapsing
const COLLAPSING_MS = 260; // animation duration for tool cards fade-out

// ── Types ────────────────────────────────────────────────────────────────────

export type BurstVisualState = "expanded" | "settling" | "collapsing" | "collapsed";

export interface BurstCollapseHandle {
  /** Keys in each visual state */
  settlingKeys: Set<string>;
  collapsingKeys: Set<string>;
  /** Indices hidden by collapsed bursts (burst fully done + animation complete) */
  collapsedIndices: Set<number>;
  /** Indices in collapsing phase — tool cards still visible but animating out */
  collapsingIndices: Set<number>;
  /** Effective collapsed set for header rendering (collapsed + collapsing) */
  effectiveCollapsed: Set<string>;
  /** User manually toggled a burst */
  toggleBurst: (key: string) => void;
  /** Called when run switches — clears all timers and state */
  reset: () => void;
  /** Sync visual states from current burst data — call when bursts change */
  syncStates: () => void;
}

// ── Helper ───────────────────────────────────────────────────────────────────

export function useToolBurstCollapse(
  getToolBursts: () => Map<number, ToolBurst>,
  getRunId: () => string | undefined,
): BurstCollapseHandle {
  // ── Visual state per burst key ──────────────────────────────────────────
  // "expanded" | "settling" | "collapsing" | "collapsed"
  let visualStates = $state(new Map<string, BurstVisualState>());

  // Manual overrides: true = forced expand, false = forced collapse
  let manualOverrides = $state(new Map<string, boolean>());

  // Pending collapse timers keyed by burst.key
  const collapseTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Pending settling timers keyed by burst.key
  const settlingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Track which run we're on so we can abort on run switch
  let activeRunId: string | undefined;

  // ── Derived: which keys are in each state ────────────────────────────────

  const settlingKeys = $derived.by(() => {
    const s = new Set<string>();
    for (const [key, state] of visualStates) {
      if (state === "settling") s.add(key);
    }
    return s;
  });

  const collapsingKeys = $derived.by(() => {
    const s = new Set<string>();
    for (const [key, state] of visualStates) {
      if (state === "collapsing") s.add(key);
    }
    return s;
  });

  const collapsedKeys = $derived.by(() => {
    const s = new Set<string>();
    for (const [key, state] of visualStates) {
      if (state === "collapsed") s.add(key);
    }
    return s;
  });

  // Keys that should show the header (collapsed or collapsing)
  const effectiveCollapsed = $derived.by(() => {
    return new Set([...collapsedKeys, ...collapsingKeys]);
  });

  // Indices hidden by fully-collapsed bursts (not collapsing — those keep their cards)
  const collapsedIndices = $derived.by(() => {
    const bursts = getToolBursts();
    const hidden = new Set<number>();
    for (const [, burst] of bursts) {
      if (collapsedKeys.has(burst.key)) {
        for (let j = burst.startIndex; j <= burst.endIndex; j++) {
          hidden.add(j);
        }
      }
    }
    return hidden;
  });

  // Indices whose tool cards should animate out (collapsing phase)
  const collapsingIndices = $derived.by(() => {
    const bursts = getToolBursts();
    const hidden = new Set<number>();
    for (const [, burst] of bursts) {
      if (collapsingKeys.has(burst.key)) {
        for (let j = burst.startIndex; j <= burst.endIndex; j++) {
          hidden.add(j);
        }
      }
    }
    return hidden;
  });

  // ── Core update logic ───────────────────────────────────────────────────

  /**
   * Recalculate visual states from burst data.
   * Called whenever bursts or their stats change.
   */
  function syncStates() {
    const runId = getRunId();
    if (!runId) return;

    // If run changed, reset everything
    if (runId !== activeRunId) {
      activeRunId = runId;
      clearAllTimers();
      visualStates = new Map();
      manualOverrides = new Map();
      return;
    }

    const bursts = getToolBursts();
    const currentStates = new Map(visualStates);
    const nextStates = new Map<string, BurstVisualState>();

    for (const [, burst] of bursts) {
      const key = burst.key;
      const currentState = currentStates.get(key) ?? "expanded";
      const manual = manualOverrides.get(key);

      // Highest priority: needs interaction → always expanded, cancel any transitions
      const needsInteraction = burst.tools.some(
        (t) => t.status === "permission_prompt" || t.status === "ask_pending",
      );
      if (needsInteraction) {
        cancelTimersForKey(key);
        nextStates.set(key, "expanded");
        continue;
      }

      // User forced expand
      if (manual === true) {
        cancelTimersForKey(key);
        nextStates.set(key, "expanded");
        continue;
      }

      // User forced collapse — go directly to collapsed
      if (manual === false) {
        cancelTimersForKey(key);
        nextStates.set(key, "collapsed");
        continue;
      }

      // ── Auto logic ───────────────────────────────────────────────────────

      const allDone = burst.stats.running === 0 && burst.stats.total > 0;

      switch (currentState) {
        case "expanded":
          if (allDone) {
            // Start settling timer
            startSettlingTimer(key);
            nextStates.set(key, "settling");
          } else {
            nextStates.set(key, "expanded");
          }
          break;

        case "settling":
          if (!allDone) {
            // A tool started running again — cancel and go back to expanded
            cancelTimersForKey(key);
            nextStates.set(key, "expanded");
          } else {
            // Keep settling — timer will trigger transition to collapsing
            nextStates.set(key, "settling");
          }
          break;

        case "collapsing":
          // Collapsing is terminal unless user manually expands
          // (timer drives to "collapsed")
          nextStates.set(key, "collapsing");
          break;

        case "collapsed":
          if (!allDone) {
            // A tool started running again — go back to expanded
            nextStates.set(key, "expanded");
          } else {
            // Stay collapsed
            nextStates.set(key, "collapsed");
          }
          break;
      }
    }

    visualStates = nextStates;
  }

  // ── Timer management ──────────────────────────────────────────────────────

  function startSettlingTimer(key: string) {
    cancelTimersForKey(key);
    const timer = setTimeout(() => {
      if (visualStates.get(key) === "settling") {
        startCollapsingTimer(key);
        visualStates = new Map(visualStates).set(key, "collapsing");
      }
    }, SETTLING_MS);
    settlingTimers.set(key, timer);
  }

  function startCollapsingTimer(key: string) {
    const timer = setTimeout(() => {
      if (visualStates.get(key) === "collapsing") {
        visualStates = new Map(visualStates).set(key, "collapsed");
      }
    }, COLLAPSING_MS);
    collapseTimers.set(key, timer);
  }

  function cancelTimersForKey(key: string) {
    const st = settlingTimers.get(key);
    if (st !== undefined) {
      clearTimeout(st);
      settlingTimers.delete(key);
    }
    const ct = collapseTimers.get(key);
    if (ct !== undefined) {
      clearTimeout(ct);
      collapseTimers.delete(key);
    }
  }

  function clearAllTimers() {
    for (const t of collapseTimers.values()) clearTimeout(t);
    for (const t of settlingTimers.values()) clearTimeout(t);
    collapseTimers.clear();
    settlingTimers.clear();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  function toggleBurst(key: string) {
    // Get current effective state
    const isCollapsed = collapsedKeys.has(key) || collapsingKeys.has(key);
    const next = new Map(manualOverrides);
    // Toggle: if currently collapsed → force expand (true), vice versa
    next.set(key, isCollapsed);
    manualOverrides = next;
    // Immediately sync so the UI updates without waiting for the next tick
    syncStates();
  }

  async function reset() {
    clearAllTimers();
    activeRunId = undefined;
    visualStates = new Map();
    manualOverrides = new Map();
    await tick();
  }

  return {
    get settlingKeys() {
      return settlingKeys;
    },
    get collapsingKeys() {
      return collapsingKeys;
    },
    get collapsedIndices() {
      return collapsedIndices;
    },
    get collapsingIndices() {
      return collapsingIndices;
    },
    get effectiveCollapsed() {
      return effectiveCollapsed;
    },
    toggleBurst,
    reset,
    // expose sync so page can call it when bursts change
    syncStates,
  };
}
