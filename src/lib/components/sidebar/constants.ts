/** Width presets for sidebar resize. */
export const SIDEBAR_WIDTHS = {
  MIN: 180,
  DEFAULT: 220,
  MAX: 400,
} as const;

/** px from edge to trigger resize. */
export const RESIZE_HANDLE_PX = 6;

/** ms to debounce save-to-localStorage. */
export const DEBOUNCE_SAVE_MS = 400;

/** localStorage keys (keep `ocv:` prefix for backward compat). */
export const STORAGE_KEYS = {
  WIDTH: "ocv:sidebarWidth",
  FAVORITES: "ocv:favorites",
  REMOVED_CWDS: "ocv:removedCwds",
  EXPANDED: "ocv:sidebarExpanded",
  SHOW_ARCHIVE: "ocv:sidebarShowArchive",
} as const;
