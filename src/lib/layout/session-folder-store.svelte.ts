/**
 * session-folder-store — owns the sidebar's session-folder state: CRUD on
 * `SessionFolder[]`, the sub-folder expand set, the create / rename /
 * delete dialog open flags, and the move-to-folder dialog flow.
 *
 * The original +layout.svelte inlined all of this (≈200 lines of state +
 * handlers) alongside unrelated concerns. Pulling it into a single rune
 * store lets the layout component stop carrying folder state at all and
 * lets the folder-tree UI import from one place.
 *
 * Behaviour-equivalence contract (refactor — no functional change):
 *   - Folder CRUD: listAllSessionFolders → normalize → store; createSessionFolder
 *     uses sessionFolderWorkspaceId(projectCwd) as the workspace key
 *   - Cascade delete: re-load runs so folder_id changes propagate to the
 *     sidebar
 *   - Move-to-folder: optimistic local update of runs (via the runs store
 *     callback), IPC call, EVT_RUNS_CHANGED dispatch
 *   - Dialog state lives in the store so the SidebarModals consumer can
 *     `bind:` to it directly (unchanged contract)
 *
 * The store accepts a `runsStore` reference so the optimistic local
 * update after a move can be applied without circular imports.
 */
import {
  listAllSessionFolders,
  createSessionFolder,
  renameSessionFolder,
  deleteSessionFolder,
  moveRunToFolder,
  batchMoveToFolder,
} from "$lib/api";
import { dbg, dbgWarn } from "$lib/utils/debug";
import {
  normalizeSessionFolderList,
  sessionFolderWorkspaceId,
  sessionFoldersForWorkspace,
  type SessionFolderGroup,
} from "$lib/utils/sidebar-groups";
import type { SessionFolder } from "$lib/types";

export interface RunsStoreRef {
  runs: TaskRun[]; // read-only
  applyFolderMoveLocally(ids: string[], folderId: string | null): void;
}

import type { TaskRun } from "$lib/types";

export class SessionFolderStore {
  sessionFolders = $state<SessionFolder[]>([]);

  // Sub-folder expand state (folderKey → expanded). Keys are "sf:<folderId>".
  expandedSubFolders = $state<Set<string>>(new Set());

  // Dialog state — exposed as $state so SidebarModals can `bind:` to it.
  folderCreateOpen = $state<boolean>(false);
  folderCreateName = $state<string>("");
  /** Cwd targeted by the current "create sub-folder" dialog. */
  folderCreateCwd = $state<string>("");

  folderRenameOpen = $state<boolean>(false);
  folderRenameTarget = $state<SessionFolder | null>(null);
  folderRenameName = $state<string>("");

  folderDeleteOpen = $state<boolean>(false);
  folderDeleteTarget = $state<SessionFolder | null>(null);

  // Move-to-folder dialog state
  moveToFolderOpen = $state<boolean>(false);
  moveToFolderRunIds = $state<string[]>([]);
  moveToFolderSelectedId = $state<string | null>(null);

  /** Bound by the layout to wire the optimistic local update after a move. */
  runsStore: RunsStoreRef | null = null;
  /** Bound by the layout to provide the cwd for create-folder calls. */
  getProjectCwd: () => string = () => "";
  /** Bound by the layout to refresh runs after a cascade delete. */
  onRunsReloadRequested: () => Promise<void> = async () => {};

  // ── List ──────────────────────────────────────────────────────────

  async load(): Promise<void> {
    try {
      const raw = await listAllSessionFolders();
      this.sessionFolders = normalizeSessionFolderList(raw);
      dbg("layout", "loadSessionFolders", { count: this.sessionFolders.length });
    } catch (e) {
      dbgWarn("layout", "loadSessionFolders failed", e);
    }
  }

  /** Convenience: scoped folders for the move-to-folder dialog. */
  foldersForMoveDialog(projectCwd: string): SessionFolder[] {
    return sessionFoldersForWorkspace(this.sessionFolders, projectCwd);
  }

  // ── Sub-folder expand ──────────────────────────────────────────────

  toggleSubFolder(folderKey: string): void {
    const next = new Set(this.expandedSubFolders);
    if (next.has(folderKey)) next.delete(folderKey);
    else next.add(folderKey);
    this.expandedSubFolders = next;
  }

  /** Force-expand a sub-folder (used after a pointer-drop move). */
  ensureSubFolderExpanded(folderId: string): void {
    if (this.expandedSubFolders.has(`sf:${folderId}`)) return;
    this.expandedSubFolders = new Set([...this.expandedSubFolders, `sf:${folderId}`]);
  }

  // ── Create ────────────────────────────────────────────────────────

