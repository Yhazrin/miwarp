<script lang="ts">
  import MiPopover from "$lib/ui/MiPopover.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { formatTokenCount } from "$lib/utils/format";
  import Icon from "$lib/components/Icon.svelte";
  import { MIWARP_DETAIL_POPOVER_CLASS } from "$lib/ui/miwarp-surfaces";

  let {
    contextUtilization = 0,
    contextWarningLevel = "none",
    contextWindow = 0,
    compactMode = false,
    showTooltip = true,
    onClick = undefined,
  }: {
    contextUtilization?: number;
    contextWarningLevel?: string;
    contextWindow?: number;
    compactMode?: boolean;
    showTooltip?: boolean;
    onClick?: () => void;
  } = $props();

  let detailOpen = $state(false);

  let pct = $derived(Math.round(contextUtilization * 100));

  let barColor = $derived.by(() => {
    if (contextWarningLevel === "critical" || contextWarningLevel === "high") {
      return "bg-gradient-to-r from-miwarp-status-error to-miwarp-status-warning";
    }
    if (contextWarningLevel === "moderate") {
      return "bg-gradient-to-r from-miwarp-status-warning to-yellow-400";
    }
    if (pct >= 80) {
      return "bg-gradient-to-r from-miwarp-status-warning to-yellow-400";
    }
    if (pct >= 60) {
      return "bg-gradient-to-r from-miwarp-status-success to-emerald-400";
    }
    return "bg-gradient-to-r from-emerald-500 to-teal-400";
  });

  let barWidth = $derived(Math.min(100, pct));

  let pulseClass = $derived(
    contextWarningLevel === "critical"
      ? "animate-pulse-slow"
      : contextWarningLevel === "high"
        ? "animate-pulse"
        : "",
  );

  let usedTokens = $derived(contextWindow ? Math.round(contextUtilization * contextWindow) : 0);
  let remainingTokens = $derived(contextWindow ? contextWindow - usedTokens : 0);

  let warningLabel = $derived.by(() => {
    switch (contextWarningLevel) {
      case "critical":
        return t("contextLevel_critical");
      case "high":
        return t("contextLevel_high");
      case "moderate":
        return t("contextLevel_moderate");
      default:
        return t("contextLevel_normal");
    }
  });

  let warningColor = $derived.by(() => {
    switch (contextWarningLevel) {
      case "critical":
        return "text-miwarp-status-error bg-[hsl(var(--miwarp-status-error)/0.1)] border-[hsl(var(--miwarp-status-error)/0.3)]";
      case "high":
        return "text-miwarp-status-warning bg-[hsl(var(--miwarp-status-warning)/0.1)] border-[hsl(var(--miwarp-status-warning)/0.3)]";
      case "moderate":
        return "text-miwarp-status-warning bg-[hsl(var(--miwarp-status-warning)/0.1)] border-[hsl(var(--miwarp-status-warning)/0.3)]";
      default:
        return "text-miwarp-status-success bg-[hsl(var(--miwarp-status-success)/0.1)] border-[hsl(var(--miwarp-status-success)/0.3)]";
    }
  });

  let contextAria = $derived(
    t("context_aria", {
      pct: String(pct),
      used: formatTokenCount(usedTokens),
      total: formatTokenCount(contextWindow),
    }),
  );

  function handleExternalClick(e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
    onClick?.();
  }

  function closeDetail() {
    detailOpen = false;
  }

</script>

