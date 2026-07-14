<script lang="ts">
  import type { Component } from "svelte";
  import EmptySidebarBody from "$lib/layout/sidebar-bodies/EmptySidebarBody.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import WindowDragArea from "$lib/components/WindowDragArea.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { getLastTarget } from "$lib/utils/remote-cwd";
  import type { PluginSection } from "$lib/utils/plugin-sections";
  import type { ConversationGroup, EnrichedProjectFolder } from "$lib/utils/sidebar-groups";
  import type { PromptSearchResult, TeamSummary } from "$lib/types";

  // The sidebar body components have heterogeneous prop shapes (some take
  // snippets, some take a string, some take an object map). The bodies
  // are lazy-loaded via `import()`, so the type system cannot statically
  // know which component will be mounted when a branch is taken. Use
  // `Component<any>` here, but every call site must use the EXPLICIT
  // `<C prop={value} />` form (not the `<C {prop} />` shorthand) — Svelte
  // 5 drops shorthand props when the target is `Component<any>`, and that
  // silent drop surfaces as a `$$props.filteredTeams.length` TypeError
  // on the receiver. See memory/svelte5-dynamic-component-shorthand.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type SidebarBodyComponent = Component<any>;

  interface Props {
    sidebarOpen: boolean;
    isChatPage: boolean;
    isPluginsPage: boolean;
    isExplorerPage: boolean;
    isTeamsPage: boolean;
    isScheduledTasksPage: boolean;
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
    onSelectWorkspace: (cwd: string) => void;
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
    onSelectWorkspace,
    onBatchDeleteConfirm,
    onClearBatchSelection,
  }: Props = $props();

  type SidebarBodyId =
    | "chat"
    | "explorer"
    | "teams"
    | "settings"
    | "scheduled-tasks"
    | "plugins";

  const BODY_LOADERS: Record<SidebarBodyId, () => Promise<{ default: SidebarBodyComponent }>> = {
    chat: () => import("$lib/layout/sidebar-bodies/ChatSidebarBody.svelte"),
    explorer: () => import("$lib/layout/sidebar-bodies/ExplorerSidebarBody.svelte"),
    teams: () => import("$lib/layout/sidebar-bodies/TeamsSidebarBody.svelte"),
    settings: () => import("$lib/layout/sidebar-bodies/SettingsSidebarBody.svelte"),
    "scheduled-tasks": () => import("$lib/layout/sidebar-bodies/ScheduledTasksSidebarBody.svelte"),
    plugins: () => import("$lib/layout/sidebar-bodies/PluginsSidebarBody.svelte"),
  };

  const activeBodyId = $derived.by((): SidebarBodyId | null => {
    if (isChatPage) return "chat";
    if (isExplorerPage) return "explorer";
    if (isTeamsPage) return "teams";
    if (isSettingsPage) return "settings";
    if (isScheduledTasksPage) return "scheduled-tasks";
    if (isPluginsPage) return "plugins";
    return null;
  });

  let BodyComponent = $state<SidebarBodyComponent | null>(null);
  let bodyLoadError = $state<string | null>(null);
  // Cache of already-loaded body components, keyed by bodyId. The lazy-load
  // machinery exists to keep the initial bundle small (chat / explorer /
  // teams / etc. body modules aren't parsed until first use), but once a
  // body has been loaded it should be reused instantly on subsequent
  // navigation without flashing a Spinner. Resets only when the layout
  // itself unmounts.
  const bodyCache = new Map<SidebarBodyId, SidebarBodyComponent>();

  $effect(() => {
    const bodyId = activeBodyId;
    if (!bodyId) {
      BodyComponent = null;
      bodyLoadError = null;
      return;
    }

    // Cache hit → swap in immediately, no spinner, no async round-trip.
    const cached = bodyCache.get(bodyId);
    if (cached) {
      BodyComponent = cached;
      bodyLoadError = null;
      return;
    }

    let cancelled = false;
    BodyComponent = null;
    bodyLoadError = null;

    void BODY_LOADERS[bodyId]()
      .then((mod) => {
        if (cancelled) return;
        bodyCache.set(bodyId, mod.default);
        BodyComponent = mod.default;
      })
      .catch(() => {
        if (cancelled) return;
        bodyLoadError = t("settings_tab_loadFailed");
      });

    return () => {
      cancelled = true;
    };
  });
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

<div class="sidebar-content-panel">
  <div
    class="sidebar-inner flex flex-col h-full relative"
    class:sidebar-inner-collapsed={!sidebarOpen}
  >
    <div class="relative shrink-0 h-[var(--miwarp-titlebar-band)]" aria-hidden="true">
      <WindowDragArea class="absolute inset-0" />
    </div>

    {#if bodyLoadError}
      <div class="flex flex-1 items-center justify-center px-3 py-6 text-center">
        <p class="text-xs text-destructive">{bodyLoadError}</p>
      </div>
    {:else if activeBodyId && !BodyComponent}
      <div class="flex flex-1 items-center justify-center py-12">
        <Spinner size="sm" />
      </div>
    {:else if BodyComponent}
      {@const C = BodyComponent}
      {#if activeBodyId === "chat"}
        <C
          {enrichedProjectFolders}
          {visibleSearchResults}
          {selectedRunId}
          {selectedScheduledTaskId}
          {mascotEnabled}
          {selectedGroupKeys}
          {batchModeActive}
          {dragRunId}
          {dragOverFolderId}
          {dragOverUnfolderedKey}
          {highlightMatch}
          {onNavigateToChatRun}
          {onToggleProject}
          {onRequestDeleteConversation}
          {onToggleSelectConversation}
          {onEnterBatchMode}
          {onSessionDragStart}
          {onSessionDragMove}
          {onSessionDragEnd}
          {onRequestRemoveProject}
          {onNewChatInFolder}
          {onNewChatInSubFolder}
          {onSelectWorkspace}
          {onBatchDeleteConfirm}
          {onClearBatchSelection}
        />
      {:else if activeBodyId === "explorer"}
        <C {explorerEmptyAction} />
      {:else if activeBodyId === "teams"}
        <C {filteredTeams} />
      {:else if activeBodyId === "plugins"}
        <C {pluginActiveSection} {pluginSections} {onPluginSectionChange} />
      {:else}
        <C />
      {/if}
    {:else}
      <EmptySidebarBody />
    {/if}
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[hsl(var(--miwarp-accent-primary)/0.3)] active:bg-[hsl(var(--miwarp-accent-primary)/0.5)] transition-colors z-10"
    onpointerdown={onStartResize}
  ></div>
</div>
