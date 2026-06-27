/**
 * Workbench mock data — prototype only.
 *
 * TODO(workspace): Replace every helper in this file with real backend calls
 * once the project-level chat backend is implemented. Search for the
 * `TODO(workspace):` prefix to find all integration points.
 *
 * Future data sources (search for the keywords to wire them in):
 *   - Project list: prefer `workspacesStore.list` (already wired by +layout.svelte
 *     from `enrichedProjectFolders`) over these mocks once we settle on a stable
 *     shape. If we need a dedicated command, add `api.listProjects()` that wraps
 *     `listRuns` server-side and groups by `cwd` / `parent_cwd`.
 *   - Project sessions: `api.listRuns({ cwd: projectCwd })` (see
 *     `src-tauri/src/storage/runs.rs`). Replace `mockProjectSessions()`.
 *   - Project-level dispatch: introduce `api.dispatchProjectMessage({
 *     projectId, prompt })` and have it open a new run with
 *     `execution_path = "project"` plus a back-reference to the project id.
 *     Replace `mockDispatchProjectMessage()`.
 */

import type { TaskRun } from "$lib/types";

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
}

export interface WorkbenchProjectMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

const NOW = Date.now();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function isoOffset(deltaMs: number): string {
  return new Date(NOW - deltaMs).toISOString();
}

/**
 * TODO(workspace): Read from `workspacesStore.list` (sidebar-derived) once the
 * shell wires it. For now this returns a small deterministic mock so the UI is
 * never empty during the prototype phase.
 */
export function mockProjectList(): WorkbenchProjectSummary[] {
  return [
    {
      id: "proj-miwarp",
      cwd: "/Users/dev/projects/miwarp",
      label: "MiWarp",
      description: "Tauri v2 desktop shell for AI coding CLIs",
      sessionCount: 12,
      lastActiveAt: isoOffset(8 * MINUTE),
      status: "active",
    },
    {
      id: "proj-design-system",
      cwd: "/Users/dev/projects/design-system",
      label: "Design System",
      description: "Shared component library + tokens",
      sessionCount: 5,
      lastActiveAt: isoOffset(3 * HOUR),
      status: "idle",
    },
    {
      id: "proj-side-quests",
      cwd: "/Users/dev/notes/side-quests",
      label: "Side Quests",
      description: "Sandbox for one-off scripts and prototypes",
      sessionCount: 2,
      lastActiveAt: isoOffset(6 * DAY),
      status: "stale",
    },
  ];
}

/**
 * TODO(workspace): Replace with `api.listRuns({ cwd })` once the backend exposes
 * a project-scoped query. Mapping stays the same: `TaskRun -> WorkbenchProjectSession`.
 */
export function mockProjectSessions(projectId: string): WorkbenchProjectSession[] {
  if (projectId === "proj-miwarp") {
    return [
      {
        id: "run-1",
        title: "Refactor session-store reactivity",
        agent: "claude",
        status: "completed",
        startedAt: isoOffset(8 * MINUTE),
        preview: "Tore apart the legacy $: blocks, kept behaviour identical.",
      },
      {
        id: "run-2",
        title: "Wire split-workspace URL state",
        agent: "claude",
        status: "completed",
        startedAt: isoOffset(2 * HOUR),
        preview: "Added ?split=dual|quad sync, validated roundtrip.",
      },
      {
        id: "run-3",
        title: "Investigate worktree spawn race",
        agent: "codex",
        status: "running",
        startedAt: isoOffset(20 * MINUTE),
        preview: "Suspect a TOCTOU on the .git/worktrees directory lock.",
      },
    ];
  }
  if (projectId === "proj-design-system") {
    return [
      {
        id: "run-ds-1",
        title: "Token audit for surface tokens",
        agent: "claude",
        status: "completed",
        startedAt: isoOffset(3 * HOUR),
        preview: "Found 14 unused tokens, drafted removal PR.",
      },
    ];
  }
  return [];
}

/**
 * TODO(workspace): Replace with `api.dispatchProjectMessage({ projectId, prompt })`
 * returning a real `WorkbenchProjectMessage`. For now the mock just echoes the
 * user prompt after a short delay so the UI can demonstrate the project-level
 * dispatch shape.
 */
export async function mockDispatchProjectMessage(
  projectId: string,
  prompt: string,
): Promise<WorkbenchProjectMessage> {
  await new Promise((resolve) => setTimeout(resolve, 350));
  return {
    id: `msg-${Date.now()}`,
    role: "assistant",
    content: `Project-level dispatch is coming soon. You said: "${prompt}" for project ${projectId}.`,
    createdAt: new Date().toISOString(),
  };
}
