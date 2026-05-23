/** True while the user is pointer-dragging a sidebar session (not an OS file drop). */
let sessionDragActive = false;

export function setSessionDragActive(active: boolean): void {
  sessionDragActive = active;
}

export function isSessionDragActive(): boolean {
  return sessionDragActive;
}

export const SESSION_DROP_FOLDER_ATTR = "data-session-folder-drop";

export function findSessionFolderDropTarget(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const target = el.closest(`[${SESSION_DROP_FOLDER_ATTR}]`) as HTMLElement | null;
  return target?.getAttribute(SESSION_DROP_FOLDER_ATTR) ?? null;
}
