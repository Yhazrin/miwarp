<!--
  SplitChatPane — wraps one pane: header + body (active or snapshot) +
  optional input dock for the active pane.

  The active-pane body content comes from the parent via the `activeContent`
  snippet — chat page is the only place that knows how to build the full
  ChatConversationStage props. This keeps SplitChatPane free of session
  knowledge and lets us reuse the existing chat surface 1:1.

  Activation flow: clicking the pane header calls `onActivate(paneId)`. By
  default that just calls `splitWorkspaceStore.setActive(paneId)` (metadata
  only — no IO). Chat page can override it to also call
  `splitPaneSessionAdapter.switchActive` which captures the leaving pane's
  snapshot and loads the entering pane into sessionStore.
-->
<script lang="ts">
  import type { PaneId, PaneState } from "$lib/split";
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
    onActivate,
  }: {
    pane: PaneState;
    onClose: () => void;
    /** Snippet that renders the active pane's ChatConversationStage body. */
    activeContent?: Snippet;
    /** Snippet that renders the active pane's ChatInputDock. */
    activeInput?: Snippet;
    /**
     * Called when the user clicks the pane header / body to make this
     * pane the active one. Defaults to `splitWorkspaceStore.setActive`.
     * Override from chat page to also load the run into sessionStore.
     */
    onActivate?: (paneId: PaneId) => void;
  } = $props();

  function activate() {
    if (pane.runtimeState === "active") return;
    if (onActivate) onActivate(pane.paneId);
    else splitWorkspaceStore.setActive(pane.paneId);
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
  <!-- Header is a button so click + keyboard activation both work. -->
  <button
    type="button"
    class="w-full text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
    aria-label={pane.runtimeState === "active"
      ? t("split_mode_activeBadge")
      : `${t("split_mode_activate")} ${pane.runId}`}
    onclick={activate}
  >
    <SplitPaneHeader {pane} {onClose} />
  </button>
  <div class="flex-1 min-h-0 overflow-hidden">
    {#if pane.runtimeState === "active"}
      {#if activeContent}
        {@render activeContent()}
      {:else}
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
      <div class="flex h-full items-center justify-center text-xs text-muted-foreground">
        {t("split_mode_loadingPane")}
      </div>
    {/if}
  </div>
  {#if pane.runtimeState === "active" && activeInput}
    {@render activeInput()}
  {/if}
</div>
