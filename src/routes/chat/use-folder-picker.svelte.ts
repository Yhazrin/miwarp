/**
 * Folder picker composable for the chat page.
 * Encapsulates folder picker dialog state and workspace creation logic.
 */
import { normalizeCwd } from "$lib/utils/sidebar-groups";
import { t } from "$lib/i18n/index.svelte";
import { getTransport } from "$lib/transport";

export function createFolderPicker(
  getStore: () => { sessionCwd: string },
  setFolderCwdOverride: (v: string) => void,
  openFolderPickerFn: (opts: {
    initialHost?: string | null;
    initialPath?: string;
    hideTargetSelector?: boolean;
  }) => Promise<{ hostName: string | null; path: string } | null>,
) {
  /** Folder picker state — resolves a Promise on confirm/cancel. */
  let folderPickerOpen = $state(false);
  let folderPickerInitialHost = $state<string | null>(null);
  let folderPickerInitialPath = $state("");
  let folderPickerHideTarget = $state(false);
  let folderPickerResolve: ((v: { hostName: string | null; path: string } | null) => void) | null =
    null;

  function openFolderPicker(opts: {
    initialHost?: string | null;
    initialPath?: string;
    hideTargetSelector?: boolean;
  }): Promise<{ hostName: string | null; path: string } | null> {
    folderPickerInitialHost = opts.initialHost ?? null;
    folderPickerInitialPath = opts.initialPath ?? "";
    folderPickerHideTarget = opts.hideTargetSelector ?? false;
    folderPickerOpen = true;
    return new Promise((resolve) => {
      folderPickerResolve = resolve;
    });
  }

  /** Open the system folder picker (Tauri native on desktop, FolderPicker modal
   *  on web) and register the chosen path as a new sidebar workspace. */
  async function addWorkspaceFromPicker() {
    let cwd: string | null = null;
    if (getTransport().isDesktop()) {
      const result = await getTransport().openDialog({
        directory: true,
        multiple: false,
        title: t("chat_addWorkspaceTitle"),
      });
      cwd = typeof result === "string" ? result : null;
    } else {
      const picked = await openFolderPickerFn({ initialHost: null });
      cwd = picked?.path ?? null;
    }
    if (!cwd) return;
    const normalized = normalizeCwd(cwd);
    if (!normalized) return;
    try {
      localStorage.setItem("ocv:project-cwd", normalized);
    } catch {
      // localStorage may fail in restricted contexts
    }
    window.dispatchEvent(new Event("ocv:cwd-changed"));
    setFolderCwdOverride(normalized);
    getStore().sessionCwd = normalized;
  }

  return {
    get folderPickerOpen() { return folderPickerOpen; },
    set folderPickerOpen(v: boolean) { folderPickerOpen = v; },
    get folderPickerInitialHost() { return folderPickerInitialHost; },
    get folderPickerInitialPath() { return folderPickerInitialPath; },
    get folderPickerHideTarget() { return folderPickerHideTarget; },
    get folderPickerResolve() { return folderPickerResolve; },
    set folderPickerResolve(v: typeof folderPickerResolve) { folderPickerResolve = v; },
    openFolderPicker,
    addWorkspaceFromPicker,
  };
}

export type FolderPickerState = ReturnType<typeof createFolderPicker>;
