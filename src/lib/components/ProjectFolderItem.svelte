<script lang="ts">
  import type { Snippet } from "svelte";
  import type {
    ProjectFolder,
    ConversationGroup,
    SessionFolderGroup,
  } from "$lib/utils/sidebar-groups";
  import ConversationItem from "./ConversationItem.svelte";
  import VirtualList from "./VirtualList.svelte";
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
    onDragOverSubFolder?: (folderKey: string, folderId: string, e: DragEvent) => void;
    onDragLeaveSubFolder?: () => void;
    onDropOnSubFolder?: (folderId: string, e: DragEvent) => void;
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
    onDragStartConversation?: (e: DragEvent, runIds: string[]) => void;
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
  }: ChatProps | CustomProps = $props();

  let visibleCount = $state(PAGE_SIZE);

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
    class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sidebar-foreground text-[13px] font-semibold tracking-tight hover:bg-sidebar-accent/35 transition-colors cursor-pointer
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
    <!-- Label + row actions -->
    <span class="truncate min-w-0 flex-1">{label}</span>
    <div
      class="shrink-0 flex items-center gap-0.5 rounded-sm group-hover/folder:bg-sidebar-accent/30"
    >
      {#if onCreateSubFolder}
        <button
          type="button"
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent/60 hover:text-sidebar-foreground group-hover/folder:opacity-100 focus-visible:opacity-100"
          title={t("sidebar_createFolder")}
          aria-label={t("sidebar_createFolder")}
          onclick={(e) => {
            e.stopPropagation();
            onCreateSubFolder?.();
          }}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onCreateSubFolder?.();
            }
          }}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 5v14" /><path d="M5 12h14" />
          </svg>
        </button>
      {/if}
      {#if onNewChat}
        <button
          type="button"
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent/60 hover:text-sidebar-foreground group-hover/folder:opacity-100 focus-visible:opacity-100"
          title={t("sidebar_newChatInFolder")}
          aria-label={t("sidebar_newChatInFolder")}
          onclick={(e) => {
            e.stopPropagation();
            onNewChat?.();
          }}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onNewChat?.();
            }
          }}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M7 8h10" /><path d="M7 12h4" /><path
              d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
            /></svg
          >
        </button>
      {/if}
      {#if onRemove}
        <button
          type="button"
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover/folder:opacity-100 focus-visible:opacity-100"
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

  <!-- Expanded children -->
  {#if expanded}
    <div class="pl-3">
      {#if children}
        {@render children()}
      {:else}
        <!-- Sub-folders (logical folders nested inside this project) -->
        {#if subFolders.length > 0}
          <div class="mb-1">
            {#each subFolders as sf (sf.folderKey)}
              {@const sfExpanded = expandedSubFolders.has(sf.folderKey)}
              {@const sfDragOver = dragOverSubFolderKey === sf.folderKey}
              <div class="group/sf mb-0.5">
                <div
                  class="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-sidebar-foreground/95 hover:bg-sidebar-accent/40 transition-colors cursor-pointer
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
                  ondragovercapture={onDragOverSubFolder
                    ? (e) => {
                        e.preventDefault();
                        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                        onDragOverSubFolder!(sf.folderKey, sf.folderId, e);
                      }
                    : undefined}
                  ondragleave={onDragLeaveSubFolder}
                  ondropcapture={onDropOnSubFolder
                    ? (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDropOnSubFolder!(sf.folderId, e);
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
        <!-- Unfoldered sessions in this project -->
        {#if folder.conversations.length > 0 && subFolders.length > 0}
          <div class="flex items-center px-2 py-0.5 mt-0.5 mb-0.5">
            <span class="text-[11px] font-semibold text-muted-foreground/55 uppercase tracking-wide"
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
