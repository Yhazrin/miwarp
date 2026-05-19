<script lang="ts">
  import type { Snippet } from "svelte";
  import type {
    ProjectFolder,
    ConversationGroup,
    SessionFolderGroup,
  } from "$lib/utils/sidebar-groups";
  import ConversationItem from "./ConversationItem.svelte";
  import VirtualList from "./VirtualList.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { dbgWarn } from "$lib/utils/debug";

  const PAGE_SIZE = 20;
  const VIRTUAL_THRESHOLD = 40;
  const ITEM_HEIGHT = 52;

  type BaseProps = {
    folder: ProjectFolder;
    label: string;
    expanded?: boolean;
    onToggle: () => void;
    showCount?: boolean;
    onRemove?: () => void;
    isDragOver?: boolean;
    onDragOver?: (e: DragEvent) => void;
    onDragLeave?: (e: DragEvent) => void;
    onDrop?: (e: DragEvent) => void;
    /** Nested logical sub-folders inside this project path. */
    subFolders?: SessionFolderGroup[];
    expandedSubFolders?: Set<string>;
    onToggleSubFolder?: (folderKey: string) => void;
    onCreateSubFolder?: () => void;
    onRenameSubFolder?: (sf: SessionFolderGroup) => void;
    onDeleteSubFolder?: (sf: SessionFolderGroup) => void;
    /** Drag-over state for a specific sub-folder (folderKey). */
    dragOverSubFolderKey?: string | null;
    onDragOverSubFolder?: (folderKey: string, folderId: string) => void;
    onDragLeaveSubFolder?: () => void;
    onDropOnSubFolder?: (folderId: string) => void;
    /** Workspace-level actions */
    onOpenDirectory?: () => void;
    onRenameWorkspace?: () => void;
    onWorkspaceSettings?: () => void;
  };

  type ChatProps = BaseProps & {
    children?: never;
    selectedRunId?: string;
    onSelectConversation: (runId: string) => void;
    onResume: (runId: string, mode: "resume") => void;
    onDelete?: (conversation: ConversationGroup) => void;
    onMoveToFolder?: (runIds: string[]) => void;
    onNewChat?: () => void;
    selectedGroupKeys?: Set<string>;
    onBatchClick?: (groupKey: string, e: MouseEvent) => void;
    onDragStartConversation?: (e: DragEvent, runId: string) => void;
    onDragEndConversation?: () => void;
  };

  type CustomProps = BaseProps & {
    children: Snippet;
    selectedRunId?: never;
    onSelectConversation?: never;
    onResume?: never;
    onDelete?: never;
    onMoveToFolder?: never;
    onNewChat?: never;
    selectedGroupKeys?: never;
    onBatchClick?: never;
    onDragStartConversation?: never;
    onDragEndConversation?: never;
  };

  let {
    folder,
    label,
    expanded = false,
    onToggle,
    showCount = true,
    onRemove,
    children,
    selectedRunId = "",
    onSelectConversation,
    onResume,
    onDelete,
    onMoveToFolder,
    onNewChat,
    selectedGroupKeys,
    onBatchClick,
    isDragOver = false,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragStartConversation,
    onDragEndConversation,
    subFolders = [],
    expandedSubFolders = new Set(),
    onToggleSubFolder,
    onCreateSubFolder,
    onRenameSubFolder,
    onDeleteSubFolder,
    dragOverSubFolderKey = null,
    onDragOverSubFolder,
    onDragLeaveSubFolder,
    onDropOnSubFolder,
    onOpenDirectory,
    onRenameWorkspace,
    onWorkspaceSettings,
  }: ChatProps | CustomProps = $props();

  let visibleCount = $state(PAGE_SIZE);

  // Header action menus
  let addMenuOpen = $state(false);
  let addMenuX = $state(0);
  let addMenuY = $state(0);
  let moreMenuOpen = $state(false);
  let moreMenuX = $state(0);
  let moreMenuY = $state(0);

  function openAddMenu(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    // Close more menu first
    if (moreMenuOpen) moreMenuOpen = false;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    addMenuX = rect.right - 80; // align right edge of menu to button right
    addMenuY = rect.bottom + 2;
    addMenuOpen = true;
  }

  function openMoreMenu(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    // Close add menu first
    if (addMenuOpen) addMenuOpen = false;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    moreMenuX = rect.right - 100;
    moreMenuY = rect.bottom + 2;
    moreMenuOpen = true;
  }

  function closeAllMenus() {
    addMenuOpen = false;
    moreMenuOpen = false;
  }

  // Close menus when right-clicking elsewhere
  $effect(() => {
    if (addMenuOpen || moreMenuOpen) {
      const handler = () => closeAllMenus();
      window.addEventListener("close-all-context-menus", handler);
      window.addEventListener("click", handler, { once: true });
      return () => {
        window.removeEventListener("close-all-context-menus", handler);
        window.removeEventListener("click", handler);
      };
    }
  });

  // Menu items
  const addMenuItems = $derived([
    {
      id: "new-chat",
      label: t("sidebar_newChatInFolder") ?? "新对话",
      icon: "play" as const,
    },
    ...(onCreateSubFolder
      ? [
          {
            id: "new-folder",
            label: t("sidebar_createFolder") ?? "新建文件夹",
            icon: "folder" as const,
          },
        ]
      : []),
  ]);

  const moreMenuItems = $derived([
    {
      id: "open-dir",
      label: t("sidebar_openDirectory") ?? "打开目录",
      icon: "folder" as const,
      disabled: !onOpenDirectory,
    },
    {
      id: "rename",
      label: t("sidebar_renameWorkspace") ?? "重命名 Workspace",
      icon: "rename" as const,
      disabled: !onRenameWorkspace,
    },
    {
      id: "settings",
      label: t("workspace_settings") ?? "Workspace 设置",
      icon: "more" as const,
      disabled: !onWorkspaceSettings,
      separatorBefore: true,
    },
  ]);

  function handleAddMenuSelect(id: string) {
    addMenuOpen = false;
    switch (id) {
      case "new-chat":
        onNewChat?.();
        break;
      case "new-folder":
        onCreateSubFolder?.();
        break;
    }
  }

  function handleMoreMenuSelect(id: string) {
    moreMenuOpen = false;
    switch (id) {
      case "open-dir":
        onOpenDirectory?.();
        break;
      case "rename":
        onRenameWorkspace?.();
        break;
      case "settings":
        onWorkspaceSettings?.();
        break;
    }
  }

  // Reset visible count when folder collapses
  $effect(() => {
    if (!expanded) visibleCount = PAGE_SIZE;
  });

  // Auto-expand visible count if selected run is beyond current page
  $effect(() => {
    if (!expanded || !selectedRunId || children) return;
    const idx = folder.conversations.findIndex((conv) =>
      conv.runs.some((r) => r.id === selectedRunId),
    );
    if (idx >= 0 && idx >= visibleCount) {
      visibleCount = idx + 1;
    }
  });

  // Skip conversation-related derivations when using children snippet
  const visibleConversations = $derived(
    children ? [] : folder.conversations.slice(0, visibleCount),
  );
  const hiddenCount = $derived(children ? 0 : folder.conversationCount - visibleCount);
  const hasMore = $derived(hiddenCount > 0);

  function showMore() {
    visibleCount = Math.min(visibleCount + PAGE_SIZE, folder.conversationCount);
  }

  function isConvSelected(conv: { runs: { id: string }[] }): boolean {
    return conv.runs.some((r) => r.id === selectedRunId);
  }

  // Warn once if conversation-mode callbacks are missing
  let warnedMissingCallbacks = false;
  $effect(() => {
    if (children) {
      // children mode switched back to conversation mode — reset latch
      warnedMissingCallbacks = false;
      return;
    }
    if (!warnedMissingCallbacks && (!onSelectConversation || !onResume)) {
      warnedMissingCallbacks = true;
      if (!onSelectConversation)
        dbgWarn("ProjectFolderItem", "onSelectConversation missing in conversation mode");
      if (!onResume) dbgWarn("ProjectFolderItem", "onResume missing in conversation mode");
    }
  });
