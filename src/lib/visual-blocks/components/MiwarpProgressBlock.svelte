<script lang="ts">
  import type { MiwarpProgressSpec, VisualBlockTone } from "../types";

  let {
    spec,
    tone = "default",
  }: {
    spec: MiwarpProgressSpec;
    tone?: VisualBlockTone;
  } = $props();

  const toneClass = $derived(tone === "on-primary" ? "on-primary" : "default");
</script>

<div class="miwarp-progress {toneClass}">
  {#if spec.title}
    <h4 class="miwarp-progress-title">{spec.title}</h4>
  {/if}
  {#if spec.summary}
    <p class="miwarp-progress-summary">{spec.summary}</p>
  {/if}
  <ul class="miwarp-progress-list">
    {#each spec.items as item, index (index)}
      <li class="miwarp-progress-item" data-status={item.status ?? "pending"}>
        <div class="miwarp-progress-row">
          <span class="miwarp-progress-label">{item.label}</span>
          {#if item.progress !== undefined}
            <span class="miwarp-progress-value">{item.progress}%</span>
          {/if}
        </div>
        {#if item.detail}
          <p class="miwarp-progress-detail">{item.detail}</p>
        {/if}
        {#if item.progress !== undefined}
          <div
            class="miwarp-progress-bar"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={item.progress}
            aria-label={item.label}
          >
            <div class="miwarp-progress-fill" style:width="{item.progress}%"></div>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .miwarp-progress {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .miwarp-progress-title {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: hsl(var(--foreground));
  }

  .miwarp-progress-summary {
    margin: 0;
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
  }

  .miwarp-progress-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .miwarp-progress-row {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.75rem;
  }

  .miwarp-progress-label {
    color: hsl(var(--foreground));
  }

  .miwarp-progress-detail {
    margin: 0.125rem 0 0;
    font-size: 0.6875rem;
    color: hsl(var(--muted-foreground));
  }

  .miwarp-progress-value {
    color: hsl(var(--muted-foreground));
    font-variant-numeric: tabular-nums;
  }

  .miwarp-progress-bar {
    margin-top: 0.25rem;
    height: 0.375rem;
    border-radius: 999px;
    background: hsl(var(--muted));
    overflow: hidden;
  }

  .miwarp-progress-fill {
    height: 100%;
    border-radius: inherit;
    background: hsl(var(--primary));
    transition: width 0.2s ease;
  }

  .miwarp-progress-item[data-status="done"] .miwarp-progress-fill {
    background: hsl(var(--miwarp-status-done, 142 71% 45%));
  }

  .miwarp-progress-item[data-status="failed"] .miwarp-progress-fill {
    background: hsl(var(--destructive));
  }

  .miwarp-progress-item[data-status="active"] .miwarp-progress-fill {
    background: hsl(var(--miwarp-status-running, var(--primary)));
  }
</style>
