/** Sidebar-derived workspace list — single source for any UI that needs
 *  to let the user pick a cwd (welcome screen, folder picker, etc.).
 *  Written by +layout.svelte from `enrichedProjectFolders`; read by chat +page.svelte. */
export interface WorkspaceOption {
  /** Absolute path; "" means the synthetic "uncategorized" bucket. */
  cwd: string;
  label: string;
  isUncategorized: boolean;
}

class WorkspacesStore {
  list: WorkspaceOption[] = $state([]);
}

export const workspacesStore = new WorkspacesStore();
