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

  const statusColor = $derived(task.enabled ? "text-green-500" : "text-muted-foreground");

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

  function handleToggle() {
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
  class="group p-4 rounded-lg border transition-all duration-200 cursor-pointer
    {selected
    ? 'border-primary bg-primary/5'
    : 'border-transparent hover:border-border hover:bg-muted/30'}"
  role="button"
  tabindex="0"
  onclick={handleSelect}
  onkeydown={(e) => e.key === "Enter" && handleSelect()}
>
  <div class="flex items-start justify-between gap-3">
    <div class="flex-1 min-w-0">
      <!-- Name and Status -->
      <div class="flex items-center gap-2 mb-1">
        <span class="text-sm font-medium truncate">{task.name}</span>
        <span class="flex items-center gap-1 {statusColor}">
          <span class="w-2 h-2 rounded-full {task.enabled ? 'bg-green-500' : 'bg-muted'}"></span>
          <span class="text-xs">{task.enabled ? t("schedCard_active") : t("schedCard_paused")}</span
          >
        </span>
      </div>

      <!-- Agent + Workspace -->
      <div class="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <span class="px-1.5 py-0.5 rounded bg-muted text-xs uppercase">{task.agent}</span>
        <span class="truncate" title={task.workspace.cwd}>
          {task.workspace.cwd.split(/[/\\]/).pop() || task.workspace.cwd}
        </span>
        {#if task.workspace.remoteHostName}
          <span class="text-xs opacity-60">@ {task.workspace.remoteHostName}</span>
        {/if}
      </div>

      <!-- Description -->
      <p class="text-xs text-muted-foreground/70 truncate mb-1">
        {task.description || task.prompt.slice(0, 80)}
      </p>

      <!-- Schedule -->
      <p class="text-xs text-muted-foreground/50">
        {scheduleDescription}
      </p>

      <!-- Timing info -->
      <div class="flex items-center gap-4 mt-2 text-xs text-muted-foreground/40">
        {#if task.nextRunAt}
          <span>{t("schedCard_next")}: {formatRelativeTime(task.nextRunAt)}</span>
        {:else if task.enabled}
          <span>{t("schedCard_next")}: {t("sched_never")}</span>
        {/if}
        {#if task.lastRunAt}
          <span>{t("schedCard_last")}: {formatRelativeTime(task.lastRunAt)}</span>
        {:else}
          <span>{t("schedCard_last")}: {t("sched_never")}</span>
        {/if}
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <Button
        variant="ghost"
        size="icon"
        title={t("schedCard_runNow")}
        loading={triggering}
        onclick={(e) => {
          e.stopPropagation();
          handleTrigger();
        }}
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5,3 19,12 5,21" />
        </svg>
      </Button>

      <Button
        variant="ghost"
        size="icon"
        title={t("schedCard_edit")}
        onclick={(e) => {
          e.stopPropagation();
          handleEdit();
        }}
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </Button>

      <Button
        variant="ghost"
        size="icon"
        title={task.enabled ? t("schedCard_pause") : t("schedCard_resume")}
        onclick={(e) => {
          e.stopPropagation();
          handleToggle();
        }}
      >
        {#if task.enabled}
          <svg
            class="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        {:else}
          <svg
            class="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polygon points="5,3 19,12 5,21" />
          </svg>
        {/if}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        title={t("schedCard_delete")}
        onclick={(e) => {
          e.stopPropagation();
          handleDelete();
        }}
      >
        <svg
          class="w-4 h-4 text-destructive"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polyline points="3,6 5,6 21,6" />
          <path
            d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
          />
        </svg>
      </Button>
    </div>
  </div>
</div>
