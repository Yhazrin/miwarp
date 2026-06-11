<!--
  SplitDropOverlay — window-level drop target for the split-pane DnD protocol.

  Listens for `dragenter`/`dragover`/`drop` on `window` so the overlay
  covers the whole chat area while a session card is being dragged from
  the sidebar. Only responds when the dataTransfer carries our MIME type
  (`application/x-miwarp-split-pane`); all other drag protocols pass
  through untouched.

  Why window-level: a chat area can contain nested scroll containers, so
  bounding the listener to a single element breaks the drop UX when the
  user hovers over a message or input. Window is the only reliable target.
-->
<script lang="ts">
  import { splitWorkspaceStore, isSplitDrag, readSplitDragRunId } from "$lib/split";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";

  let dragDepth = $state(0);
  const isDragging = $derived(dragDepth > 0 && splitWorkspaceStore.enabled);
  const canDrop = $derived(splitWorkspaceStore.panes.length < 4);

  $effect(() => {
    function onDragEnter(e: DragEvent) {
      if (!isSplitDrag(e)) return;
      e.preventDefault();
      dragDepth++;
    }
    function onDragLeave(e: DragEvent) {
      if (!isSplitDrag(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
    }
    function onDragOver(e: DragEvent) {
      if (!isSplitDrag(e)) return;
      // Always preventDefault while our MIME is present so the browser
      // shows the correct drop indicator and lets us control dropEffect.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = canDrop ? "copy" : "none";
    }
    function onDrop(e: DragEvent) {
      if (!isSplitDrag(e)) return;
      e.preventDefault();
      dragDepth = 0;
      if (!canDrop) {
        splitWorkspaceStore.onToast?.("split_mode_paneLimitReached", "error");
        return;
      }
      const runId = readSplitDragRunId(e);
      if (runId) splitWorkspaceStore.addPane(runId);
    }
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  });
</script>

{#if isDragging}
  <div
    class="pointer-events-none absolute inset-0 z-40 flex items-center justify-center border-2 border-dashed backdrop-blur-[1px]"
    class:border-primary={canDrop}
    class:border-destructive={!canDrop}
    class:bg-primary={canDrop}
    class:bg-destructive={!canDrop}
    style:background-color={canDrop
      ? "hsl(var(--primary) / 0.05)"
      : "hsl(var(--destructive) / 0.08)"}
    role="presentation"
    aria-hidden="true"
  >
    <div
      class="flex items-center gap-2 rounded-xl border border-border/40 bg-background/90 px-6 py-3 text-sm font-medium shadow-lg"
    >
      <Icon
        name={canDrop ? "plus" : "triangle-alert"}
        size="sm"
        class={canDrop ? "text-primary" : "text-destructive"}
      />
      <span>{canDrop ? t("split_mode_dropHint") : t("split_mode_paneLimitReached")}</span>
    </div>
  </div>
{/if}
