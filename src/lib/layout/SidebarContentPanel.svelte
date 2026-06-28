<script lang="ts">
  import { goto } from "$app/navigation";
  import { getContext } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import ProjectFolderItem from "$lib/components/ProjectFolderItem.svelte";
  import SettingsSidebar from "$lib/components/settings/SettingsSidebar.svelte";
  import ScheduledTasksSidebar from "$lib/components/ScheduledTasksSidebar.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import WorkbenchSidebar from "$lib/components/workbench/WorkbenchSidebar.svelte";
  import WindowDragArea from "$lib/components/WindowDragArea.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { explorerTreeStore as ets } from "$lib/layout/explorer-tree-store.svelte";
  import { projectSelectionStore as pss } from "$lib/layout/project-selection-store.svelte";
  import { runsSidebarStore as rss } from "$lib/layout/runs-sidebar-store.svelte";
  import { sessionFolderStore as sfs } from "$lib/layout/session-folder-store.svelte";
  import { teamSidebarStore as tss } from "$lib/layout/team-sidebar-store.svelte";
  import ExplorerTreeNodes from "$lib/layout/ExplorerTreeNodes.svelte";
  import type { TeamStore } from "$lib/stores/team-store.svelte";
  import { openDirectoryInFinder } from "$lib/api";
  import type { PluginSection } from "$lib/utils/plugin-sections";
  import type { ConversationGroup, EnrichedProjectFolder } from "$lib/utils/sidebar-groups";
  import { getWorkspaceMascotStatus } from "$lib/utils/sidebar-groups";
  import { cwdDisplayLabel, truncate, snippetAround, relativeTime } from "$lib/utils/format";
  import { getLastTarget } from "$lib/utils/remote-cwd";
  import type { PromptSearchResult, TeamSummary } from "$lib/types";

  interface Props {
    sidebarOpen: boolean;
    isChatPage: boolean;
    isPluginsPage: boolean;
    isExplorerPage: boolean;
    isTeamsPage: boolean;
    isScheduledTasksPage: boolean;
    isWorkbenchPage: boolean;
    isSettingsPage: boolean;
    pluginActiveSection: string;
    pluginSections: PluginSection[];
    enrichedProjectFolders: EnrichedProjectFolder[];
    visibleSearchResults: PromptSearchResult[];
    filteredTeams: TeamSummary[];
    selectedRunId: string;
    selectedScheduledTaskId: string;
    mascotEnabled: boolean;
    selectedGroupKeys: Set<string>;
    batchModeActive: boolean;
    dragRunId: string | null;
    dragOverFolderId: string | null;
    dragOverUnfolderedKey: string | null;
    highlightMatch: (text: string, query: string) => string;
    onStartResize: (e: PointerEvent) => void;
    onPluginSectionChange: (sectionId: string) => void;
    onPickFolder: () => void;
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
    onBatchDeleteConfirm: () => void;
    onClearBatchSelection: () => void;
  }

  let {
    sidebarOpen,
    isChatPage,
    isPluginsPage,
    isExplorerPage,
    isTeamsPage,
    isScheduledTasksPage,
    isWorkbenchPage,
    isSettingsPage,
    pluginActiveSection,
    pluginSections,
    enrichedProjectFolders,
    visibleSearchResults,
    filteredTeams,
    selectedRunId,
    selectedScheduledTaskId,
    mascotEnabled,
    selectedGroupKeys,
    batchModeActive,
    dragRunId,
    dragOverFolderId,
    dragOverUnfolderedKey,
    highlightMatch,
    onStartResize,
    onPluginSectionChange,
    onPickFolder,
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
    onBatchDeleteConfirm,
    onClearBatchSelection,
  }: Props = $props();

  const teamStore = getContext<TeamStore>("teamStore");
</script>

