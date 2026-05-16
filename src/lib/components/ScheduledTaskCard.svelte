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
  class="group relative rounded-xl border transition-all duration-150 cursor-pointer
    {selected
    ? 'border-primary/30 bg-primary/[0.04] shadow-sm'
    : 'border-transparent hover:border-border/60 hover:bg-muted/30'}"
  role="button"
  tabindex="0"
  onclick={handleSelect}
  onkeydown={(e) => e.key === "Enter" && handleSelect()}
>
  <!-- Selected accent bar -->
  {#if selected}
    <div class="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-primary"></div>
  {/if}

  <div class="px-4 py-3 {selected ? 'pl-5' : ''}">
    <div class="flex items-start justify-between gap-2">
      <div class="flex-1 min-w-0">
        <!-- Title + Status -->
        <div class="flex items-center gap-2 mb-1">
          <span class="text-[13px] font-semibold text-foreground truncate">{task.name}</span>
          <span
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0
              {task.enabled
              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
              : 'bg-muted text-muted-foreground'}"
          >
            <span
              class="w-1 h-1 rounded-full {task.enabled
                ? 'bg-green-500'
                : 'bg-muted-foreground/50'}"
            ></span>
            {task.enabled ? t("schedCard_active") : t("schedCard_paused")}
          </span>
        </div>

        <!-- Agent + Workspace -->
        <div class="flex items-center gap-1.5 mb-1.5">
          <span
            class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground uppercase"
            >{task.agent}</span
          >
          <span class="text-[11px] text-muted-foreground/70 truncate" title={task.workspace.cwd}>
            {task.workspace.cwd.split(/[/\\]/).pop() || task.workspace.cwd}
          </span>
          {#if task.workspace.remoteHostName}
            <span class="text-[10px] text-muted-foreground/50"
              >@ {task.workspace.remoteHostName}</span
            >
          {/if}
        </div>

        <!-- Schedule + Timing -->
        <div class="flex items-center gap-3 text-[11px] text-muted-foreground/60">
          <span class="flex items-center gap-1">
            <svg
              class="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            {scheduleDescription}
          </span>
          {#if task.nextRunAt}
            <span class="flex items-center gap-1">
              <span class="text-muted-foreground/40">{t("schedCard_next")}:</span>
              {formatRelativeTime(task.nextRunAt)}
            </span>
          {/if}
          {#if task.lastRunAt}
            <span class="flex items-center gap-1">
              <span class="text-muted-foreground/40">{t("schedCard_last")}:</span>
              {formatRelativeTime(task.lastRunAt)}
            </span>
          {/if}
        </div>
      </div>

      <!-- Actions (hover) -->
      <div
        class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
      >
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7"
          title={t("schedCard_runNow")}
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
          class="h-7 w-7"
          title={t("schedCard_edit")}
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
            <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
          </svg>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7"
          title={task.enabled ? t("schedCard_pause") : t("schedCard_resume")}
          onclick={(e) => {
            e.stopPropagation();
            handleToggle();
          }}
        >
          {#if task.enabled}
            <svg
              class="w-3.5 h-3.5"
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
              class="w-3.5 h-3.5"
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
          class="h-7 w-7 hover:text-destructive"
          title={t("schedCard_delete")}
          onclick={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
        >
          <svg
            class="w-3.5 h-3.5"
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
</div>
