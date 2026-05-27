import type { SessionFolder } from "$lib/types";

/** Data attribute key used for session drop targets. */
export const SESSION_DROP_FOLDER_ATTR = "data-drop-folder";

/** Build a list of drop-zone folder entries from folders + "All Sessions". */
export interface DropZone {
  cwd: string;
  label: string;
}

export function buildDropZones(folders: SessionFolder[]): DropZone[] {
  const zones: DropZone[] = [{ cwd: "", label: "All Sessions" }];
  for (const f of folders) {
    zones.push({ cwd: f.workspaceId, label: f.name ?? f.workspaceId });
  }
  return zones;
}

/** Find which drop zone a dragged item is hovering over. */
export function findDropZone(
  target: HTMLElement | null,
): string | null {
  let el = target;
  while (el) {
    const val = el.getAttribute(SESSION_DROP_FOLDER_ATTR);
    if (val !== null) return val;
    el = el.parentElement;
  }
  return null;
}
