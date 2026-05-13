<script lang="ts">
  import { onMount } from "svelte";
  import Button from "$lib/components/Button.svelte";
  import ScheduledTaskCard from "$lib/components/ScheduledTaskCard.svelte";
  import ScheduledTaskEditor from "$lib/components/ScheduledTaskEditor.svelte";
  import { scheduledTasksStore } from "$lib/stores/scheduled-tasks-store.svelte";
  import type { ScheduledTaskLog } from "$lib/types/scheduled-task";

  let activeTab = $state<"all" | "active" | "paused">("all");

  const filteredTasks = $derived(() => {
    switch (activeTab) {
      case "active":
        return scheduledTasksStore.activeTasks;
      case "paused":
        return scheduledTasksStore.inactiveTasks;
      default:
        return scheduledTasksStore.tasks;
    }
  });

  onMount(() => {
    scheduledTasksStore.loadTasks();
  });

  function getLogStatusIcon(status: ScheduledTaskLog["status"]) {
    switch (status) {
      case "running":
        return { icon: "animate-spin", color: "text-blue-500", label: "Running" };
      case "completed":
        return { icon: "✓", color: "text-green-500", label: "Completed" };
      case "failed":
        return { icon: "✗", color: "text-red-500", label: "Failed" };
      case "cancelled":
        return { icon: "○", color: "text-yellow-500", label: "Cancelled" };
    }
  }

  function formatDuration(startAt: string, endAt?: string): string {
    if (!endAt) return "In progress";
    const start = new Date(startAt).getTime();
    const end = new Date(endAt).getTime();
    const seconds = Math.round((end - start) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
</script>

<svelte:head>
  <title>Scheduled Tasks</title>
</svelte:head>

<div class="flex flex-col h-full">
  <!-- Header -->
  <div
    class="flex items-center justify-between px-6 py-4 border-b bg-background/50 backdrop-blur-sm"
  >
    <div>
      <h1 class="text-2xl font-bold">Scheduled Tasks</h1>
      <p class="text-sm text-muted-foreground">Manage automated tasks that run on a schedule</p>
    </div>
    <Button variant="default" onclick={() => scheduledTasksStore.openCreateEditor()}>
      <svg
        class="w-4 h-4 mr-2"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      New Task
    </Button>
  </div>

  <!-- Content -->
  <div class="flex flex-1 overflow-hidden">
    <!-- Task List -->
    <div class="flex flex-col w-1/2 border-r overflow-hidden">
      <!-- Tabs -->
      <div class="flex items-center gap-1 px-4 py-2 border-b bg-muted/20">
        <button
          class="px-3 py-1.5 text-sm rounded-md transition-colors
            {activeTab === 'all' ? 'bg-background shadow-sm' : 'hover:bg-background/50'}"
          onclick={() => (activeTab = "all")}
        >
          All ({scheduledTasksStore.tasks.length})
        </button>
        <button
          class="px-3 py-1.5 text-sm rounded-md transition-colors
            {activeTab === 'active' ? 'bg-background shadow-sm' : 'hover:bg-background/50'}"
          onclick={() => (activeTab = "active")}
        >
          Active ({scheduledTasksStore.activeTasks.length})
        </button>
        <button
          class="px-3 py-1.5 text-sm rounded-md transition-colors
            {activeTab === 'paused' ? 'bg-background shadow-sm' : 'hover:bg-background/50'}"
          onclick={() => (activeTab = "paused")}
        >
          Paused ({scheduledTasksStore.inactiveTasks.length})
        </button>
      </div>

      <!-- Task List -->
      <div class="flex-1 overflow-y-auto p-4 space-y-2">
        {#if scheduledTasksStore.loading}
          <div class="flex items-center justify-center py-8 text-muted-foreground">
            <svg
              class="w-5 h-5 animate-spin mr-2"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10" stroke-opacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
            Loading tasks...
          </div>
        {:else if filteredTasks().length === 0}
          <div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <svg
              class="w-12 h-12 mb-4 opacity-50"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <p class="text-sm">No scheduled tasks</p>
            <Button variant="link" onclick={() => scheduledTasksStore.openCreateEditor()}>
              Create your first task
            </Button>
          </div>
        {:else}
          {#each filteredTasks() as task (task.taskId)}
            <ScheduledTaskCard
              {task}
              selected={scheduledTasksStore.selectedTaskId === task.taskId}
            />
          {/each}
        {/if}
      </div>
    </div>

    <!-- Task Details Panel -->
    <div class="flex-1 overflow-y-auto">
      {#if scheduledTasksStore.selectedTask}
        {@const task = scheduledTasksStore.selectedTask}
        <div class="p-6 space-y-6">
          <!-- Task Info -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <h2 class="text-xl font-semibold">{task.taskId}</h2>
              <span
                class="px-2 py-1 text-xs rounded-full {task.enabled
                  ? 'bg-green-500/10 text-green-500'
                  : 'bg-muted text-muted-foreground'}"
              >
                {task.enabled ? "Active" : "Paused"}
              </span>
            </div>
            {#if task.description}
              <p class="text-muted-foreground">{task.description}</p>
            {/if}
          </div>

          <!-- Schedule Info -->
          <div class="p-4 rounded-lg bg-muted/30 space-y-2">
            <h3 class="text-sm font-medium text-muted-foreground">Schedule</h3>
            {#if task.cronExpression}
              <div class="flex items-center gap-2">
                <svg
                  class="w-4 h-4 text-muted-foreground"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12,6 12,12 16,14" />
                </svg>
                <span class="font-mono text-sm">{task.cronExpression}</span>
              </div>
            {:else if task.fireAt}
              <div class="flex items-center gap-2">
                <svg
                  class="w-4 h-4 text-muted-foreground"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <span>{new Date(task.fireAt).toLocaleString()}</span>
              </div>
            {/if}

            <div class="grid grid-cols-2 gap-4 pt-2">
              {#if task.nextRunAt}
                <div>
                  <span class="text-xs text-muted-foreground">Next Run</span>
                  <p class="text-sm">{new Date(task.nextRunAt).toLocaleString()}</p>
                </div>
              {/if}
              {#if task.lastRunAt}
                <div>
                  <span class="text-xs text-muted-foreground">Last Run</span>
                  <p class="text-sm">{new Date(task.lastRunAt).toLocaleString()}</p>
                </div>
              {/if}
            </div>
          </div>

          <!-- Prompt Preview -->
          <div class="space-y-2">
            <h3 class="text-sm font-medium text-muted-foreground">Prompt</h3>
            <div class="p-4 rounded-lg bg-muted/30">
              <pre class="text-sm whitespace-pre-wrap font-mono">{task.prompt}</pre>
            </div>
          </div>

          <!-- Execution Logs -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-medium text-muted-foreground">Execution Logs</h3>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => scheduledTasksStore.loadTaskLogs(task.taskId)}
              >
                Refresh
              </Button>
            </div>

            {#if scheduledTasksStore.selectedTaskLogs.length === 0}
              <div
                class="p-8 text-center text-muted-foreground text-sm rounded-lg border border-dashed"
              >
                No execution logs yet
              </div>
            {:else}
              <div class="space-y-2">
                {#each scheduledTasksStore.selectedTaskLogs as log (log.id)}
                  {@const statusInfo = getLogStatusIcon(log.status)}
                  <div class="p-3 rounded-lg bg-muted/30 flex items-center gap-3">
                    <span class={statusInfo.color}>{statusInfo.icon}</span>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 text-sm">
                        <span>{statusInfo.label}</span>
                        <span class="text-muted-foreground">
                          {new Date(log.startAt).toLocaleString()}
                        </span>
                        {#if log.endAt}
                          <span class="text-muted-foreground/50">
                            ({formatDuration(log.startAt, log.endAt)})
                          </span>
                        {/if}
                      </div>
                      {#if log.error}
                        <p class="text-xs text-destructive mt-1 truncate">{log.error}</p>
                      {:else if log.result}
                        <p class="text-xs text-muted-foreground mt-1 truncate">{log.result}</p>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <div class="flex flex-col items-center justify-center h-full text-muted-foreground">
          <svg
            class="w-16 h-16 mb-4 opacity-50"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14,2 14,8 20,8" />
          </svg>
          <p class="text-sm">Select a task to view details</p>
        </div>
      {/if}
    </div>
  </div>
</div>

<!-- Editor Modal -->
<ScheduledTaskEditor />

<!-- Error Toast -->
{#if scheduledTasksStore.error}
  <div
    class="fixed bottom-4 right-4 p-4 rounded-lg bg-destructive text-destructive-foreground shadow-lg flex items-center gap-3"
  >
    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
    <span class="text-sm">{scheduledTasksStore.error}</span>
    <button
      class="ml-2 p-1 hover:bg-white/20 rounded"
      onclick={() => scheduledTasksStore.clearError()}
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </div>
{/if}
