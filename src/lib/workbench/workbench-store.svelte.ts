/**
 * Workbench state — Svelte 5 runes only.
 *
 * TODO(workspace): Wire the project list to `workspacesStore.list` (which is
 * already populated by `+layout.svelte` from `enrichedProjectFolders`). Today
 * the store boots from a mock so the prototype renders without backend data.
 * Search for `TODO(workspace):` in `workbench-mock-data.ts` for the data
 * source swap.
 *
 * Architecture notes:
 *   - Single store, scoped to the workbench view. Page and child components
 *     read it via the exported `workbenchStore` instance.
 *   - Cross-component state (selected project, message log, draft) lives here
 *     to avoid prop drilling; the page only passes `onSelect` callbacks when
 *     child components need to mutate.
 *   - Message dispatch currently goes through the mock. When the backend
 *     lands, replace `dispatchMessage()` with an `api.dispatchProjectMessage`
 *     call (search for the same `TODO(workspace):` prefix).
 */

import {
  mockProjectList,
  mockProjectSessions,
  mockDispatchProjectMessage,
  type WorkbenchProjectSummary,
  type WorkbenchProjectSession,
  type WorkbenchProjectMessage,
} from "./workbench-mock-data";

class WorkbenchStore {
  projects: WorkbenchProjectSummary[] = $state(mockProjectList());
  selectedProjectId: string = $state(mockProjectList()[0]?.id ?? "");

  // Cached per-project session list. Populated lazily when a project is
  // selected; cleared when the selection changes so the UI can show a
  // loading state on the next selection.
  sessionsByProject: Record<string, WorkbenchProjectSession[]> = $state({});
  sessionsLoadingFor: string = $state("");

  // Per-project message thread for the placeholder project chat.
  messagesByProject: Record<string, WorkbenchProjectMessage[]> = $state({});
  draftByProject: Record<string, string> = $state({});
  dispatching: boolean = $state(false);

  selectedProject = $derived(this.projects.find((p) => p.id === this.selectedProjectId) ?? null);

  selectedSessions = $derived(
    this.selectedProjectId ? (this.sessionsByProject[this.selectedProjectId] ?? []) : [],
  );

  selectedMessages = $derived(
    this.selectedProjectId ? (this.messagesByProject[this.selectedProjectId] ?? []) : [],
  );

  selectedDraft = $derived(
    this.selectedProjectId ? (this.draftByProject[this.selectedProjectId] ?? "") : "",
  );

  selectProject(projectId: string): void {
    if (projectId === this.selectedProjectId) return;
    this.selectedProjectId = projectId;
    void this.loadSessionsFor(projectId);
  }

  setDraft(projectId: string, value: string): void {
    this.draftByProject = { ...this.draftByProject, [projectId]: value };
  }

  async loadSessionsFor(projectId: string): Promise<void> {
    if (!projectId) return;
    if (this.sessionsByProject[projectId]) return;
    this.sessionsLoadingFor = projectId;
    // TODO(workspace): await api.listRuns({ cwd }) instead of the mock.
    const sessions = await Promise.resolve(mockProjectSessions(projectId));
    this.sessionsByProject = { ...this.sessionsByProject, [projectId]: sessions };
    if (this.sessionsLoadingFor === projectId) {
      this.sessionsLoadingFor = "";
    }
  }

  async sendMessage(projectId: string, prompt: string): Promise<void> {
    const text = prompt.trim();
    if (!text || this.dispatching) return;
    const userMessage: WorkbenchProjectMessage = {
      id: `msg-${Date.now()}-user`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    const existing = this.messagesByProject[projectId] ?? [];
    this.messagesByProject = {
      ...this.messagesByProject,
      [projectId]: [...existing, userMessage],
    };
    this.setDraft(projectId, "");
    this.dispatching = true;
    try {
      // TODO(workspace): replace with api.dispatchProjectMessage.
      const reply = await mockDispatchProjectMessage(projectId, text);
      this.messagesByProject = {
        ...this.messagesByProject,
        [projectId]: [...(this.messagesByProject[projectId] ?? []), reply],
      };
    } finally {
      this.dispatching = false;
    }
  }
}

export const workbenchStore = new WorkbenchStore();
