<script lang="ts">
  /**
   * v1.0.6 / 6.7: MiDialog — Bits UI Dialog wrapper with MiWarp sizing
   * tokens. Replaces the 30+ hand-rolled overlay components that lived
   * in chat and explorer pages. Sized via `size` prop: sm / md / lg /
   * xl / sheet / fullscreen / lightbox.
   */
  import { Dialog } from "bits-ui";

  let {
    open = $bindable(false),
    title = "",
    description = "",
    size = "md",
    children,
    actions,
    onClose,
    dismissable = true,
  }: {
    open?: boolean;
    title?: string;
    description?: string;
    size?: "sm" | "md" | "lg" | "xl" | "sheet" | "fullscreen" | "lightbox";
    children?: import("svelte").Snippet;
    actions?: import("svelte").Snippet;
    onClose?: () => void;
    dismissable?: boolean;
  } = $props();

  const widthMap: Record<string, string> = {
    sm: "max-w-sm",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
    sheet: "max-w-md sm:max-w-lg",
    fullscreen: "max-w-[100vw] h-[100vh] rounded-none",
    lightbox: "max-w-5xl",
  };

  function handleOpenChange(next: boolean) {
    if (!next && onClose) onClose();
    open = next;
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Portal>
    <Dialog.Overlay
      class="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm"
    />
    <Dialog.Content
      class="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2
        w-[90vw] {widthMap[size]}
        rounded-lg border border-border bg-card p-5 shadow-xl
        focus:outline-none"
      interactOutsideBehavior={dismissable ? "close" : "ignore"}
      escapeKeydownBehavior={dismissable ? "close" : "ignore"}
    >
      {#if title}
        <Dialog.Title class="mb-1 text-base font-semibold text-foreground">
          {title}
        </Dialog.Title>
      {/if}
      {#if description}
        <Dialog.Description class="mb-3 text-sm text-muted-foreground">
          {description}
        </Dialog.Description>
      {/if}
      <div class="max-h-[70vh] overflow-y-auto">
        {#if children}
          {@render children()}
        {/if}
      </div>
      {#if actions}
        <div class="mt-4 flex justify-end gap-2">
          {@render actions()}
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