</script>

<div class="group/folder mb-0.5">
  <!-- Folder header (also serves as drop target) -->
  <div
    class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors cursor-pointer
      {isDragOver ? 'bg-primary/15 ring-1 ring-primary/40' : ''}"
    role="button"
    tabindex="0"
    onclick={onToggle}
    onkeydown={(e) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggle();
      }
    }}
    title={folder.isUncategorized ? label : folder.cwd}
    aria-expanded={expanded}
    aria-label={label}
    ondragover={onDragOver
      ? (e) => {
          e.preventDefault();
          onDragOver!(e);
        }
      : undefined}
    ondragleave={onDragLeave}
    ondrop={onDrop
      ? (e) => {
          e.preventDefault();
          onDrop!(e);
        }
      : undefined}
  >
    <!-- Chevron -->
    <svg
      class="h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform duration-150 {expanded
        ? 'rotate-90'
        : ''}"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
    <!-- Icon -->
    {#if folder.isUncategorized}
      <!-- Inbox icon -->
      <svg
        class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path
          d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
        />
      </svg>
    {:else}
      <!-- Folder icon -->
      <svg
        class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    {/if}
    <!-- Label -->
    <span class="truncate">{label}</span>
    <!-- Count badge -->
    {#if showCount && folder.conversationCount > 0}
      <span
        class="shrink-0 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium text-muted-foreground"
      >
        {folder.conversationCount}
      </span>
    {/if}

    <!-- Action buttons (low opacity, visible on hover) -->
    <div
      class="ml-auto flex items-center gap-0.5 opacity-0 group-hover/folder:opacity-100 transition-opacity shrink-0"
    >
      <!-- + button (new chat/folder) -->
      {#if onNewChat || onCreateSubFolder}
        <button
          class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          aria-label={t("sidebar_newChat")}
          onclick={openAddMenu}
        >
          <svg
            class="h-3 w-3"
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
      <!-- ⋯ button (more options) -->
      <button
        class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
        aria-label={t("sidebar_moreOptions")}
        onclick={openMoreMenu}
      >
        <svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>
      <!-- Remove button (×) -->
      {#if onRemove}
        <button
          class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          aria-label={t("sidebar_removeProject")}
          onclick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onRemove?.();
            }
          }}
        >
          <svg
            class="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
          >
        </button>
      {/if}
    </div>
  </div>

  <!-- Add menu -->
  {#if addMenuOpen}
    <ContextMenu
      x={addMenuX}
      y={addMenuY}
      items={addMenuItems}
      onSelect={handleAddMenuSelect}
      onClose={() => (addMenuOpen = false)}
    />
  {/if}

  <!-- More menu -->
  {#if moreMenuOpen}
    <ContextMenu
      x={moreMenuX}
      y={moreMenuY}
      items={moreMenuItems}
      onSelect={handleMoreMenuSelect}
      onClose={() => (moreMenuOpen = false)}
    />
  {/if}

  <!-- Expanded children -->
  {#if expanded}
    <div class="pl-3">
      {#if children}
        {@render children()}
      {:else}
        <!-- Sub-folders (logical folders nested inside this project) -->
        {#if subFolders.length > 0 || onCreateSubFolder}
          <div class="mb-1">
            {#each subFolders as sf (sf.folderKey)}
              {@const sfExpanded = expandedSubFolders.has(sf.folderKey)}
              {@const sfDragOver = dragOverSubFolderKey === sf.folderKey}
              <div class="group/sf mb-0.5">
                <div
                  class="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-sidebar-foreground hover:bg-sidebar-accent/40 transition-colors cursor-pointer
                    {sfDragOver ? 'bg-primary/15 ring-1 ring-primary/40' : ''}"
                  role="button"
                  tabindex="0"
                  onclick={() => onToggleSubFolder?.(sf.folderKey)}
                  onkeydown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onToggleSubFolder?.(sf.folderKey);
                    }
                  }}
                  ondragover={onDragOverSubFolder
                    ? (e) => {
                        e.preventDefault();
                        onDragOverSubFolder!(sf.folderKey, sf.folderId!);
                      }
                    : undefined}
                  ondragleave={onDragLeaveSubFolder}
                  ondrop={onDropOnSubFolder
                    ? (e) => {
                        e.preventDefault();
                        onDropOnSubFolder!(sf.folderId!);
                      }
                    : undefined}
                >
                  <svg
                    class="h-2.5 w-2.5 shrink-0 text-muted-foreground/50 transition-transform duration-150 {sfExpanded
                      ? 'rotate-90'
                      : ''}"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"><path d="M9 18l6-6-6-6" /></svg
                  >
                  <!-- Tag icon for logical sub-folder -->
                  <svg
                    class="h-3 w-3 shrink-0 text-muted-foreground/60"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><path
                      d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.41 0l9.29-9.29a1 1 0 0 0 0-1.41z"
                    /><circle cx="7" cy="7" r="1" /></svg
                  >
                  <span class="truncate flex-1">{sf.name}</span>
                  {#if sf.conversationCount > 0}
                    <span
                      class="shrink-0 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium text-muted-foreground"
                    >
                      {sf.conversationCount}
                    </span>
                  {/if}
                  <!-- Hover actions -->
                  <div
                    class="shrink-0 flex gap-0.5 opacity-0 group-hover/sf:opacity-100 transition-opacity ml-0.5"
                  >
                    {#if onRenameSubFolder}
                      <button
                        class="flex h-4 w-4 items-center justify-center rounded hover:bg-sidebar-accent/80 text-muted-foreground hover:text-sidebar-foreground"
                        title={t("sidebar_renameFolder")}
                        onclick={(e) => {
                          e.stopPropagation();
                          onRenameSubFolder?.(sf);
                        }}
                      >
                        <svg
                          class="h-2.5 w-2.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        </svg>
                      </button>
                    {/if}
                    {#if onDeleteSubFolder}
                      <button
                        class="flex h-4 w-4 items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                        title={t("sidebar_removeFolder") || "删除文件夹"}
                        onclick={(e) => {
                          e.stopPropagation();
                          onDeleteSubFolder?.(sf);
                        }}
                      >
                        <svg
                          class="h-2.5 w-2.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                        </svg>
                      </button>
                    {/if}
                  </div>
                </div>
                <!-- Sub-folder sessions -->
                {#if sfExpanded}
                  <div class="pl-3">
                    {#each sf.conversations as conv (conv.groupKey)}
                      <ConversationItem
                        conversation={conv}
                        selected={conv.runs.some((r) => r.id === selectedRunId)}
                        batchSelected={selectedGroupKeys?.has(conv.groupKey) ?? false}
                        onclick={() => onSelectConversation?.(conv.latestRun.id)}
                        onresume={onResume}
                        ondelete={onDelete}
                        onmovetofolder={onMoveToFolder}
                        {onBatchClick}
                        ondragstart={onDragStartConversation}
                        ondragend={onDragEndConversation}
                      />
                    {/each}
                    {#if sf.conversations.length === 0}
                      <p class="px-3 py-1.5 text-[11px] text-muted-foreground/50 italic">
                        {t("sidebar_folderEmpty") || "暂无会话"}
                      </p>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        <!-- Empty state -->
        {#if folder.conversations.length === 0 && subFolders.length === 0}
          <p class="px-3 py-2 text-[11px] text-muted-foreground/40 italic">
            {t("sidebar_noConversationsInFolder") || "暂无会话，点击 + 新建"}
          </p>
        {/if}

        <!-- Unfoldered sessions in this project -->
        {#if folder.conversations.length > 0 && subFolders.length > 0}
          <div class="flex items-center px-2 py-0.5 mt-0.5 mb-0.5">
            <span class="text-[10px] text-muted-foreground/50 uppercase tracking-wider"
              >{t("sidebar_uncategorized") || "未归类"}</span
            >
          </div>
        {/if}
        {#if visibleConversations.length >= VIRTUAL_THRESHOLD}
          <VirtualList items={visibleConversations} itemHeight={ITEM_HEIGHT} class="max-h-[60vh]">
            {#snippet item(conv)}
              <ConversationItem
                conversation={conv}
                selected={isConvSelected(conv)}
                batchSelected={selectedGroupKeys?.has(conv.groupKey) ?? false}
                onclick={() => onSelectConversation?.(conv.latestRun.id)}
                onresume={onResume}
                ondelete={onDelete}
                onmovetofolder={onMoveToFolder}
                {onBatchClick}
                ondragstart={onDragStartConversation}
                ondragend={onDragEndConversation}
              />
            {/snippet}
          </VirtualList>
        {:else}
          {#each visibleConversations as conv (conv.groupKey)}
            <ConversationItem
              conversation={conv}
              selected={isConvSelected(conv)}
              batchSelected={selectedGroupKeys?.has(conv.groupKey) ?? false}
              onclick={() => onSelectConversation?.(conv.latestRun.id)}
              onresume={onResume}
              ondelete={onDelete}
              onmovetofolder={onMoveToFolder}
              {onBatchClick}
              ondragstart={onDragStartConversation}
              ondragend={onDragEndConversation}
            />
          {/each}
        {/if}
        {#if hasMore}
          <button
            class="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 rounded-md transition-colors"
            onclick={showMore}
          >
            {t("sidebar_showMore", { count: String(Math.min(PAGE_SIZE, hiddenCount)) })}
          </button>
        {/if}
      {/if}
    </div>
  {/if}
</div>
