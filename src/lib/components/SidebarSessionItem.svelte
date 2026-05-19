<script lang="ts">
  import type { ConversationGroup } from "$lib/utils/sidebar-groups";
  import { TERMINAL_PHASES, canResumeNow } from "$lib/stores";
  import { getNoSessionPersistence } from "$lib/stores/agent-settings-cache.svelte";
  import { relativeTime, truncate } from "$lib/utils/format";
  import { PLATFORM_PRESETS } from "$lib/utils/platform-presets";
  import { hasAttention } from "$lib/stores/attention-store.svelte";
  import StatusBadge from "./StatusBadge.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import ContextMenu from "./ContextMenu.svelte";

  function platformLabel(id: string): string {
    return PLATFORM_PRESETS.find((p) => p.id === id)?.name ?? id;
  }

  interface Props {
    conversation: ConversationGroup;
    selected?: boolean;
    pinned?: boolean;
    onclick?: () => void;
    onpin?: () => void;
    onresume?: (runId: string, mode: "resume") => void;
    ondelete?: (conversation: ConversationGroup) => void;
    onmovetofolder?: (runIds: string[]) => void;
    onrename?: (conversation: ConversationGroup) => void;
  }

  let {
    conversation,
    selected = false,
    pinned = false,
    onclick,
    onpin,
    onresume,
    ondelete,
    onmovetofolder,
    onrename,
  }: Props = $props();

  const run = $derived(conversation.latestRun);
  const label = $derived(truncate(conversation.title, 28));
  const time = $derived(relativeTime(run.last_activity_at ?? run.started_at));
  const canResume = $derived(canResumeNow(run, run.status, getNoSessionPersistence(run.agent)));
  const canDelete = $derived(conversation.runs.every((r) => TERMINAL_PHASES.includes(r.status)));
  const runCount = $derived(conversation.runs.length);
  const needsAttention = $derived(hasAttention(run.id));

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
    if (onrename) {
      onrename(conversation);
    } else {
      editValue = conversation.title;
      editing = true;
      requestAnimationFrame(() => {
        editInputEl?.select();
      });
    }
  }

  async function commitRename() {
    editing = false;
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== conversation.title) {
      try {
        const { renameRun } = await import("$lib/api");
        await renameRun(conversation.latestRun.id, trimmed);
        dbg("sidebar-item", "renamed", { runId: conversation.latestRun.id, name: trimmed });
        window.dispatchEvent(new Event("ocv:runs-changed"));
      } catch (e) {
        dbgWarn("sidebar-item", "rename failed", e);
      }
    }
  }

  function cancelRename() {
    editing = false;
  }

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

  function openContextMenuFromButton(e: MouseEvent) {
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

  function handleContextMenuSelect(id: string) {
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

  const contextMenuItems = $derived([
    { id: "rename", label: t("sidebar_rename") ?? "Rename", icon: "rename" as const },
    {
      id: "movetofolder",
      label: t("sidebar_moveToFolder") ?? "Move to folder",
      icon: "folder" as const,
    },
    {
      id: "delete",
      label: t("sidebar_delete") ?? "Delete",
      icon: "trash" as const,
      danger: true,
      separatorBefore: true,
      disabled: !canDelete,
    },
  ]);

  function handleKeydown(e: KeyboardEvent) {
    if (editing) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onclick?.();
    }
  }
</script>

<div
  class="group/item w-full text-left px-2.5 py-1.5 rounded-md transition-colors cursor-pointer
    {selected
    ? 'bg-sidebar-accent/70 text-sidebar-accent-foreground'
    : 'hover:bg-sidebar-accent/30 text-sidebar-foreground'}"
  role="button"
  tabindex="0"
  onclick={() => onclick?.()}
  onkeydown={handleKeydown}
  oncontextmenu={openContextMenu}
>
  <div class="flex items-center justify-between gap-1.5">
    <div class="flex items-center gap-1.5 min-w-0">
      {#if selected}
        <StatusBadge
          status={run.status}
          attention={needsAttention}
          compact={false}
          shortLabel={true}
          class="shrink-0"
        />
      {:else}
        <span
          class="inline-block h-[5px] w-[5px] rounded-full shrink-0 {statusDot.animated
            ? 'animate-slow-pulse'
            : ''}"
          style:background-color={statusDot.color}
          title={run.status}
        ></span>
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
          class="truncate text-[13px] leading-tight font-medium"
          ondblclick={(e) => {
            e.stopPropagation();
            startRename();
          }}>{label}</span
        >
      {/if}
    </div>
    <div class="flex items-center gap-0.5 shrink-0">
      {#if pinned}
        <svg
          class="h-3 w-3 shrink-0 text-primary/60"
          viewBox="0 0 24 24"
          fill="currentColor"
          stroke="currentColor"
          stroke-width="0"
        >
          <path
            d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
          />
        </svg>
      {/if}
      {#if runCount > 1}
        <span
          class="inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-muted/70 px-1 text-[10px] font-normal text-muted-foreground/70"
          title={t("sidebar_runs", { count: String(runCount) })}
        >
          {runCount}
        </span>
      {/if}
      {#if onpin}
        <button
          class="opacity-0 group-hover/item:opacity-100 p-0.5 rounded hover:bg-accent/20 transition-opacity {pinned
            ? 'text-primary'
            : 'text-muted-foreground'}"
          onclick={(e) => {
            e.stopPropagation();
            onpin?.();
          }}
          title={pinned ? t("sidebar_unpin") : t("sidebar_pin")}
          aria-label={pinned ? t("sidebar_unpinSession") : t("sidebar_pinSession")}
        >
          <svg
            class="h-3 w-3"
            viewBox="0 0 24 24"
            fill={pinned ? "currentColor" : "none"}
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
            />
          </svg>
        </button>
      {/if}
      {#if canResume && onresume}
        <button
          class="opacity-0 group-hover/item:opacity-100 p-0.5 rounded hover:bg-accent/20 transition-opacity text-muted-foreground"
          onclick={(e) => {
            e.stopPropagation();
            onresume(run.id, "resume");
          }}
          title={t("sidebar_resume")}
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
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </button>
      {/if}
    </div>
  </div>
  <!-- Preview / meta row -->
  <div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/50 pl-[14px]">
    <div class="flex items-center gap-1 min-w-0">
      <span class="shrink-0">{run.agent}</span>
      {#if run.platform_id && run.platform_id !== "anthropic"}
        <span class="shrink-0">&middot;</span>
        <span class="truncate">{platformLabel(run.platform_id)}</span>
      {/if}
    </div>
    <span class="ml-auto shrink-0">{time}</span>
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
