import * as api from "$lib/api";
import { getTransport } from "$lib/transport";
import { attentionQueueStore } from "$lib/stores/attention-queue-store.svelte";
import { sessionStore } from "$lib/stores";
import type { AttentionItem } from "$lib/types/attention-queue";
import type { TaskRun } from "$lib/types";
import type { WorkspaceOption } from "$lib/stores/workspaces-store.svelte";
import { normalizeCwd } from "$lib/utils/sidebar-groups";
import { EVT_RUNS_CHANGED } from "$lib/utils/bus-events";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { workbenchSessionController } from "./workbench-session-controller";

const LS_SELECTED_PROJECT_ID = "ocv:workbench:selected-project-id";
const LS_ACTIVE_RUNS_BY_PROJECT = "ocv:workbench:active-runs-by-project";

export interface WorkbenchProjectSummary {
  id: string;
  cwd: string;
  label: string;
  description: string;
  sessionCount: number;
  lastActiveAt: string | null;
  status: "active" | "idle" | "stale";
}

export interface WorkbenchProjectSession {
  id: string;
  title: string;
  agent: string;
  status: TaskRun["status"];
  startedAt: string;
  preview: string;
  surface: TaskRun["run_surface"];
}

function projectIdFromCwd(cwd: string): string {
  return `cwd:${normalizeCwd(cwd) || cwd}`;
}

function basename(path: string): string {
  const normalized = normalizeCwd(path) || path;
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? normalized;
}

function runActivityAt(run: TaskRun): string {
  return run.last_activity_at ?? run.ended_at ?? run.started_at;
}

function compareIsoDesc(a: string | null, b: string | null): number {
  return new Date(b ?? 0).getTime() - new Date(a ?? 0).getTime();
}

function isActiveRun(run: TaskRun): boolean {
  return (
    run.status === "running" ||
    run.status === "pending" ||
    run.status === "waiting_input" ||
    run.status === "waiting_approval"
  );
}

function isProjectDeskRun(run: TaskRun): boolean {
  return run.run_surface === "project_desk";
}

export function runProjectCwd(run: TaskRun): string {
  return normalizeCwd(run.parent_cwd ?? run.cwd);
}

function projectStatus(
  runs: TaskRun[],
  lastActiveAt: string | null,
): WorkbenchProjectSummary["status"] {
  if (runs.some(isActiveRun)) return "active";
  if (!lastActiveAt) return "stale";
  const ageMs = Date.now() - new Date(lastActiveAt).getTime();
  return ageMs < 1000 * 60 * 60 * 24 ? "idle" : "stale";
}

function mapRunToSession(run: TaskRun): WorkbenchProjectSession {
  return {
    id: run.id,
    title: run.name || run.prompt || run.last_message_preview || run.id,
    agent: run.agent,
    status: run.status,
    startedAt: run.started_at,
    preview: run.last_message_preview || run.prompt || "",
    surface: run.run_surface,
  };
}

function canUseLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function readJson<T>(key: string, fallback: T): T {
  if (!canUseLocalStorage()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (!canUseLocalStorage()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Non-critical: project desk still works without persistence.
  }
}

function readString(key: string): string {
  if (!canUseLocalStorage()) return "";
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeString(key: string, value: string): void {
  if (!canUseLocalStorage()) return;
  try {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Non-critical: project desk still works without persistence.
  }
}

class WorkbenchStore {
  projects: WorkbenchProjectSummary[] = $state([]);
  selectedProjectId: string = $state("");
  allRuns: TaskRun[] = $state([]);
  loading: boolean = $state(false);
  error: string = $state("");
  /** P2-17: epoch ms of the last successful refresh, so the error banner can
   *  render a relative timestamp + a retry button without a separate IPC. */
  lastRefreshAt: number = $state(0);
  /** P2-17: convenience derived for sidebar / hero to know if the workbench
   *  has ever successfully loaded. */
  hasLoadedOnce = $derived(this.lastRefreshAt > 0);

  /** P2-17: re-run refresh() with the same args as the last call so the
   *  "Retry" button on the error banner doesn't need to know about
   *  preload / workspace plumbing. */
  async retry(): Promise<void> {
    return this.refresh(this.workspaceOptions, undefined);
  }
  activeRunByProject: Record<string, string> = $state({});
  private workspaceOptions: WorkspaceOption[] = [];

  /**
   * P0-3: subscribe to backend run changes so the workbench reacts to
   * status updates without manual refresh. The store also listens to
   * `ocv:runs-changed` (see `subscribeToBusEvents`) — the transport
   * subscription is the authoritative path; the bus event covers the
   * window where the transport event is dropped (e.g. layout reload).
   */
  private transportUnlisten: (() => void) | null = null;
  private busEventUnlisten: (() => void) | null = null;
  /** Single-flight generation token for refresh() — bumped on each refresh. */
  private refreshGeneration = 0;

  selectedProject = $derived(this.projects.find((p) => p.id === this.selectedProjectId) ?? null);

  /** Project-scoped runs for the selected project, sorted by most recent activity.
   *  Shared by Hero / Chat / ControlPanel so we filter + sort once per refresh
   *  instead of three times across components. */
  selectedProjectRuns = $derived(
    this.selectedProject
      ? this.allRuns
          .filter((run) => runProjectCwd(run) === this.selectedProject?.cwd)
          .sort((a, b) => compareIsoDesc(runActivityAt(a), runActivityAt(b)))
      : ([] as TaskRun[]),
  );

  selectedSessions = $derived(this.selectedProjectRuns.map(mapRunToSession));

  selectedActiveRunId = $derived(
    this.selectedProjectId ? (this.activeRunByProject[this.selectedProjectId] ?? "") : "",
  );

  totalSessionCount = $derived(
    this.projects.reduce((sum, project) => sum + project.sessionCount, 0),
  );

  activeProjectCount = $derived(
    this.projects.filter((project) => project.status === "active").length,
  );

  attentionRunCount = $derived(
    // P1-6: source-of-truth is now AttentionQueueStore, not run.status.
    // The Rust RunStatus enum doesn't have waiting_input / waiting_approval —
    // it only knows "running" / "pending" / "completed" / "failed". The
    // attention queue is what surfaces "agent needs user input" reliably.
    this.attentionItemsForActiveProject().filter(
      (item) => item.status === "open" || item.status === "acknowledged",
    ).length,
  );

  /**
   * P1-6: derive attention items for the selected project's active runs.
   * Falls back to [] when the queue hasn't been loaded yet (cold start)
   * so the UI doesn't crash before the first hydrate.
   */
  attentionItemsForProject(projectId: string): AttentionItem[] {
    const project = this.projects.find((p) => p.id === projectId);
    if (!project) return [];
    const projectRunIds = new Set(
      this.allRuns.filter((run) => runProjectCwd(run) === project.cwd).map((run) => run.id),
    );
    const snapshot = attentionQueueStore.snapshot;
    if (!snapshot) return [];
    return snapshot.items.filter((item) => item.run_id != null && projectRunIds.has(item.run_id));
  }

  attentionItemsForActiveProject(): AttentionItem[] {
    return this.selectedProjectId ? this.attentionItemsForProject(this.selectedProjectId) : [];
  }

  /** P1-6: ensure the attention queue is hydrated. Idempotent. */
  async ensureAttentionLoaded(): Promise<void> {
    if (!attentionQueueStore.snapshot) {
      await attentionQueueStore.loadSnapshot();
    }
    await attentionQueueStore.subscribe();
  }

  /**
   * P1-11: lite IPC omits `last_activity_at` / `message_count` /
   * `last_message_preview`. Patch from the in-memory SessionStore run when
   * available so the workbench sidebar doesn't show "—" for the active
   * conversation's message count.
   */
  private patchLiteRuns(runs: TaskRun[]): TaskRun[] {
    const live = sessionStore.run;
    if (!live) return runs;
    let touched = false;
    const patched = runs.map((run) => {
      if (run.id !== live.id) return run;
      if (
        run.message_count != null &&
        run.last_activity_at != null &&
        run.last_message_preview != null
      ) {
        return run;
      }
      touched = true;
      return {
        ...run,
        message_count: run.message_count ?? live.message_count,
        last_activity_at: run.last_activity_at ?? live.last_activity_at ?? run.started_at,
        last_message_preview: run.last_message_preview ?? live.last_message_preview,
      };
    });
    return touched ? patched : runs;
  }

  /**
   * P0-1: select a project via the shared controller so the underlying
   * SessionStore / EventMiddleware subscription is swapped atomically.
   * Returns the controller's SelectProjectResult for callers that need
   * to verify the generation captured against the controller's last value.
   */
  async selectProject(projectId: string): Promise<void> {
    const target = this.projects.find((p) => p.id === projectId) ?? null;
    const previousId = this.selectedProjectId;
    if (projectId === previousId && target) {
      // Same project → controller is a no-op for IO; still capture gen.
      await workbenchSessionController.selectProject(target, {
        runs: this.allRuns,
        activeRunByProject: this.activeRunByProject,
        currentProjectId: previousId,
      });
      return;
    }
    const result = await workbenchSessionController.selectProject(target, {
      runs: this.allRuns,
      activeRunByProject: this.activeRunByProject,
      currentProjectId: previousId,
    });
    if (workbenchSessionController.generation !== result.generation) {
      // A newer selectProject call won the race — abort before mutating state.
      dbg("workbench", "selectProject: stale generation, abort", {
        result: result.generation,
        current: workbenchSessionController.generation,
      });
      return;
    }
    this.selectedProjectId = result.projectId;
    if (result.activeRunId) {
      this.activeRunByProject = {
        ...this.activeRunByProject,
        [result.projectId]: result.activeRunId,
      };
      this.persistActiveRuns();
    }
    this.persistSelectedProject();
  }

  /**
   * P0-1 helper for "release ownership" — used by callers that need to
   * drop the current SessionStore binding (e.g. an empty chat path that
   * wants to clear the active run before sending a new message).
   */
  async releaseSessionOwnership(): Promise<void> {
    const currentRunId = this.selectedProjectId
      ? (this.activeRunByProject[this.selectedProjectId] ?? "")
      : "";
    await workbenchSessionController.releaseSessionOwnership(currentRunId);
  }

  setActiveRun(projectId: string, runId: string): void {
    if (!projectId || !runId) return;
    if (this.activeRunByProject[projectId] === runId) return;
    this.activeRunByProject = { ...this.activeRunByProject, [projectId]: runId };
    this.persistActiveRuns();
    // When the user explicitly switches active run, swap SessionStore
    // ownership so a /workbench → chat transition picks up the right run.
    void workbenchSessionController.swapSessionOwnership(
      this.activeRunByProject[projectId] ?? "",
      runId,
    );
  }

  async refresh(
    workspaces?: WorkspaceOption[],
    /** v1.0.10 perf: pass the runs already loaded by the layout to avoid a
     *  redundant list_runs_lite IPC when both the sidebar and the workbench
     *  are mounted (cold start). Falls back to the IPC when undefined.
     *
     *  P1-11: prefer `listRuns()` when we have to call out so the workbench
     *  sees `last_activity_at` / `message_count` / `last_message_preview`.
     *  `listRunsLite()` deliberately returns None for those fields — fine for
     *  pickers, but the workbench sidebar shows recency + message counts.
     *  Preloaded runs from the layout come from the same `list_runs_lite`
     *  IPC, so we patch missing fields with derived values below.
     */
    preloadedRuns?: TaskRun[],
  ): Promise<void> {
    // P0-5: capture a generation token. If a later refresh starts (and
    // bumps refreshGeneration) before this one finishes its async IPC,
    // we drop the result rather than racing the swap.
    const myGen = ++this.refreshGeneration;
    this.restorePersistedState();
    if (workspaces) this.workspaceOptions = workspaces;
    this.loading = true;
    this.error = "";
    this.lastRefreshAt = Date.now();
    try {
      let runs: TaskRun[];
      if (preloadedRuns && preloadedRuns.length > 0) {
        runs = preloadedRuns;
      } else {
        // P1-11: prefer the full IPC so message counts / recency are accurate.
        try {
          runs = await api.listRuns();
        } catch (fullErr) {
          dbgWarn("workbench", "listRuns failed, falling back to lite", fullErr);
          // Lite still produces the recency sort and IDs; the project
          // sidebar will show "—" for message count instead of a number.
          runs = await api.listRunsLite();
        }
      }
      // P1-11 fallback: lite runs have None last_activity_at / message_count.
      // For runs that are currently owned by a live SessionStore, fill from
      // the in-memory run so the sidebar at least shows the live message
      // count instead of "—".
      runs = this.patchLiteRuns(runs);
      if (myGen !== this.refreshGeneration) {
        dbg("workbench", "refresh: stale generation, dropping result", {
          myGen,
          current: this.refreshGeneration,
        });
        return;
      }
      this.allRuns = runs;
      this.projects = this.buildProjects(this.workspaceOptions, runs);
      this.syncActiveRuns();
      if (!this.projects.some((project) => project.id === this.selectedProjectId)) {
        this.selectedProjectId = this.projects[0]?.id ?? "";
        this.persistSelectedProject();
      }
    } catch (e) {
      if (myGen !== this.refreshGeneration) return;
      this.error = String(e);
      this.projects = this.buildProjects(this.workspaceOptions, this.allRuns);
    } finally {
      if (myGen === this.refreshGeneration) this.loading = false;
    }
  }

  /**
   * P0-3: start listening to backend run changes. Safe to call multiple
   * times — both subscriptions are registered at most once.
   */
  async subscribeToBusEvents(): Promise<void> {
    if (this.transportUnlisten && this.busEventUnlisten) return;
    if (!this.transportUnlisten) {
      try {
        const transport = getTransport();
        this.transportUnlisten = await transport.listen<Record<string, unknown>>(
          "ocv:status-changed",
          () => {
            dbg("workbench", "ocv:status-changed → refresh");
            void this.refresh(this.workspaceOptions);
          },
        );
      } catch (e) {
        dbg("workbench", "subscribeToBusEvents: transport listen failed", String(e));
        this.transportUnlisten = null;
      }
    }
    if (!this.busEventUnlisten) {
      const handler = () => {
        dbg("workbench", "EVT_RUNS_CHANGED → refresh");
        void this.refresh(this.workspaceOptions);
      };
      window.addEventListener(EVT_RUNS_CHANGED, handler);
      this.busEventUnlisten = () => window.removeEventListener(EVT_RUNS_CHANGED, handler);
    }
  }

  /** Reverse of {@link subscribeToBusEvents} — used during teardown. */
  unsubscribeFromBusEvents(): void {
    this.transportUnlisten?.();
    this.transportUnlisten = null;
    this.busEventUnlisten?.();
    this.busEventUnlisten = null;
  }

  private buildProjects(workspaces: WorkspaceOption[], runs: TaskRun[]): WorkbenchProjectSummary[] {
    const workspaceByCwd = new Map<string, WorkspaceOption>();
    for (const workspace of workspaces) {
      const cwd = normalizeCwd(workspace.cwd);
      if (!cwd || workspace.isUncategorized) continue;
      workspaceByCwd.set(cwd, { ...workspace, cwd });
    }

    const runsByCwd = new Map<string, TaskRun[]>();
    for (const run of runs) {
      const cwd = runProjectCwd(run);
      if (!cwd) continue;
      const existing = runsByCwd.get(cwd) ?? [];
      existing.push(run);
      runsByCwd.set(cwd, existing);
    }

    const cwds = new Set([...workspaceByCwd.keys(), ...runsByCwd.keys()]);
    return Array.from(cwds)
      .map((cwd) => {
        const workspace = workspaceByCwd.get(cwd);
        const projectRuns = runsByCwd.get(cwd) ?? [];
        const lastActiveAt =
          projectRuns.map(runActivityAt).sort((a, b) => compareIsoDesc(a, b))[0] ?? null;
        return {
          id: projectIdFromCwd(cwd),
          cwd,
          label: workspace?.label || basename(cwd),
          description: cwd,
          sessionCount: projectRuns.length,
          lastActiveAt,
          status: projectStatus(projectRuns, lastActiveAt),
        };
      })
      .sort((a, b) => {
        const activity = compareIsoDesc(a.lastActiveAt, b.lastActiveAt);
        return activity !== 0 ? activity : a.label.localeCompare(b.label);
      });
  }

  private syncActiveRuns(): void {
    const next = { ...this.activeRunByProject };
    for (const project of this.projects) {
      const projectRuns = this.allRuns
        .filter((run) => runProjectCwd(run) === project.cwd)
        .sort((a, b) => compareIsoDesc(runActivityAt(a), runActivityAt(b)));

      const currentId = next[project.id];
      const currentStillBelongs = projectRuns.some(
        (run) => run.id === currentId && isProjectDeskRun(run),
      );
      if (currentStillBelongs) continue;

      const nextRun =
        projectRuns.find((run) => isProjectDeskRun(run) && isActiveRun(run)) ??
        projectRuns.find(isProjectDeskRun);

      if (nextRun) {
        next[project.id] = nextRun.id;
      } else {
        delete next[project.id];
      }
    }
    this.activeRunByProject = next;
    this.persistActiveRuns();
  }

  private restorePersistedState(): void {
    if (!this.selectedProjectId) {
      this.selectedProjectId = readString(LS_SELECTED_PROJECT_ID);
    }
    if (Object.keys(this.activeRunByProject).length === 0) {
      this.activeRunByProject = readJson<Record<string, string>>(LS_ACTIVE_RUNS_BY_PROJECT, {});
    }
  }

  private persistSelectedProject(): void {
    writeString(LS_SELECTED_PROJECT_ID, this.selectedProjectId);
  }

  private persistActiveRuns(): void {
    writeJson(LS_ACTIVE_RUNS_BY_PROJECT, this.activeRunByProject);
  }
}

export const workbenchStore = new WorkbenchStore();

// Re-export so unit tests can instantiate a fresh store without going
// through the singleton. The singleton stays the default for app code.
export { WorkbenchStore as WorkbenchStoreClass };
