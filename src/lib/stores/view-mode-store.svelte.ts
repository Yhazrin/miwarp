/**
 * View Mode Store
 *
 * Controls transcript display density:
 * - verbose: every tool call, file read, and intermediate step shown expanded
 * - summary: only significant tool calls visible (hides intermediate Read/Grep/Glob etc.)
 */

export type ViewMode = "verbose" | "summary";

class ViewModeStore {
  mode = $state<ViewMode>("summary");

  cycle() {
    const modes: ViewMode[] = ["verbose", "summary"];
    const idx = modes.indexOf(this.mode);
    this.mode = modes[(idx + 1) % modes.length];
  }

  set(mode: ViewMode) {
    this.mode = mode;
  }

  get isVerbose() {
    return this.mode === "verbose";
  }

  get isSummary() {
    return this.mode === "summary";
  }
}

export const viewModeStore = new ViewModeStore();
