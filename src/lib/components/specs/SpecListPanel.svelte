<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { SpecPriority, SpecRecord, SpecStatus } from "$lib/types/spec";

  type StatusFilter = SpecStatus | "all";
  type PriorityFilter = SpecPriority | "all";

  let {
    specs,
    selectedSpecId,
    loading = false,
    statusFilter,
    priorityFilter,
    search,
    onSelect,
    onStatusFilterChange,
    onPriorityFilterChange,
    onSearchChange,
  }: {
    specs: SpecRecord[];
    selectedSpecId: string | null;
    loading?: boolean;
    statusFilter: StatusFilter;
    priorityFilter: PriorityFilter;
    search: string;
    onSelect: (id: string) => void;
    onStatusFilterChange: (status: StatusFilter) => void;
    onPriorityFilterChange: (priority: PriorityFilter) => void;
    onSearchChange: (value: string) => void;
  } = $props();

  const statusOptions: { id: StatusFilter; key: MessageKey }[] = [
    { id: "all", key: "specs_filter_status" },
    { id: "draft", key: "specs_status_draft" },
    { id: "clarifying", key: "specs_status_clarifying" },
    { id: "planned", key: "specs_status_planned" },
    { id: "implementing", key: "specs_status_implementing" },
    { id: "verifying", key: "specs_status_verifying" },
    { id: "accepted", key: "specs_status_accepted" },
    { id: "rejected", key: "specs_status_rejected" },
  ];

  const priorityOptions: { id: PriorityFilter; key: MessageKey }[] = [
    { id: "all", key: "specs_filter_priority" },
    { id: "low", key: "specs_priority_low" },
    { id: "medium", key: "specs_priority_medium" },
    { id: "high", key: "specs_priority_high" },
    { id: "critical", key: "specs_priority_critical" },
  ];

  const statusKeyById: Record<SpecStatus, MessageKey> = {
    draft: "specs_status_draft",
    clarifying: "specs_status_clarifying",
    planned: "specs_status_planned",
    implementing: "specs_status_implementing",
    verifying: "specs_status_verifying",
    accepted: "specs_status_accepted",
    rejected: "specs_status_rejected",
  };

  const priorityKeyById: Record<SpecPriority, MessageKey> = {
    low: "specs_priority_low",
    medium: "specs_priority_medium",
    high: "specs_priority_high",
    critical: "specs_priority_critical",
  };

  const statusTone: Record<SpecStatus, string> = {
    draft: "bg-muted text-muted-foreground",
    clarifying: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    planned: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
    implementing: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
    verifying: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
    accepted: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    rejected: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  };

  function moveSelection(delta: number): void {
    if (specs.length === 0) return;
    const index = specs.findIndex((spec) => spec.id === selectedSpecId);
    const nextIndex =
      index < 0
        ? delta > 0
          ? 0
          : specs.length - 1
        : (index + delta + specs.length) % specs.length;
    const target = specs[nextIndex];
    if (target) onSelect(target.id);
  }

  function onListKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      const first = specs[0];
      if (first) onSelect(first.id);
    } else if (event.key === "End") {
      event.preventDefault();
      const last = specs[specs.length - 1];
      if (last) onSelect(last.id);
    }
  }
</script>

<div class="flex h-full flex-col border-r border-border">
  <div class="shrink-0 space-y-3 border-b border-border px-4 py-3">
    <div class="flex flex-col gap-2">
      <input
        type="search"
        value={search}
        placeholder={t("specs_filter_search")}
        aria-label={t("specs_filter_search")}
        oninput={(event) => onSearchChange((event.currentTarget as HTMLInputElement).value)}
        class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
      />
      <div class="flex flex-wrap gap-1.5" role="group" aria-label={t("specs_filter_group_label")}>
        <select
          value={statusFilter}
          onchange={(event) =>
            onStatusFilterChange((event.currentTarget as HTMLSelectElement).value as StatusFilter)}
          class="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground"
          aria-label={t("specs_filter_status")}
        >
          {#each statusOptions as option (option.id)}
            <option value={option.id}>{t(option.key)}</option>
          {/each}
        </select>
        <select
          value={priorityFilter}
          onchange={(event) =>
            onPriorityFilterChange(
              (event.currentTarget as HTMLSelectElement).value as PriorityFilter,
            )}
          class="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground"
          aria-label={t("specs_filter_priority")}
        >
          {#each priorityOptions as option (option.id)}
            <option value={option.id}>{t(option.key)}</option>
          {/each}
        </select>
      </div>
    </div>
  </div>

  <div
    class="flex-1 overflow-y-auto p-2"
    role="listbox"
    aria-label={t("specs_title")}
    tabindex="0"
    onkeydown={onListKeydown}
  >
    {#if loading && specs.length === 0}
      <p class="px-3 py-6 text-xs text-muted-foreground">{t("common_loading")}</p>
    {:else if specs.length === 0}
      <p class="px-3 py-6 text-xs text-muted-foreground">{t("specs_empty")}</p>
    {:else}
      <ul class="space-y-1">
        {#each specs as spec (spec.id)}
          <li>
            <button
              type="button"
              class="w-full rounded-lg border px-3 py-2.5 text-left transition-colors
                {selectedSpecId === spec.id
                ? 'border-primary/40 bg-primary/10'
                : 'border-transparent hover:border-border hover:bg-muted/40'}"
              aria-current={selectedSpecId === spec.id ? "true" : undefined}
              aria-label={t("specs_select_aria", { title: spec.title })}
              onclick={() => onSelect(spec.id)}
            >
              <div class="flex items-start justify-between gap-2">
                <p class="truncate text-sm font-medium text-foreground">{spec.title}</p>
                <span
                  class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold {statusTone[
                    spec.status
                  ]}"
                >
                  {t(statusKeyById[spec.status])}
                </span>
              </div>
              <div class="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{t(priorityKeyById[spec.priority])}</span>
                <span
                  >{t("specs_criteria_count", {
                    count: String(spec.acceptance_criteria.length),
                  })}</span
                >
              </div>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
