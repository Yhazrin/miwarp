<!--
  ExplorerSidebarBody — body for the `/explorer` route. Renders the
  file-tree (or an empty / loading / error state) for the currently
  selected projectCwd. Pulled out of SidebarContentPanel so the rest of
  the layout doesn't pay for ExplorerTreeNodes / explorer-tree-store on
  the initial bundle parse.

  Behaviour-equivalence contract (refactor — no functional change):
    - Mirrors the old `isExplorerPage` branch in SidebarContentPanel:
      cwd not set → EmptyState; treeLoading → spinner; treeError →
      retry; empty tree → "empty directory" EmptyState; else render
      ExplorerTreeNodes fed by explorerTreeStore.
    - The "open folder" button is provided by the parent via the
      `explorerEmptyAction` snippet, so the body itself does not need to
      know how to open a folder picker.
-->
<script lang="ts">
  import { explorerTreeStore as ets } from "$lib/layout/explorer-tree-store.svelte";
  import { projectSelectionStore as pss } from "$lib/layout/project-selection-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { getLastTarget } from "$lib/utils/remote-cwd";
  import type { Snippet } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import ExplorerTreeNodes from "$lib/layout/ExplorerTreeNodes.svelte";
  import type { TreeNode } from "$lib/layout/explorer-tree-store.svelte";

  interface Props {
    /** Snippet rendered inside the no-cwd EmptyState (typically an "open folder" button). */
    explorerEmptyAction?: Snippet;
  }

  let { explorerEmptyAction }: Props = $props();
</script>

<div class="flex-1 overflow-y-auto px-1 py-1">
  {#if !pss.projectCwd}
    <EmptyState
      iconName="folder-open"
      title={getLastTarget()
        ? t("layout_remoteFileTreeUnavailable")
        : t("sidebar_selectProjectBrowse")}
      action={explorerEmptyAction}
      class="py-8"
    />
  {:else if ets.treeLoading}
    <div class="flex items-center justify-center py-12">
      <Spinner size="sm" />
    </div>
  {:else if ets.treeError}
    <div class="flex flex-col gap-2 px-3 py-6 text-center">
      <div class="flex justify-center">
        <Icon name="triangle-alert" size="md" class="text-destructive/70" />
      </div>
      <p class="text-xs font-medium text-foreground">
        {t("explorer_treeLoadFailed")}
      </p>
      <p class="text-[11px] text-muted-foreground break-all">
        {ets.treeError}
      </p>
      <button
        type="button"
        class="mx-auto mt-1 rounded-md px-2.5 py-1 text-[11px] font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
        onclick={() => ets.loadRootTree(pss.projectCwd)}
      >
        {t("common_retry")}
      </button>
    </div>
  {:else if ets.fileTree.length === 0}
    <EmptyState iconName="folder-open" title={t("sidebar_emptyDirectory")} class="py-8" />
  {:else}
    <ExplorerTreeNodes
      nodes={ets.fileTree as TreeNode[]}
      selectedPath={ets.explorerSelectedFile}
      onToggle={(node) => ets.toggleFolder(node)}
      onSelect={(node) => ets.selectFile(node)}
      onRetry={(node) => ets.retryFolder(node)}
    />
  {/if}
</div>
