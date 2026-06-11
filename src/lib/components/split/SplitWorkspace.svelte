<!--
  SplitWorkspace — grid container for split-pane view (v1.0.8).

  PR-2 ships the host shell + drop overlay mount point. PR-3 fills in the
  grid layout + per-pane rendering + headers. Keep this file ≤ 80 lines;
  PR-3 logic should live in child components, not here.
-->
<script lang="ts">
  import { splitWorkspaceStore } from "$lib/split";
  import SplitDropOverlay from "./SplitDropOverlay.svelte";
</script>

<div
  class="split-workspace relative h-full w-full"
  data-split-mode={splitWorkspaceStore.enabled ? "true" : "false"}
>
  <!-- PR-3 will render the grid + panes here. PR-2 keeps it empty so the
       overlay is the only visible split artifact. -->
  {#if !splitWorkspaceStore.enabled}
    <!-- Empty state when split is enabled=false: chat page renders the
         normal ChatConversationStage instead, so this branch is the
         no-op default. -->
  {/if}
  <SplitDropOverlay />
</div>
