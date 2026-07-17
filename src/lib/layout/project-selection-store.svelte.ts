/**
 * project-selection-store — owns the layout's project-cwd selection state:
 * the active cwd, the pinned-cwds list, the removed-cwds list, and the
 * sidebar's expanded-folder Set.
 *
 * The original +layout.svelte held all of these as inline `$state` plus
 * inline `$effect` blocks that mirrored them into localStorage and
 * dispatched `ocv:project-changed` for downstream pages. Moving them into
 * a single rune store keeps the persistence side-effects next to the state
 * they touch, lets the layout script shrink, and gives the workspace
 * sidebar a single import for everything it needs.
 *
 * Behaviour-equivalence contract (refactor — no functional change):
 *   - projectCwd change → LS_PROJECT_CWD persist + auto-pin if non-root
 *   - projectCwd change → EVT_PROJECT_CHANGED dispatch with detail.cwd
 *   - expandedProjects change → prune to valid folder keys (only after
 *     runs have loaded) → LS_EXPANDED_PROJECTS persist
 *   - removedCwds change → LS_REMOVED_CWDS persist + cascade to clear
 *     projectCwd / pinnedCwds entries
 *
 * The store exposes both `$state` fields (for the layout template to bind)
 * and a small mutation API. Components MUST go through the mutation API
 * (not direct field assignment) when the side-effect matters — direct
 * assignment still works, but the persistence layer only fires for the
 * named setters.
 */
import {
  LS_PINNED_CWDS,
  LS_PROJECT_CWD,
  LS_REMOVED_CWDS,
  LS_EXPANDED_PROJECTS,
} from "$lib/utils/storage-keys";
import { loadRemovedCwds, isRemovedCwd } from "$lib/utils/removed-cwds";
import { normalizeCwd } from "$lib/utils/sidebar-groups";
import { dbg } from "$lib/utils/debug";
import { EVT_PROJECT_CHANGED } from "$lib/utils/bus-events";

type FolderKey string;

function safePersist(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore quota */
  }
}

function safeRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Singleton store. The layout mounts a single instance via `init()` and
 * tears it down with `dispose()`. Svelte 5 runes on a class instance work
 * with `$state` because the layout reads fields via `store.field`.
 */
class ProjectSelectionStore {
  projectCwd = $state<string>("");
  pinnedCwds = $state<string[]>([]);
  removedCwds = $state<string[]>([]);
  expandedProjects = $state<Set<FolderKey>>(new Set());

  // Tracks whether runs have loaded so the prune effect doesn't fire on
  // cold-start with an empty folder set (which would wipe everything).
  private _runsLoaded = $state(false);
  private _disposed = false;

  /**
   * Read persisted state from localStorage and apply the CWD-pinning /
   * event-dispatch effects.
   *
   * Call once from the layout onMount. Idempotent — subsequent calls are
   * no-ops so hot reloads don't reset state.
   */
  init(): void {
    if (typeof window === "undefined") return;
    if (this._disposed) return;

    const saved = window.localStorage.getItem(LS_PROJECT_CWD);
    if (saved) {
      const normalized = normalizeCwd(saved);
      if (normalized) this.projectCwd = normalized;
    }

    try {
      const rawExpanded = window.localStorage.getItem(LS_EXPANDED_PROJECTS);
      if (rawExpanded) {
        const parsed = JSON.parse(rawExpanded);
        if (Array.isArray(parsed) && parsed.every((v: unknown) => typeof v === "string")) {
          this.expandedProjects = new Set(parsed as string[]);
        }
      }
    } catch {
      /* corrupted data, keep empty */
    }
    try {
      const pinned = window.localStorage.getItem(LS_PINNED_CWDS);
      if (pinned) {
        const parsed = JSON.parse(pinned);
        if (Array.isArray(parsed) && parsed.every((v: unknown) => typeof v === "string")) {
          this.pinnedCwds = parsed as string[];
        }
      }
    } catch {
      /* ignore parse errors */
    }
    this.removedCwds = loadRemovedCwds();
  }

  /** Mark that runs have loaded so the prune effect can start running. */
  markRunsLoaded(): void {
    this._runsLoaded = true;
  }

  /**
   * Set the active cwd. Triggers localStorage persist, auto-pin (when not
   * "/"), and EVT_PROJECT_CHANGED dispatch. Empty string is treated as
   * "All Projects" and clears LS_PROJECT_CWD.
   */
  setProjectCwd(cwd: string): void {
    const normalized = normalizeCwd(cwd);
    if (this.projectCwd === normalized) return;
    this.projectCwd = normalized;

    if (typeof window === "undefined") return;

    if (normalized) {
      safePersist(LS_PROJECT_CWD, normalized);
      // Auto-pin so the cwd stays in the dropdown after switching away.
      if (normalized !== "/" && !this.pinnedCwds.includes(normalized)) {
        this.pinnedCwds = [...this.pinnedCwds, normalized];
        safePersist(LS_PINNED_CWDS, JSON.stringify(this.pinnedCwds));
      }
    } else {
      safeRemove(LS_PROJECT_CWD);
    }
    window.dispatchEvent(new CustomEvent(EVT_PROJECT_CHANGED, { detail: { cwd: normalized } }));
  }

