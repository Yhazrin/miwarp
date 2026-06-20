<script lang="ts">
  /**
   * SidebarModals — owns the 7 confirm/input dialogs that used to live inline
   * inside `src/routes/+layout.svelte`. State ownership stays with the layout
   * (so handlers can keep touching `runs` / `sessionFolders` / `removedCwds`
   * etc.); this component is a pure presentational host that forwards events
   * back via callback props.
   */
  import Modal from "$lib/components/Modal.svelte";
  import { t } from "$lib/i18n/index.svelte";

  type FolderOption = { id: string; name: string };

  let {
    deleteConfirmOpen = $bindable(false),
    onDeleteSoft,
    onDeleteHard,
    onDeleteCancel,
    batchDeleteConfirmOpen = $bindable(false),
    batchDeleteCount = 0,
    onBatchSoftDelete,
    onBatchHardDelete,
    onBatchDeleteCancel,
    removeProjectConfirmOpen = $bindable(false),
    onRemoveProject,
    onRemoveProjectCancel,
    folderCreateOpen = $bindable(false),
    folderCreateName = $bindable(""),
    onCreateFolder,
    folderRenameOpen = $bindable(false),
    folderRenameName = $bindable(""),
    onRenameFolder,
    folderDeleteOpen = $bindable(false),
    folderDeleteTargetName = "",
    onDeleteFolderKeep,
    onDeleteFolderCascade,
    moveToFolderOpen = $bindable(false),
    moveToFolderCount = 0,
    moveToFolderSelectedId = $bindable<string | null>(null),
    moveToFolderOptions = [] as FolderOption[],
    onMoveToFolder,
  }: {
    deleteConfirmOpen?: boolean;
    onDeleteSoft?: () => void;
    onDeleteHard?: () => void;
    onDeleteCancel?: () => void;
    batchDeleteConfirmOpen?: boolean;
    batchDeleteCount?: number;
    onBatchSoftDelete?: () => void;
    onBatchHardDelete?: () => void;
    onBatchDeleteCancel?: () => void;
    removeProjectConfirmOpen?: boolean;
    onRemoveProject?: () => void;
    onRemoveProjectCancel?: () => void;
    folderCreateOpen?: boolean;
    folderCreateName?: string;
    onCreateFolder?: () => void;
    folderRenameOpen?: boolean;
    folderRenameName?: string;
    onRenameFolder?: () => void;
    folderDeleteOpen?: boolean;
    folderDeleteTargetName?: string;
    onDeleteFolderKeep?: () => void;
    onDeleteFolderCascade?: () => void;
    moveToFolderOpen?: boolean;
    moveToFolderCount?: number;
    moveToFolderSelectedId?: string | null;
    moveToFolderOptions?: FolderOption[];
    onMoveToFolder?: () => void;
  } = $props();

  function focusOnMount(node: HTMLElement) {
    node.focus();
    return {};
  }

  function closeFolderCreate() {
    folderCreateOpen = false;
    folderCreateName = "";
  }

  function closeFolderRename() {
    folderRenameOpen = false;
    folderRenameName = "";
  }

  function closeFolderDelete() {
    folderDeleteOpen = false;
  }

  function closeMoveToFolder() {
    moveToFolderOpen = false;
  }
</script>

<Modal bind:open={deleteConfirmOpen} title={t("sidebar_deleteConfirm")}>
  <p class="text-sm text-muted-foreground mb-4">{t("sidebar_deleteDesc")}</p>
  <div class="flex justify-end gap-2">
    <button
      type="button"
      class="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors"
      onclick={onDeleteCancel}
    >
      {t("sidebar_deleteCancel")}
    </button>
    <button
      type="button"
      class="px-3 py-1.5 text-sm rounded-md border border-miwarp-status-warning text-miwarp-status-warning hover:bg-[hsl(var(--miwarp-status-warning)/0.1)] transition-colors"
      onclick={onDeleteSoft}
    >
      {t("sidebar_softDelete")}
    </button>
    <button
      type="button"
      class="px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
      onclick={onDeleteHard}
    >
      {t("sidebar_hardDelete")}
    </button>
  </div>
</Modal>

<Modal bind:open={batchDeleteConfirmOpen} title={t("sidebar_batchDelete")}>
  <p class="text-sm text-muted-foreground mb-4">
    {t("sidebar_batchDeleteConfirm", { count: String(batchDeleteCount) })}
  </p>
  <div class="flex justify-end gap-2">
    <button
      type="button"
      class="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors"
      onclick={onBatchDeleteCancel}
    >
      {t("sidebar_deleteCancel")}
    </button>
    <button
      type="button"
      class="px-3 py-1.5 text-sm rounded-md border border-miwarp-status-warning text-miwarp-status-warning hover:bg-[hsl(var(--miwarp-status-warning)/0.1)] transition-colors"
      onclick={onBatchSoftDelete}
    >
      {t("sidebar_softDelete")}
    </button>
    <button
      type="button"
      class="px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
      onclick={onBatchHardDelete}
    >
      {t("sidebar_hardDelete")}
    </button>
  </div>
