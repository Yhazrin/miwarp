/**
 * View Mode Store
 *
 * Controls transcript display density:
 * - normal  (default): tool calls collapsed to one-line summaries, full text responses
 * - verbose: every tool call, file read, and intermediate step shown expanded
 * - summary: only significant tool calls visible (hides intermediate Read/Grep/Glob etc.)
 */

export type ViewMode = "normal" | "verbose" | "summary";

class ViewModeStore {
  mode = $state<ViewMode>("normal");

  cycle() {
    const modes: ViewMode[] = ["normal", "verbose", "summary"];
    const idx = modes.indexOf(this.mode);
    this.mode = modes[(idx + 1) % modes.length];
  }

  set(mode: ViewMode) {
    this.mode = mode;
  }

  get isNormal() {
    return this.mode === "normal";
  }

  get isVerbose() {
    return this.mode === "verbose";
  }

  get isSummary() {
    return this.mode === "summary";
  }
}

export const viewModeStore = new ViewModeStore();
