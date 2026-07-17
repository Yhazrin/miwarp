<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { diagnosticsStore } from "$lib/stores/diagnostics-store.svelte";
  import type {
    DiagnosticsCategory,
    DiagnosticsEvent,
    DiagnosticsSeverity,
  } from "$lib/types/diagnostics";
  import DiagnosticsFilterBar from "$lib/components/diagnostics/DiagnosticsFilterBar.svelte";
  import DiagnosticsEventList from "$lib/components/diagnostics/DiagnosticsEventList.svelte";
  import DiagnosticsHealthPanel from "$lib/components/diagnostics/DiagnosticsHealthPanel.svelte";

  let categoryFilter = $state<DiagnosticsCategory | "all">("all");
  let severityFilter = $state<DiagnosticsSeverity | "all">("all");
  let search = $state("");
  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const events = $derived.by((): DiagnosticsEvent[] => {
    diagnosticsStore.setFilter({ category: categoryFilter, severity: severityFilter, search });
    return diagnosticsStore.filtered();
  });
  const selected = $derived(diagnosticsStore.selectedEvent);
  const counts = $derived(diagnosticsStore.countBySeverity());

  onMount(() => {
    void diagnosticsStore.refresh().catch((e: unknown) => {
      console.error("diagnostics: failed to load", e);
    });
  });

  function onSelect(id: string): void {
    diagnosticsStore.selectEvent(id);
  }

  function onCategoryFilterChange(category: DiagnosticsCategory | "all"): void {
    categoryFilter = category;
  }

  function onSeverityFilterChange(severity: DiagnosticsSeverity | "all"): void {
    severityFilter = severity;
  }

  function onSearchChange(value: string): void {
    search = value;
  }

  async function onExport(): Promise<void> {
    try {
      const bundle = await diagnosticsStore.exportRedactedBundle();
      if (bundle) {
        toast = t("diagnostics_export_done", { path: bundle.destination });
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => (toast = null), 4000);
      }
    } catch (e) {
      toast = t("diagnostics_export_failed", {
        message: e instanceof Error ? e.message : String(e),
      });
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast = null), 4000);
    }
  }

  onDestroy(() => {
    if (toastTimer) clearTimeout(toastTimer);
  });
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
    <div>
      <h1 class="text-base font-semibold text-foreground">{t("diagnostics_title")}</h1>
      <p class="mt-0.5 text-xs text-muted-foreground">{t("diagnostics_subtitle")}</p>
      <p class="mt-1 text-[10px] text-muted-foreground">
        {t("diagnostics_severity_legend", {
          info: String(counts.info),
          warning: String(counts.warning),
          error: String(counts.error),
          critical: String(counts.critical),
        })}
      </p>
    </div>
    <button
      type="button"
      class="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
      onclick={() => diagnosticsStore.refresh()}
    >
      Refresh
    </button>
  </div>

  <DiagnosticsFilterBar
    {categoryFilter}
    {severityFilter}
    {search}
    {onCategoryFilterChange}
    {onSeverityFilterChange}
    {onSearchChange}
  />

  {#if toast}
    <div
      class="border-b border-border bg-muted/40 px-6 py-2 text-xs text-muted-foreground"
      role="status"
    >
      {toast}
    </div>
  {/if}

  <div class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1.4fr_1fr]">
    <DiagnosticsEventList {events} selectedEventId={selected?.id ?? null} {onSelect} />
    <DiagnosticsHealthPanel
      snapshot={diagnosticsStore.snapshot}
      bundles={diagnosticsStore.bundles}
      selectedEvent={selected}
      exporting={diagnosticsStore.exporting}
      {onExport}
    />
  </div>
</div>
