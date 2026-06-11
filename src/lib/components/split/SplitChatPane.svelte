<!--
  SplitChatPane — wraps one pane: header + body (active or snapshot) +
  optional input dock for the active pane.

  The active-pane body content comes from the parent via the `activeContent`
  snippet — chat page is the only place that knows how to build the full
  ChatConversationStage props. This keeps SplitChatPane free of session
  knowledge and lets us reuse the existing chat surface 1:1.
-->
<script lang="ts">
  import type { PaneState } from "$lib/split";
  import { splitWorkspaceStore } from "$lib/split";
  import SplitPaneHeader from "./SplitPaneHeader.svelte";
  import SplitPaneSnapshotView from "./SplitPaneSnapshotView.svelte";
  import type { PaneSnapshotWithRaw } from "$lib/split";
  import Spinner from "$lib/components/Spinner.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import type { Snippet } from "svelte";

  let {
    pane,
    onClose,
    activeContent,
    activeInput,
  }: {
    pane: PaneState;
    onClose: () => void;
    /** Snippet that renders the active pane's ChatConversationStage body. */
    activeContent?: Snippet;
    /** Snippet that renders the active pane's ChatInputDock. */
    activeInput?: Snippet;
  } = $props();

  function handleHeaderClick() {
    if (pane.runtimeState !== "active") splitWorkspaceStore.setActive(pane.paneId);
  }

  const snapshot = $derived(pane.cachedSnapshot as PaneSnapshotWithRaw | null);
</script>

<div
  class="flex flex-col h-full min-w-0 min-h-0 bg-background"
  data-pane-id={pane.paneId}
  data-runtime-state={pane.runtimeState}
  data-load-state={pane.loadState}
  role="region"
  aria-label={`Pane ${pane.runId}`}
>
  <SplitPaneHeader {pane} {onClose} />
  <div class="flex-1 min-h-0 overflow-hidden">
    {#if pane.runtimeState === "active"}
      {#if activeContent}
        {@render activeContent()}
      {:else}
        <!-- Defensive: chat page should always supply activeContent. -->
        <div class="flex h-full items-center justify-center text-xs text-muted-foreground">
          {t("split_mode_loadingPane")}
        </div>
      {/if}
    {:else if pane.loadState === "loading" && !snapshot}
      <div class="flex h-full flex-col items-center justify-center gap-2">
        <Spinner size="sm" class="border-muted-foreground/30" />
        <p class="text-xs text-muted-foreground">{t("split_mode_loadingPane")}</p>
      </div>
    {:else if pane.loadState === "error" && pane.errorState}
      <div class="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
        <Icon name="triangle-alert" size="md" class="text-destructive" />
        <p class="text-sm text-destructive">{t("split_mode_paneLoadFailed")}</p>
        <p class="text-[11px] text-muted-foreground max-w-md break-words">
          {pane.errorState.message}
        </p>
      </div>
    {:else if snapshot}
      <SplitPaneSnapshotView {snapshot} />
    {:else}
      <!-- Idle pane with no snapshot yet. -->
      <div class="flex h-full items-center justify-center text-xs text-muted-foreground">
        {t("split_mode_loadingPane")}
      </div>
    {/if}
  </div>
  {#if pane.runtimeState === "active" && activeInput}
    {@render activeInput()}
  {/if}
</div>
