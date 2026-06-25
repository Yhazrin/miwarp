<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { DiagnosticsCategory, DiagnosticsSeverity } from "$lib/types/diagnostics";

  type CategoryFilter = DiagnosticsCategory | "all";
  type SeverityFilter = DiagnosticsSeverity | "all";

  let {
    categoryFilter,
    severityFilter,
    search,
    onCategoryFilterChange,
    onSeverityFilterChange,
    onSearchChange,
  }: {
    categoryFilter: CategoryFilter;
    severityFilter: SeverityFilter;
    search: string;
    onCategoryFilterChange: (category: CategoryFilter) => void;
    onSeverityFilterChange: (severity: SeverityFilter) => void;
    onSearchChange: (value: string) => void;
  } = $props();

  const categoryOptions: { id: CategoryFilter; key: MessageKey }[] = [
    { id: "all", key: "diagnostics_filter_category" },
    { id: "runtime_health", key: "diagnostics_category_runtime_health" },
    { id: "session_health", key: "diagnostics_category_session_health" },
    { id: "trace", key: "diagnostics_category_trace" },
    { id: "performance", key: "diagnostics_category_performance" },
    { id: "export", key: "diagnostics_category_export" },
  ];

  const severityOptions: { id: SeverityFilter; key: MessageKey }[] = [
    { id: "all", key: "diagnostics_filter_severity" },
    { id: "info", key: "diagnostics_severity_info" },
    { id: "warning", key: "diagnostics_severity_warning" },
    { id: "error", key: "diagnostics_severity_error" },
    { id: "critical", key: "diagnostics_severity_critical" },
  ];
</script>

<div
  class="flex flex-wrap items-center gap-2 border-b border-border px-6 py-2"
  role="group"
  aria-label={t("diagnostics_filter_group_label")}
>
  <input
    type="search"
    value={search}
    oninput={(event) => onSearchChange((event.currentTarget as HTMLInputElement).value)}
    placeholder={t("diagnostics_filter_search")}
    aria-label={t("diagnostics_filter_search")}
    class="w-56 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
  />
  <select
    value={categoryFilter}
    onchange={(event) =>
      onCategoryFilterChange((event.currentTarget as HTMLSelectElement).value as CategoryFilter)}
    class="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground"
    aria-label={t("diagnostics_filter_category")}
  >
    {#each categoryOptions as option (option.id)}
      <option value={option.id}>{t(option.key)}</option>
    {/each}
  </select>
  <select
    value={severityFilter}
    onchange={(event) =>
      onSeverityFilterChange((event.currentTarget as HTMLSelectElement).value as SeverityFilter)}
    class="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground"
    aria-label={t("diagnostics_filter_severity")}
  >
    {#each severityOptions as option (option.id)}
      <option value={option.id}>{t(option.key)}</option>
    {/each}
  </select>
</div>
