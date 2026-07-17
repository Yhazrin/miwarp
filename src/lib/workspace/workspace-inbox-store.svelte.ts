import { getGitSummary, listRunsLite } from "$lib/api";
import type { TaskRun } from "$lib/types";
import type { WorkspaceGitSnapshot } from "$lib/types/workspace";
import { dbgWarn } from "$lib/utils/debug";
import { EVT_RUNS_CHANGED } from "$lib/utils/bus-events";
import { normalizeCwd } from "$lib/utils/sidebar-groups";

const GIT_CACHE_TTL_MS = 5 * 60 * 1000;

function emptyGitSnapshot(loading = false): WorkspaceGitSnapshot {
  return {
    branch: "",
    changedFiles: 0,
    isClean: true,
    loading,
    error: null,
  };
}

export class WorkspaceInboxStore {
  runs = $state<TaskRun[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  selectedCwd = $state("");
  gitByCwd = $state<Record<string, WorkspaceGitSnapshot>>({});

  private runsInFlight: Promise<void> | null = null;
  private gitInFlight = new Map<string, Promise<void>>();
  private gitLoadedAt = new Map<string, number>();
  private runsListener: (() => void) | null = null;

  init(): void {
    if (this.runsListener) return;
    this.runsListener = () => {
      void this.refreshRuns();
    };
    window.addEventListener(EVT_RUNS_CHANGED, this.runsListener);
  }

  dispose(): void {
    if (!this.runsListener) return;
    window.removeEventListener(EVT_RUNS_CHANGED, this.runsListener);
    this.runsListener = null;
  }

  refreshRuns(): Promise<void> {
    if (this.runsInFlight) return this.runsInFlight;
    this.runsInFlight = this.performRefreshRuns();
    return this.runsInFlight.finally(() => {
      this.runsInFlight = null;
    });
  }

  private async performRefreshRuns(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.runs = await listRunsLite();
    } catch (error) {
      dbgWarn("workspace-inbox-store", "refreshRuns failed", error);
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }
  }

  selectCwd(cwd: string): void {
    this.selectedCwd = normalizeCwd(cwd);
  }

  gitSnapshot(cwd: string): WorkspaceGitSnapshot | null {
    const key = normalizeCwd(cwd);
    if (!key) return null;
    return this.gitByCwd[key] ?? null;
  }

  ensureGitSummary(cwd: string): Promise<void> {
    const key = normalizeCwd(cwd);
    if (!key) return Promise.resolve();

    const cachedAt = this.gitLoadedAt.get(key);
    if (cachedAt && Date.now() - cachedAt < GIT_CACHE_TTL_MS) {
      const snapshot = this.gitByCwd[key];
      if (snapshot && !snapshot.loading && !snapshot.error) {
        return Promise.resolve();
      }
    }

    const inFlight = this.gitInFlight.get(key);
    if (inFlight) return inFlight;

    const promise = this.loadGitSummary(key);
    this.gitInFlight.set(key, promise);
    return promise.finally(() => {
      this.gitInFlight.delete(key);
    });
  }

  private async loadGitSummary(cwd: string): Promise<void> {
    this.gitByCwd = {
      ...this.gitByCwd,
      [cwd]: { ...emptyGitSnapshot(true), loading: true },
    };

    try {
      const summary = await getGitSummary(cwd);
      this.gitByCwd = {
        ...this.gitByCwd,
        [cwd]: {
          branch: summary.branch ?? "",
          changedFiles: summary.total_files ?? summary.files?.length ?? 0,
          isClean: (summary.total_files ?? summary.files?.length ?? 0) === 0,
          loading: false,
          error: null,
        },
      };
      this.gitLoadedAt.set(cwd, Date.now());
    } catch (error) {
      dbgWarn("workspace-inbox-store", "getGitSummary failed", { cwd, error });
      this.gitByCwd = {
        ...this.gitByCwd,
        [cwd]: {
          ...emptyGitSnapshot(false),
          error: error instanceof Error ? error.message : String(error),
        },
      };
      this.gitLoadedAt.set(cwd, Date.now());
    }
  }
}

const workspaceInboxStore = new WorkspaceInboxStore();
