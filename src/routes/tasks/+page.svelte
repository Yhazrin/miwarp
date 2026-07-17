<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { taskCoreStore } from "$lib/stores/task-core-store.svelte";
  import type { TaskCreateInput } from "$lib/types/task";
  import TaskListPanel from "$lib/components/tasks/TaskListPanel.svelte";
  import TaskDetailPanel from "$lib/components/tasks/TaskDetailPanel.svelte";
  import TaskCreateDialog from "$lib/components/tasks/TaskCreateDialog.svelte";

  type FilterId = "all" | "active" | "attention" | "review" | "done" | "failed" | "archived";

  let filter = $state<FilterId>("all");
  let createOpen = $state(false);
  let loadingEvents = $state(false);
  let reconcileToast = $state<string | null>(null);

  const selectedTask = $derived(taskCoreStore.selected);
  const eventsForSelected = $derived(selectedTask ? taskCoreStore.eventsFor(selectedTask.id) : []);

  onMount(() => {
    void taskCoreStore.refresh().catch((e) => {
      console.error("tasks: failed to load", e);
    });
  });

  function handleFilterChange(next: FilterId): void {
    filter = next;
  }

  function handleSelect(id: string): void {
    taskCoreStore.select(id);
    const task = taskCoreStore.selected;
    if (!task) return;
    loadingEvents = true;
    taskCoreStore
      .loadEvents(task.id)
      .catch((e: unknown) => {
        console.error("tasks: loadEvents failed", e);
      })
      .finally(() => {
        loadingEvents = false;
      });
  }

  async function handleCreate(input: TaskCreateInput): Promise<void> {
    try {
      await taskCoreStore.create(input);
      createOpen = false;
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  async function handleRefresh(): Promise<void> {
    await taskCoreStore.refresh();
    if (selectedTask) {
      loadingEvents = true;
      try {
        await taskCoreStore.loadEvents(selectedTask.id);
      } finally {
        loadingEvents = false;
      }
    }
  }

  async function handleLoadEvents(): Promise<void> {
    if (!selectedTask) return;
    loadingEvents = true;
    try {
      await taskCoreStore.loadEvents(selectedTask.id);
    } finally {
      loadingEvents = false;
    }
  }

  async function handleReconcile(): Promise<void> {
    try {
      const report = await taskCoreStore.reconcileAfterRestart();
      reconcileToast = t("tasks_reconcile_summary", {
        scanned: String(report.scanned),
        recovered: String(report.recovered_pending_mutations),
        moved: String(report.moved_to_needs_attention),
        unchanged: String(report.unchanged),
      });
      setTimeout(() => (reconcileToast = null), 4000);
    } catch (e) {
      reconcileToast = e instanceof Error ? e.message : String(e);
      setTimeout(() => (reconcileToast = null), 4000);
    }
  }

  async function handleLinkRun(runId: string, role: string): Promise<void> {
    if (!selectedTask) return;
    await taskCoreStore.linkRun({
      task_id: selectedTask.id,
      run_id: runId,
      role: role as "primary" | "worktree" | "verification" | "review" | "followup",
    });
  }

  async function handleUnlinkRun(runId: string): Promise<void> {
    if (!selectedTask) return;
    await taskCoreStore.linkRun({
      task_id: selectedTask.id,
      run_id: runId,
      role: null,
    });
  }

  async function handleApplyReview(decision: {
    outcome: "pending" | "approved" | "changes_requested" | "rejected";
    notes?: string;
  }): Promise<void> {
    if (!selectedTask) return;
    await taskCoreStore.setReviewDecision(selectedTask.id, {
      outcome: decision.outcome,
      notes: decision.notes ?? null,
      decided_at: new Date().toISOString(),
      reviewer: null,
    });
  }

  async function handleApplyMerge(decision: {
    decision: "pending" | "merge" | "keep_branch" | "discard";
    notes?: string;
  }): Promise<void> {
    if (!selectedTask) return;
    await taskCoreStore.setMergeDecision(selectedTask.id, {
      decision: decision.decision,
      decided_at: new Date().toISOString(),
      notes: decision.notes ?? null,
    });
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
    <div>
      <h1 class="text-base font-semibold text-foreground">{t("tasks_title")}</h1>
      <p class="mt-0.5 text-xs text-muted-foreground">{t("tasks_subtitle")}</p>
    </div>
    <div class="flex gap-2">
      <button
        type="button"
        class="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        onclick={handleReconcile}
      >
        {t("tasks_reconcile")}
      </button>
    </div>
  </div>

  {#if reconcileToast}
    <div
      class="border-b border-border bg-muted/40 px-6 py-2 text-xs text-muted-foreground"
      role="status"
    >
      {reconcileToast}
    </div>
  {/if}

  <div class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[20rem_1fr]">
    <TaskListPanel
      tasks={taskCoreStore.tasks}
      selectedTaskId={selectedTask?.id ?? null}
      loading={taskCoreStore.loading}
      {filter}
      onFilterChange={handleFilterChange}
      onSelect={handleSelect}
      onCreate={() => (createOpen = true)}
    />
    <TaskDetailPanel
      task={selectedTask}
      events={eventsForSelected}
      {loadingEvents}
      onLinkRun={handleLinkRun}
      onUnlinkRun={handleUnlinkRun}
      onApplyReview={handleApplyReview}
      onApplyMerge={handleApplyMerge}
      onRefresh={handleRefresh}
      onLoadEvents={handleLoadEvents}
    />
  </div>

  <TaskCreateDialog
    open={createOpen}
    onSubmit={handleCreate}
    onCancel={() => (createOpen = false)}
  />
</div>
