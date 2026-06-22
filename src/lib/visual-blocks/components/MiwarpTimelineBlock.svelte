<script lang="ts">
  import type { MiwarpTimelineSpec, VisualBlockTone } from "../types";

  let {
    spec,
    tone = "default",
  }: {
    spec: MiwarpTimelineSpec;
    tone?: VisualBlockTone;
  } = $props();

  const toneClass = $derived(tone === "on-primary" ? "on-primary" : "default");
</script>

<div class="miwarp-timeline {toneClass}">
  {#if spec.title}
    <h4 class="miwarp-timeline-title">{spec.title}</h4>
  {/if}
  <ol class="miwarp-timeline-list">
    {#each spec.items as item, index (index)}
      <li class="miwarp-timeline-item" data-state={item.state ?? "pending"}>
        <div class="miwarp-timeline-marker" aria-hidden="true"></div>
        <div class="miwarp-timeline-body">
          <div class="miwarp-timeline-row">
            <span class="miwarp-timeline-item-title">{item.title}</span>
            {#if item.date}
              <time class="miwarp-timeline-date">{item.date}</time>
            {/if}
          </div>
          {#if item.detail}
            <p class="miwarp-timeline-detail">{item.detail}</p>
          {/if}
        </div>
      </li>
    {/each}
  </ol>
</div>

<style>
  .miwarp-timeline-title {
    margin: 0 0 0.625rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: hsl(var(--foreground));
  }

  .miwarp-timeline-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .miwarp-timeline-item {
    display: grid;
    grid-template-columns: 1rem 1fr;
    gap: 0.625rem;
    padding-bottom: 0.875rem;
    position: relative;
  }

  .miwarp-timeline-item:not(:last-child)::before {
    content: "";
    position: absolute;
    left: 0.4375rem;
    top: 1rem;
    bottom: 0;
    width: 1px;
    background: hsl(var(--border) / 0.6);
  }

  .miwarp-timeline-marker {
    width: 0.875rem;
    height: 0.875rem;
    margin-top: 0.125rem;
    border-radius: 999px;
    border: 2px solid hsl(var(--border));
    background: hsl(var(--background));
    z-index: 1;
  }

  .miwarp-timeline-item[data-state="active"] .miwarp-timeline-marker {
    border-color: hsl(var(--primary));
    background: hsl(var(--primary) / 0.2);
  }

  .miwarp-timeline-item[data-state="done"] .miwarp-timeline-marker {
    border-color: hsl(var(--miwarp-status-done, 142 71% 45%));
    background: hsl(var(--miwarp-status-done, 142 71% 45%) / 0.25);
  }

  .miwarp-timeline-item[data-state="failed"] .miwarp-timeline-marker {
    border-color: hsl(var(--destructive));
    background: hsl(var(--destructive) / 0.2);
  }

  .miwarp-timeline-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.375rem;
  }

  .miwarp-timeline-item-title {
    font-size: 0.75rem;
    font-weight: 500;
    color: hsl(var(--foreground));
  }

  .miwarp-timeline-date {
    font-size: 0.6875rem;
    color: hsl(var(--muted-foreground));
    font-variant-numeric: tabular-nums;
  }

  .miwarp-timeline-detail {
    margin: 0.25rem 0 0;
    font-size: 0.6875rem;
    color: hsl(var(--muted-foreground));
    line-height: 1.4;
  }
</style>
