<script lang="ts">
  import type { ConversationGroup } from '$lib/utils/sidebar-groups';
  import { TERMINAL_PHASES, canResumeNow } from '$lib/stores';
  import { getNoSessionPersistence } from '$lib/stores/agent-settings-cache.svelte';
  import { relativeTime, truncate } from '$lib/utils/format';
  import { PLATFORM_PRESETS } from '$lib/utils/platform-presets';
  import { hasAttention } from '$lib/stores/attention-store.svelte';
  import DualStatusIndicator from './DualStatusIndicator.svelte';

  function platformLabel(id: string): string {
    return PLATFORM_PRESETS.find((p) => p.id === id)?.name ?? id;
  }

  interface Props {
    conversation: ConversationGroup;
    selected?: boolean;
    pinned?: boolean;
    onclick?: () => void;
    onpin?: () => void;
    onresume?: (runId: string, mode: 'resume') => void;
    ondelete?: (conversation: ConversationGroup) => void;
  }

  let {
    conversation,
    selected = false,
    pinned = false,
    onclick,
    onpin,
    onresume,
    ondelete,
  }: Props = $props();

  const run = $derived(conversation.latestRun);
  const label = $derived(truncate(conversation.title, 28));
  const time = $derived(relativeTime(run.last_activity_at ?? run.started_at));
  const canResume = $derived(
    canResumeNow(run, run.status as any, getNoSessionPersistence(run.agent)),
  );
  const canDelete = $derived(
    conversation.runs.every((r) => TERMINAL_PHASES.includes(r.status as any)),
  );
  const runCount = $derived(conversation.runs.length);
  const needsAttention = $derived(hasAttention(run.id));

  // Dual-signal status: color = state, shape = process status
  const indicatorState = $derived.by(() => {
    const s = run.status;
    if (s === 'running') return 'running' as const;
    if (s === 'waiting_input' || s === 'waiting_approval') return 'needs-input' as const;
    if (s === 'completed') return 'completed' as const;
    if (s === 'error') return 'failed' as const;
    if (s === 'stopped') return 'stopped' as const;
    return 'idle' as const;
  });

  const indicatorProcess = $derived.by(() => {
    const s = run.status;
    if (s === 'running') return 'active' as const;
    if (s === 'waiting_input' || s === 'waiting_approval') return 'active' as const;
    // Sessions with loop/sleeping behavior
    if (run.loop_sleeping) return 'sleeping' as const;
    return 'exited' as const;
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onclick?.();
    }
  }
</script>

<div
  class="group/item w-full text-left px-2.5 py-2 rounded-md transition-colors cursor-pointer
    {selected
    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
    : 'hover:bg-sidebar-accent/50 text-sidebar-foreground'}"
  role="button"
  tabindex="0"
  onclick={() => onclick?.()}
  onkeydown={handleKeydown}
>
  <div class="flex items-center justify-between gap-1.5">
    <div class="flex items-center gap-1.5 min-w-0">
      <!-- Dual-signal status indicator (color = state, shape = process) -->
      <DualStatusIndicator
        state={indicatorState}
        processStatus={indicatorProcess}
        size="xs"
        label={needsAttention ? `Needs attention: ${indicatorState}` : undefined}
      />
      <span class="truncate text-xs font-medium">{label}</span>
    </div>
    <div class="flex items-center gap-1 shrink-0">
      {#if pinned}
        <!-- Pin icon -->
        <svg
          class="h-3 w-3 shrink-0 text-primary/70"
          viewBox="0 0 24 24"
          fill="currentColor"
          stroke="currentColor"
          stroke-width="0"
        >
          <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
      {/if}
      {#if runCount > 1}
        <span
          class="inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium text-muted-foreground"
          title="{runCount} runs"
        >
          {runCount}
        </span>
      {/if}
      <!-- Pin toggle (visible on hover) -->
      {#if onpin}
        <button
          class="opacity-0 group-hover/item:opacity-100 p-0.5 rounded hover:bg-accent/30 transition-opacity {pinned ? 'text-primary' : 'text-muted-foreground'}"
          onclick={(e) => {
            e.stopPropagation();
            onpin?.();
          }}
          title={pinned ? 'Unpin' : 'Pin'}
          aria-label={pinned ? 'Unpin session' : 'Pin session'}
        >
          <svg
            class="h-3 w-3"
            viewBox="0 0 24 24"
            fill={pinned ? 'currentColor' : 'none'}
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
          </svg>
        </button>
      {/if}
      {#if canResume && onresume}
        <button
          class="opacity-0 group-hover/item:opacity-100 p-0.5 rounded hover:bg-accent/30 transition-opacity text-muted-foreground"
          onclick={(e) => {
            e.stopPropagation();
            onresume(run.id, 'resume');
          }}
          title="Resume"
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
      {#if canDelete && ondelete}
        <button
          class="opacity-0 group-hover/item:opacity-100 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-opacity"
          onclick={(e) => {
            e.stopPropagation();
            ondelete?.(conversation);
          }}
          title="Delete"
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
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </svg>
        </button>
      {/if}
    </div>
  </div>
  <!-- Preview / meta row -->
  <div class="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground pl-[14px]">
    <div class="flex items-center gap-1.5 min-w-0">
      <span class="shrink-0">{run.agent}</span>
      {#if run.platform_id && run.platform_id !== 'anthropic'}
        <span class="shrink-0">&middot;</span>
        <span class="truncate">{platformLabel(run.platform_id)}</span>
      {/if}
    </div>
    <span class="ml-auto shrink-0">{time}</span>
  </div>
</div>
