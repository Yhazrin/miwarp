<script lang="ts">
  /**
   * App modal shell — powered by Bits UI via MiDialog.
   * Keeps the legacy `Modal` import path for existing screens.
   */
  import MiDialog from "$lib/ui/MiDialog.svelte";

  let {
    open = $bindable(false),
    title = "",
    closeable = true,
    size = "default" as "default" | "sm" | "lg" | "xl",
    type: _type = "default",
    onClose,
    children,
  }: {
    open?: boolean;
    title?: string;
    closeable?: boolean;
    size?: "default" | "sm" | "lg" | "xl";
    type?: "default" | "info" | "warning" | "error";
    onClose?: () => void;
    children?: import("svelte").Snippet;
  } = $props();

  const miDialogSize = $derived(
    size === "lg" || size === "xl" ? "lg" : size === "sm" ? "md" : "default",
  );
</script>

<MiDialog bind:open {title} {closeable} {onClose} size={miDialogSize}>
  {#if children}
    {@render children()}
  {/if}
</MiDialog>
