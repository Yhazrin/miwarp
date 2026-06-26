<script lang="ts">
  /**
   * Activity card — 7-day mini summary + jump link to the full /usage page.
   * Receives the totals from the parent so this component never blocks on a
   * network call on its own; if the data is unavailable the parent passes
   * `null` and we render a skeleton.
   */
  import { goto } from "$app/navigation";
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import Icon from "$lib/components/Icon.svelte";
  import PersonalSection from "./PersonalSection.svelte";

  let {
    totalRuns = null,
    totalCostUsd = null,
    dailyCost = [],
  }: {
    totalRuns: number | null;
    totalCostUsd: number | null;
    dailyCost: number[];
  } = $props();

  function lk(key: string): string {
    return t(key as MessageKey);
  }

  const hasData = $derived(totalRuns !== null && totalCostUsd !== null);
  const maxBar = $derived(Math.max(1, ...dailyCost));

  function formatUsd(n: number | null): string {
    if (n === null) return "—";
    return `$${n.toFixed(2)}`;
  }
</script>

<PersonalSection
  icon="bar-chart-2"
  eyebrow={lk("personal_section_activity_eyebrow")}
  title={lk("personal_section_activity_title")}
  description={lk("personal_section_activity_desc")}
>
  {#snippet action()}
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/10"
      onclick={() => goto("/usage")}
    >
      {lk("personal_activity_viewFull")}
      <Icon name="chevron-right" size="xs" />
    </button>
  {/snippet}

  {#if !hasData}
    <div class="space-y-2">
      <div class="h-3 w-1/3 animate-pulse rounded bg-sidebar-accent/30"></div>
      <div class="h-3 w-1/2 animate-pulse rounded bg-sidebar-accent/30"></div>
    </div>
  {:else}
    <div class="grid grid-cols-2 gap-4">
      <div>
        <p class="text-xs uppercase tracking-wide text-muted-foreground">
          {lk("personal_activity_runs7d")}
        </p>
        <p class="mt-1 text-2xl font-semibold tabular-nums text-foreground">{totalRuns}</p>
      </div>
      <div>
        <p class="text-xs uppercase tracking-wide text-muted-foreground">
          {lk("personal_activity_cost7d")}
        </p>
        <p class="mt-1 text-2xl font-semibold tabular-nums text-foreground">
          {formatUsd(totalCostUsd)}
        </p>
      </div>
    </div>

    {#if dailyCost.length > 0}
      <div class="flex h-16 items-end gap-1" aria-hidden="true">
        {#each dailyCost as value, idx (idx)}
          <div
            class="flex-1 rounded-sm bg-primary/40 transition-colors"
            style="height: {Math.max(6, (value / maxBar) * 100)}%"
            title={`${lk("personal_activity_day")} ${idx + 1}: ${formatUsd(value)}`}
          ></div>
        {/each}
      </div>
    {/if}
  {/if}
</PersonalSection>
