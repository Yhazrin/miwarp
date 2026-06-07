<script lang="ts">
  /**
   * v1.0.6 / 6.7: MiConfirmDialog — confirm/cancel flow that reuses
   * MiDialog underneath. Lets existing call sites drop bespoke modal
   * implementations.
   */
  import MiDialog from "./MiDialog.svelte";
  import { t } from "$lib/i18n/index.svelte";

  let {
    open = $bindable(false),
    title = "",
    description = "",
    confirmLabel = "",
    cancelLabel = "",
    destructive = false,
    onConfirm,
    onCancel,
  }: {
    open?: boolean;
    title?: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
    onConfirm?: () => void;
    onCancel?: () => void;
  } = $props();

  function close() {
    open = false;
  }

  function handleConfirm() {
    onConfirm?.();
    close();
  }

  function handleCancel() {
    onCancel?.();
    close();
  }
</script>

<MiDialog
  bind:open
  {title}
  {description}
  size="sm"
  onClose={handleCancel}
>
  {#snippet actions()}
    <button
      type="button"
      class="rounded-md border border-border bg-background px-3 py-1.5 text-sm
        text-foreground transition-colors hover:bg-muted"
      onclick={handleCancel}
    >
      {cancelLabel || t("common_cancel")}
    </button>
    <button
      type="button"
      class="rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors
        {destructive
          ? 'bg-miwarp-status-error hover:bg-miwarp-status-error/85'
          : 'bg-primary hover:bg-primary/85'}"
      onclick={handleConfirm}
    >
      {confirmLabel || t("common_confirm")}
    </button>
  {/snippet}
</MiDialog>
