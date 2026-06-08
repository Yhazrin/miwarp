<script lang="ts">
  /**
   * MiAlertDialog — Bits UI AlertDialog wrapper for dangerous confirmations.
   *
   * Use for delete-session, reset-pairing, revoke-device, etc.
   * Provides title, description, cancel/confirm actions with MiWarp surface tokens.
   *
   * RULE: only src/lib/ui/* may import bits-ui.
   */
  import { AlertDialog } from "bits-ui";
  import { t } from "$lib/i18n/index.svelte";
  import {
    MIWARP_DIALOG_OVERLAY_CLASS,
    MIWARP_DIALOG_CONTENT_MD_CLASS,
    MIWARP_DIALOG_CONTENT_STYLE,
  } from "./miwarp-surfaces";

  let {
    open = $bindable(false),
    title = "",
    description = "",
    confirmLabel = "",
    confirmVariant = "danger" as "danger" | "primary",
    cancelLabel = "",
    onConfirm,
    onCancel,
  }: {
    open?: boolean;
    title?: string;
    description?: string;
    confirmLabel?: string;
    confirmVariant?: "danger" | "primary";
    cancelLabel?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  } = $props();

  let confirmClass = $derived(
    confirmVariant === "danger"
      ? "rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
      : "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90",
  );

  function handleConfirm() {
    open = false;
    onConfirm?.();
  }

  function handleCancel() {
    open = false;
    onCancel?.();
  }
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Portal>
    <AlertDialog.Overlay class={MIWARP_DIALOG_OVERLAY_CLASS} />
    <AlertDialog.Content
      class={MIWARP_DIALOG_CONTENT_MD_CLASS}
      style={MIWARP_DIALOG_CONTENT_STYLE}
    >
      {#if title}
        <AlertDialog.Title class="mb-1 text-base font-semibold text-foreground">
          {title}
        </AlertDialog.Title>
      {/if}
      {#if description}
        <AlertDialog.Description class="mb-4 text-sm text-muted-foreground">
          {description}
        </AlertDialog.Description>
      {/if}
      <div class="flex justify-end gap-2">
        <AlertDialog.Cancel
          class="rounded-lg border border-border/50 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          onclick={handleCancel}
        >
          {cancelLabel || t("common_cancel")}
        </AlertDialog.Cancel>
        <AlertDialog.Action class={confirmClass} onclick={handleConfirm}>
          {confirmLabel || t("common_confirm")}
        </AlertDialog.Action>
      </div>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
