/** Shared surface classes for Bits UI wrappers (MiWarp design tokens). */

export const MIWARP_DIALOG_OVERLAY_CLASS =
  "fixed inset-0 z-50 bg-miwarp-overlay backdrop-blur-md";

export const MIWARP_DIALOG_CONTENT_CLASS =
  "elevation-3 outline-hidden fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[hsl(var(--miwarp-glass-border)/0.25)] p-6 backdrop-blur-2xl";

export const MIWARP_DIALOG_CONTENT_STYLE = "background: hsl(var(--miwarp-bg-deep) / 0.94);";

export const MIWARP_POPOVER_CONTENT_CLASS =
  "statusbar-popover z-[9999] min-w-[220px] w-max animate-fade-in rounded-2xl border border-border/35 bg-background/86 p-1 backdrop-blur-xl outline-hidden";

/** Status bar tier-2 menus (model / process visibility). */
export const MIWARP_STATUSBAR_MENU_CLASS =
  "statusbar-popover z-[45] flex max-h-[min(420px,70vh)] flex-col overflow-hidden outline-hidden animate-fade-in rounded-2xl border border-border/35 bg-background/86 backdrop-blur-xl";

export const MIWARP_SELECT_ITEM_CLASS =
  "flex w-full cursor-default select-none items-center gap-2 rounded-xl px-3 py-2 text-xs outline-hidden transition-colors data-highlighted:bg-accent/20 data-[state=checked]:bg-accent/20 data-[state=checked]:font-medium";

export const MIWARP_SELECT_ITEM_STATUSBAR_CLASS =
  "flex w-full cursor-default select-none items-start gap-2 rounded-[10px] px-2 py-2 text-left text-xs outline-hidden transition-colors data-highlighted:bg-muted/45 data-[state=checked]:bg-primary/12";

/** Compact menus (auth badge, settings pickers). */
export const MIWARP_MENU_PANEL_CLASS =
  "z-[9999] max-h-80 w-72 overflow-y-auto rounded-md border border-border/35 bg-background/95 p-0 shadow-lg outline-hidden animate-fade-in backdrop-blur-xl";

/** Anchored detail panels (context %, tool hints). */
export const MIWARP_DETAIL_POPOVER_CLASS =
  "z-50 w-64 rounded-xl border border-border/60 bg-background/95 p-3 shadow-lg outline-hidden backdrop-blur-sm animate-fade-in";

export const MIWARP_DIALOG_CONTENT_LG_CLASS =
  "elevation-3 outline-hidden fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-[hsl(var(--miwarp-glass-border)/0.25)] p-0 backdrop-blur-2xl";

export const MIWARP_DIALOG_CONTENT_COMMAND_CLASS =
  "outline-hidden fixed left-1/2 top-[15vh] z-50 w-full max-w-xl -translate-x-1/2 rounded-lg border border-[hsl(var(--miwarp-glass-border)/0.25)] bg-background p-0 shadow-2xl";

export const MIWARP_DIALOG_CONTENT_MD_CLASS =
  "elevation-3 outline-hidden fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[hsl(var(--miwarp-glass-border)/0.25)] p-0 backdrop-blur-2xl";

export const MIWARP_DIALOG_CONTENT_SM_CLASS =
  "elevation-3 outline-hidden fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[hsl(var(--miwarp-glass-border)/0.25)] p-5 backdrop-blur-2xl";
