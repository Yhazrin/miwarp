/**
 * Split workspace layout helpers — maps `LayoutMode` to CSS class names
 * and slot counts. Pure functions; no Svelte runes. Imported by
 * `SplitWorkspace.svelte` and the store for validation.
 */

import type { LayoutMode } from "./split-workspace-store.svelte";

export function layoutGridClass(mode: LayoutMode): string {
  switch (mode) {
    case "single":
      return "split-grid-single";
    case "dual":
      return "split-grid-dual";
    case "triple":
      return "split-grid-triple";
    case "quad":
      return "split-grid-quad";
  }
}

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

/**
 * Stable slot index for a pane in a given layout. Used by CSS grid
 * `grid-column` / `grid-row` assignments.
 *
 *   single: [0]
 *   dual:   [0, 1]
 *   triple: [0, 1, 2]   — pane 0 spans full height on the left; 1, 2 stack right
 *   quad:   [0, 1, 2, 3] — 2×2 grid
 */
export interface SlotPosition {
  column: number;
  row: number;
}

export function slotPosition(mode: LayoutMode, slot: number): SlotPosition {
  switch (mode) {
    case "single":
      return { column: 1, row: 1 };
    case "dual":
      return { column: slot + 1, row: 1 };
    case "triple":
      if (slot === 0) return { column: 1, row: 1 };
      return { column: 2, row: slot }; // slot 1 → row 1, slot 2 → row 2
    case "quad":
      return { column: (slot % 2) + 1, row: Math.floor(slot / 2) + 1 };
  }
}
