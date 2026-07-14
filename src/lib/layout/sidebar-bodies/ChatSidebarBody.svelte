<!--
  ChatSidebarBody — the body for `/chat` and `/` (the default workspace
  sidebar). Owns the deep-search input + results list and the
  ProjectFolderItem tree. Pulled out of SidebarContentPanel so the rest
  of the layout doesn't pay for ProjectFolderItem / sidebar-groups on
  initial bundle parse.

  Behaviour-equivalence contract (refactor — no functional change):
    - Renders exactly the same markup as the old `isChatPage` branch in
      SidebarContentPanel: search input → either search results OR
      enrichedProjectFolders list with batch-selection footer.
    - All props are forwarded from SidebarContentPanel; the parent owns
      the state, the body is a render function over those props.
-->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { runsSidebarStore as rss } from "$lib/layout/runs-sidebar-store.svelte";
  import { projectSelectionStore as pss } from "$lib/layout/project-selection-store.svelte";
  import { sessionFolderStore as sfs } from "$lib/layout/session-folder-store.svelte";
  import { openDirectoryInFinder } from "$lib/api";
  import { t } from "$lib/i18n/index.svelte";
  import { cwdDisplayLabel, relativeTime, snippetAround, truncate } from "$lib/utils/format";
  import { getWorkspaceMascotStatus } from "$lib/utils/sidebar-groups";
  import type { ConversationGroup, EnrichedProjectFolder } from "$lib/utils/sidebar-groups";
  import type { PromptSearchResult } from "$lib/types";
  import Icon from "$lib/components/Icon.svelte";
  import ProjectFolderItem from "$lib/components/ProjectFolderItem.svelte";
  import Spinner from "$lib/components/Spinner.svelte";

  interface Props {
    enrichedProjectFolders: EnrichedProjectFolder[];
    visibleSearchResults: PromptSearchResult[];
    selectedRunId: string;
    selectedScheduledTaskId: string;
    mascotEnabled: boolean;
    selectedGroupKeys: Set<string>;
    batchModeActive: boolean;
    dragRunId: string | null;
    dragOverFolderId: string | null;
    dragOverUnfolderedKey: string | null;
    highlightMatch: (text: string, query: string) => string;
    onNavigateToChatRun: (
      targetRunId: string,
      opts?: { scrollTo?: string; replaceState?: boolean },
    ) => void;
    onToggleProject: (folderKey: string) => void;
    onRequestDeleteConversation: (conv: ConversationGroup) => void;
    onToggleSelectConversation: (groupKey: string, e: MouseEvent) => void;
    onEnterBatchMode: (groupKey: string) => void;
    onSessionDragStart: (runId: string, label: string, e: PointerEvent) => void;
    onSessionDragMove: (e: PointerEvent) => void;
    onSessionDragEnd: (e: PointerEvent) => void;
    onRequestRemoveProject: (cwd: string) => void;
    onNewChatInFolder: (cwd: string) => void;
    onNewChatInSubFolder: (parentCwd: string, subFolderId: string) => void;
    onSelectWorkspace: (cwd: string) => void;
    onBatchDeleteConfirm: () => void;
    onClearBatchSelection: () => void;
  }

  let {
    enrichedProjectFolders = [],
    visibleSearchResults = [],
    selectedRunId = "",
    selectedScheduledTaskId = "",
    mascotEnabled = true,
    selectedGroupKeys = new Set<string>(),
    batchModeActive = false,
    dragRunId = null,
    dragOverFolderId = null,
    dragOverUnfolderedKey = null,
    highlightMatch,
    onNavigateToChatRun,
    onToggleProject,
    onRequestDeleteConversation,
    onToggleSelectConversation,
    onEnterBatchMode,
    onSessionDragStart,
    onSessionDragMove,
    onSessionDragEnd,
    onRequestRemoveProject,
    onNewChatInFolder,
    onNewChatInSubFolder,
    onSelectWorkspace,
    onBatchDeleteConfirm,
    onClearBatchSelection,
  }: Props = $props();
</script>

<div class="no-drag relative z-10 shrink-0 px-3 pb-2.5 pt-1">
  <input
    type="text"
    bind:value={rss.runSearchQuery}
    oninput={() => rss.onDeepQueryInput()}
    placeholder={t("sidebar_searchChats")}
    class="w-full min-w-0 rounded-full border border-sidebar-border bg-sidebar px-3.5 py-1.5 text-xs text-sidebar-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-ring/50"
  />
</div>

