<script lang="ts">
  import { Dialog } from "bits-ui";
  import { t } from "$lib/i18n/index.svelte";
  import {
    MIWARP_DIALOG_CONTENT_CLASS,
    MIWARP_DIALOG_CONTENT_COMMAND_CLASS,
    MIWARP_DIALOG_CONTENT_LG_CLASS,
    MIWARP_DIALOG_CONTENT_MD_CLASS,
    MIWARP_DIALOG_CONTENT_STYLE,
    MIWARP_DIALOG_OVERLAY_CLASS,
  } from "$lib/ui/miwarp-surfaces";

  let {
    open = $bindable(false),
    title = "",
    closeable = true,
    size = "default" as "default" | "md" | "lg" | "command",
    contentClass = "",
    onClose,
    children,
  }: {
    open?: boolean;
    title?: string;
    closeable?: boolean;
    size?: "default" | "md" | "lg" | "command";
    contentClass?: string;
    onClose?: () => void;
    children?: import("svelte").Snippet;
  } = $props();

  const SIZE_CLASS: Record<"default" | "md" | "lg" | "command", string> = {
    default: MIWARP_DIALOG_CONTENT_CLASS,
    md: MIWARP_DIALOG_CONTENT_MD_CLASS,
    lg: MIWARP_DIALOG_CONTENT_LG_CLASS,
    command: MIWARP_DIALOG_CONTENT_COMMAND_CLASS,
  };

  let dialogContentClass = $derived(`${SIZE_CLASS[size]} ${contentClass}`.trim());

  function handleOpenChange(next: boolean) {
    if (!closeable && !next) return;
    const wasOpen = open;
    open = next;
    if (wasOpen && !next) onClose?.();
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Portal>
    <Dialog.Overlay class={MIWARP_DIALOG_OVERLAY_CLASS} />
    <Dialog.Content
      class={dialogContentClass}
      style={size === "command" ? undefined : MIWARP_DIALOG_CONTENT_STYLE}
      interactOutsideBehavior={closeable ? "close" : "ignore"}
    >
      {#if title}
        <Dialog.Title class="mb-4 pr-8 text-lg font-semibold text-foreground">{title}</Dialog.Title>
      {/if}
      {#if closeable}
        <Dialog.Close
          class="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-miwarp-text-tertiary transition-colors hover:bg-miwarp-bg-hover hover:text-miwarp-text-primary"
          aria-label={t("common_close")}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M1 1l12 12M13 1L1 13"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </Dialog.Close>
      {/if}
      {#if children}
        {@render children()}
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
