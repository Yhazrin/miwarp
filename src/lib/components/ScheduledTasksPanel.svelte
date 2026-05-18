<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { scheduledTasksStore } from "$lib/stores/scheduled-tasks-store.svelte";
  import ScheduledTaskCard from "$lib/components/ScheduledTaskCard.svelte";
  import ScheduledTaskEditorPanel from "$lib/components/ScheduledTaskEditorPanel.svelte";

  function handleCreateNew() {
    scheduledTasksStore.editingTask = null;
    scheduledTasksStore.editorMode = "create";
    scheduledTasksStore.showEditor = true;
  }

  function handleEdit(task: (typeof scheduledTasksStore.tasks)[0]) {
    scheduledTasksStore.editingTask = task;
    scheduledTasksStore.editorMode = "edit";
    scheduledTasksStore.showEditor = true;
  }

  function handleCardClick(task: (typeof scheduledTasksStore.tasks)[0]) {
    scheduledTasksStore.selectedTaskId = task.id;
  }

  // Load tasks on mount
  $effect(() => {
    scheduledTasksStore.loadTasks();
  });
</script>

<div class="flex flex-1 flex-col overflow-hidden">
  {#if scheduledTasksStore.showEditor}
    <div class="flex-1 overflow-y-auto">
      <ScheduledTaskEditorPanel />
    </div>
  {:else}
    <div class="flex items-center justify-between px-3 py-2 border-b border-border/30">
      <h3 class="text-xs font-semibold text-foreground">{t("scheduledTasks_title")}</h3>
      <button
        class="rounded px-2 py-1 text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        onclick={handleCreateNew}
      >
        {t("scheduledTasks_create")}
      </button>
    </div>

    <div class="flex-1 overflow-y-auto">
      {#if scheduledTasksStore.loading}
        <div class="flex items-center justify-center h-32 text-xs text-muted-foreground/50">
          {t("scheduledTasks_loading")}
        </div>
      {:else if scheduledTasksStore.tasks.length === 0}
        <div
          class="flex flex-col items-center justify-center h-32 gap-2 text-xs text-muted-foreground/50"
        >
          <svg
            class="h-8 w-8 text-muted-foreground/30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>{t("scheduledTasks_empty")}</span>
        </div>
      {:else}
        <div class="p-2 space-y-2">
          {#if scheduledTasksStore.activeTasks.length > 0}
            <div class="mb-3">
              <p
                class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1 mb-1.5"
              >
                {t("scheduledTasks_active")}
              </p>
              {#each scheduledTasksStore.activeTasks as task (task.id)}
                <button class="w-full text-left" onclick={() => handleCardClick(task)}>
                  <ScheduledTaskCard
                    {task}
                    selected={scheduledTasksStore.selectedTaskId === task.id}
                  />
                </button>
              {/each}
            </div>
          {/if}

          {#if scheduledTasksStore.inactiveTasks.length > 0}
            <div>
              <p
                class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1 mb-1.5"
              >
                {t("scheduledTasks_inactive")}
              </p>
              {#each scheduledTasksStore.inactiveTasks as task (task.id)}
                <button class="w-full text-left" onclick={() => handleCardClick(task)}>
                  <ScheduledTaskCard
                    {task}
                    selected={scheduledTasksStore.selectedTaskId === task.id}
                  />
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