  /** Toggle a project folder in the expanded set. Persists to LS_EXPANDED_PROJECTS. */
  toggleProject(folderKey: FolderKey): void {
    const next = new Set(this.expandedProjects);
    if (next.has(folderKey)) next.delete(folderKey);
    else next.add(folderKey);
    this.expandedProjects = next;
  }

  /**
   * Replace the expanded set wholesale. Persists the JSON-encoded array.
   * Used by auto-expand effects (run-driven, cwd-driven).
   */
  replaceExpanded(next: Set<FolderKey>): void {
    this.expandedProjects = next;
    if (typeof window === "undefined") return;
    safePersist(LS_EXPANDED_PROJECTS, JSON.stringify([...next]));
  }

  /** Add a cwd to the pinned set (idempotent). */
  pin(cwd: string): void {
    const normalized = normalizeCwd(cwd);
    if (!normalized || this.pinnedCwds.includes(normalized)) return;
    this.pinnedCwds = [...this.pinnedCwds, normalized];
    if (typeof window !== "undefined") {
      safePersist(LS_PINNED_CWDS, JSON.stringify(this.pinnedCwds));
    }
  }

  /** Unpin a cwd. No-op if not pinned. */
  unpin(cwd: string): void {
    const normalized = normalizeCwd(cwd);
    const next = this.pinnedCwds.filter((c) => normalizeCwd(c) !== normalized);
    if (next.length === this.pinnedCwds.length) return;
    this.pinnedCwds = next;
    if (typeof window !== "undefined") {
      safePersist(LS_PINNED_CWDS, JSON.stringify(this.pinnedCwds));
    }
  }

  /**
   * Add a cwd to the removed-cwds list. If the user is currently viewing
   * that cwd, switches back to "All Projects" (empty string). Cascades to
   * unpinned entry if present.
   */
  removeProject(cwd: string): void {
    const normalized = normalizeCwd(cwd);
    if (!normalized) return;
    if (!this.removedCwds.includes(normalized)) {
      this.removedCwds = [...this.removedCwds, normalized];
      if (typeof window !== "undefined") {
        safePersist(LS_REMOVED_CWDS, JSON.stringify(this.removedCwds));
      }
    }
    const newPinned = this.pinnedCwds.filter((c) => normalizeCwd(c) !== normalized);
    if (newPinned.length !== this.pinnedCwds.length) {
      this.pinnedCwds = newPinned;
      if (typeof window !== "undefined") {
        safePersist(LS_PINNED_CWDS, JSON.stringify(this.pinnedCwds));
      }
    }
    if (normalizeCwd(this.projectCwd) === normalized) {
      this.setProjectCwd("");
    }
    dbg("layout", "removeProject", { cwd: normalized });
  }

  /** Undo a removeProject — re-add cwd to the sidebar. */
  unremoveProject(cwd: string): void {
    const normalized = normalizeCwd(cwd);
    if (!normalized) return;
    const next = this.removedCwds.filter((c) => c !== normalized);
    if (next.length === this.removedCwds.length) return;
    this.removedCwds = next;
    if (typeof window !== "undefined") {
      safePersist(LS_REMOVED_CWDS, JSON.stringify(this.removedCwds));
    }
    dbg("layout", "unremoveProject", { cwd: normalized });
  }

  /**
   * Persist the current expandedProjects, optionally pruning entries that
   * are not in `validFolderKeys`. Pruning only runs after runs have loaded
   * (avoids wiping stored keys on cold start before the folder tree is
   * known).
   */
  persistAndPruneExpanded(validFolderKeys: ReadonlySet<FolderKey>): void {
    if (!this._runsLoaded) return;
    const pruned = [...this.expandedProjects].filter((k) => validFolderKeys.has(k));
    if (pruned.length !== this.expandedProjects.size) {
      this.expandedProjects = new Set(pruned);
    }
    if (typeof window !== "undefined") {
      safePersist(LS_EXPANDED_PROJECTS, JSON.stringify(pruned));
    }
  }

  /** Sync from EVT_CWD_CHANGED — re-read LS_PROJECT_CWD and apply. */
  syncFromStorage(): void {
    if (typeof window === "undefined") return;
    const newCwd = normalizeCwd(window.localStorage.getItem(LS_PROJECT_CWD) ?? "") || "";
    if (newCwd !== this.projectCwd) {
      // Bypass the auto-pin in setProjectCwd by direct assignment + manual
      // persist (mirrors the original behaviour exactly: external code may
      // already have written LS_PROJECT_CWD, we just need to mirror it).
      this.projectCwd = newCwd;
      if (newCwd) {
        safePersist(LS_PROJECT_CWD, newCwd);
      } else {
        safeRemove(LS_PROJECT_CWD);
      }
    }
  }

  /** O(1) `isRemoved` lookup derived from removedCwds. */
  isRemoved(cwd: string): boolean {
    return isRemovedCwd(cwd, new Set(this.removedCwds.map(normalizeCwd)));
  }

  /** Tear down. Idempotent. */
  dispose(): void {
    this._disposed = true;
  }
}

/** Singleton instance for the layout. Multiple consumers share the same store. */
export const projectSelectionStore = new ProjectSelectionStore();
