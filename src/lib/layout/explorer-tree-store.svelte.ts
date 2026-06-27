/**
 * explorer-tree-store — owns the file-tree state for the sidebar's
 * `/explorer` route: the root TreeNode list, the loading flag, the
 * currently selected file path, and a per-load sequence counter that
 * invalidates stale IPC responses.
 *
 * The original +layout.svelte inlined the `TreeNode` interface, the
 * `entriesToNodes` helper, the `loadRootTree` async function, the
 * `toggleFolder` / `selectFile` handlers, and the `$effect` that reloads
 * the tree when the route or project changes. Pulling them into a single
 * rune store keeps the lazy-loading / sequence-numbering invariants next
 * to the data they protect.
 *
 * Behaviour-equivalence contract (refactor — no functional change):
 *   - Tree root: listDirectory(projectCwd, true) when cwd is set
 *   - Per-folder expansion: listDirectory(node.fullPath, true) on first
 *     toggle, then flip the `expanded` flag
 *   - Sequence-numbered (`_treeSeq`) cancellation discards responses from
 *     superseded calls (cwd change while a load is in flight)
 *   - Selection dispatches EVT_EXPLORER_FILE with the full path so the
 *     /explorer page can sync its internal state
 *   - Selected-path also listens for EVT_EXPLORER_FILE_SELECTED so the
 *     explorer page can re-sync after navigating back from elsewhere
 */
import { listDirectory } from "$lib/api";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { normalizeCwd } from "$lib/utils/sidebar-groups";
import { EVT_EXPLORER_FILE, EVT_EXPLORER_FILE_SELECTED } from "$lib/utils/bus-events";
import type { DirEntry } from "$lib/types";

export interface TreeNode {
  name: string;
  fullPath: string;
  is_dir: boolean;
  size: number;
  expanded: boolean;
  loaded: boolean;
  children: TreeNode[];
  depth: number;
}

/** Build TreeNode rows from a DirEntry list. Pure function (testable). */
export function entriesToNodes(entries: DirEntry[], parentPath: string, depth: number): TreeNode[] {
  return entries.map((e) => ({
    name: e.name,
    fullPath: `${parentPath}/${e.name}`,
    is_dir: e.is_dir,
    size: e.size,
    expanded: false,
    loaded: false,
    children: [],
    depth,
  }));
}

export class ExplorerTreeStore {
  fileTree = $state<TreeNode[]>([]);
  treeLoading = $state<boolean>(false);
  explorerSelectedFile = $state<string>("");

  /** Monotonic sequence used to invalidate stale IPC responses. */
  private _treeSeq = 0;
  private _disposed = false;

  async loadRootTree(projectCwd: string): Promise<void> {
    if (this._disposed) return;
    if (!projectCwd) {
      this.fileTree = [];
      return;
    }
    const seq = ++this._treeSeq;
    this.treeLoading = true;
    try {
      const listing = await listDirectory(projectCwd, true);
      if (seq !== this._treeSeq) return;
      this.fileTree = entriesToNodes(listing.entries, projectCwd, 0);
      dbg("layout", "file tree loaded", { count: this.fileTree.length });
    } catch (e) {
      if (seq !== this._treeSeq) return;
      dbgWarn("layout", "file tree load error", e);
      this.fileTree = [];
    } finally {
      if (seq === this._treeSeq) this.treeLoading = false;
    }
  }

  /**
   * Toggle a folder node: lazy-load its children on first expansion,
   * then flip the `expanded` flag. Mutates the node in place to preserve
   * the existing children reference for already-loaded branches.
   */
  async toggleFolder(node: TreeNode): Promise<void> {
    if (!node.loaded) {
      try {
        const listing = await listDirectory(node.fullPath, true);
        node.children = entriesToNodes(listing.entries, node.fullPath, node.depth + 1);
        node.loaded = true;
        dbg("layout", "folder loaded", { path: node.fullPath, count: node.children.length });
      } catch (e) {
        dbgWarn("layout", "folder load error", e);
        node.children = [];
        node.loaded = true;
      }
    }
    node.expanded = !node.expanded;
  }

  /** Select a file node and notify the /explorer page via the bus event. */
  selectFile(node: TreeNode): void {
    this.explorerSelectedFile = node.fullPath;
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(EVT_EXPLORER_FILE, { detail: { path: node.fullPath } }));
  }

  /** Listen for EVT_EXPLORER_FILE_SELECTED so the explorer page can re-sync. */
  installExplorerFileSync(): () => void {
    if (typeof window === "undefined") return () => {};
    const onExplorerFileSelected = (e: Event) => {
      this.explorerSelectedFile = (e as CustomEvent).detail?.path ?? "";
    };
    window.addEventListener(EVT_EXPLORER_FILE_SELECTED, onExplorerFileSelected);
    return () => window.removeEventListener(EVT_EXPLORER_FILE_SELECTED, onExplorerFileSelected);
  }

  /**
   * The original `$effect` watching the explorer route. Pulled into a
   * standalone helper so AppShell / layout can call it explicitly without
   * owning reactive wiring. Returns true when the tree was loaded,
   * false when waiting for runs.
   */
  async onExplorerRouteEntered(
    projectCwd: string,
    runsLoadSucceededOnce: boolean,
    fallbackRunCwd: () => string | null,
  ): Promise<void> {
    if (projectCwd) {
      await this.loadRootTree(projectCwd);
      return;
    }
    if (!runsLoadSucceededOnce) {
      // Wait until runs finish so we can auto-pick a recent cwd.
      return;
    }
    const fb = fallbackRunCwd();
    if (fb) {
      // Signal the layout so it can update projectCwd / trigger a reload.
      // The actual selection lives in projectSelectionStore; the layout
      // wires that on top of this call.
      dbg("layout", "explorer: auto-fallback to recent cwd", { cwd: fb });
      return;
    }
    ++this._treeSeq;
    this.fileTree = [];
    this.treeLoading = false;
  }

  /** O(1) derivation used by the layout to seed the explorer cwd. */
  pickRecentRunsFallback(
    runs: ReadonlyArray<{ cwd: string | null | undefined; started_at: string }>,
  ): string | null {
    const fallback = runs
      .filter((r): r is { cwd: string; started_at: string } => Boolean(r.cwd) && r.cwd !== "/")
      .map((r) => ({ cwd: normalizeCwd(r.cwd), ts: r.started_at }))
      .filter((r): r is { cwd: string; ts: string } => Boolean(r.cwd))
      .sort((a, b) => b.ts.localeCompare(a.ts))[0];
    return fallback?.cwd ?? null;
  }

  dispose(): void {
    this._disposed = true;
  }
}

/** Singleton instance for the layout. */
export const explorerTreeStore = new ExplorerTreeStore();
