<script lang="ts">
  import Button from "./Button.svelte";
  import { goto } from "$app/navigation";
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

  /** First line of the prompt (or first 60 chars) — used as a hover preview
   * and shown muted below the schedule row (#6, #9). */
  const promptPreview = $derived.by(() => {
    const trimmed = (task.prompt ?? "").trim();
    if (!trimmed) return "";
    const firstLine = trimmed.split(/\r?\n/, 1)[0];
    return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
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

  const statusColor = $derived(
    task.enabled ? "text-miwarp-status-success" : "text-muted-foreground",
  );

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

  function handleSkipNext() {
    scheduledTasksStore.toggleSkipNextRun(task.id);
  }

  function handleDelete() {
    if (confirm(t("schedCard_deleteConfirm", { name: task.name }))) {
      scheduledTasksStore.deleteTask(task.id);
    }
  }

  function handleSelect() {
    scheduledTasksStore.selectTask(task.id);
  }

  /** Click on the card body: select + navigate to detail. Buttons stop
   * propagation so they keep their primary behavior. (#6) */
  function handleCardClick() {
    handleSelect();
    goto(`/scheduled-tasks/${task.id}`);
  }

  function handleCardKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCardClick();
    }
  }
</script>

<div
  class="group p-3 rounded-lg border transition-all duration-200 cursor-pointer
    {selected
    ? 'border-sidebar-border bg-sidebar-accent text-sidebar-foreground'
    : 'border-transparent text-sidebar-foreground hover:border-sidebar-border hover:bg-sidebar-accent/40'}"
  role="button"
  tabindex="0"
  aria-label={task.name}
  onclick={handleCardClick}
  onkeydown={handleCardKey}
>
  <!-- Info section - full width -->
  <div class="mb-2">
    <!-- Name and Status -->
    <div class="flex items-center gap-2 mb-1">
      <span class="text-sm font-medium text-sidebar-foreground truncate" title={task.name}
        >{task.name}</span
      >
      <span class="flex items-center gap-1 {statusColor} shrink-0">
        <span
          class="w-1.5 h-1.5 rounded-full {task.enabled ? 'bg-miwarp-status-success' : 'bg-muted'}"
        ></span>
        <span class="text-[10px]"
          >{task.enabled ? t("schedCard_active") : t("schedCard_paused")}</span
        >
      </span>
      {#if task.skipNextRun}
        <span
          class="shrink-0 px-1.5 py-0.5 text-[9px] rounded bg-miwarp-status-warning/15 text-miwarp-status-warning uppercase"
          title={t("sched_skipNextDesc")}
        >
          {t("sched_skipNext")}
        </span>
      {/if}
    </div>

    <!-- Agent + Workspace -->
    <div
      class="flex items-center gap-2 text-[10px] text-sidebar-foreground/70 mb-1 overflow-hidden"
    >
      <span class="px-1.5 py-0.5 rounded bg-sidebar-accent/70 uppercase font-medium shrink-0"
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
    <p class="text-[10px] text-sidebar-foreground/50 truncate mb-1" title={scheduleDescription}>
      {scheduleDescription}
    </p>

    <!-- Prompt preview (#6, #9) — show first line of prompt as muted text -->
    {#if promptPreview}
      <p class="text-[10px] text-sidebar-foreground/70 truncate mb-1" title={task.prompt}>
        {promptPreview}
      </p>
    {/if}

    <!-- Timing info -->
    <div class="flex items-center gap-4 text-[10px] text-sidebar-foreground/45 overflow-hidden">
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
      title={task.skipNextRun ? t("sched_skipNextDisable") : t("sched_skipNextEnable")}
      aria-label={task.skipNextRun ? t("sched_skipNextDisable") : t("sched_skipNextEnable")}
      onclick={(e) => {
        e.stopPropagation();
        handleSkipNext();
      }}
    >
      <svg
        class="w-3.5 h-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <polygon points="5,4 15,12 5,20" />
        <line x1="19" y1="5" x2="19" y2="19" />
      </svg>
    </Button>

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
