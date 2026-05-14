<script lang="ts">
  import Button from "./Button.svelte";
  import { scheduledTasksStore } from "$lib/stores/scheduled-tasks-store.svelte";
  import { ScheduledTasksService } from "$lib/services/scheduled-tasks-service";
  import type { ScheduledTask } from "$lib/types/scheduled-task";

  let {
    task,
    selected = false,
  }: {
    task: ScheduledTask;
    selected?: boolean;
  } = $props();

  let triggering = $state(false);

  const scheduleDescription = $derived(() => {
    const s = task.schedule;
    switch (s.type) {
      case "cron":
        return s.cronExpression
          ? ScheduledTasksService.describeCronExpression(s.cronExpression)
          : "No cron expression";
      case "interval":
        return `Every ${s.intervalMinutes ?? 60} minutes`;
      case "one-time":
        return s.fireAt ? `One-time: ${new Date(s.fireAt).toLocaleString()}` : "No time set";
      default:
        return "Unknown schedule";
    }
  });

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
    if (confirm(`Delete task "${task.name}"?`)) {
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
          <span class="text-xs">{task.enabled ? "Active" : "Paused"}</span>
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
        {scheduleDescription()}
      </p>

      <!-- Timing info -->
      <div class="flex items-center gap-4 mt-2 text-xs text-muted-foreground/40">
        {#if task.nextRunAt}
          <span>Next: {new Date(task.nextRunAt).toLocaleString()}</span>
        {/if}
        {#if task.lastRunAt}
          <span>Last: {new Date(task.lastRunAt).toLocaleString()}</span>
        {/if}
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <Button
        variant="ghost"
        size="icon"
        title="Run now"
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
        title="Edit"
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
        title={task.enabled ? "Pause" : "Resume"}
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
        title="Delete"
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
