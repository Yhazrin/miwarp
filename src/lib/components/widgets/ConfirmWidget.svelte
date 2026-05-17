<script lang="ts">
  import { AlertTriangle, XCircle } from "lucide-svelte";

  interface ConfirmData {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
  }

  let {
    data,
    onAction,
  }: {
    data: ConfirmData;
    onAction?: (confirmed: boolean) => void;
  } = $props();

  const confirmLabel = $derived(data.confirmLabel || "Confirm");
  const cancelLabel = $derived(data.cancelLabel || "Cancel");
  const isDestructive = $derived(data.destructive || false);

  function handleConfirm() {
    onAction?.(true);
  }

  function handleCancel() {
    onAction?.(false);
  }
</script>

<div
  class="confirm-widget rounded-lg border p-4"
  class:border-red-500={isDestructive}
  class:border-border={!isDestructive}
  class:bg-red-50/30={isDestructive}
  class:bg-muted/20={!isDestructive}
>
  <div class="flex items-start gap-3">
    {#if isDestructive}
      <AlertTriangle class="h-5 w-5 shrink-0 text-red-500" />
    {/if}

    <div class="flex-1">
      {#if data.title}
        <h3 class="mb-1 text-sm font-semibold">{data.title}</h3>
      {/if}
      <p class="text-sm text-muted-foreground">{data.message}</p>
    </div>
  </div>

  <div class="mt-4 flex items-center justify-end gap-2">
    <button
      onclick={handleCancel}
      class="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/50"
    >
      {cancelLabel}
    </button>

    {#if isDestructive}
      <button
        onclick={handleConfirm}
        class="rounded-md bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600"
      >
        {confirmLabel}
      </button>
    {:else}
      <button
        onclick={handleConfirm}
        class="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600"
      >
        {confirmLabel}
      </button>
    {/if}
  </div>
</div>