</Modal>

<Modal bind:open={removeProjectConfirmOpen} title={t("sidebar_removeProjectConfirm")}>
  <p class="text-sm text-muted-foreground mb-4">{t("sidebar_removeProjectDesc")}</p>
  <div class="flex justify-end gap-2">
    <button
      type="button"
      class="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors"
      onclick={onRemoveProjectCancel}
    >
      {t("sidebar_deleteCancel")}
    </button>
    <button
      type="button"
      class="px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
      onclick={onRemoveProject}
    >
      {t("sidebar_deleteOk")}
    </button>
  </div>
</Modal>

<Modal bind:open={folderCreateOpen} title={t("sidebar_createFolder")}>
  <p class="text-sm text-muted-foreground mb-3">{t("sidebar_createFolderDesc")}</p>
  <input
    type="text"
    class="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring mb-4"
    placeholder={t("sidebar_folderNamePlaceholder")}
    bind:value={folderCreateName}
    onkeydown={(e) => e.key === "Enter" && onCreateFolder?.()}
    use:focusOnMount
  />
  <div class="flex justify-end gap-2">
    <button
      type="button"
      class="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors"
      onclick={closeFolderCreate}
    >
      {t("sidebar_deleteCancel")}
    </button>
    <button
      type="button"
      class="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      onclick={onCreateFolder}
    >
      {t("sidebar_createFolderOk")}
    </button>
  </div>
</Modal>

<Modal bind:open={folderRenameOpen} title={t("sidebar_renameFolder")}>
  <input
    type="text"
    class="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring mb-4"
    bind:value={folderRenameName}
    onkeydown={(e) => e.key === "Enter" && onRenameFolder?.()}
    use:focusOnMount
  />
  <div class="flex justify-end gap-2">
    <button
      type="button"
      class="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors"
      onclick={closeFolderRename}
    >
      {t("sidebar_deleteCancel")}
    </button>
    <button
      type="button"
      class="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      onclick={onRenameFolder}
    >
      {t("sidebar_renameFolderOk")}
    </button>
  </div>
</Modal>

<Modal bind:open={folderDeleteOpen} title={t("sidebar_deleteFolder")}>
  <p class="text-sm text-muted-foreground mb-4">
    {t("sidebar_deleteFolderDesc", { name: folderDeleteTargetName })}
  </p>
  <div class="flex justify-end gap-2">
    <button
      type="button"
      class="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors"
      onclick={closeFolderDelete}
    >
      {t("sidebar_deleteCancel")}
    </button>
    <button
      type="button"
      class="px-3 py-1.5 text-sm rounded-md border border-miwarp-status-warning text-miwarp-status-warning hover:bg-[hsl(var(--miwarp-status-warning)/0.1)] transition-colors"
      onclick={onDeleteFolderKeep}
    >
      {t("sidebar_deleteFolderKeep")}
    </button>
    <button
      type="button"
      class="px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
      onclick={onDeleteFolderCascade}
    >
      {t("sidebar_deleteFolderCascade")}
    </button>
  </div>
</Modal>

<Modal bind:open={moveToFolderOpen} title={t("sidebar_moveToFolder")}>
  <p class="text-sm text-muted-foreground mb-3">
    {t("sidebar_moveToFolderDesc", { count: String(moveToFolderCount) })}
  </p>
  <div class="flex flex-col gap-1.5 mb-4 max-h-48 overflow-y-auto">
    <button
      type="button"
      class="text-left px-3 py-2 text-sm rounded-md transition-colors"
      class:bg-primary={moveToFolderSelectedId === null}
      class:text-primary-foreground={moveToFolderSelectedId === null}
      class:hover:bg-accent={moveToFolderSelectedId !== null}
      onclick={() => (moveToFolderSelectedId = null)}
    >
      {t("sidebar_uncategorized")}
    </button>
    {#each moveToFolderOptions as folder}
      <button
        type="button"
        class="text-left px-3 py-2 text-sm rounded-md transition-colors"
        class:bg-primary={moveToFolderSelectedId === folder.id}
        class:text-primary-foreground={moveToFolderSelectedId === folder.id}
        class:hover:bg-accent={moveToFolderSelectedId !== folder.id}
        onclick={() => (moveToFolderSelectedId = folder.id)}
      >
        {folder.name}
      </button>
    {/each}
  </div>
  <div class="flex justify-end gap-2">
    <button
      type="button"
      class="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors"
      onclick={closeMoveToFolder}
    >
      {t("sidebar_deleteCancel")}
    </button>
    <button
      type="button"
      class="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      onclick={onMoveToFolder}
    >
      {t("sidebar_moveToFolderOk")}
    </button>
  </div>
</Modal>
