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

  Important: the overlay stays mounted regardless of `split.enabled` —
  the drop itself is the entry point into split mode. If the user drops
  a card while not in split mode, we `enter({activeRunId: runId})`
  first, then `addPane`. The visual hint also shows on the first drop
  so users see what's about to happen.
-->
<script lang="ts">
  import { splitWorkspaceStore, isSplitDrag, readSplitDragRunId } from "$lib/split";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";

  let dragDepth = $state(0);
  let overlayEl = $state<HTMLElement | null>(null);
  const isDragging = $derived(dragDepth > 0);
  const canDrop = $derived(!splitWorkspaceStore.enabled || splitWorkspaceStore.panes.length < 4);

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
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = canDrop ? "copy" : "none";
  }
  function onDrop(e: DragEvent) {
    if (!isSplitDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    const runId = readSplitDragRunId(e);
    if (!runId) return;
    if (splitWorkspaceStore.enabled && splitWorkspaceStore.panes.length >= 4) {
      splitWorkspaceStore.onToast?.("split_mode_paneLimitReached", "error");
      return;
    }
    if (!splitWorkspaceStore.enabled) {
      splitWorkspaceStore.enter({ activeRunId: runId, cwd: null });
    } else {
      splitWorkspaceStore.addPane(runId);
    }
  }
  // Also handle window-level events as fallback (covers Tauri WebView edge cases)
  function onWindowDragEnter(e: DragEvent) {
    if (isSplitDrag(e)) {
      e.preventDefault();
      dragDepth++;
    }
  }
  function onWindowDragLeave(e: DragEvent) {
    if (isSplitDrag(e)) dragDepth = Math.max(0, dragDepth - 1);
  }
  function onWindowDragOver(e: DragEvent) {
    if (isSplitDrag(e)) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = canDrop ? "copy" : "none";
    }
  }
  function onWindowDrop(e: DragEvent) {
    if (!isSplitDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    const runId = readSplitDragRunId(e);
    if (!runId) return;
    if (splitWorkspaceStore.enabled && splitWorkspaceStore.panes.length >= 4) {
      splitWorkspaceStore.onToast?.("split_mode_paneLimitReached", "error");
      return;
    }
    if (!splitWorkspaceStore.enabled) {
      splitWorkspaceStore.enter({ activeRunId: runId, cwd: null });
    } else {
      splitWorkspaceStore.addPane(runId);
    }
  }

  $effect(() => {
    window.addEventListener("dragenter", onWindowDragEnter);
    window.addEventListener("dragleave", onWindowDragLeave);
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("drop", onWindowDrop);
    return () => {
      window.removeEventListener("dragenter", onWindowDragEnter);
      window.removeEventListener("dragleave", onWindowDragLeave);
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("drop", onWindowDrop);
    };
  });
</script>

{#if isDragging}
  <div
    bind:this={overlayEl}
    ondragenter={onDragEnter}
    ondragleave={onDragLeave}
    ondragover={onDragOver}
    ondrop={onDrop}
    class="fixed inset-0 z-50 flex items-center justify-center border-2 border-dashed backdrop-blur-[1px]"
    class:border-primary={canDrop}
    class:border-destructive={!canDrop}
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
