<script lang="ts">
  import Modal from "./Modal.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { showToast } from "$lib/stores/toast-store.svelte";

  interface Props {
    open?: boolean;
    cwd: string;
    currentAlias?: string;
    onClose: () => void;
    onSave?: (alias: string) => void;
    onRemove?: () => void;
  }

  let {
    open = $bindable(false),
    cwd,
    currentAlias = "",
    onClose,
    onSave,
    onRemove,
  }: Props = $props();

  let aliasValue = $state("");
  let saving = $state(false);

  $effect(() => {
    if (open) {
      aliasValue = currentAlias;
    }
  });

  async function handleOpenDirectory() {
    try {
      const { open: shellOpen } = await import("@tauri-apps/plugin-shell");
      await shellOpen(cwd);
    } catch {
      showToast(
        t("toast_openDirFailed") ?? "Cannot open directory. Please confirm the path still exists.",
        "error",
      );
    }
  }

  function handleSave() {
    saving = true;
    try {
      onSave?.(aliasValue.trim());
      saving = false;
      onClose();
    } catch {
      saving = false;
      showToast(t("toast_settingsSaveFailed") ?? "Failed to save settings", "error");
    }
  }
</script>

<Modal bind:open title={t("workspace_settings") ?? "Workspace Settings"} size="sm" {onClose}>
  <div class="space-y-4">
    <!-- Alias -->
    <div>
      <label class="mb-1.5 block text-xs font-medium text-muted-foreground">
        {t("workspace_displayName") ?? "Display name"}
      </label>
      <input
        type="text"
        bind:value={aliasValue}
        class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm
               placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
        placeholder={t("workspace_aliasPlaceholder") ?? "Leave empty to use default"}
      />
      <p class="mt-1 text-[10px] text-muted-foreground/60">
        {t("workspace_aliasHint") ??
          "Only modifies the sidebar display name, not the actual folder."}
      </p>
    </div>

    <!-- Path -->
    <div>
      <label class="mb-1.5 block text-xs font-medium text-muted-foreground">
        {t("workspace_localPath") ?? "Local path"}
      </label>
      <div class="flex items-center gap-2">
        <span
          class="flex-1 truncate rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground font-mono"
          title={cwd}
        >
          {cwd}
        </span>
        <button
          class="shrink-0 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground
                 hover:bg-accent hover:text-foreground transition-colors"
          onclick={handleOpenDirectory}
        >
          {t("workspace_openDir") ?? "Open"}
        </button>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
      {#if onRemove}
        <button
          class="mr-auto rounded-lg border border-destructive/50 px-3 py-2 text-xs text-destructive
                 hover:bg-destructive/10 transition-colors"
          onclick={() => {
            onRemove?.();
            onClose();
          }}
        >
          {t("sidebar_removeProject") ?? "Remove from sidebar"}
        </button>
      {/if}
      <button
        class="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground
               hover:bg-accent transition-colors"
        onclick={onClose}
      >
        {t("common_cancel") ?? "Cancel"}
      </button>
      <button
        class="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground
               hover:bg-primary/90 transition-colors disabled:opacity-50"
        onclick={handleSave}
        disabled={saving}
      >
        {t("common_save") ?? "Save"}
      </button>
    </div>
  </div>
</Modal>
