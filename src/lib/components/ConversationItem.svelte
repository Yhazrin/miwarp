<script lang="ts">
  import type { ConversationGroup } from "$lib/utils/sidebar-groups";
  import { TERMINAL_PHASES } from "$lib/stores";
  import { EVT_RUNS_CHANGED } from "$lib/utils/bus-events";
  import { relativeTime, truncate } from "$lib/utils/format";
  import { PLATFORM_PRESETS } from "$lib/utils/platform-presets";
  import { t } from "$lib/i18n/index.svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { hasAttention } from "$lib/stores/attention-store.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import Icon from "./Icon.svelte";

  const LONG_PRESS_MS = 480;
  const DRAG_THRESHOLD_PX = 10;

  function platformLabel(id: string): string {
    return PLATFORM_PRESETS.find((p) => p.id === id)?.name ?? id;
  }

  let {
    conversation,
    selected = false,
    batchSelected = false,
    batchModeActive = false,
    density = "default",
    isDragging = false,
    onclick,
    ondelete,
    onmovetofolder,
    onBatchClick,
    onLongPressSelect,
    onSessionDragStart,
    onSessionDragMove,
    onSessionDragEnd,
  }: {
    conversation: ConversationGroup;
    selected?: boolean;
    batchSelected?: boolean;
    /** When true, tap toggles batch selection instead of navigating. */
    batchModeActive?: boolean;
    /** Compact typography for sidebar tree (level 3). */
    density?: "default" | "sidebar";
    /** True when this conversation is currently being dragged. */
    isDragging?: boolean;
    onclick?: () => void;
    ondelete?: (conversation: ConversationGroup) => void;
    onmovetofolder?: (runIds: string[], folderId?: string | null) => void;
    onBatchClick?: (groupKey: string, e: MouseEvent) => void;
    onLongPressSelect?: (groupKey: string) => void;
    onSessionDragStart?: (runId: string, label: string, e: PointerEvent) => void;
    onSessionDragMove?: (e: PointerEvent) => void;
    onSessionDragEnd?: (e: PointerEvent) => void;
  } = $props();

  const isSidebar = $derived(density === "sidebar");

  const run = $derived(conversation.latestRun);
  const label = $derived(truncate(conversation.title, 28));
  const time = $derived(relativeTime(run.last_activity_at ?? run.started_at));
  const canDelete = $derived(conversation.runs.every((r) => TERMINAL_PHASES.includes(r.status)));
  const _needsAttention = $derived(hasAttention(run.id));

  // Compact status dot for non-selected items
  const statusDot = $derived.by(() => {
    const s = run.status;
    if (s === "running" || s === "waiting_input" || s === "waiting_approval")
      return { color: "hsl(var(--miwarp-status-info))", animated: true };
    if (s === "completed") return { color: "hsl(var(--miwarp-status-success))", animated: false };
    if (s === "error") return { color: "hsl(var(--miwarp-status-error))", animated: false };
    if (s === "stopped") return { color: "hsl(var(--muted-foreground))", animated: false };
    return { color: "hsl(var(--muted-foreground))", animated: false };
  });

  // ── Inline rename ──────────────────────────────────────────────────────────

  let editing = $state(false);
  let editValue = $state("");
  let editInputEl: HTMLInputElement | undefined = $state();

  function startRename() {
    editValue = conversation.title;
    editing = true;
    requestAnimationFrame(() => {
      editInputEl?.select();
    });
  }

  async function commitRename() {
    editing = false;
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== conversation.title) {
      try {
        const { renameRun } = await import("$lib/api");
        await renameRun(conversation.latestRun.id, trimmed);
        dbg("conv-item", "renamed", { runId: conversation.latestRun.id, name: trimmed });
        window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
      } catch (e) {
        dbgWarn("conv-item", "rename failed", e);
      }
    }
  }

  function cancelRename() {
    editing = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (editing) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onclick?.();
    }
  }

  function handleClick(e: MouseEvent) {
    if (editing || suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    if (batchModeActive && onBatchClick) {
      onBatchClick(conversation.groupKey, e);
      return;
    }
    if ((e.shiftKey || e.metaKey || e.ctrlKey) && onBatchClick) {
      onBatchClick(conversation.groupKey, e);
      return;
    }
    onclick?.();
  }

  // ── Pointer gestures: long-press → batch select; drag → move to folder ──

  let suppressNextClick = $state(false);
  let pointerStartX = 0;
  let pointerStartY = 0;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressFired = false;
  let pointerDragging = $state(false);
  let activePointerId: number | null = null;

  function clearPointerGesture() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);
    activePointerId = null;
    longPressFired = false;
    pointerDragging = false;
  }

  function handlePointerDown(e: PointerEvent) {
    if (editing || e.button !== 0) return;
    // Ignore if starting on interactive child (buttons, rename input)
    const target = e.target as HTMLElement;
    if (target.closest("button, input, textarea, a")) return;

    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    longPressFired = false;
    pointerDragging = false;
    activePointerId = e.pointerId;

    longPressTimer = setTimeout(() => {
      longPressFired = true;
      suppressNextClick = true;
      onLongPressSelect?.(conversation.groupKey);
    }, LONG_PRESS_MS);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  function handlePointerMove(e: PointerEvent) {
    if (activePointerId !== e.pointerId || longPressFired) return;
    if (pointerDragging) {
      e.preventDefault();
      onSessionDragMove?.(e);
      return;
    }
    const dx = e.clientX - pointerStartX;
    const dy = e.clientY - pointerStartY;
    if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;

    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    if (!onSessionDragStart) return;

    pointerDragging = true;
    suppressNextClick = true;
    e.preventDefault();
    onSessionDragStart(conversation.latestRun.id, conversation.title, e);
    onSessionDragMove?.(e);
  }

  function handlePointerUp(e: PointerEvent) {
    if (activePointerId !== e.pointerId) return;
    if (pointerDragging) {
      onSessionDragEnd?.(e);
    } else if (longPressFired) {
      suppressNextClick = true;
    }
    clearPointerGesture();
  }

  $effect(() => {
    return () => clearPointerGesture();
  });

  // ── Context menu ──────────────────────────────────────────────────────────

  let contextMenuOpen = $state(false);
  let contextMenuX = $state(0);
  let contextMenuY = $state(0);

  function openContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Close all other context menus first
    window.dispatchEvent(new CustomEvent("close-all-context-menus"));
    contextMenuX = e.clientX;
    contextMenuY = e.clientY;
    contextMenuOpen = true;
  }

  function _openContextMenuFromButton(e: MouseEvent) {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent("close-all-context-menus"));
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    contextMenuX = rect.left;
    contextMenuY = rect.bottom + 4;
    contextMenuOpen = true;
  }

  function closeContextMenu() {
    contextMenuOpen = false;
  }

  // Listen for close-all event from other context menus
  $effect(() => {
    if (contextMenuOpen) {
      const handler = () => {
        contextMenuOpen = false;
      };
      window.addEventListener("close-all-context-menus", handler);
      return () => window.removeEventListener("close-all-context-menus", handler);
    }
  });

  async function handleContextMenuSelect(id: string) {
    switch (id) {
      case "rename":
        startRename();
        break;
      case "movetofolder":
        onmovetofolder?.(conversation.runs.map((r) => r.id));
        break;
      case "delete":
        if (confirm(t("sidebar_deleteConfirmMsg") ?? "Delete this conversation?")) {
          ondelete?.(conversation);
        }
        break;
    }
  }

  // Context menu items
  const contextMenuItems = $derived([
    { id: "rename", label: t("sidebar_rename"), icon: "rename" as const },
    { id: "movetofolder", label: t("sidebar_moveToFolder"), icon: "folder" as const },
    {
      id: "delete",
      label: t("sidebar_delete"),
      icon: "trash" as const,
      danger: true,
      separatorBefore: true,
      disabled: !canDelete,
    },
  ]);
