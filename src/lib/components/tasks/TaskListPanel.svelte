<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { TaskRecord, TaskStatus } from "$lib/types/task";
  import {
    PRIORITY_KEYS,
    STATUS_KEYS,
    STATUS_TONE,
    isActiveStatus,
  } from "$lib/chat/task-status-helpers";
  import { relativeTime } from "$lib/utils/format";

  type FilterId = "all" | "active" | "attention" | "review" | "done" | "failed" | "archived";

  let {
    tasks,
    selectedTaskId,
    loading = false,
    filter,
    onFilterChange,
    onSelect,
    onCreate,
  }: {
    tasks: TaskRecord[];
    selectedTaskId: string | null;
    loading?: boolean;
    filter: FilterId;
    onFilterChange: (filter: FilterId) => void;
    onSelect: (id: string) => void;
    onCreate: () => void;
  } = $props();

  const filters: { id: FilterId; labelKey: MessageKey }[] = [
    { id: "all", labelKey: "tasks_filter_all" },
    { id: "active", labelKey: "tasks_filter_active" },
    { id: "attention", labelKey: "tasks_filter_attention" },
    { id: "review", labelKey: "tasks_filter_review" },
    { id: "done", labelKey: "tasks_filter_done" },
    { id: "failed", labelKey: "tasks_filter_failed" },
    { id: "archived", labelKey: "tasks_filter_archived" },
  ];

  const filteredTasks = $derived.by(() => {
    switch (filter) {
      case "all":
        return tasks;
      case "active":
        return tasks.filter((task) => isActiveStatus(task.status));
      case "attention":
        return tasks.filter((task) => task.status === "needs_attention");
      case "review":
        return tasks.filter((task) => task.status === "review");
      case "done":
        return tasks.filter((task) => task.status === "done" || task.status === "archived");
      case "failed":
        return tasks.filter((task) => task.status === "failed");
      case "archived":
        return tasks.filter((task) => task.status === "archived");
      default:
        return tasks;
    }
  });

  const statusBadgeClass = (status: TaskStatus): string => {
    const tone = STATUS_TONE[status];
    if (tone === "success") return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300";
    if (tone === "warning") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    if (tone === "danger") return "bg-rose-500/15 text-rose-600 dark:text-rose-300";
    if (tone === "info") return "bg-sky-500/15 text-sky-600 dark:text-sky-300";
    return "bg-muted text-muted-foreground";
  };
</script>

<div class="flex h-full flex-col border-r border-border">
  <div class="shrink-0 space-y-3 border-b border-border px-4 py-3">
    <div class="flex items-center justify-between gap-2">
      <div>
        <h2 class="text-sm font-semibold text-foreground">{t("tasks_title")}</h2>
        <p class="mt-0.5 text-xs text-muted-foreground">{t("tasks_subtitle")}</p>
      </div>
      <button
        type="button"
        class="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        onclick={onCreate}
      >
        {t("tasks_create_button")}
      </button>
    </div>
    <div class="flex flex-wrap gap-1.5">
      {#each filters as option (option.id)}
        <button
          type="button"
          class="rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors
            {filter === option.id
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border text-muted-foreground hover:bg-muted'}"
          onclick={() => onFilterChange(option.id)}
        >
          {t(option.labelKey)}
        </button>
      {/each}
    </div>
  </div>

  <div class="flex-1 overflow-y-auto p-2">
    {#if loading && tasks.length === 0}
      <p class="px-3 py-6 text-xs text-muted-foreground">{t("common_loading")}</p>
    {:else if filteredTasks.length === 0}
      <p class="px-3 py-6 text-xs text-muted-foreground">{t("tasks_empty")}</p>
    {:else}
      <ul class="space-y-1">
        {#each filteredTasks as task (task.id)}
          <li>
            <button
              type="button"
              class="w-full rounded-lg border px-3 py-2.5 text-left transition-colors
                {selectedTaskId === task.id
                ? 'border-primary/40 bg-primary/10'
                : 'border-transparent hover:border-border hover:bg-muted/40'}"
              onclick={() => onSelect(task.id)}
            >
              <div class="flex items-start justify-between gap-2">
                <p class="truncate text-sm font-medium text-foreground">{task.title}</p>
                <span
                  class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold {statusBadgeClass(
                    task.status,
                  )}"
                >
                  {t(STATUS_KEYS[task.status])}
                </span>
              </div>
              <div class="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{t(PRIORITY_KEYS[task.priority])}</span>
                <span title={task.updated_at}>{relativeTime(task.updated_at)}</span>
              </div>
              {#if task.changed_files.length > 0}
                <p class="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                  {task.changed_files.length} files
                </p>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
