<script lang="ts">
  /**
   * Folder CRUD dialogs: create, rename, delete.
   * Extracted from +layout.svelte to reduce root layout complexity.
   * Move-to-folder stays in layout (has runs[] dependencies).
   */
  import Modal from "$lib/components/Modal.svelte";
  import type { SessionFolder } from "$lib/types";
  import { t } from "$lib/i18n/index.svelte";
  import { createSessionFolder, renameSessionFolder, deleteSessionFolder } from "$lib/api";
  import { normalizeCwd } from "$lib/utils/sidebar-groups";
  import { dbg, dbgWarn } from "$lib/utils/debug";

  interface Props {
    sessionFolders: SessionFolder[];
    projectCwd: string;
    onFoldersChanged: (folders: SessionFolder[]) => void;
    onCascadeDelete?: () => Promise<void>;
  }

  let { sessionFolders, projectCwd, onFoldersChanged, onCascadeDelete }: Props = $props();

  // ── Create folder ──
  let folderCreateOpen = $state(false);
  let folderCreateName = $state("");
  let folderCreateTargetWorkspace = $state<string | null>(null);

  export function openCreateFolder(targetWorkspace?: string | null) {
    folderCreateTargetWorkspace = targetWorkspace ?? null;
    folderCreateOpen = true;
    folderCreateName = "";
  }

  async function doCreateFolder() {
    const name = folderCreateName.trim();
    if (!name) return;
    const target = folderCreateTargetWorkspace;
    const workspaceId =
      target != null && target !== ""
        ? normalizeCwd(target) || target.trim()
        : normalizeCwd(projectCwd) || "default";
    folderCreateOpen = false;
    folderCreateName = "";
    folderCreateTargetWorkspace = null;
    try {
      const folder = await createSessionFolder(name, workspaceId);
      onFoldersChanged([...sessionFolders, folder]);
      dbg("layout", "createFolder success", { id: folder.id, name });
    } catch (e) {
      dbgWarn("layout", "createFolder failed", e);
    }
  }

  // ── Rename folder ──
  let folderRenameOpen = $state(false);
  let folderRenameTarget = $state<SessionFolder | null>(null);
  let folderRenameName = $state("");

  export function openRenameFolder(folder: SessionFolder) {
    folderRenameTarget = folder;
    folderRenameName = folder.name;
    folderRenameOpen = true;
  }

  async function doRenameFolder() {
    const target = folderRenameTarget;
    const newName = folderRenameName.trim();
    if (!target || !newName) return;
    folderRenameOpen = false;
    folderRenameTarget = null;
    try {
      await renameSessionFolder(target.id, newName);
      onFoldersChanged(
        sessionFolders.map((f) => (f.id === target.id ? { ...f, name: newName } : f)),
      );
      dbg("layout", "renameFolder success", { id: target.id, newName });
    } catch (e) {
      dbgWarn("layout", "renameFolder failed", e);
    }
  }

  // ── Delete folder ──
  let folderDeleteOpen = $state(false);
  let folderDeleteTarget = $state<SessionFolder | null>(null);

  export function openDeleteFolder(folder: SessionFolder) {
    folderDeleteTarget = folder;
    folderDeleteOpen = true;
  }

  async function doDeleteFolder(cascade: boolean) {
    const target = folderDeleteTarget;
    folderDeleteOpen = false;
    folderDeleteTarget = null;
    if (!target) return;
    try {
      await deleteSessionFolder(target.id, cascade);
      onFoldersChanged(sessionFolders.filter((f) => f.id !== target.id));
      if (cascade && onCascadeDelete) {
        await onCascadeDelete();
      }
      dbg("layout", "deleteFolder success", { id: target.id, cascade });
    } catch (e) {
      dbgWarn("layout", "deleteFolder failed", e);
    }
  }

  // Reset workspace target when create dialog closes
  $effect(() => {
    if (!folderCreateOpen) folderCreateTargetWorkspace = null;
  });
</script>

<!-- Create folder dialog -->
<Modal bind:open={folderCreateOpen} title={t("sidebar_createFolder")}>
  <p class="text-sm text-muted-foreground mb-3">{t("sidebar_createFolderDesc")}</p>
  <input
    type="text"
    class="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring mb-4"
    placeholder={t("sidebar_folderNamePlaceholder")}
    bind:value={folderCreateName}
    onkeydown={(e) => e.key === "Enter" && doCreateFolder()}
    autofocus
  />
  <div class="flex justify-end gap-2">
    <button
      class="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors"
      onclick={() => {
        folderCreateOpen = false;
        folderCreateName = "";
        folderCreateTargetWorkspace = null;
      }}
    >
      {t("sidebar_deleteCancel")}
    </button>
    <button
      class="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      onclick={doCreateFolder}
    >
      {t("sidebar_createFolderOk")}
    </button>
  </div>
</Modal>

<!-- Rename folder dialog -->
<Modal bind:open={folderRenameOpen} title={t("sidebar_renameFolder")}>
  <input
    type="text"
    class="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring mb-4"
    bind:value={folderRenameName}
    onkeydown={(e) => e.key === "Enter" && doRenameFolder()}
    autofocus
  />
  <div class="flex justify-end gap-2">
    <button
      class="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors"
      onclick={() => {
        folderRenameOpen = false;
        folderRenameTarget = null;
      }}
    >
      {t("sidebar_deleteCancel")}
    </button>
    <button
      class="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      onclick={doRenameFolder}
    >
      {t("sidebar_renameFolderOk")}
    </button>
  </div>
</Modal>

<!-- Delete folder dialog -->
<Modal bind:open={folderDeleteOpen} title={t("sidebar_deleteFolder")}>
  <p class="text-sm text-muted-foreground mb-4">
    {t("sidebar_deleteFolderDesc", { name: folderDeleteTarget?.name ?? "" })}
  </p>
  <div class="flex justify-end gap-2">
    <button
      class="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors"
      onclick={() => {
        folderDeleteOpen = false;
        folderDeleteTarget = null;
      }}
    >
      {t("sidebar_deleteCancel")}
    </button>
    <button
      class="px-3 py-1.5 text-sm rounded-md border border-orange-500 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950 transition-colors"
      onclick={() => doDeleteFolder(false)}
    >
      {t("sidebar_deleteFolderKeep")}
    </button>
    <button
      class="px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
      onclick={() => doDeleteFolder(true)}
    >
      {t("sidebar_deleteFolderCascade")}
    </button>
  </div>
</Modal>
