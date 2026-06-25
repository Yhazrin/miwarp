<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { specStore } from "$lib/stores/spec-store.svelte";
  import type { SpecPriority, SpecStatus } from "$lib/types/spec";
  import SpecListPanel from "$lib/components/specs/SpecListPanel.svelte";
  import SpecDetailPanel from "$lib/components/specs/SpecDetailPanel.svelte";

  const selected = $derived(specStore.selected);
  const filtered = $derived(specStore.filtered());
  const counts = $derived(specStore.countByStatus());

  let statusFilter = $state<SpecStatus | "all">("all");
  let priorityFilter = $state<SpecPriority | "all">("all");
  let search = $state("");

  onMount(() => {
    void specStore.refresh().catch((e: unknown) => {
      console.error("specs: failed to load", e);
    });
  });

  function syncStoreFilter(): void {
    specStore.setFilter({ status: statusFilter, priority: priorityFilter, search });
  }

  function onStatusFilterChange(next: SpecStatus | "all"): void {
    statusFilter = next;
    syncStoreFilter();
  }

  function onPriorityFilterChange(next: SpecPriority | "all"): void {
    priorityFilter = next;
    syncStoreFilter();
  }

  function onSearchChange(value: string): void {
    search = value;
    syncStoreFilter();
  }

  function onSelect(id: string): void {
    specStore.select(id);
  }

  function onRunGate(gateId: string): void {
    if (!selected) return;
    // Frontend stub: cycle verdict so reviewers can see the surface update end-to-end.
    // Tauri command will replace this with the real gate runner.
    const current = selected.gates.find((gate) => gate.id === gateId);
    if (!current) return;
    const next: "pending" | "pass" | "fail" =
      current.verdict === "pending" ? "pass" : current.verdict === "pass" ? "fail" : "pending";
    specStore.recordGateResult(selected.id, gateId, next);
  }

  const activeCount = $derived(
    counts.clarifying + counts.planned + counts.implementing + counts.verifying,
  );
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
    <div>
      <h1 class="text-base font-semibold text-foreground">{t("specs_title")}</h1>
      <p class="mt-0.5 text-xs text-muted-foreground">{t("specs_subtitle")}</p>
      <p class="mt-1 text-[10px] text-muted-foreground">
        {t("specs_summary_stats", {
          specs: String(filtered.length),
          active: String(activeCount),
          accepted: String(counts.accepted),
        })}
      </p>
    </div>
    <button
      type="button"
      class="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
      aria-label={t("specs_refresh")}
      onclick={() => specStore.refresh()}
    >
      {t("specs_refresh")}
    </button>
  </div>

  <div class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[20rem_1fr]">
    <SpecListPanel
      specs={filtered}
      selectedSpecId={selected?.id ?? null}
      loading={specStore.loading}
      {statusFilter}
      {priorityFilter}
      {search}
      {onSelect}
      {onStatusFilterChange}
      {onPriorityFilterChange}
      {onSearchChange}
    />
    <SpecDetailPanel spec={selected} {onRunGate} />
  </div>
</div>