{#if rss.runSearchQuery.trim()}
  <div class="sidebar-scroll flex-1 overflow-y-auto">
    {#if rss.searching && visibleSearchResults.length === 0}
      <div class="flex items-center justify-center py-10">
        <Spinner size="sm" />
      </div>
    {:else if !rss.searching && visibleSearchResults.length === 0}
      <div class="flex items-center justify-center px-3 py-10 text-center">
        <p class="text-xs text-muted-foreground">{t("runs_noMatching")}</p>
      </div>
    {:else}
      {#each visibleSearchResults as result}
        <button
          type="button"
          class="w-full text-left flex flex-col gap-0.5 px-3 py-2 hover:bg-sidebar-accent/50 transition-colors text-sidebar-foreground"
          onclick={() => {
            rss.runSearchQuery = "";
            rss.searchResults = [];
            onNavigateToChatRun(result.runId, {
              scrollTo: result.matchedEventId || result.matchedTs,
            });
          }}
        >
          <p class="text-[12px] min-w-0 line-clamp-2 break-all">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html highlightMatch(
              snippetAround(result.matchedText, rss.runSearchQuery, 80),
              rss.runSearchQuery,
            )}
          </p>
          <div class="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
            <span class="flex-1 min-w-0 truncate"
              >{result.runName || truncate(result.runPrompt, 30)}</span
            >
            <span class="ml-auto shrink-0">{relativeTime(result.matchedTs)}</span>
          </div>
        </button>
      {/each}
    {/if}
  </div>
{:else}
  <div class="sidebar-scroll flex-1 overflow-y-auto px-2 py-1">
    {#each enrichedProjectFolders as folder (folder.folderKey)}
      <ProjectFolderItem
        {folder}
        label={folder.isUncategorized ? t("sidebar_uncategorized") : cwdDisplayLabel(folder.cwd)}
        expanded={pss.expandedProjects.has(folder.folderKey)}
        {selectedRunId}
        onToggle={() => {
          const wasExpanded = pss.expandedProjects.has(folder.folderKey);
          onToggleProject(folder.folderKey);
          // When expanding a workspace folder, notify the chat page so it can
          // show the workspace overview in the main area.
          if (!wasExpanded && !folder.isUncategorized && folder.cwd) {
            onSelectWorkspace(folder.cwd);
          }
        }}
        onSelectConversation={onNavigateToChatRun}
        onDelete={onRequestDeleteConversation}
        onMoveToFolder={(runIds, folderId) => sfs.requestMove(runIds, folderId)}
        {selectedGroupKeys}
        {batchModeActive}
        onBatchClick={onToggleSelectConversation}
        onLongPressSelect={onEnterBatchMode}
        {onSessionDragStart}
        {onSessionDragMove}
        {onSessionDragEnd}
        onRemove={folder.isUncategorized ? undefined : () => onRequestRemoveProject(folder.cwd)}
        onNewChat={folder.isUncategorized ? undefined : () => onNewChatInFolder(folder.cwd)}
        onNewChatInSubFolder={folder.isUncategorized
          ? undefined
          : (sf) => onNewChatInSubFolder(folder.cwd, sf.folderId)}
        subFolders={folder.subFolders ?? []}
        scheduledTaskHubs={folder.scheduledTaskHubs ?? []}
        {selectedScheduledTaskId}
        onSelectScheduledHub={(taskId) => goto(`/scheduled-tasks/${taskId}`)}
        expandedSubFolders={sfs.expandedSubFolders}
        onToggleSubFolder={(k) => sfs.toggleSubFolder(k)}
        onCreateSubFolder={folder.isUncategorized
          ? undefined
          : () => sfs.openCreateDialog(folder.cwd)}
        onRenameSubFolder={(sf) => {
          const f = sfs.sessionFolders.find((x) => x.id === sf.folderId);
          if (f) sfs.openRenameDialog(f);
        }}
        onDeleteSubFolder={(sf) => {
          const f = sfs.sessionFolders.find((x) => x.id === sf.folderId);
          if (f) sfs.openDeleteDialog(f);
        }}
        dragOverSubFolderKey={dragOverFolderId ? `sf:${dragOverFolderId}` : null}
        dragOverUnfoldered={dragOverUnfolderedKey === folder.folderKey}
        {dragRunId}
        onOpenDirectory={folder.isUncategorized
          ? undefined
          : () => {
              openDirectoryInFinder(folder.cwd).catch(() => {});
            }}
        showMascot={mascotEnabled && !folder.isUncategorized}
        mascotStatus={getWorkspaceMascotStatus(folder)}
      />
    {/each}

    {#if enrichedProjectFolders.length === 0}
      <div class="flex flex-col items-center gap-2 px-3 py-6 text-center">
        <Icon name="check" size="md" class="text-muted-foreground/30" />
        <p class="text-xs text-muted-foreground">{t("sidebar_workingTreeClean")}</p>
      </div>
    {/if}
  </div>
  {#if selectedGroupKeys.size > 0}
    <div class="flex flex-col gap-0.5 border-t px-2 py-1.5 bg-sidebar-accent/30">
      <div class="flex items-center gap-1">
        <span class="text-[11px] text-muted-foreground px-1">
          {t("sidebar_batchSelected", { count: String(selectedGroupKeys.size) })}
        </span>
        <button
          type="button"
          class="ml-auto rounded px-1.5 py-0.5 text-[11px] text-destructive hover:bg-destructive/10 transition-colors"
          onclick={onBatchDeleteConfirm}
          title={t("sidebar_batchDelete")}
        >
          {t("sidebar_batchDelete")}
        </button>
        <button
          type="button"
          class="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent transition-colors"
          onclick={onClearBatchSelection}
          title={t("sidebar_batchClear")}
        >
          {t("sidebar_batchClear")}
        </button>
      </div>
      <p class="px-1 text-[10px] text-muted-foreground/60">
        {t("sidebar_batchModeHint")}
      </p>
    </div>
  {/if}
{/if}
