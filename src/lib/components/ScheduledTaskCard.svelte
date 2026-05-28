<script lang="ts">
  import Button from "./Button.svelte";
  import { scheduledTasksStore } from "$lib/stores/scheduled-tasks-store.svelte";
  import { ScheduledTasksService } from "$lib/services/scheduled-tasks-service";
  import type { ScheduledTask } from "$lib/types/scheduled-task";
  import { t } from "$lib/i18n/index.svelte";

  let {
    task,
    selected = false,
  }: {
    task: ScheduledTask;
    selected?: boolean;
  } = $props();

  let triggering = $state(false);

  const scheduleDescription = $derived.by(() => {
    const s = task.schedule;
    switch (s.type) {
      case "cron":
        return s.cronExpression
          ? ScheduledTasksService.describeCronExpression(s.cronExpression)
          : t("schedCard_noCron");
      case "interval":
        return t("schedCard_interval", { minutes: String(s.intervalMinutes ?? 60) });
      case "one-time":
        return s.fireAt
          ? t("schedCard_oneTime", { time: new Date(s.fireAt).toLocaleString() })
          : t("schedCard_noTimeSet");
      default:
        return t("schedCard_unknownSchedule");
    }
  });

  function formatRelativeTime(isoStr: string): string {
    const date = new Date(isoStr);
    const now = Date.now();
    const diffMs = date.getTime() - now;
    const absDiff = Math.abs(diffMs);
    const future = diffMs > 0;

    if (absDiff < 60_000) return future ? t("sched_inProgress") : t("sched_never");
    const minutes = Math.round(absDiff / 60_000);
    if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
    return date.toLocaleString();
  }

  const statusColor = $derived(task.enabled ? "text-[hsl(var(--miwarp-status-success))]" : "text-muted-foreground");

  async function handleTrigger() {
    triggering = true;
    try {
      await scheduledTasksStore.runTaskNow(task.id);
    } finally {
      triggering = false;
    }
  }

  function handleEdit() {
    scheduledTasksStore.openEditEditor(task);
  }

  function _handleToggle() {
    scheduledTasksStore.toggleTaskEnabled(task.id);
  }

  function handleDelete() {
    if (confirm(t("schedCard_deleteConfirm", { name: task.name }))) {
      scheduledTasksStore.deleteTask(task.id);
    }
  }

  function handleSelect() {
    scheduledTasksStore.selectTask(task.id);
  }
</script>

<div
  class="group p-3 rounded-lg border transition-all duration-200 cursor-pointer
    {selected
    ? 'border-primary bg-primary/5'
    : 'border-transparent hover:border-border hover:bg-muted/30'}"
  role="button"
  tabindex="0"
  aria-label={task.name}
  onclick={handleSelect}
  onkeydown={(e) => e.key === "Enter" && handleSelect()}
>
  <!-- Info section - full width -->
  <div class="mb-2">
    <!-- Name and Status -->
    <div class="flex items-center gap-2 mb-1">
      <span class="text-sm font-medium text-foreground truncate" title={task.name}>{task.name}</span
      >
      <span class="flex items-center gap-1 {statusColor} shrink-0">
        <span class="w-1.5 h-1.5 rounded-full {task.enabled ? 'bg-[hsl(var(--miwarp-status-success))]' : 'bg-muted'}"></span>
        <span class="text-[10px]"
          >{task.enabled ? t("schedCard_active") : t("schedCard_paused")}</span
        >
      </span>
    </div>

    <!-- Agent + Workspace -->
    <div class="flex items-center gap-2 text-[10px] text-muted-foreground mb-1 overflow-hidden">
      <span class="px-1.5 py-0.5 rounded bg-muted/80 uppercase font-medium shrink-0"
        >{task.agent}</span
      >
      <span class="truncate shrink-0" title={task.workspace.cwd}>
        {task.workspace.cwd.split(/[/\\]/).pop() || task.workspace.cwd}
      </span>
      {#if task.workspace.remoteHostName}
        <span class="opacity-60 shrink-0">@ {task.workspace.remoteHostName}</span>
      {/if}
    </div>

    <!-- Schedule -->
    <p class="text-[10px] text-muted-foreground/50 truncate mb-1" title={scheduleDescription}>
      {scheduleDescription}
    </p>

    <!-- Timing info -->
    <div class="flex items-center gap-4 text-[10px] text-muted-foreground/40 overflow-hidden">
      {#if task.nextRunAt}
        <span class="shrink-0">{t("schedCard_next")}: {formatRelativeTime(task.nextRunAt)}</span>
      {:else if task.enabled}
        <span class="shrink-0">{t("schedCard_next")}: {t("sched_never")}</span>
      {/if}
      {#if task.lastRunAt}
        <span class="shrink-0">{t("schedCard_last")}: {formatRelativeTime(task.lastRunAt)}</span>
      {:else}
        <span class="shrink-0">{t("schedCard_last")}: {t("sched_never")}</span>
      {/if}
    </div>
  </div>

  <!-- Actions - below info, right aligned -->
  <div class="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
    <Button
      variant="ghost"
      size="icon"
      title={t("schedCard_runNow")}
      aria-label={t("schedCard_runNow")}
      loading={triggering}
      onclick={(e) => {
        e.stopPropagation();
        handleTrigger();
      }}
    >
      <svg
        class="w-3.5 h-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <polygon points="5,3 19,12 5,21" />
      </svg>
    </Button>

    <Button
      variant="ghost"
      size="icon"
      title={t("schedCard_edit")}
      aria-label={t("schedCard_edit")}
      onclick={(e) => {
        e.stopPropagation();
        handleEdit();
      }}
    >
      <svg
        class="w-3.5 h-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    </Button>

    <Button
      variant="ghost"
      size="icon"
      title={t("schedCard_delete")}
      aria-label={t("schedCard_delete")}
      onclick={(e) => {
        e.stopPropagation();
        handleDelete();
      }}
    >
      <svg
        class="w-3.5 h-3.5 text-destructive"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <polyline points="3,6 5,6 21,6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    </Button>
  </div>
</div>
