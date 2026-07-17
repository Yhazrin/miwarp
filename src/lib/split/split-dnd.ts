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
export const RUN_DRAG_MIME = "application/x-miwarp-run";

/** Active sidebar session drag (HTML5 path). Pointer drags use session-drag-state instead. */
let activeSplitDragRunId: string | null = null;

export function beginSplitDrag(runId: string): void {
  activeSplitDragRunId = runId;
}

export function endSplitDrag(): void {
  activeSplitDragRunId = null;
}

export function getActiveSplitDragRunId(): string | null {
  return activeSplitDragRunId;
}

function dataTransferHasSplitMime(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    if (t === SPLIT_DRAG_MIME || t === RUN_DRAG_MIME) return true;
  }
  return false;
}

/** Returns true for HTML5 sidebar drags (incl. WebKit where custom MIME is hidden until drop). */
export function isSplitDrag(e: DragEvent | null | undefined): boolean {
  if (activeSplitDragRunId) return true;
  if (!e?.dataTransfer) return false;
  return dataTransferHasSplitMime(e);
}

/** Extract the runId from a drop event's dataTransfer. */
export function readSplitDragRunId(e: DragEvent): string | null {
  const fromSplit = e.dataTransfer?.getData(SPLIT_DRAG_MIME);
  if (fromSplit) return fromSplit;
  const fromRun = e.dataTransfer?.getData(RUN_DRAG_MIME);
  if (fromRun) return fromRun;
  if (activeSplitDragRunId) return activeSplitDragRunId;
  const plain = e.dataTransfer?.getData("text/plain")?.trim();
  if (plain && plain.length >= 8) return plain;
  return null;
}
