<script lang="ts">
  import type { MiwarpKpiSpec, VisualBlockTone } from "../types";

  let {
    spec,
    tone = "default",
  }: {
    spec: MiwarpKpiSpec;
    tone?: VisualBlockTone;
  } = $props();

  const toneClass = $derived(tone === "on-primary" ? "on-primary" : "default");
</script>

<div class="miwarp-kpi {toneClass}">
  {#if spec.title}
    <h4 class="miwarp-kpi-title">{spec.title}</h4>
  {/if}
  <div class="miwarp-kpi-grid" role="list">
    {#each spec.items as item, index (index)}
      <div class="miwarp-kpi-card" role="listitem" data-status={item.status ?? "neutral"}>
        <p class="miwarp-kpi-label">{item.label}</p>
        <p class="miwarp-kpi-value">{item.value}</p>
        {#if item.detail}
          <p class="miwarp-kpi-detail">{item.detail}</p>
        {/if}
        {#if item.trend}
          <p class="miwarp-kpi-trend" data-trend={item.trend} aria-hidden="true">
            {#if item.trend === "up"}↑{:else if item.trend === "down"}↓{:else}→{/if}
          </p>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .miwarp-kpi-title {
    margin: 0 0 0.5rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: hsl(var(--foreground));
  }

  .miwarp-kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
    gap: 0.5rem;
  }

  .miwarp-kpi-card {
    border: 1px solid hsl(var(--border) / 0.45);
    border-radius: 0.5rem;
    padding: 0.5rem 0.625rem;
    background: hsl(var(--background) / 0.35);
    position: relative;
  }

  .miwarp-kpi-label {
    margin: 0;
    font-size: 0.6875rem;
    color: hsl(var(--muted-foreground));
  }

  .miwarp-kpi-value {
    margin: 0.125rem 0 0;
    font-size: 1rem;
    font-weight: 600;
    color: hsl(var(--foreground));
    font-variant-numeric: tabular-nums;
  }

  .miwarp-kpi-detail {
    margin: 0.125rem 0 0;
    font-size: 0.6875rem;
    color: hsl(var(--muted-foreground));
  }

  .miwarp-kpi-trend {
    position: absolute;
    top: 0.375rem;
    right: 0.5rem;
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .miwarp-kpi-trend[data-trend="up"] {
    color: hsl(var(--miwarp-status-done, 142 71% 45%));
  }

  .miwarp-kpi-trend[data-trend="down"] {
    color: hsl(var(--destructive));
  }

  .miwarp-kpi-trend[data-trend="flat"] {
    color: hsl(var(--muted-foreground));
  }

  .miwarp-kpi-card[data-status="success"] {
    border-color: hsl(var(--miwarp-status-done, 142 71% 45%) / 0.45);
  }

  .miwarp-kpi-card[data-status="warning"] {
    border-color: hsl(var(--miwarp-status-warning, 38 92% 50%) / 0.45);
  }

  .miwarp-kpi-card[data-status="error"] {
    border-color: hsl(var(--destructive) / 0.45);
  }
</style>
