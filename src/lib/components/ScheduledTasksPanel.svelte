<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { scheduledTasksStore } from "$lib/stores/scheduled-tasks-store.svelte";
  import ScheduledTaskCard from "$lib/components/ScheduledTaskCard.svelte";
  import ScheduledTaskEditorPanel from "$lib/components/ScheduledTaskEditorPanel.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";

  let { cwd = "" }: { cwd?: string } = $props();

  // Filter tasks by workspace when cwd is provided
  let filteredTasks = $derived(
    cwd
      ? scheduledTasksStore.tasks.filter((t) => t.workspace.cwd === cwd)
      : scheduledTasksStore.tasks,
  );

  let _partitioned = $derived.by(() => {
    const active: typeof filteredTasks = [];
    const inactive: typeof filteredTasks = [];
    for (const t of filteredTasks) {
      (t.enabled ? active : inactive).push(t);
    }
    return { active, inactive };
  });
  let filteredActiveTasks = $derived(_partitioned.active);
  let filteredInactiveTasks = $derived(_partitioned.inactive);

  function handleCreateNew() {
    scheduledTasksStore.editingTask = null;
    scheduledTasksStore.editorMode = "create";
    scheduledTasksStore.showEditor = true;
  }

  function _handleEdit(task: (typeof scheduledTasksStore.tasks)[0]) {
    scheduledTasksStore.editingTask = task;
    scheduledTasksStore.editorMode = "edit";
    scheduledTasksStore.showEditor = true;
  }

  function handleCardClick(task: (typeof scheduledTasksStore.tasks)[0]) {
    scheduledTasksStore.selectedTaskId = task.id;
  }

  // Load tasks on mount or when cwd changes
  $effect(() => {
    void cwd; // establish reactive tracking for cwd prop
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
      <button type="button"
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
      {:else if filteredTasks.length === 0}
        <EmptyState
          icon="🕐"
          title={t("scheduledTasks_empty")}
          class="h-32"
        />
      {:else}
        <div class="p-2 space-y-2">
          {#if filteredActiveTasks.length > 0}
            <div class="mb-3">
              <p
                class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1 mb-1.5"
              >
                {t("scheduledTasks_active")}
              </p>
              {#each filteredActiveTasks as task (task.id)}
                <button type="button" class="w-full text-left" onclick={() => handleCardClick(task)}>
                  <ScheduledTaskCard
                    {task}
                    selected={scheduledTasksStore.selectedTaskId === task.id}
                  />
                </button>
              {/each}
            </div>
          {/if}

          {#if filteredInactiveTasks.length > 0}
            <div>
              <p
                class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1 mb-1.5"
              >
                {t("scheduledTasks_inactive")}
              </p>
              {#each filteredInactiveTasks as task (task.id)}
                <button type="button" class="w-full text-left" onclick={() => handleCardClick(task)}>
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
