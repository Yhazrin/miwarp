<script lang="ts">
  import type { ConversationGroup } from "$lib/utils/sidebar-groups";
  import { TERMINAL_PHASES, canResumeNow } from "$lib/stores";
  import { getNoSessionPersistence } from "$lib/stores/agent-settings-cache.svelte";
  import StatusBadge from "./StatusBadge.svelte";
  import { relativeTime, truncate } from "$lib/utils/format";
  import { PLATFORM_PRESETS } from "$lib/utils/platform-presets";
  import { t } from "$lib/i18n/index.svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { hasAttention } from "$lib/stores/attention-store.svelte";

  function platformLabel(id: string): string {
    return PLATFORM_PRESETS.find((p) => p.id === id)?.name ?? id;
  }

  let {
    conversation,
    selected = false,
    batchSelected = false,
    onclick,
    onresume,
    ondelete,
    onmovetofolder,
    onBatchClick,
  }: {
    conversation: ConversationGroup;
    selected?: boolean;
    batchSelected?: boolean;
    onclick?: () => void;
    onresume?: (runId: string, mode: "resume") => void;
    ondelete?: (conversation: ConversationGroup) => void;
    onmovetofolder?: (runIds: string[]) => void;
    onBatchClick?: (groupKey: string, e: MouseEvent) => void;
  } = $props();

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

  // ── Inline rename (self-contained, mirrors RunListItem) ──

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
        dbg("conv-item", "renamed", {
          runId: conversation.latestRun.id,
          name: trimmed,
        });
        window.dispatchEvent(new Event("ocv:runs-changed"));
      } catch (e) {
        dbgWarn("conv-item", "rename failed", e);
        // runs will refresh on next poll
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
    if (editing) return;
    if ((e.shiftKey || e.metaKey || e.ctrlKey) && onBatchClick) {
      onBatchClick(conversation.groupKey, e);
      return;
    }
    onclick?.();
  }
</script>

<div
  class="group w-full text-left px-3 py-1.5 rounded-md transition-colors text-xs cursor-pointer
    {selected
    ? 'bg-sidebar-accent/70 text-sidebar-accent-foreground'
    : 'hover:bg-sidebar-accent/30 text-sidebar-foreground'} {batchSelected
    ? 'ring-1 ring-primary/50'
    : ''}"
  role="button"
  tabindex="0"
  onclick={handleClick}
  onkeydown={handleKeydown}
>
  <div class="flex items-center justify-between gap-2">
    <div class="flex items-center gap-1.5 min-w-0">
      {#if conversation.isFavorite}
        <svg
          class="h-3 w-3 shrink-0 text-yellow-500/70"
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
          class="truncate text-[13px] leading-tight font-medium"
          ondblclick={(e) => {
            e.stopPropagation();
            startRename();
          }}>{label}</span
        >
      {/if}
    </div>
    <div class="flex items-center gap-0.5 shrink-0">
      {#if runCount > 1}
        <span
          class="inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-muted/70 px-1 text-[10px] font-normal text-muted-foreground/70"
          title={t("sidebar_conversations", { count: String(runCount) })}>{runCount}</span
        >
      {/if}
      {#if canResume && onresume}
        <button
          class="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent/20 transition-opacity"
          onclick={(e) => {
            e.stopPropagation();
            onresume(run.id, "resume");
          }}
          title={t("runItem_resumeTitle")}
        >
          <svg
            class="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path
              d="M21 3v5h-5"
            /></svg
          >
        </button>
      {/if}
      {#if canDelete && ondelete}
        <button
          class="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-opacity"
          onclick={(e) => {
            e.stopPropagation();
            ondelete(conversation);
          }}
          title={t("sidebar_deleteConfirm")}
        >
          <svg
            class="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path
              d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"
            /></svg
          >
        </button>
      {/if}
      {#if onmovetofolder}
        <button
          class="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent/20 text-muted-foreground hover:text-sidebar-foreground transition-opacity"
          onclick={(e) => {
            e.stopPropagation();
            onmovetofolder(conversation.runs.map((r) => r.id));
          }}
          title={t("sidebar_moveToFolder")}
        >
          <svg
            class="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path
              d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
            /><path d="m9 13 2 2 4-4" /></svg
          >
        </button>
      {/if}
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
    </div>
  </div>
  <div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
    <div class="flex items-center gap-1 min-w-0">
      <span class="shrink-0">{run.agent}</span>
      {#if run.worktree_branch}
        <span
          class="shrink-0 inline-flex items-center gap-0.5 px-1 py-0 rounded bg-blue-500/10 text-blue-400/70 font-mono text-[10px] max-w-[80px] truncate"
          title={run.worktree_branch}
        >
          <svg
            class="h-2.5 w-2.5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle
              cx="6"
              cy="18"
              r="3"
            /><path d="M18 9a9 9 0 0 1-9 9" /></svg
          >
          {run.worktree_branch}
        </span>
      {/if}
      {#if run.remote_host_name}
        <svg
          class="h-3 w-3 shrink-0 text-blue-400/50"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><title>{t("statusbar_sshTitle", { name: run.remote_host_name })}</title><circle
            cx="12"
            cy="12"
            r="10"
          /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></svg
        >
      {/if}
      {#if run.platform_id && run.platform_id !== "anthropic"}
        <span class="shrink-0">&middot;</span>
        <span class="truncate">{platformLabel(run.platform_id)}</span>
      {/if}
    </div>
    <span class="ml-auto shrink-0">{time}</span>
  </div>
</div>
