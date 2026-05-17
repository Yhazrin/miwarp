<script lang="ts">
  import type { ConversationGroup } from "$lib/utils/sidebar-groups";
  import { TERMINAL_PHASES, canResumeNow } from "$lib/stores";
  import { getNoSessionPersistence } from "$lib/stores/agent-settings-cache.svelte";
  import { relativeTime, truncate } from "$lib/utils/format";
  import { PLATFORM_PRESETS } from "$lib/utils/platform-presets";
  import { hasAttention } from "$lib/stores/attention-store.svelte";
  import StatusBadge from "./StatusBadge.svelte";
  import { t } from "$lib/i18n/index.svelte";

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
  const canResume = $derived(canResumeNow(run, run.status, getNoSessionPersistence(run.agent)));
  const canDelete = $derived(conversation.runs.every((r) => TERMINAL_PHASES.includes(r.status)));
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

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onclick?.();
    }
  }
</script>

<div
  class="group/item w-full text-left rounded-md py-1.5 pr-2.5 pl-2 transition-colors cursor-pointer text-[11px]
    {selected
    ? 'bg-sidebar-accent/25 text-sidebar-foreground'
    : 'hover:bg-sidebar-accent/28 text-sidebar-foreground'}"
  role="button"
  tabindex="0"
  onclick={() => onclick?.()}
  onkeydown={handleKeydown}
>
  <div class="flex items-center justify-between gap-1.5">
    <div class="flex items-center gap-1.5 min-w-0">
      {#if selected}
        <StatusBadge
          status={run.status}
          attention={needsAttention}
          compact={false}
          shortLabel={true}
          subtle={true}
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
      <span class="truncate leading-snug font-medium text-sidebar-foreground">{label}</span>
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
      {#if canDelete && ondelete}
        <button
          class="opacity-0 group-hover/item:opacity-100 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-opacity"
          onclick={(e) => {
            e.stopPropagation();
            ondelete?.(conversation);
          }}
          title={t("sidebar_delete")}
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
  <div
    class="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground/32 leading-none pl-1"
  >
    <div class="flex items-center gap-1 min-w-0 flex-1">
      <span class="shrink-0 text-muted-foreground/38">{run.agent}</span>
      {#if run.platform_id && run.platform_id !== "anthropic"}
        <span class="shrink-0 text-muted-foreground/22">&middot;</span>
        <span class="truncate text-muted-foreground/35">{platformLabel(run.platform_id)}</span>
      {/if}
    </div>
    <span class="shrink-0 tabular-nums text-muted-foreground/26 ml-auto text-right">{time}</span>
  </div>
</div>
