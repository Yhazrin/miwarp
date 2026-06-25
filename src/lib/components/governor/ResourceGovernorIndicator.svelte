<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import {
    resourceGovernorStore,
    type GovernorStatus,
  } from "$lib/stores/resource-governor-store.svelte";

  onMount(() => {
    void resourceGovernorStore.refresh().catch((e: unknown) => {
      console.error("governor: failed to load", e);
    });
  });

  const concurrent = $derived(resourceGovernorStore.concurrentRuns);
  const status = $derived(resourceGovernorStore.status);

  const statusClass = $derived.by((): string => {
    if (status === "exceeded") return "governor-indicator__badge--danger";
    if (status === "warning") return "governor-indicator__badge--warning";
    if (status === "ok") return "governor-indicator__badge--ok";
    return "governor-indicator__badge--unknown";
  });

  const ariaLabel = $derived(t("governor_indicator_aria", { runs: String(concurrent) }));
</script>

<div class="governor-indicator" role="status" aria-live="polite" aria-label={ariaLabel}>
  <span class="governor-indicator__runs font-mono">{concurrent}</span>
  <span class="governor-indicator__label">{t("governor_concurrent_runs")}</span>
  <span class="governor-indicator__badge {statusClass}">{t(`governor_status_${status}`)}</span>
</div>

<style>
  .governor-indicator {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.125rem 0.5rem;
    border-radius: 0.375rem;
    border: 1px solid hsl(var(--border));
    background: hsl(var(--muted) / 0.4);
    font-size: 0.6875rem;
    line-height: 1.2;
    color: hsl(var(--foreground));
  }
  .governor-indicator__runs {
    font-weight: 600;
  }
  .governor-indicator__label {
    color: hsl(var(--muted-foreground));
  }
  .governor-indicator__badge {
    border-radius: 0.25rem;
    padding: 0 0.375rem;
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .governor-indicator__badge--ok {
    background: hsl(var(--emerald-500) / 0.15);
    color: hsl(var(--emerald-600));
  }
  .governor-indicator__badge--warning {
    background: hsl(var(--amber-500) / 0.15);
    color: hsl(var(--amber-700));
  }
  .governor-indicator__badge--danger {
    background: hsl(var(--rose-500) / 0.15);
    color: hsl(var(--rose-600));
  }
  .governor-indicator__badge--unknown {
    background: hsl(var(--muted));
    color: hsl(var(--muted-foreground));
  }
</style>
