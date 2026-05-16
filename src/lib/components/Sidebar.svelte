<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ConversationGroup, ProjectFolder } from "$lib/utils/sidebar-groups";
  import SidebarSearch from "./SidebarSearch.svelte";
  import SidebarSessionItem from "./SidebarSessionItem.svelte";
  import SidebarProjectGroup from "./SidebarProjectGroup.svelte";
  import { t } from "$lib/i18n/index.svelte";

  interface Props {
    /** Whether the sidebar is visible */
    open?: boolean;
    /** Sidebar content panel width in pixels */
    width?: number;
    /** Current page label shown in header */
    pageLabel?: string;
    /** Project folders to render */
    projectFolders?: ProjectFolder[];
    /** Expanded folder keys */
    expandedFolders?: Set<string>;
    /** Currently selected run ID */
    selectedRunId?: string;
    /** Set of pinned session group keys */
    pinnedSessionIds?: Set<string>;
    /** Search query (controlled) */
    searchQuery?: string;
    /** Whether a search is in progress */
    searching?: boolean;
    /** Number of search results found */
    searchResultCount?: number;
    /** Callbacks */
    onToggleSidebar?: () => void;
    onNewChat?: () => void;
    onToggleFolder?: (folderKey: string) => void;
    onSelectConversation?: (runId: string) => void;
    onResume?: (runId: string, mode: "resume") => void;
    onDeleteConversation?: (conversation: ConversationGroup) => void;
    onRemoveProject?: (cwd: string) => void;
    onNewChatInFolder?: (cwd: string) => void;
    onSearch?: (query: string) => void;
    onClearSearch?: () => void;
    onPickFolder?: () => void;
    onPinSession?: (groupKey: string) => void;
    /** Label function for folder names */
    folderLabel?: (folder: ProjectFolder) => string;
    /** Default search placeholder */
    searchPlaceholder?: string;
    /** Extra slot content above the project tree (e.g. tab bar) */
    headerContent?: Snippet;
    /** Extra slot content below the project tree (e.g. footer actions) */
    footerContent?: Snippet;
    /** Snippet for rendering search results */
    searchResultsContent?: Snippet;
  }

  let {
    open = true,
    width = 280,
    pageLabel = "Chat",
    projectFolders = [],
    expandedFolders = new Set(),
    selectedRunId = "",
    pinnedSessionIds = new Set(),
    searchQuery = "",
    searching = false,
    searchResultCount = 0,
    onToggleSidebar: _onToggleSidebar,
    onNewChat,
    onToggleFolder,
    onSelectConversation,
    onResume,
    onDeleteConversation,
    onRemoveProject,
    onNewChatInFolder,
    onSearch,
    onClearSearch,
    onPickFolder,
    onPinSession,
    folderLabel,
    searchPlaceholder,
    headerContent,
    footerContent,
    searchResultsContent,
  }: Props = $props();

  const isSearching = $derived(searchQuery.trim().length > 0);

  function defaultFolderLabel(folder: ProjectFolder): string {
    if (folder.isUncategorized) return t("sidebar_uncategorized");
    // Extract last path segment
    const parts = folder.cwd.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts[parts.length - 1] ?? folder.cwd;
  }

  const resolveLabel = $derived(folderLabel ?? defaultFolderLabel);
</script>

{#if open}
  <aside
    class="flex flex-col h-full shrink-0 border-r border-sidebar-border relative overflow-hidden"
    style="
      width: {width}px;
      backdrop-filter: blur(var(--miwarp-glass-blur, 16px));
      -webkit-backdrop-filter: blur(var(--miwarp-glass-blur, 16px));
      background: hsla(var(--miwarp-glass-bg), var(--miwarp-glass-opacity, 0.72));
    "
  >
    <!-- Header -->
    <div class="flex h-12 shrink-0 items-center gap-2 border-b border-sidebar-border px-3">
      <span class="flex-1 min-w-0 truncate text-sm font-semibold text-sidebar-foreground">
        {pageLabel}
      </span>
      {#if onNewChat}
        <button
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          onclick={() => onNewChat?.()}
          title={t("sidebar_newConversation")}
          aria-label={t("sidebar_newConversation")}
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
      {/if}
    </div>

    <!-- Optional header content (tab bar, etc.) -->
    {#if headerContent}
      {@render headerContent()}
    {/if}

    <!-- Search -->
    <div class="px-2 pt-2 pb-1 shrink-0">
      <SidebarSearch
        placeholder={searchPlaceholder ?? t("sidebar_searchChats")}
        value={searchQuery}
        {onSearch}
        onClear={onClearSearch}
      />
      {#if isSearching}
        {#if searching}
          <p class="text-[11px] text-muted-foreground px-1 pt-0.5">{t("sidebar_searching")}</p>
        {:else if searchResultCount > 0}
          <p
            class="flex items-center justify-between text-[11px] text-muted-foreground px-1 pt-0.5"
          >
            <span>{searchResultCount} result{searchResultCount !== 1 ? "s" : ""}</span>
          </p>
        {/if}
      {/if}
    </div>

    <!-- Content area -->
    <div class="flex-1 overflow-y-auto px-2 py-1">
      {#if isSearching}
        <!-- Searching indicator -->
        {#if searching && searchResultCount === 0}
          <div class="flex items-center justify-center py-10">
            <div
              class="h-4 w-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin"
            ></div>
          </div>
        {:else if !searching && searchResultCount === 0}
          <div class="flex flex-col items-center gap-2 px-3 py-10 text-center">
            <svg
              class="h-8 w-8 text-muted-foreground/30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <p class="text-xs text-muted-foreground">{t("sidebar_noSessions")}</p>
          </div>
        {:else}
          <!-- Search results rendered via snippet -->
          {@render searchResultsContent?.()}
        {/if}
      {:else}
        <!-- Project folder tree -->
        {#each projectFolders as folder (folder.folderKey)}
          <SidebarProjectGroup
            {folder}
            label={resolveLabel(folder)}
            expanded={expandedFolders.has(folder.folderKey)}
            showRemove={!folder.isUncategorized}
            onToggle={() => onToggleFolder?.(folder.folderKey)}
            onRemove={folder.isUncategorized ? undefined : () => onRemoveProject?.(folder.cwd)}
            onNewChat={folder.isUncategorized ? undefined : () => onNewChatInFolder?.(folder.cwd)}
          >
            {#each folder.conversations as conv (conv.groupKey)}
              <SidebarSessionItem
                conversation={conv}
                selected={conv.runs.some((r) => r.id === selectedRunId)}
                pinned={pinnedSessionIds.has(conv.groupKey)}
                onclick={() => onSelectConversation?.(conv.latestRun.id)}
                onresume={onResume}
                ondelete={onDeleteConversation}
                onpin={onPinSession ? () => onPinSession(conv.groupKey) : undefined}
              />
            {/each}
          </SidebarProjectGroup>
        {/each}

        <!-- Open folder button -->
        {#if onPickFolder}
          <button
            class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
            onclick={() => onPickFolder?.()}
          >
            <svg
              class="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            <span>{t("project_openFolder")}</span>
          </button>
        {/if}

        <!-- Empty state -->
        {#if projectFolders.length === 0}
          <div class="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <svg
              class="h-10 w-10 text-muted-foreground/20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
            </svg>
            <p class="text-xs text-muted-foreground">
              {t("sidebar_noConversationsYet")}<br />{t("sidebar_startNewChat")}
            </p>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Optional footer content -->
    {#if footerContent}
      {@render footerContent()}
    {/if}
  </aside>
{/if}
