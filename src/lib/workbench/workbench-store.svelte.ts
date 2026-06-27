import * as api from "$lib/api";
import type { TaskRun } from "$lib/types";
import type { WorkspaceOption } from "$lib/stores/workspaces-store.svelte";
import { normalizeCwd } from "$lib/utils/sidebar-groups";

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
  activeRunByProject: Record<string, string> = $state({});
  private workspaceOptions: WorkspaceOption[] = [];

  selectedProject = $derived(this.projects.find((p) => p.id === this.selectedProjectId) ?? null);

  selectedSessions = $derived(
    this.selectedProject
      ? this.allRuns
          .filter((run) => runProjectCwd(run) === this.selectedProject?.cwd)
          .sort((a, b) => compareIsoDesc(runActivityAt(a), runActivityAt(b)))
          .map(mapRunToSession)
      : [],
  );

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
    this.allRuns.filter(
      (run) => run.status === "waiting_input" || run.status === "waiting_approval",
    ).length,
  );

  selectProject(projectId: string): void {
    if (projectId === this.selectedProjectId) return;
    this.selectedProjectId = projectId;
    this.persistSelectedProject();
  }

  setActiveRun(projectId: string, runId: string): void {
    if (!projectId || !runId) return;
    this.activeRunByProject = { ...this.activeRunByProject, [projectId]: runId };
    this.persistActiveRuns();
  }

  async refresh(
    workspaces?: WorkspaceOption[],
    /** v1.0.10 perf: pass the runs already loaded by the layout to avoid a
     *  redundant list_runs_lite IPC when both the sidebar and the workbench
     *  are mounted (cold start). Falls back to the IPC when undefined. */
    preloadedRuns?: TaskRun[],
  ): Promise<void> {
    this.restorePersistedState();
    if (workspaces) this.workspaceOptions = workspaces;
    this.loading = true;
    this.error = "";
    try {
      const runs =
        preloadedRuns && preloadedRuns.length > 0 ? preloadedRuns : await api.listRunsLite();
      this.allRuns = runs;
      this.projects = this.buildProjects(this.workspaceOptions, runs);
      this.syncActiveRuns();
      if (!this.projects.some((project) => project.id === this.selectedProjectId)) {
        this.selectedProjectId = this.projects[0]?.id ?? "";
        this.persistSelectedProject();
      }
    } catch (e) {
      this.error = String(e);
      this.projects = this.buildProjects(this.workspaceOptions, this.allRuns);
    } finally {
      this.loading = false;
    }
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
