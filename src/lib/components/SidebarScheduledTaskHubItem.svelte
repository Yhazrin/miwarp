<script lang="ts">
  import type { ScheduledTaskHubGroup } from "$lib/utils/sidebar-groups";
  import { relativeTime } from "$lib/utils/format";
  import { getSidebarStatusDot } from "$lib/utils/sidebar-status-dot";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";

  interface Props {
    hub: ScheduledTaskHubGroup;
    selected?: boolean;
    onclick?: () => void;
  }

  let { hub, selected = false, onclick }: Props = $props();

  const statusDot = $derived(getSidebarStatusDot(hub.latestStatus));

  const timeLabel = $derived(
    relativeTime(hub.latestRun.last_activity_at ?? hub.latestRun.started_at),
  );

  const statusLabel = $derived.by(() => {
    switch (hub.latestStatus) {
      case "running":
      case "pending":
        return t("sched_runRunning");
      case "completed":
        return t("sched_runCompleted");
      case "error":
      case "failed":
        return t("sched_runFailed");
      case "stopped":
        return t("sched_runCancelled");
      default:
        return t("sched_runQueued");
    }
  });
</script>

<button
  type="button"
  class="group/hub flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors
    {selected
    ? 'bg-sidebar-accent text-sidebar-foreground'
    : 'text-sidebar-foreground/90 hover:bg-sidebar-accent/40'}"
  {onclick}
  title={hub.taskName}
  aria-current={selected ? "page" : undefined}
>
  <div class="flex w-full items-center gap-2">
    <Icon name="clock" size="sm" class="shrink-0 text-[hsl(var(--miwarp-status-warning)/0.8)]" />

    <span class="min-w-0 flex-1 truncate font-medium">{hub.taskName}</span>

    {#if !hub.enabled}
      <span
        class="shrink-0 rounded px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground bg-muted/60"
      >
        {t("sched_paused")}
      </span>
    {/if}

    <span
      class="sidebar-session-badge inline-flex h-3.5 min-w-[14px] shrink-0 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium text-muted-foreground"
      title={t("schedHub_executionCount", { count: String(hub.executionCount) })}
    >
      {hub.executionCount}
    </span>

    <span
      class="sidebar-status-dot h-1.5 w-1.5 shrink-0 rounded-full {statusDot.animated
        ? 'animate-pulse'
        : ''}"
      style="background-color: {statusDot.color}"
      aria-hidden="true"
    ></span>

    <span class="sidebar-session-time shrink-0 text-[10px] tabular-nums">{timeLabel}</span>
  </div>

  {#if hub.latestSummary}
    <p class="sidebar-session-meta ml-5 truncate text-[10px]" title={hub.latestSummary}>
      <span class="opacity-80">{statusLabel} ·</span>
      {hub.latestSummary}
    </p>
  {/if}
</button>
