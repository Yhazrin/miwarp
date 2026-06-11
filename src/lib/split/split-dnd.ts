/**
 * Split workspace DnD protocol — separate MIME type from existing
 * folder-drag and chat-file-drop protocols so all three can coexist on
 * the same window-level dragover/drop listeners.
 *
 * Wire it from the sidebar drag handler:
 *
 *   function onDragStart(e: DragEvent, runId: string) {
 *     e.dataTransfer?.setData("application/x-miwarp-run", runId);      // folder
 *     e.dataTransfer?.setData(SPLIT_DRAG_MIME, runId);                  // split pane
 *   }
 *
 * `SplitDropOverlay` listens for window-level dragenter/over/drop and
 * only reacts when `SPLIT_DRAG_MIME` is present in the dataTransfer types.
 */

export const SPLIT_DRAG_MIME = "application/x-miwarp-split-pane";

/** Returns true iff the drag event carries our MIME type. */
export function isSplitDrag(e: DragEvent | null | undefined): boolean {
  if (!e?.dataTransfer) return false;
  const types = e.dataTransfer.types;
  if (!types) return false;
  // dataTransfer.types is a DOMStringList in browsers; normalize to array.
  for (let i = 0; i < types.length; i++) {
    if (types[i] === SPLIT_DRAG_MIME) return true;
  }
  return false;
}

/** Extract the runId from a drop event's dataTransfer. */
export function readSplitDragRunId(e: DragEvent): string | null {
  const v = e.dataTransfer?.getData(SPLIT_DRAG_MIME);
  return v || null;
}
