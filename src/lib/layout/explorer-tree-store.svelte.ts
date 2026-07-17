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

/**
 * Per-node load lifecycle:
 *   - idle    : never fetched (children unknown — do not render)
 *   - loading : IPC in flight
 *   - ready   : children loaded (may be empty)
 *   - error   : IPC failed; loadError holds the reason
 *
 * `loaded` remains for backward compatibility with downstream consumers but
 * is now derived from `loadState === "ready"`.
 */
type NodeLoadState "idle" | "loading" | "ready" | "error";

export interface TreeNode {
  name: string;
  fullPath: string;
  is_dir: boolean;
  size: number;
  expanded: boolean;
  /** @deprecated Prefer loadState === "ready". */
  loaded: boolean;
  children: TreeNode[];
  depth: number;
  loadState: NodeLoadState;
  loadError?: string;
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
    loadState: "idle",
  }));
}

export class ExplorerTreeStore {
  fileTree = $state<TreeNode[]>([]);
  treeLoading = $state<boolean>(false);
  /** Set when the root directory read fails — UI surfaces a retry entry instead of a fake empty list. */
  treeError = $state<string | null>(null);
  explorerSelectedFile = $state<string>("");

  /** Monotonic sequence used to invalidate stale IPC responses. */
  private _treeSeq = 0;
  private _disposed = false;

  async loadRootTree(projectCwd: string): Promise<void> {
    if (this._disposed) return;
    if (!projectCwd) {
      this.fileTree = [];
      this.treeError = null;
      return;
    }
    const seq = ++this._treeSeq;
    this.treeLoading = true;
    this.treeError = null;
    try {
      const listing = await listDirectory(projectCwd, true);
      if (seq !== this._treeSeq) return;
      this.fileTree = entriesToNodes(listing.entries, projectCwd, 0);
      dbg("layout", "file tree loaded", { count: this.fileTree.length });
    } catch (e) {
      if (seq !== this._treeSeq) return;
      // Keep the previous tree intact so the user can still navigate; surface the error
      // so the UI shows a retry entry instead of an empty "no files" placeholder.
      const message = e instanceof Error ? e.message : String(e);
      dbgWarn("layout", "file tree load error", message);
      this.treeError = message;
    } finally {
      if (seq === this._treeSeq) this.treeLoading = false;
    }
  }

  /**
   * Toggle a folder node: lazy-load its children on first expansion,
   * then flip the `expanded` flag. On error, the node keeps `expanded=false`
   * and exposes `loadError` so the UI can offer a retry — it never silently
   * reports an empty directory.
   */
  async toggleFolder(node: TreeNode): Promise<void> {
    if (node.loadState === "idle") {
      node.loadState = "loading";
      node.loadError = undefined;
      try {
        const listing = await listDirectory(node.fullPath, true);
        node.children = entriesToNodes(listing.entries, node.fullPath, node.depth + 1);
        node.loadState = "ready";
        node.loaded = true;
        dbg("layout", "folder loaded", { path: node.fullPath, count: node.children.length });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        dbgWarn("layout", "folder load error", { path: node.fullPath, err: message });
        node.loadError = message;
        node.loadState = "error";
        // Deliberately leave `loaded=false` so legacy callers keep working,
        // and do not flip `expanded` — the UI shows the error in place.
        return;
      }
    } else if (node.loadState === "loading") {
      // Concurrent toggle: ignore second click until the in-flight load finishes.
      return;
    }
    node.expanded = !node.expanded;
  }

  /** Retry a failed folder load: resets the error marker and re-issues the IPC. */
  async retryFolder(node: TreeNode): Promise<void> {
    if (node.loadState !== "error" && node.loadState !== "idle") return;
    node.loadState = "idle";
    node.loadError = undefined;
    await this.toggleFolder(node);
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
    this.treeError = null;
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
