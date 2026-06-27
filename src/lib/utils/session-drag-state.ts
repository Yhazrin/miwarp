/** True while the user is pointer-dragging a sidebar session (not an OS file drop). */
let sessionDragActive = false;
let sessionDragOverSplit = false;

export const SESSION_DRAG_EVENT = "miwarp:session-drag";

export const SESSION_DRAG_ROOT_CLASS = "session-drag-active";
export const SESSION_SPLIT_DROP_TARGET_CLASS = "session-split-drop-target";

function emitSessionDragState(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SESSION_DRAG_EVENT, {
      detail: { active: sessionDragActive, overSplit: sessionDragOverSplit },
    }),
  );
}

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
    root.classList.remove(SESSION_SPLIT_DROP_TARGET_CLASS);
    sessionDragOverSplit = false;
    document.removeEventListener("selectstart", blockSelectStart, { capture: true });
  }
  emitSessionDragState();
}

export function isSessionDragActive(): boolean {
  return sessionDragActive;
}

export const SESSION_DROP_FOLDER_ATTR = "data-session-folder-drop";
export const SESSION_DROP_UNFOLDERED_ATTR = "data-session-unfoldered-drop";
/** Chat main pane — dropping a sidebar session here opens split workspace. */
export const SESSION_DROP_SPLIT_ATTR = "data-session-split-drop";

export function setSessionDragOverSplit(active: boolean): void {
  sessionDragOverSplit = active;
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(SESSION_SPLIT_DROP_TARGET_CLASS, active);
  emitSessionDragState();
}

export function isSessionDragOverSplit(): boolean {
  return sessionDragOverSplit;
}

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

/** True when `(x, y)` is over the chat split drop zone. */
export function findSessionSplitDropTarget(x: number, y: number): boolean {
  const el = document.elementFromPoint(x, y);
  if (!el) return false;
  return el.closest(`[${SESSION_DROP_SPLIT_ATTR}]`) != null;
}

/** @deprecated Use findSessionDropTarget */
export function findSessionFolderDropTarget(x: number, y: number): string | null {
  const target = findSessionDropTarget(x, y);
  return target?.type === "folder" ? target.folderId : null;
}