  /** Open the create-sub-folder dialog targeting `cwd`. */
  openCreateDialog(cwd: string): void {
    this.folderCreateCwd = cwd;
    this.folderCreateName = "";
    this.folderCreateOpen = true;
  }

  async doCreate(): Promise<void> {
    const name = this.folderCreateName.trim();
    if (!name) return;
    this.folderCreateOpen = false;
    this.folderCreateName = "";
    try {
      const workspaceId = sessionFolderWorkspaceId(this.folderCreateCwd || this.getProjectCwd());
      const folder = await createSessionFolder(name, workspaceId);
      this.folderCreateCwd = "";
      await this.load();
      dbg("layout", "createFolder success", { id: folder.id, name });
    } catch (e) {
      dbgWarn("layout", "createFolder failed", e);
    }
  }

  // ── Rename ────────────────────────────────────────────────────────

  openRenameDialog(folder: SessionFolder): void {
    this.folderRenameTarget = folder;
    this.folderRenameName = folder.name;
    this.folderRenameOpen = true;
  }

  async doRename(): Promise<void> {
    const target = this.folderRenameTarget;
    const newName = this.folderRenameName.trim();
    if (!target || !newName) return;
    this.folderRenameOpen = false;
    this.folderRenameTarget = null;
    try {
      await renameSessionFolder(target.id, newName);
      this.sessionFolders = this.sessionFolders.map((f) =>
        f.id === target.id ? { ...f, name: newName } : f,
      );
      dbg("layout", "renameFolder success", { id: target.id, newName });
    } catch (e) {
      dbgWarn("layout", "renameFolder failed", e);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────

  openDeleteDialog(folder: SessionFolder): void {
    this.folderDeleteTarget = folder;
    this.folderDeleteOpen = true;
  }

  async doDelete(cascade: boolean): Promise<void> {
    const target = this.folderDeleteTarget;
    this.folderDeleteOpen = false;
    this.folderDeleteTarget = null;
    if (!target) return;
    try {
      await deleteSessionFolder(target.id, cascade);
      this.sessionFolders = this.sessionFolders.filter((f) => f.id !== target.id);
      if (cascade) {
        await this.onRunsReloadRequested();
      }
      dbg("layout", "deleteFolder success", { id: target.id, cascade });
    } catch (e) {
      dbgWarn("layout", "deleteFolder failed", e);
    }
  }

  // ── Move ──────────────────────────────────────────────────────────

  /**
   * If `folderId !== undefined`, perform the move immediately (used when
   * the caller already knows the destination — e.g. pointer drop into a
   * folder row). Otherwise open the dialog.
   */
  requestMove(runIds: string[], folderId?: string | null): void {
    if (folderId !== undefined) {
      void this._moveImmediate(runIds, folderId);
      return;
    }
    this.moveToFolderRunIds = runIds;
    this.moveToFolderSelectedId = null;
    this.moveToFolderOpen = true;
  }

  private async _moveImmediate(runIds: string[], folderId: string | null): Promise<void> {
    if (runIds.length === 0) return;
    try {
      if (runIds.length === 1) {
        await moveRunToFolder(runIds[0], folderId);
      } else {
        await batchMoveToFolder(runIds, folderId);
      }
      this.runsStore?.applyFolderMoveLocally(runIds, folderId);
      if (folderId) this.ensureSubFolderExpanded(folderId);
      dbg("layout", "moveToFolder immediate success", { count: runIds.length, folderId });
    } catch (e) {
      dbgWarn("layout", "moveToFolder immediate failed", e);
    }
  }

  async doMoveFromDialog(): Promise<void> {
    const ids = this.moveToFolderRunIds;
    const folderId = this.moveToFolderSelectedId;
    this.moveToFolderOpen = false;
    this.moveToFolderRunIds = [];
    if (ids.length === 0) return;
    try {
      if (ids.length === 1) {
        await moveRunToFolder(ids[0], folderId);
      } else {
        await batchMoveToFolder(ids, folderId);
      }
      this.runsStore?.applyFolderMoveLocally(ids, folderId);
      if (folderId) this.ensureSubFolderExpanded(folderId);
      dbg("layout", "moveToFolder success", { count: ids.length, folderId });
    } catch (e) {
      dbgWarn("layout", "moveToFolder failed", e);
    }
  }

  /** No-op marker for parity with other layout stores; the store is GC'd
   *  with the layout component so no teardown is required. */
  dispose(): void {
    /* no-op */
  }
}

/** Singleton instance for the layout. */
export const sessionFolderStore = new SessionFolderStore();

/** Convenience re-export so callers can `import type { SessionFolderGroup }` here. */
export type { SessionFolderGroup };
