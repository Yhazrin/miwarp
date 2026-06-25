<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type {
    DiagnosticsBundle,
    DiagnosticsEvent,
    DiagnosticsSnapshot,
  } from "$lib/types/diagnostics";
  import { relativeTime } from "$lib/utils/format";

  let {
    snapshot,
    bundles,
    selectedEvent,
    exporting,
    onExport,
  }: {
    snapshot: DiagnosticsSnapshot | null;
    bundles: DiagnosticsBundle[];
    selectedEvent: DiagnosticsEvent | null;
    exporting: boolean;
    onExport: () => void;
  } = $props();

  function healthClass(health: DiagnosticsSnapshot["runtime_health"] | undefined): string {
    if (!health || health === "unknown") return "bg-muted text-muted-foreground";
    if (health === "healthy") return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300";
    if (health === "degraded") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    return "bg-rose-500/15 text-rose-600 dark:text-rose-300";
  }

  function perfMs(value: number | null | undefined): string {
    if (value == null) return "—";
    return t("diagnostics_p_ms", { ms: String(Math.round(value)) });
  }
</script>

<div class="grid grid-cols-1 gap-6 px-6 py-4 lg:grid-cols-2">
  <section class="space-y-2">
    <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {t("diagnostics_health_runtime")}
    </h3>
    <div class="rounded-md border border-border bg-background px-3 py-2 text-xs">
      <span
        class="rounded-full px-2 py-0.5 text-[10px] font-semibold {healthClass(
          snapshot?.runtime_health,
        )}"
      >
        {snapshot?.runtime_health ?? "unknown"}
      </span>
    </div>
    <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {t("diagnostics_health_session")}
    </h3>
    <div class="rounded-md border border-border bg-background px-3 py-2 text-xs">
      <span
        class="rounded-full px-2 py-0.5 text-[10px] font-semibold {healthClass(
          snapshot?.session_health,
        )}"
      >
        {snapshot?.session_health ?? "unknown"}
      </span>
    </div>
    <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {t("diagnostics_health_diagnostics")}
    </h3>
    <p class="text-xs text-foreground">
      {snapshot?.last_diagnostic_at
        ? relativeTime(snapshot.last_diagnostic_at)
        : t("diagnostics_health_never")}
    </p>
  </section>

  <section class="space-y-2">
    <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {t("diagnostics_perf_section")}
    </h3>
    {#if !snapshot?.performance_p50_ms}
      <p class="text-xs text-muted-foreground">{t("diagnostics_perf_none")}</p>
    {:else}
      <dl class="grid grid-cols-3 gap-2 text-xs text-foreground">
        <div class="rounded-md border border-border bg-background px-3 py-2">
          <dt class="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("diagnostics_p50_label")}
          </dt>
          <dd>{perfMs(snapshot.performance_p50_ms)}</dd>
        </div>
        <div class="rounded-md border border-border bg-background px-3 py-2">
          <dt class="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("diagnostics_p95_label")}
          </dt>
          <dd>{perfMs(snapshot.performance_p95_ms)}</dd>
        </div>
        <div class="rounded-md border border-border bg-background px-3 py-2">
          <dt class="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("diagnostics_p99_label")}
          </dt>
          <dd>{perfMs(snapshot.performance_p99_ms)}</dd>
        </div>
      </dl>
    {/if}
  </section>

  <section class="space-y-2 lg:col-span-2">
    <div class="flex items-center justify-between">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("diagnostics_bundles_section")}
      </h3>
      <button
        type="button"
        class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        disabled={exporting}
        aria-label={t("diagnostics_export_button_aria")}
        onclick={onExport}
      >
        {exporting ? t("diagnostics_export_in_progress") : t("diagnostics_export_button")}
      </button>
    </div>
    {#if bundles.length === 0}
      <p class="text-xs text-muted-foreground">{t("diagnostics_bundles_none")}</p>
    {:else}
      <ul class="space-y-1.5">
        {#each bundles as bundle (bundle.id)}
          <li
            class="rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground"
          >
            <p class="font-mono">{bundle.destination}</p>
            <p class="mt-0.5 text-[10px] text-muted-foreground">
              {bundle.redacted_fields.length} redacted · {relativeTime(bundle.created_at)}
            </p>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if selectedEvent}
    <section class="space-y-2 lg:col-span-2">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {selectedEvent.title}
      </h3>
      <p class="text-xs text-foreground">{selectedEvent.detail ?? "—"}</p>
      <p class="text-[10px] text-muted-foreground">
        {selectedEvent.source ?? "—"} · {selectedEvent.run_id ?? "—"} · {selectedEvent.task_id ??
          "—"}
      </p>
    </section>
  {/if}
</div>