{#snippet contextTrigger(props: Record<string, unknown>)}
  <div
    {...props}
    class="relative inline-flex cursor-pointer items-center {props.class ?? ''}"
    role="button"
    tabindex="0"
    aria-label={contextAria}
    onclick={(e: MouseEvent) => e.stopPropagation()}
  >
    <div class="flex items-center gap-2">
      <div class="session-context-bar min-w-[4rem] {pulseClass}">
        <div class="h-full w-full overflow-hidden rounded-full bg-muted/30">
          <div class="h-full transition-all duration-500 {barColor}" style="width: {barWidth}%"></div>
        </div>
        <span class="ml-1.5 text-[10px] font-bold text-foreground/70">{pct}%</span>
        <span class="text-[10px] font-medium text-foreground/50">ctx</span>
      </div>

      {#if !compactMode}
        <span class="session-context-pill text-foreground/60 {pulseClass}">
          <span class="session-context-pill-inner {barColor}">
            <span class="flex items-center justify-center whitespace-nowrap">
              <span
                class="w-8 text-center text-[10px] font-bold text-[hsl(var(--miwarp-accent-on-accent)/0.9)]"
                >{pct}%</span
              >
              <span
                class="session-context-ctx-label text-[10px] font-bold text-[hsl(var(--miwarp-accent-on-accent)/0.7)]"
                >ctx</span
              >
            </span>
          </span>
        </span>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet contextDetailPanel()}
  <div class="mb-3 flex items-center justify-between">
    <h4 class="text-sm font-semibold text-foreground">{t("context_detailTitle")}</h4>
    <button
      type="button"
      class="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      onclick={closeDetail}
      aria-label={t("common_close")}
    >
      <Icon name="x" size="sm" />
    </button>
  </div>

  <div class="mb-4">
    <div class="mb-1.5 h-3 w-full overflow-hidden rounded-full bg-muted/30">
      <div class="h-full transition-all duration-500 {barColor}" style="width: {barWidth}%"></div>
    </div>
    <div class="flex items-center justify-between text-[10px]">
      <span class="text-muted-foreground">{pct}% {t("context_used")}</span>
      <span class="{warningColor} rounded-full border px-2 py-0.5 text-[9px] font-medium">
        {warningLabel}
      </span>
    </div>
  </div>

  <div class="space-y-2 border-t border-border/40 pt-3">
    <div class="flex items-center justify-between text-xs">
      <span class="text-muted-foreground">{t("context_usedTokens")}</span>
      <span class="font-mono font-medium text-foreground">{formatTokenCount(usedTokens)}</span>
    </div>
    <div class="flex items-center justify-between text-xs">
      <span class="text-muted-foreground">{t("context_remainingTokens")}</span>
      <span class="font-mono font-medium text-miwarp-status-success"
        >{formatTokenCount(remainingTokens)}</span
      >
    </div>
    <div class="flex items-center justify-between text-xs">
      <span class="text-muted-foreground">{t("context_totalWindow")}</span>
      <span class="font-mono font-medium text-foreground">{formatTokenCount(contextWindow)}</span>
    </div>
  </div>

  <div class="mt-3 border-t border-border/40 pt-3">
    <p class="text-center text-[10px] text-muted-foreground/70">{t("context_hint")}</p>
  </div>
{/snippet}

{#if onClick}
  <div class="relative inline-flex items-center">
    <div class="flex items-center gap-2">
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="session-context-bar min-w-[4rem] {pulseClass}"
        role={showTooltip ? "button" : "presentation"}
        tabindex="0"
        aria-label={contextAria}
        onclick={handleExternalClick}
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleExternalClick(e);
          }
        }}
      >
        <div class="h-full w-full overflow-hidden rounded-full bg-muted/30">
          <div class="h-full transition-all duration-500 {barColor}" style="width: {barWidth}%"></div>
        </div>
        <span class="ml-1.5 text-[10px] font-bold text-foreground/70">{pct}%</span>
        <span class="text-[10px] font-medium text-foreground/50">ctx</span>
      </div>
    </div>
  </div>
{:else}
  <MiPopover
    bind:open={detailOpen}
    contentClass={MIWARP_DETAIL_POPOVER_CLASS}
    side="bottom"
    align="end"
    sideOffset={8}
  >
    {#snippet trigger({ props })}
      {@render contextTrigger(props)}
    {/snippet}
    {@render contextDetailPanel()}
  </MiPopover>
{/if}
