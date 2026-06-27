<!--
  SplitWorkspace — grid container that fans panes out by `layoutMode`.

  Layout strategy (v1.0.8 P1 — no free resize):
  - single: 1 col × 1 row
  - dual:   2 cols × 1 row (side by side)
  - triple: 2 cols × 2 rows, but pane 0 spans the left column full height;
            panes 1 and 2 stack on the right (visual: 1 left, 2 right)
  - quad:   2 cols × 2 rows

  The grid uses `hsl(var(--border))` for the gap so dividers between panes
  pick up the theme border colour automatically. All sizing uses CSS grid
  template areas; PR-3 keeps the cells flexible (1fr) so the layout adapts
  to whatever the chat-area container is sized to.

  The active pane body content comes from the parent via the `activePaneBody`
  snippet. PR-4 (chat page integration) is the only place that knows how to
  build a full ChatConversationStage instance with the right VM/handler
  bundle, so the snippet keeps SplitWorkspace free of session concerns.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { splitWorkspaceStore, type PaneId } from "$lib/split";
  import { activateSplitPane, closeSplitPane } from "$lib/split/split-workspace-lifecycle";
  import SplitChatPane from "./SplitChatPane.svelte";
  import SplitWorkspaceToolbar from "./SplitWorkspaceToolbar.svelte";
  import { fly } from "svelte/transition";

  let {
    activePaneBody,
    activePaneInput,
    onActivate,
  }: {
    /** Snippet invoked for the single active pane's body (ChatConversationStage). */
    activePaneBody?: Snippet;
    /** Snippet invoked for the single active pane's input dock (ChatInputDock). */
    activePaneInput?: Snippet;
    /**
     * Called when the user clicks an inactive pane's header. Defaults to
     * splitWorkspaceStore.setActive (metadata only). Chat page overrides
     * to also call splitPaneSessionAdapter.switchActive so the underlying
     * sessionStore.loadRun runs.
     */
    onActivate?: (paneId: PaneId) => void;
  } = $props();

  const split = splitWorkspaceStore;
</script>

<div
  class="split-workspace relative flex h-full w-full flex-col"
  data-split-mode={split.enabled ? "true" : "false"}
>
  {#if split.enabled}
    <SplitWorkspaceToolbar />
    <div class="split-grid min-h-0 flex-1 w-full" data-layout-mode={split.layoutMode}>
      {#each split.panes as pane, idx (pane.paneId)}
        <div
          class="split-pane-slot min-w-0 min-h-0"
          data-pane-index={idx}
          data-runtime-state={pane.runtimeState}
          in:fly={{ y: 12, duration: 180 }}
        >
          <SplitChatPane
            {pane}
            onClose={() => void closeSplitPane(pane.paneId)}
            activeContent={pane.runtimeState === "active" ? activePaneBody : undefined}
            activeInput={pane.runtimeState === "active" ? activePaneInput : undefined}
            onActivate={onActivate ?? ((id) => void activateSplitPane(id))}
          />
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* Layout CSS — kept local so each SplitWorkspace instance can be moved
     without affecting other components. All colours come from design tokens. */
  .split-grid {
    display: grid;
    gap: 1px;
    background: hsl(var(--border));
  }
  .split-grid[data-layout-mode="single"] {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr;
  }
  .split-grid[data-layout-mode="dual"] {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr;
  }
  .split-grid[data-layout-mode="triple"] {
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    grid-template-rows: 1fr 1fr;
  }
  /* triple: pane 0 spans left column full height; panes 1+2 stack right */
  .split-grid[data-layout-mode="triple"] > [data-pane-index="0"] {
    grid-column: 1;
    grid-row: 1 / span 2;
  }
  .split-grid[data-layout-mode="triple"] > [data-pane-index="1"] {
    grid-column: 2;
    grid-row: 1;
  }
  .split-grid[data-layout-mode="triple"] > [data-pane-index="2"] {
    grid-column: 2;
    grid-row: 2;
  }
  .split-grid[data-layout-mode="quad"] {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
  }
  .split-grid[data-layout-mode="quad"] > [data-pane-index="0"] {
    grid-column: 1;
    grid-row: 1;
  }
  .split-grid[data-layout-mode="quad"] > [data-pane-index="1"] {
    grid-column: 2;
    grid-row: 1;
  }
  .split-grid[data-layout-mode="quad"] > [data-pane-index="2"] {
    grid-column: 1;
    grid-row: 2;
  }
  .split-grid[data-layout-mode="quad"] > [data-pane-index="3"] {
    grid-column: 2;
    grid-row: 2;
  }
  .split-pane-slot {
    background: hsl(var(--background));
    overflow: hidden;
  }
</style>
