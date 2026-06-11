/**
 * Public entry for the split workspace module.
 *
 * Importers should prefer this barrel over reaching into individual files,
 * so the module surface stays controlled as the feature grows.
 */

export {
  splitWorkspaceStore,
  SplitWorkspaceStore,
  MAX_PANES,
  maxSlotsForLayout,
  makePaneId,
} from "./split-workspace-store.svelte";
export type {
  PaneId,
  PaneState,
  PaneLoadState,
  PaneRuntimeState,
  PaneScrollState,
  PaneErrorState,
  PaneSnapshot,
  LayoutMode,
  EnterOptions,
  AddPaneOptions,
  SplitToastKind,
  SplitToastFn,
} from "./split-workspace-store.svelte";

export { splitPaneSessionAdapter } from "./split-pane-session-adapter";
export type { XtermLike, PaneSnapshotWithRaw } from "./split-pane-session-adapter";

export { SPLIT_DRAG_MIME, isSplitDrag, readSplitDragRunId } from "./split-dnd";

export { layoutGridClass, layoutDescription, slotPosition } from "./split-layout";
export type { SlotPosition } from "./split-layout";
