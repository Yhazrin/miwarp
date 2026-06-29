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

  Live header data: `activeRunData` (when pane is active) is forwarded to
  the header so the title + status reflect the live sessionStore, not the
  stale cached snapshot. The header gracefully ignores it for inactive panes.

  Inactive pane refresh (P2-3): when this pane is inactive and has a
  cached snapshot, a 30s interval re-fetches the snapshot via
  `splitPaneSessionAdapter.fetchSnapshot(force=true)`. The interval is
  cleared when the pane becomes active (the adapter handles its own
  activate path) or when the component unmounts.
-->
<script lang="ts">
  import type { PaneId, PaneState } from "$lib/split";
  import { refreshInactivePaneSnapshot, splitWorkspaceStore } from "$lib/split";
  import SplitPaneHeader from "./SplitPaneHeader.svelte";
  import SplitPaneSnapshotView from "./SplitPaneSnapshotView.svelte";
  import type { PaneSnapshotWithRaw } from "$lib/split";
  import type { TaskRun } from "$lib/types";
  import Spinner from "$lib/components/Spinner.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { onDestroy } from "svelte";
  import { appVisibility } from "$lib/stores/app-visibility.svelte";
  import type { Snippet } from "svelte";

  /** Polling interval (ms) for refreshing inactive pane snapshots. */
  const REFRESH_INTERVAL_MS = 30_000;

  let {
    pane,
    onClose,
    activeContent,
    activeInput,
    onActivate,
    activeRunData = null,
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
    /** Live { name, status } for the active pane — fed to the header. */
    activeRunData?: { name: string; status: TaskRun["status"] } | null;
  } = $props();

  function activate() {
    if (pane.runtimeState === "active") return;
    if (onActivate) onActivate(pane.paneId);
    else splitWorkspaceStore.setActive(pane.paneId);
  }

  function handleHeaderKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    }
  }

  const snapshot = $derived(pane.cachedSnapshot as PaneSnapshotWithRaw | null);
  // Only the active pane should forward live data; inactive panes render
  // their cached snapshot instead, so passing the data through is wasted work.
  const headerActiveRunData = $derived(pane.runtimeState === "active" ? activeRunData : null);

  // New-content indicator: shown on inactive panes whose cached snapshot's
  // `latestEventTime` is newer than its `fetchedAt` (i.e. the bus saw
  // something we haven't replayed yet).
  const hasNewContent = $derived.by(() => {
    if (pane.runtimeState === "active") return false;
    if (!pane.cachedSnapshot) return false;
    return pane.cachedSnapshot.latestEventTime > pane.cachedSnapshot.fetchedAt;
  });

  // Reactive polling: start/stop the 30s interval based on whether this
  // pane is inactive and has a snapshot to refresh. Clear on transitions
  // out of inactive and on unmount.
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  $effect(() => {
    const shouldPoll =
      pane.runtimeState === "inactive" &&
      pane.cachedSnapshot !== null &&
      pane.loadState === "ready";
    if (shouldPoll && pollTimer === null) {
      pollTimer = setInterval(() => {
        // Idle-energy guard: skip snapshot refresh while the split window
        // is hidden or unfocused — the user can't see the inactive pane,
        // and refreshing burns an IPC + run journal replay every tick.
        if (!appVisibility.isDocumentVisible || !appVisibility.isAppFocused) return;
        void refreshInactivePaneSnapshot(pane.paneId);
      }, REFRESH_INTERVAL_MS);
    } else if (!shouldPoll && pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });

  onDestroy(() => {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });
</script>

<div
  class="flex flex-col h-full min-w-0 min-h-0 bg-background"
  data-pane-id={pane.paneId}
  data-runtime-state={pane.runtimeState}
  data-load-state={pane.loadState}
  role="region"
  aria-label={`Pane ${pane.runId}`}
>
  <!-- Header is keyboard-activatable but uses div+role="button" so the inner
       close button can stay a real <button> without nesting interactive
       controls (which is invalid HTML and trips a11y tools). -->
  <div
    role="button"
    tabindex="0"
    class="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
    aria-label={pane.runtimeState === "active"
      ? t("split_mode_activeBadge")
      : `${t("split_mode_activate")} ${pane.runId}`}
    onclick={activate}
    onkeydown={handleHeaderKeydown}
  >
    <SplitPaneHeader {pane} {onClose} activeRunData={headerActiveRunData} {hasNewContent} />
  </div>
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
