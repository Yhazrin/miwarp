<script lang="ts">
  import type { Snippet } from "svelte";
  import type {
    ProjectFolder,
    ConversationGroup,
    SessionFolderGroup,
    ScheduledTaskHubGroup,
  } from "$lib/utils/sidebar-groups";
  import ConversationItem from "./ConversationItem.svelte";
  import SidebarScheduledTaskHubItem from "./SidebarScheduledTaskHubItem.svelte";
  import VirtualList from "./VirtualList.svelte";
  import ContextMenu, { type MenuItem } from "./ContextMenu.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { slide } from "svelte/transition";
  import { SESSION_DROP_FOLDER_ATTR } from "$lib/utils/session-drag-state";
  import { dbgWarn } from "$lib/utils/debug";
  import ClaudeCanvas from "./ClaudeCanvas.svelte";

  const PAGE_SIZE = 20;
  const VIRTUAL_THRESHOLD = 40;
  const ITEM_HEIGHT = 44;

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
    /** Scheduled task hubs grouped under this workspace. */
    scheduledTaskHubs?: ScheduledTaskHubGroup[];
    selectedScheduledTaskId?: string;
    onSelectScheduledHub?: (taskId: string) => void;
    expandedSubFolders?: Set<string>;
    onToggleSubFolder?: (folderKey: string) => void;
    onCreateSubFolder?: () => void;
    onRenameSubFolder?: (sf: SessionFolderGroup) => void;
    onDeleteSubFolder?: (sf: SessionFolderGroup) => void;
    /** Drag-over state for a specific sub-folder (folderKey). */
    dragOverSubFolderKey?: string | null;
    /** ID of the run currently being dragged (used to dim the dragged conversation). */
    dragRunId?: string | null;
    onDragOverSubFolder?: (folderKey: string, folderId: string) => void;
    onDropOnSubFolder?: (folderId: string) => void;
    /** Workspace-level actions */
    onOpenDirectory?: () => void;
    onRenameWorkspace?: () => void;
    onWorkspaceSettings?: () => void;
    /** Whether this workspace has a running project */
    isRunning?: boolean;
    /** Mascot animation status: idle, running, waiting, done */
    mascotStatus?: "idle" | "running" | "waiting" | "done";
    /** Whether to show the canvas mascot */
    showMascot?: boolean;
    /** Callback when mascot is clicked — e.g. to open a panel */
    onMascotClick?: () => void;
  };

  type ChatProps = BaseProps & {
    children?: never;
    selectedRunId?: string;
    onSelectConversation: (runId: string) => void;
    onResume: (runId: string, mode: "resume") => void;
    onDelete?: (conversation: ConversationGroup) => void;
    onMoveToFolder?: (runIds: string[], folderId?: string | null) => void;
    onNewChat?: () => void;
    selectedGroupKeys?: Set<string>;
    onBatchClick?: (groupKey: string, e: MouseEvent) => void;
    batchModeActive?: boolean;
    onLongPressSelect?: (groupKey: string) => void;
    onSessionDragStart?: (runId: string, label: string, e: PointerEvent) => void;
    onSessionDragMove?: (e: PointerEvent) => void;
    onSessionDragEnd?: (e: PointerEvent) => void;
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
    batchModeActive?: never;
    onLongPressSelect?: never;
    onSessionDragStart?: never;
    onSessionDragMove?: never;
    onSessionDragEnd?: never;
  };

  let {
    folder,
    label,
    expanded = false,
    onToggle,
    showCount: _showCount = true,
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
    batchModeActive = false,
    onLongPressSelect,
    onSessionDragStart,
    onSessionDragMove,
    onSessionDragEnd,
    isDragOver = false,
    onDragOver,
    onDragLeave,
    onDrop,
    subFolders = [],
    scheduledTaskHubs = [],
    selectedScheduledTaskId = "",
    onSelectScheduledHub,
    expandedSubFolders = new Set(),
    onToggleSubFolder,
    onCreateSubFolder,
    onRenameSubFolder,
    onDeleteSubFolder,
    dragOverSubFolderKey = null,
    dragRunId = null,
    onDragOverSubFolder: _onDragOverSubFolder,
    onDropOnSubFolder: _onDropOnSubFolder,
    onOpenDirectory,
    onRenameWorkspace,
    onWorkspaceSettings,
    isRunning: _isRunning = false,
    mascotStatus = "idle",
    showMascot = false,
    onMascotClick,
  }: ChatProps | CustomProps = $props();

  let visibleCount = $state(PAGE_SIZE);

  // Header action menus
  let addMenuOpen = $state(false);
  let addMenuX = $state(0);
  let addMenuY = $state(0);
  let moreMenuOpen = $state(false);
  let moreMenuX = $state(0);
  let moreMenuY = $state(0);

  // Sub-folder context menu
  let sfContextMenuOpen = $state(false);
  let sfContextMenuX = $state(0);
  let sfContextMenuY = $state(0);
  let sfContextMenuTarget = $state<SessionFolderGroup | null>(null);

  // Workspace (project) context menu — same interaction pattern as sub-folders
  let wsContextMenuOpen = $state(false);
  let wsContextMenuX = $state(0);
  let wsContextMenuY = $state(0);

  function openWsContextMenu(e: MouseEvent) {
    if (wsContextMenuItems.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent("close-all-context-menus"));
    wsContextMenuX = e.clientX;
    wsContextMenuY = e.clientY;
    wsContextMenuOpen = true;
  }

  function closeWsContextMenu() {
    wsContextMenuOpen = false;
  }

  function handleWsContextMenuSelect(id: string) {
    switch (id) {
      case "new-chat":
        onNewChat?.();
        break;
      case "new-folder":
        onCreateSubFolder?.();
        break;
      case "open-dir":
        onOpenDirectory?.();
        break;
      case "rename":
        onRenameWorkspace?.();
        break;
      case "settings":
        onWorkspaceSettings?.();
        break;
      case "remove":
        onRemove?.();
        break;
    }
    closeWsContextMenu();
  }

  const wsContextMenuItems = $derived.by(() => {
    const items: MenuItem[] = [];
    if (onNewChat) {
      items.push({
        id: "new-chat",
        label: t("sidebar_newChatInFolder") ?? "新对话",
        icon: "play",
      });
    }
    if (onCreateSubFolder) {
      items.push({
        id: "new-folder",
        label: t("sidebar_createFolder") ?? "新建文件夹",
        icon: "folder",
      });
    }
    if (onOpenDirectory) {
      items.push({
        id: "open-dir",
        label: t("sidebar_openDirectory") ?? "打开目录",
        icon: "folder",
        separatorBefore: items.length > 0,
      });
    }
    if (onRenameWorkspace) {
      items.push({
        id: "rename",
        label: t("sidebar_renameWorkspace") ?? "重命名 Workspace",
        icon: "rename",
        separatorBefore: items.length > 0 && !onOpenDirectory,
      });
    }
    if (onWorkspaceSettings) {
      items.push({
        id: "settings",
        label: t("workspace_settings") ?? "Workspace 设置",
        icon: "more",
        separatorBefore: items.length > 0 && !onRenameWorkspace && !onOpenDirectory,
      });
    }
    if (onRemove) {
      items.push({
        id: "remove",
        label: t("sidebar_removeProject") ?? "从侧边栏收纳",
        icon: "archive",
        danger: true,
        separatorBefore: true,
      });
    }
    return items;
  });

  function openSfContextMenu(e: MouseEvent, sf: SessionFolderGroup) {
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent("close-all-context-menus"));
    sfContextMenuX = e.clientX;
    sfContextMenuY = e.clientY;
    sfContextMenuTarget = sf;
    sfContextMenuOpen = true;
  }

  function closeSfContextMenu() {
    sfContextMenuOpen = false;
    sfContextMenuTarget = null;
  }

  function handleSfContextMenuSelect(id: string) {
    if (!sfContextMenuTarget) return;
    if (id === "rename") {
      onRenameSubFolder?.(sfContextMenuTarget);
    } else if (id === "delete") {
      onDeleteSubFolder?.(sfContextMenuTarget);
    }
    closeSfContextMenu();
  }

  const sfContextMenuItems = [
    { id: "rename", label: t("sidebar_renameFolder") ?? "重命名", icon: "rename" as const },
    {
      id: "delete",
      label: t("sidebar_removeFolder") ?? "删除文件夹",
      icon: "trash" as const,
      danger: true,
    },
  ];

  function closeAllMenus() {
    addMenuOpen = false;
    moreMenuOpen = false;
    closeWsContextMenu();
  }

  // Close menus when right-clicking elsewhere
  $effect(() => {
    if (addMenuOpen || moreMenuOpen || sfContextMenuOpen || wsContextMenuOpen) {
      const handler = () => {
        closeAllMenus();
        closeSfContextMenu();
      };
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

<div class="group/folder mb-1">
  <!-- Workspace row (level 1) -->
  <div
    class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[13px] font-semibold tracking-tight text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors cursor-pointer
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
    oncontextmenu={openWsContextMenu}
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
      class="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-150 {expanded
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
        class="h-4 w-4 shrink-0 text-muted-foreground/70"
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
      <Icon name="folder" size="md" class="shrink-0 text-muted-foreground/70" />
    {/if}
    <!-- Label -->
    <span class="truncate">{label}</span>

    <!-- Canvas mascot — shown when enabled, regardless of status -->
    {#if showMascot}
      <button type="button"
        class="ml-auto shrink-0 cursor-pointer hover:opacity-80 active:opacity-60 transition-opacity rounded"
        onclick={onMascotClick}
        title={t("mascot_clickToOpen") ?? "查看运行状态"}
        aria-label={t("mascot_clickToOpen") ?? "查看运行状态"}
      >
        <ClaudeCanvas status={mascotStatus} size={16} />
      </button>
    {/if}
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
    <div class="ml-1.5 mt-0.5 border-l border-border/25 pl-2" transition:slide={{ duration: 200 }}>
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
                  class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium text-sidebar-foreground/90 hover:bg-sidebar-accent/40 transition-colors cursor-pointer
                    {sfDragOver ? 'bg-primary/15 ring-1 ring-primary/40' : ''}"
                  role="button"
                  tabindex="0"
                  {...{ [SESSION_DROP_FOLDER_ATTR]: sf.folderId }}
                  onclick={() => onToggleSubFolder?.(sf.folderKey)}
                  onkeydown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onToggleSubFolder?.(sf.folderKey);
                    }
                  }}
                  oncontextmenu={(e) => openSfContextMenu(e, sf)}
                >
                  <svg
                    class="h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform duration-150 {sfExpanded
                      ? 'rotate-90'
                      : ''}"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"><path d="M9 18l6-6-6-6" /></svg
                  >
                  <!-- Bookmark icon for logical sub-folder -->
                  <svg
                    class="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg
                  >
                  <span class="truncate flex-1">{sf.name}</span>
                  {#if sf.conversationCount > 0}
                    <span
                      class="shrink-0 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium text-muted-foreground"
                    >
                      {sf.conversationCount}
                    </span>
                  {/if}
                </div>
                <!-- Sub-folder sessions -->
                {#if sfExpanded}
                  <div class="ml-1 border-l border-border/20 pl-1.5">
                    {#each sf.conversations as conv (conv.groupKey)}
                      <ConversationItem
                        conversation={conv}
                        density="sidebar"
                        selected={conv.runs.some((r) => r.id === selectedRunId)}
                        batchSelected={selectedGroupKeys?.has(conv.groupKey) ?? false}
                        {batchModeActive}
                        isDragging={dragRunId === conv.latestRun.id}
                        onclick={() => onSelectConversation?.(conv.latestRun.id)}
                        onresume={onResume}
                        ondelete={onDelete}
                        onmovetofolder={onMoveToFolder}
                        {onBatchClick}
                        {onLongPressSelect}
                        {onSessionDragStart}
                        {onSessionDragMove}
                        {onSessionDragEnd}
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

        {#if scheduledTaskHubs.length > 0}
          <div class="mb-1">
            <div class="flex items-center px-2 py-0.5 mb-0.5">
              <span class="text-[10px] text-muted-foreground/50 uppercase tracking-wider">
                {t("sidebar_scheduledTasks")}
              </span>
            </div>
            {#each scheduledTaskHubs as hub (hub.hubKey)}
              <SidebarScheduledTaskHubItem
                {hub}
                selected={selectedScheduledTaskId === hub.taskId}
                onclick={() => onSelectScheduledHub?.(hub.taskId)}
              />
            {/each}
          </div>
        {/if}

        <!-- Empty state -->
        {#if folder.conversations.length === 0 && subFolders.length === 0 && scheduledTaskHubs.length === 0}
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
                density="sidebar"
                selected={isConvSelected(conv)}
                batchSelected={selectedGroupKeys?.has(conv.groupKey) ?? false}
                {batchModeActive}
                isDragging={dragRunId === conv.latestRun.id}
                onclick={() => onSelectConversation?.(conv.latestRun.id)}
                onresume={onResume}
                ondelete={onDelete}
                onmovetofolder={onMoveToFolder}
                {onBatchClick}
                {onLongPressSelect}
                {onSessionDragStart}
                {onSessionDragMove}
                {onSessionDragEnd}
              />
            {/snippet}
          </VirtualList>
        {:else}
          {#each visibleConversations as conv (conv.groupKey)}
            <ConversationItem
              conversation={conv}
              density="sidebar"
              selected={isConvSelected(conv)}
              batchSelected={selectedGroupKeys?.has(conv.groupKey) ?? false}
              {batchModeActive}
              isDragging={dragRunId === conv.latestRun.id}
              onclick={() => onSelectConversation?.(conv.latestRun.id)}
              onresume={onResume}
              ondelete={onDelete}
              onmovetofolder={onMoveToFolder}
              {onBatchClick}
              {onLongPressSelect}
              {onSessionDragStart}
              {onSessionDragMove}
              {onSessionDragEnd}
            />
          {/each}
        {/if}
        {#if hasMore}
          <button type="button"
            class="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 rounded-md transition-colors"
            onclick={showMore}
          >
            {t("sidebar_showMore", { count: String(Math.min(PAGE_SIZE, hiddenCount)) })}
          </button>
        {/if}
      {/if}
    </div>
  {/if}

  <!-- Workspace context menu -->
  {#if wsContextMenuOpen}
    <ContextMenu
      x={wsContextMenuX}
      y={wsContextMenuY}
      items={wsContextMenuItems}
      onSelect={handleWsContextMenuSelect}
      onClose={closeWsContextMenu}
    />
  {/if}

  <!-- Sub-folder context menu -->
  {#if sfContextMenuOpen}
    <ContextMenu
      x={sfContextMenuX}
      y={sfContextMenuY}
      items={sfContextMenuItems}
      onSelect={handleSfContextMenuSelect}
      onClose={closeSfContextMenu}
    />
  {/if}
</div>
