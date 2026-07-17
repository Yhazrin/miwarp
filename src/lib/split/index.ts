/**
 * Public entry for the split workspace module.
 *
 * Importers should prefer this barrel over reaching into individual files,
 * so the module surface stays controlled as the feature grows.
 */

export {splitWorkspaceStore}from "./split-workspace-store.svelte";;
export type {PaneId, PaneState, LayoutMode}from "./split-workspace-store.svelte";;
;
export type {PaneSnapshotWithRaw}from "./split-pane-session-adapter";;

export {isSplitDrag, readSplitDragRunId}from "./split-dnd";;
;
;

export {refreshInactivePaneSnapshot}from "./split-workspace-lifecycle";;
;

export { layoutDescription } from "./split-layout";
