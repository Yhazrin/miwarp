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

export {
  SPLIT_DRAG_MIME,
  RUN_DRAG_MIME,
  isSplitDrag,
  readSplitDragRunId,
  beginSplitDrag,
  endSplitDrag,
  getActiveSplitDragRunId,
} from "./split-dnd";

export { buildChatUrl, isSplitModeUrl, SPLIT_QUERY_PARAM } from "./split-workspace-url";

export {
  registerSplitWorkspaceLifecycle,
  unregisterSplitWorkspaceLifecycle,
  enterSplitWorkspace,
  addSplitPane,
  activateSplitPane,
  closeSplitPane,
  exitSplitWorkspace,
  toggleSplitWorkspace,
  reconcileSplitFromUrl,
  syncSplitUrlFromStore,
  setSplitLayoutMode,
  isSplitUrlSyncLocked,
} from "./split-workspace-lifecycle";
export type { SplitWorkspaceLifecycleDeps } from "./split-workspace-lifecycle";

export { layoutGridClass, layoutDescription, slotPosition } from "./split-layout";
export type { SlotPosition } from "./split-layout";
