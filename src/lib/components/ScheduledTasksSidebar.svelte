<script lang="ts">
  import { onMount } from "svelte";
  import Button from "$lib/components/Button.svelte";
  import ScheduledTaskCard from "$lib/components/ScheduledTaskCard.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { scheduledTasksStore } from "$lib/stores/scheduled-tasks-store.svelte";

  let activeTab = $state<"all" | "active" | "paused">("all");

  const filteredTasks = $derived.by(() => {
    switch (activeTab) {
      case "active":
        return scheduledTasksStore.activeTasks;
      case "paused":
        return scheduledTasksStore.inactiveTasks;
      default:
        return scheduledTasksStore.tasks;
    }
  });

  $effect(() => {
    const id = scheduledTasksStore.selectedTaskId;
    if (!id) return;
    queueMicrotask(() => {
      const el = document.querySelector(`[data-task-card-id="${id}"]`);
      if (el && "scrollIntoView" in el) {
        (el as HTMLElement).scrollIntoView({ block: "nearest" });
      }
    });
  });

  onMount(() => {
    void scheduledTasksStore.loadTasks();
    void scheduledTasksStore.loadAllRuns();
  });
</script>

<div class="flex shrink-0 items-center justify-between gap-2 px-3 py-2.5">
  <h1 class="min-w-0 truncate text-[13px] font-semibold leading-snug text-sidebar-foreground">
    {t("sched_title")}
  </h1>
  <Button variant="ghost" size="sm" onclick={() => scheduledTasksStore.openCreateEditor()}>
    {t("sched_newTask")}
  </Button>
</div>

<div class="flex shrink-0 items-center gap-1 px-2 pb-2">
  <button
    type="button"
    data-active={activeTab === "all" ? "true" : undefined}
    class="rounded-md px-2 py-1 text-xs transition-colors {activeTab === 'all'
      ? 'bg-sidebar-accent text-sidebar-foreground'
      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
    onclick={() => (activeTab = "all")}
  >
    {t("sched_tabAll")} ({scheduledTasksStore.tasks.length})
  </button>
  <button
    type="button"
    data-active={activeTab === "active" ? "true" : undefined}
    class="rounded-md px-2 py-1 text-xs transition-colors {activeTab === 'active'
      ? 'bg-sidebar-accent text-sidebar-foreground'
      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
    onclick={() => (activeTab = "active")}
  >
    {t("sched_tabActive")} ({scheduledTasksStore.activeTasks.length})
  </button>
  <button
    type="button"
    data-active={activeTab === "paused" ? "true" : undefined}
    class="rounded-md px-2 py-1 text-xs transition-colors {activeTab === 'paused'
      ? 'bg-sidebar-accent text-sidebar-foreground'
      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
    onclick={() => (activeTab = "paused")}
  >
    {t("sched_tabPaused")} ({scheduledTasksStore.inactiveTasks.length})
  </button>
</div>

<div class="sidebar-scroll flex-1 overflow-y-auto px-2 py-1">
  {#if scheduledTasksStore.loading}
    <div class="flex items-center justify-center py-8 text-xs text-sidebar-foreground/70">
      {t("sched_loading")}
    </div>
  {:else if filteredTasks.length === 0}
    <div class="flex flex-col items-center justify-center gap-2 px-3 py-10 text-center">
      <p class="text-xs text-sidebar-foreground/70">{t("sched_noTasks")}</p>
      <Button variant="link" onclick={() => scheduledTasksStore.openCreateEditor()}>
        {t("sched_createFirst")}
      </Button>
    </div>
  {:else}
    <div class="space-y-1">
      {#each filteredTasks as task (task.id)}
        <div data-task-card-id={task.id}>
          <ScheduledTaskCard {task} selected={scheduledTasksStore.selectedTaskId === task.id} />
        </div>
      {/each}
    </div>
  {/if}
</div>