{#snippet explorerEmptyAction()}
  {#if !getLastTarget()}
    <button
      type="button"
      class="mt-2 rounded-md border border-sidebar-border bg-sidebar px-3 py-1.5 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
      onclick={onPickFolder}
    >
      {t("sidebar_openFolder")}
    </button>
  {/if}
{/snippet}

{#snippet treeNodes(nodes: import("$lib/layout/explorer-tree-store.svelte").TreeNode[])}
  <ExplorerTreeNodes
    {nodes}
    selectedPath={ets.explorerSelectedFile}
    onToggle={(node) => ets.toggleFolder(node)}
    onSelect={(node) => ets.selectFile(node)}
    onRetry={(node) => ets.retryFolder(node)}
  />
{/snippet}

<div class="sidebar-content-panel">
  <div
    class="sidebar-inner flex flex-col h-full relative"
    class:sidebar-inner-collapsed={!sidebarOpen}
  >
    <div class="relative shrink-0 h-[var(--miwarp-titlebar-band)]" aria-hidden="true">
      <WindowDragArea class="absolute inset-0" />
    </div>
    {#if isChatPage}
      <div class="no-drag relative z-10 shrink-0 px-3 pb-2.5 pt-1">
        <input
          type="text"
          bind:value={rss.runSearchQuery}
          oninput={() => rss.onDeepQueryInput()}
          placeholder={t("sidebar_searchChats")}
          class="w-full min-w-0 rounded-full border border-sidebar-border bg-sidebar px-3.5 py-1.5 text-xs text-sidebar-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-ring/50"
        />
      </div>
    {/if}

    {#if isPluginsPage}
      <div class="flex-1 overflow-y-auto py-2">
        {#each pluginSections as section}
          {@const isActive = pluginActiveSection === section.id}
          <button
            type="button"
            class="flex w-full items-center gap-2 py-2 px-3 text-xs font-medium transition-colors
                  {isActive
              ? 'bg-sidebar-accent text-sidebar-foreground'
              : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
            onclick={() => onPluginSectionChange(section.id)}
          >
            {#if section.icon === "overview"}
              <svg
                class="h-3.5 w-3.5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><rect width="7" height="7" x="3" y="3" rx="1" /><rect
                  width="7"
                  height="7"
                  x="14"
                  y="3"
                  rx="1"
                /><rect width="7" height="7" x="14" y="14" rx="1" /><rect
                  width="7"
                  height="7"
                  x="3"
                  y="14"
                  rx="1"
                /></svg
              >
            {:else if section.icon === "sparkles"}
              <svg
                class="h-3.5 w-3.5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path
                  d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"
                /></svg
              >
            {:else if section.icon === "sources"}
              <svg
                class="h-3.5 w-3.5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path
                  d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
                /><path d="M8 7h8" /><path d="M8 11h8" /></svg
              >
            {:else if section.icon === "server"}
              <svg
                class="h-3.5 w-3.5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><rect width="20" height="8" x="2" y="2" rx="2" ry="2" /><rect
                  width="20"
                  height="8"
                  x="2"
                  y="14"
                  rx="2"
                  ry="2"
                /><line x1="6" x2="6.01" y1="6" y2="6" /><line
                  x1="6"
                  x2="6.01"
                  y1="18"
                  y2="18"
                /></svg
              >
            {:else if section.icon === "webhook"}
              <svg
                class="h-3.5 w-3.5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path
                  d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"
                /><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" /><path
                  d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8H12"
                /></svg
              >
            {:else if section.icon === "package"}
              <svg
                class="h-3.5 w-3.5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path d="m7.5 4.27 9 5.15" /><path
                  d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
                /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg
              >
            {:else if section.icon === "agents"}
              <svg
                class="h-3.5 w-3.5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path
                  d="M2 14h2"
                /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></svg
              >
            {/if}
            <span class="min-w-0 truncate">{section.label()}</span>
          </button>
        {/each}
      </div>
    {:else if isExplorerPage}
      <div class="flex-1 overflow-y-auto px-1 py-1">
        {#if !pss.projectCwd}
          {@const lastRemote = getLastTarget()}
          <EmptyState
            iconName="folder-open"
            title={lastRemote
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
          {@render treeNodes(ets.fileTree)}
        {/if}
      </div>
    {:else if isTeamsPage}
      <div class="px-2 pt-2 pb-1 shrink-0 flex items-center justify-between gap-2">
        <input
          type="text"
          bind:value={tss.teamStoreSearchQuery}
          placeholder={t("sidebar_searchTeams")}
          class="w-full min-w-0 rounded-md border border-sidebar-border bg-sidebar px-2.5 py-1.5 text-xs text-sidebar-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-ring/50"
        />
        <a
          href="/teams"
          class="shrink-0 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
          title={t("teamsPage_quickLaunch")}
        >
          +
        </a>
      </div>
      <div class="flex-1 overflow-y-auto px-2 py-1">
        {#if teamStore.loading}
          <div class="flex items-center justify-center py-6">
            <Spinner size="sm" />
          </div>
        {:else if filteredTeams.length === 0}
          <div class="flex flex-col items-center gap-1.5 px-3 py-6 text-center">
            <p class="text-xs text-muted-foreground">{t("sidebar_noActiveTeams")}</p>
            <a
              href="/teams"
              class="text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
            >
              {t("teamsPage_quickLaunch")} →
            </a>
          </div>
        {:else}
          {#each filteredTeams as team}
            <button
              type="button"
              class="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors mb-0.5
                      {teamStore.selectedTeam === team.name
                ? 'bg-sidebar-accent text-sidebar-foreground'
                : 'hover:bg-sidebar-accent/50 text-sidebar-foreground'}"
              onclick={() => teamStore.selectTeam(team.name)}
            >
              <div class="flex items-center gap-1.5">
                <span class="h-2 w-2 rounded-full bg-miwarp-status-info shrink-0"></span>
                <span class="text-[13px] font-medium min-w-0 truncate">{team.name}</span>
              </div>
              {#if team.description}
                <p class="text-xs text-muted-foreground truncate pl-3.5">
                  {team.description}
                </p>
              {/if}
              <div class="flex items-center gap-2 pl-3.5 text-xs text-muted-foreground">
                <span>{t("sidebar_members", { count: String(team.member_count) })}</span>
                <span>{t("sidebar_tasks", { count: String(team.task_count) })}</span>
              </div>
            </button>
          {/each}
        {/if}
      </div>
    {:else if isSettingsPage}
      <SettingsSidebar />
    {:else if isScheduledTasksPage}
      <ScheduledTasksSidebar />
    {:else if isWorkbenchPage}
      <WorkbenchSidebar {onPickFolder} />
    {:else if isChatPage}
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
              label={folder.isUncategorized
                ? t("sidebar_uncategorized")
                : cwdDisplayLabel(folder.cwd)}
              expanded={pss.expandedProjects.has(folder.folderKey)}
              {selectedRunId}
              onToggle={() => onToggleProject(folder.folderKey)}
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
              onRemove={folder.isUncategorized
                ? undefined
                : () => onRequestRemoveProject(folder.cwd)}
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
    {/if}
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[hsl(var(--miwarp-accent-primary)/0.3)] active:bg-[hsl(var(--miwarp-accent-primary)/0.5)] transition-colors z-10"
    onpointerdown={onStartResize}
  ></div>
</div>
