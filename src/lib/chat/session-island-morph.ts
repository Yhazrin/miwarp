/**
 * Session island morph flash system — manages capsule animation states.
 *
 * Tracks task running/waiting state transitions and emits timed "flash"
 * overlays (running → done → stopped → cached) on the session status bar.
 */

export type MorphFlash = "none" | "running" | "done" | "stopped" | "cached";
export type MorphShell = "none" | "running" | "done" | "stopped" | "cached" | "waiting";
export type StatusOverlayMode = "none" | "send" | "permission" | "toast" | "morph";

export interface MorphState {
  morphFlash: MorphFlash;
  morphFlashTimer: ReturnType<typeof setTimeout> | undefined;
  trackedRunId: string | null;
  prevTaskRunning: boolean;
  prevSessionPhase: string;
  morphInitialized: boolean;
}

export function createMorphState(): MorphState {
  return {
    morphFlash: "none",
    morphFlashTimer: undefined,
    trackedRunId: null,
    prevTaskRunning: false,
    prevSessionPhase: "empty",
    morphInitialized: false,
  };
}

export function clearMorphFlash(state: MorphState): void {
  state.morphFlash = "none";
  clearTimeout(state.morphFlashTimer);
}

function showMorphFlash(
  state: MorphState,
  kind: Exclude<MorphFlash, "none">,
  durationMs: number,
): void {
  clearMorphFlash(state);
  state.morphFlash = kind;
  state.morphFlashTimer = setTimeout(() => {
    state.morphFlash = "none";
  }, durationMs);
}

/** Resolved visual shell: transient flash wins over persistent waiting. */
export function resolveMorphShell(flash: MorphFlash, taskWaiting: boolean): MorphShell {
  if (flash !== "none") return flash;
  if (taskWaiting) return "waiting";
  return "none";
}

export function morphShellClass(shell: MorphShell): string {
  switch (shell) {
    case "running":
      return "session-island-running";
    case "done":
      return "session-island-done";
    case "waiting":
      return "session-island-waiting";
    case "stopped":
      return "session-island-stopped";
    case "cached":
      return "session-island-cached";
    default:
      return "";
  }
}

export function morphShellLabel(shell: MorphShell): string {
  switch (shell) {
    case "running":
      return "running";
    case "done":
      return "done";
    case "waiting":
      return "waiting";
    case "stopped":
      return "stopped";
    case "cached":
      return "cached";
    default:
      return "";
  }
}

/**
 * Process a morph state transition. Called whenever taskRunning or sessionPhase changes.
 * Returns the updated state (mutates in place for perf).
 */
export function processMorphTransition(
  state: MorphState,
  runId: string | null,
  taskActive: boolean,
  phase: string,
): void {
  if (runId !== state.trackedRunId) {
    state.trackedRunId = runId;
    state.prevTaskRunning = taskActive;
    state.prevSessionPhase = phase;
    clearMorphFlash(state);
    state.morphInitialized = true;
    return;
  }

  if (!state.morphInitialized) {
    state.prevTaskRunning = taskActive;
    state.prevSessionPhase = phase;
    state.morphInitialized = true;
    return;
  }

  if (phase === "stopped" && state.prevSessionPhase !== "stopped") {
    showMorphFlash(state, "stopped", 2000);
    state.prevSessionPhase = phase;
    state.prevTaskRunning = taskActive;
    return;
  }

  if (phase === "cached" && state.prevSessionPhase !== "cached") {
    showMorphFlash(state, "cached", 2200);
    state.prevSessionPhase = phase;
    state.prevTaskRunning = taskActive;
    return;
  }

  if (taskActive !== state.prevTaskRunning) {
    if (taskActive) {
      showMorphFlash(state, "running", 1500);
    } else if (phase !== "stopped" && phase !== "failed") {
      showMorphFlash(state, "done", 2000);
    }
    state.prevTaskRunning = taskActive;
  }

  state.prevSessionPhase = phase;
}
