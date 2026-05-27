<script lang="ts">
  import type { WarningLevel } from "$lib/utils/context-window";
  import {
    formatTokens,
    formatCost,
    getProgressColor,
    getContainerBg,
    getBorderColor,
    getPercentage,
  } from "$lib/utils/context-window";
  import { t } from "$lib/i18n/index.svelte";
  import { fade } from "svelte/transition";

  let {
    utilization = 0,
    warningLevel = "none" as WarningLevel,
    inputTokens = 0,
    outputTokens = 0,
    cacheReadTokens = 0,
    cacheWriteTokens = 0,
    model = "",
    cost = 0,
    compact = false,
    showCost = false,
    class: className = "",
  } = $props();

  let showTooltip = $state(false);

  const percentage = $derived(getPercentage(utilization));
  const progressColor = $derived(getProgressColor(warningLevel));
  const containerBg = $derived(getContainerBg(warningLevel));
  const borderColor = $derived(getBorderColor(warningLevel));

  const totalTokens = $derived(inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens);

  const effectiveTokens = $derived(inputTokens + outputTokens);

  function getWarningIcon(level: WarningLevel): string {
    switch (level) {
      case "none":
        return "";
      case "moderate":
        return "⚠️";
      case "high":
        return "⚠️";
      case "critical":
        return "🚨";
    }
  }

  function getWarningMessage(level: WarningLevel): string {
    switch (level) {
      case "none":
        return "";
      case "moderate":
        return t("context_moderateWarning");
      case "high":
        return t("context_highWarning");
      case "critical":
        return t("context_criticalWarning");
    }
  }
</script>

{#if compact}
  <!-- Compact mode: inline progress bar with percentage -->
  <div
    class="inline-flex items-center gap-1.5 {className}"
    role="meter"
    aria-valuenow={percentage}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-label={t("context_usageMeter", { pct: percentage.toString() })}
  >
    <div class="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
      <div
        class="h-full rounded-full transition-all duration-300 {progressColor}"
        style="width: {percentage}%"
      ></div>
    </div>
    <span class="text-xs text-muted-foreground tabular-nums">
      {percentage}%
    </span>
  </div>
{:else}
  <!-- Full mode: detailed display with breakdown -->
  <div
    class="relative rounded-lg border p-3 transition-all duration-300 {containerBg} {borderColor} {className}"
    role="region"
    aria-label={t("context.contextWindow")}
    onmouseenter={() => (showTooltip = true)}
    onmouseleave={() => (showTooltip = false)}
  >
    <!-- Header -->
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-foreground">
          {t("context.tokenUsage")}
        </span>
        {#if model}
          <span class="text-xs text-muted-foreground">{model}</span>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        {#if warningLevel !== "none"}
          <span class="text-sm" title={getWarningMessage(warningLevel)}>
            {getWarningIcon(warningLevel)}
          </span>
        {/if}
        {#if showCost && cost > 0}
          <span class="text-xs text-muted-foreground tabular-nums">
            {formatCost(cost)}
          </span>
        {/if}
      </div>
    </div>

    <!-- Progress bar -->
    <div class="relative h-2.5 bg-muted rounded-full overflow-hidden">
      <!-- Threshold markers -->
      <div class="absolute inset-0 flex">
        <div class="w-1/2 border-r border-dashed border-border"></div>
        <div class="w-3/4 border-r border-dashed border-border"></div>
      </div>

      <!-- Fill -->
      <div
        class="absolute inset-y-0 left-0 rounded-full transition-all duration-500 {progressColor}"
        style="width: {percentage}%"
      ></div>
    </div>

    <!-- Percentage label -->
    <div class="flex justify-end mt-1">
      <span class="text-xs text-muted-foreground tabular-nums">
        {percentage}%
      </span>
    </div>

    <!-- Token breakdown -->
    <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      <!-- Input -->
      <div class="flex items-center gap-1">
        <span class="w-2 h-2 rounded-full bg-[hsl(var(--miwarp-status-info))]"></span>
        <span class="text-xs text-muted-foreground">{t('context_input')}</span>
        <span class="text-xs tabular-nums text-foreground">
          {formatTokens(inputTokens)}
        </span>
      </div>

      <!-- Output -->
      <div class="flex items-center gap-1">
        <span class="w-2 h-2 rounded-full bg-[hsl(var(--miwarp-accent-violet))]"></span>
        <span class="text-xs text-muted-foreground">{t('context_output')}</span>
        <span class="text-xs tabular-nums text-foreground">
          {formatTokens(outputTokens)}
        </span>
      </div>

      <!-- Cache Read -->
      {#if cacheReadTokens > 0}
        <div class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-[hsl(var(--miwarp-status-success))]"></span>
          <span class="text-xs text-muted-foreground">{t('context_cache')}</span>
          <span class="text-xs tabular-nums text-foreground">
            {formatTokens(cacheReadTokens)}
          </span>
        </div>
      {/if}

      <!-- Cache Write -->
      {#if cacheWriteTokens > 0}
        <div class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-[hsl(var(--miwarp-status-warning))]"></span>
          <span class="text-xs text-muted-foreground">{t('context_write')}</span>
          <span class="text-xs tabular-nums text-foreground">
            {formatTokens(cacheWriteTokens)}
          </span>
        </div>
      {/if}

      <!-- Total -->
      <div class="flex items-center gap-1 ml-auto">
        <span class="text-xs text-muted-foreground">{t('context_totalTokens')}</span>
        <span class="text-xs tabular-nums font-medium text-foreground">
          {formatTokens(totalTokens)}
        </span>
      </div>
    </div>

    <!-- Warning message -->
    {#if warningLevel !== "none"}
      <div class="mt-2 text-xs text-muted-foreground flex items-center gap-1">
        <span>{getWarningMessage(warningLevel)}</span>
      </div>
    {/if}

    <!-- Tooltip (detailed breakdown on hover) -->
    {#if showTooltip}
      <div
        class="absolute left-0 right-0 bottom-full mb-2 p-3 bg-popover border border-border rounded-lg shadow-xl z-50"
        transition:fade={{ duration: 100 }}
      >
        <div class="text-xs space-y-1">
          <div class="flex justify-between">
            <span class="text-muted-foreground">{t('context_totalTokens')}</span>
            <span class="tabular-nums text-foreground">{totalTokens.toLocaleString()}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">{t('context_effective')} (in + out):</span>
            <span class="tabular-nums text-foreground">{effectiveTokens.toLocaleString()}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">{t('context_cacheEfficiency')}</span>
            <span class="tabular-nums text-foreground">
              {effectiveTokens > 0
                ? ((cacheReadTokens / effectiveTokens) * 100).toFixed(1) + "%"
                : "N/A"}
            </span>
          </div>
          {#if cost > 0}
            <div class="flex justify-between">
              <span class="text-muted-foreground">{t('context_cost')}</span>
              <span class="tabular-nums text-foreground">{formatCost(cost)}</span>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Animation for critical state pulse */
  :global(.critical) .progress-bar {
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }
</style>