</script>

<div
  class="group w-full text-left rounded-md transition-colors cursor-pointer
    {isSidebar ? 'mb-1.5 px-2.5 py-2.5 text-xs' : 'px-3 py-1.5 text-xs'}
    {selected
    ? 'bg-sidebar-accent/70 text-sidebar-accent-foreground'
    : 'hover:bg-sidebar-accent/30 text-sidebar-foreground'} {batchSelected
    ? 'ring-1 ring-primary/50'
    : ''} {isDragging ? 'opacity-40' : ''}"
  role="button"
  tabindex="0"
  aria-label={label}
  class:select-none={pointerDragging || isDragging}
  style:touch-action={pointerDragging || isDragging ? "none" : "pan-y"}
  onclick={handleClick}
  onkeydown={handleKeydown}
  oncontextmenu={openContextMenu}
  onpointerdown={handlePointerDown}
>
  <div class="flex items-center justify-between {isSidebar ? 'gap-2.5' : 'gap-2'}">
    <div class="flex items-center {isSidebar ? 'gap-2' : 'gap-1.5'} min-w-0">
      {#if conversation.isFavorite}
        <svg
          class="h-3 w-3 shrink-0 text-[hsl(var(--miwarp-status-warning)/0.7)]"
          viewBox="0 0 24 24"
          fill="currentColor"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polygon
            points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
          />
        </svg>
      {/if}
      {#if editing}
        <input
          bind:this={editInputEl}
          bind:value={editValue}
          class="min-w-0 flex-1 bg-transparent text-xs outline-none border-b border-primary"
          onblur={commitRename}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancelRename();
            }
            e.stopPropagation();
          }}
          onclick={(e) => e.stopPropagation()}
        />
      {:else}
        <span
          class="truncate leading-snug select-none {isSidebar
            ? 'text-[13px] font-medium text-sidebar-foreground/90'
            : 'text-[13px] font-medium'}"
          role="button"
          tabindex={0}
          ondblclick={(e) => {
            e.stopPropagation();
            startRename();
          }}>{label}</span
        >
      {/if}
    </div>
    <div class="flex items-center gap-1.5 shrink-0">
      <span class="tabular-nums text-muted-foreground/60 text-[10.5px]">{time}</span>
      <span
        class="inline-block h-[6px] w-[6px] rounded-full shrink-0 {statusDot.animated
          ? 'animate-slow-pulse'
          : ''}"
        style:background-color={statusDot.color}
        title={run.status}
      ></span>
    </div>
  </div>
  <!-- Meta row: branch / platform / remote / time -->
  <div
    class="flex items-center gap-1.5 text-muted-foreground/45 leading-snug {isSidebar
      ? 'mt-1.5 text-[11px]'
      : 'mt-0.5 text-[10.5px]'}"
  >
    <div class="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
      {#if run.worktree_branch}
        <span
          class="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-[hsl(var(--miwarp-accent-violet)/0.1)] text-[hsl(var(--miwarp-accent-violet)/0.8)] font-mono text-[10px] max-w-[110px] truncate"
          title={run.worktree_branch}
        >
          <Icon name="git-branch" size="xs" class="shrink-0 opacity-80" />
          {run.worktree_branch}
        </span>
      {/if}
      {#if run.remote_host_name}
        <svg
          class="h-2.5 w-2.5 shrink-0 text-[hsl(var(--miwarp-status-info)/0.6)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <title>{t("statusbar_sshTitle", { name: run.remote_host_name })}</title>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <path d="M2 12h20" />
        </svg>
      {/if}
      {#if run.platform_id && run.platform_id !== "anthropic"}
        <span class="truncate opacity-70">{platformLabel(run.platform_id)}</span>
      {/if}
    </div>
  </div>
</div>

{#if contextMenuOpen}
  <ContextMenu
    x={contextMenuX}
    y={contextMenuY}
    items={contextMenuItems}
    onSelect={handleContextMenuSelect}
    onClose={closeContextMenu}
  />
{/if}
