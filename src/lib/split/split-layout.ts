/**
 * Split workspace layout helpers — maps `LayoutMode` to i18n labels.
 * Pure functions; no Svelte runes. Imported by `SplitWorkspace.svelte`.
 *
 * Note: the previous `layoutGridClass` and `slotPosition` helpers were
 * dead code — `SplitWorkspace.svelte` uses CSS Grid `data-layout-mode`
 * attributes + per-layout selectors in `<style>` instead, so the helpers
 * were removed in P2-2.
 */

import type { LayoutMode } from "./split-workspace-store.svelte";

export function layoutDescription(mode: LayoutMode, label: (key: string) => string): string {
  switch (mode) {
    case "single":
      return label("split_mode_layoutSingle");
    case "dual":
      return label("split_mode_layoutDual");
    case "triple":
      return label("split_mode_layoutTriple");
    case "quad":
      return label("split_mode_layoutQuad");
  }
}
