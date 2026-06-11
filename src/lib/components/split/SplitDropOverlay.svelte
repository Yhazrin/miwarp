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
  // Show the hint whenever a split drag is in flight, regardless of whether
  // split mode is already enabled. This is what lets a first-time drop
  // enter split mode on the fly.
  const isDragging = $derived(dragDepth > 0);
  // The cap applies once we're in split mode (or about to be).
  const canDrop = $derived(!splitWorkspaceStore.enabled || splitWorkspaceStore.panes.length < 4);

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
      const runId = readSplitDragRunId(e);
      if (!runId) return;
      // Cap check only matters once we're already in split mode.
      if (splitWorkspaceStore.enabled && splitWorkspaceStore.panes.length >= 4) {
        splitWorkspaceStore.onToast?.("split_mode_paneLimitReached", "error");
        return;
      }
      // First-time drop enters split mode with this run as the active pane.
      if (!splitWorkspaceStore.enabled) {
        splitWorkspaceStore.enter({ activeRunId: runId, cwd: null });
      } else {
        splitWorkspaceStore.addPane(runId);
      }
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
    class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-2 border-dashed backdrop-blur-[1px]"
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
