/** True while the user is pointer-dragging a sidebar session (not an OS file drop). */
let sessionDragActive = false;

export const SESSION_DRAG_ROOT_CLASS = "session-drag-active";

function blockSelectStart(e: Event): void {
  e.preventDefault();
}

export function setSessionDragActive(active: boolean): void {
  sessionDragActive = active;
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (active) {
    root.classList.add(SESSION_DRAG_ROOT_CLASS);
    document.addEventListener("selectstart", blockSelectStart, { capture: true });
  } else {
    root.classList.remove(SESSION_DRAG_ROOT_CLASS);
    document.removeEventListener("selectstart", blockSelectStart, { capture: true });
  }
}

export function isSessionDragActive(): boolean {
  return sessionDragActive;
}

export const SESSION_DROP_FOLDER_ATTR = "data-session-folder-drop";
export const SESSION_DROP_UNFOLDERED_ATTR = "data-session-unfoldered-drop";

export type SessionDropTarget =
  | { type: "folder"; folderId: string }
  | { type: "unfoldered"; workspaceKey: string };

export function findSessionDropTarget(x: number, y: number): SessionDropTarget | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const folderEl = el.closest(`[${SESSION_DROP_FOLDER_ATTR}]`) as HTMLElement | null;
  if (folderEl) {
    const folderId = folderEl.getAttribute(SESSION_DROP_FOLDER_ATTR);
    if (folderId) return { type: "folder", folderId };
  }
  const unfolderedEl = el.closest(`[${SESSION_DROP_UNFOLDERED_ATTR}]`) as HTMLElement | null;
  if (unfolderedEl) {
    const workspaceKey = unfolderedEl.getAttribute(SESSION_DROP_UNFOLDERED_ATTR);
    if (workspaceKey) return { type: "unfoldered", workspaceKey };
  }
  return null;
}

/** @deprecated Use findSessionDropTarget */
export function findSessionFolderDropTarget(x: number, y: number): string | null {
  const target = findSessionDropTarget(x, y);
  return target?.type === "folder" ? target.folderId : null;
}
