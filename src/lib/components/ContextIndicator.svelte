<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { formatTokenCount } from "$lib/utils/format";

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
    /** 紧凑模式（用于status bar内联显示） */
    compactMode?: boolean;
    /** 显示tooltip */
    showTooltip?: boolean;
    /** 点击回调 */
    onClick?: () => void;
  } = $props();

  // 详情弹窗状态
  let detailOpen = $state(false);
  let detailRef: HTMLDivElement | undefined = $state();

  // 计算百分比和颜色
  let pct = $derived(Math.round(contextUtilization * 100));

  // 渐变色进度条颜色（基于利用率和预警级别）
  let barColor = $derived.by(() => {
    if (contextWarningLevel === "critical" || contextWarningLevel === "high") {
      return "bg-gradient-to-r from-red-500 to-orange-500";
    }
    if (contextWarningLevel === "moderate") {
      return "bg-gradient-to-r from-amber-500 to-yellow-400";
    }
    if (pct >= 80) {
      return "bg-gradient-to-r from-amber-500 to-yellow-400";
    }
    if (pct >= 60) {
      return "bg-gradient-to-r from-green-500 to-emerald-400";
    }
    return "bg-gradient-to-r from-emerald-500 to-teal-400";
  });

  // 进度条宽度
  let barWidth = $derived(Math.min(100, pct));

  // 脉冲动画类（高利用率时启用）
  let pulseClass = $derived(
    contextWarningLevel === "critical"
      ? "animate-pulse-slow"
      : contextWarningLevel === "high"
        ? "animate-pulse"
        : "",
  );

  // 显示的文本
  let displayText = $derived(compactMode ? `${pct}%` : `ctx ${pct}%`);

  // 详细tokens信息（用于弹窗）
  let usedTokens = $derived(contextWindow ? Math.round(contextUtilization * contextWindow) : 0);
  let remainingTokens = $derived(contextWindow ? contextWindow - usedTokens : 0);

  // 预警级别标签
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

  // 预警级别颜色
  let warningColor = $derived.by(() => {
    switch (contextWarningLevel) {
      case "critical":
        return "text-[hsl(var(--miwarp-status-error))] bg-[hsl(var(--miwarp-status-error)/0.1)] border-[hsl(var(--miwarp-status-error)/0.3)]";
      case "high":
        return "text-[hsl(var(--miwarp-status-warning))] bg-[hsl(var(--miwarp-status-warning)/0.1)] border-[hsl(var(--miwarp-status-warning)/0.3)]";
      case "moderate":
        return "text-amber-500 bg-amber-500/10 border-amber-500/30";
      default:
        return "text-emerald-500 bg-emerald-500/10 border-emerald-500/30";
    }
  });

  function toggleDetail(e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
    if (onClick) {
      onClick();
    } else {
      detailOpen = !detailOpen;
    }
  }

  function closeDetail() {
    detailOpen = false;
  }

  // 点击外部关闭弹窗
  function handleClickOutside(e: MouseEvent) {
    if (detailOpen && detailRef && !detailRef.contains(e.target as Node)) {
      detailOpen = false;
    }
  }
</script>

/** * ContextIndicator: 增强型上下文使用率可视化组件 * * Codex 设计灵感: * 1.
渐变色进度条（绿色→黄色→橙色→红色） * 2. 点击展开详细信息弹窗 * 3. 预警级别视觉增强（脉冲动画） * 4.
显示已用/总 tokens 数量 */
<svelte:window onclick={handleClickOutside} />

<div class="relative inline-flex items-center">
  <!-- 进度条背景 -->
  <div class="flex items-center gap-2">
    <!-- 迷你进度条（紧凑模式） -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="session-context-bar min-w-[4rem] {pulseClass}"
      role={showTooltip || onClick ? "button" : "presentation"}
      tabindex={onClick ? 0 : -1}
      aria-label={t("context_aria", {
        pct: String(pct),
        used: formatTokenCount(usedTokens),
        total: formatTokenCount(contextWindow),
      })}
      onclick={onClick || toggleDetail}
      onkeydown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick ? onClick() : toggleDetail(e);
        }
      }}
    >
      <div class="h-full w-full overflow-hidden rounded-full bg-muted/30">
        <div class="h-full transition-all duration-500 {barColor}" style="width: {barWidth}%"></div>
      </div>
      <span class="ml-1.5 text-[10px] font-bold text-foreground/70">{pct}%</span>
      <span class="text-[10px] font-medium text-foreground/50">ctx</span>
    </div>

    <!-- 非紧凑模式：pill样式 -->
    {#if !compactMode}
      <span
        class="session-context-pill text-foreground/60 cursor-pointer {pulseClass}"
        role="button"
        tabindex="0"
        aria-label={t("context_aria", {
          pct: String(pct),
          used: formatTokenCount(usedTokens),
          total: formatTokenCount(contextWindow),
        })}
        onclick={toggleDetail}
        onkeydown={(e) => {
          if (e.key === "Enter") toggleDetail(e);
        }}
      >
        <span class="session-context-pill-inner {barColor}">
          <span class="flex items-center justify-center whitespace-nowrap">
            <span class="text-[10px] font-bold text-white/90 w-8 text-center">{pct}%</span>
            <span class="session-context-ctx-label text-[10px] font-bold text-white/70">ctx</span>
          </span>
        </span>
      </span>
    {/if}
  </div>

  <!-- 详情弹窗 -->
  {#if detailOpen}
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      bind:this={detailRef}
      class="absolute top-full right-0 z-50 mt-2 w-64 rounded-xl border border-border/60 bg-background/95 p-3 shadow-lg backdrop-blur-sm animate-fade-in"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key === "Escape") closeDetail();
      }}
      role="dialog"
      tabindex="-1"
      aria-label={t("context_detailTitle")}
    >
      <!-- Header -->
      <div class="mb-3 flex items-center justify-between">
        <h4 class="text-sm font-semibold text-foreground">{t("context_detailTitle")}</h4>
        <button
          class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          onclick={closeDetail}
          aria-label={t("common_close")}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- 大进度条 -->
      <div class="mb-4">
        <div class="mb-1.5 h-3 w-full overflow-hidden rounded-full bg-muted/30">
          <div
            class="h-full transition-all duration-500 {barColor}"
            style="width: {barWidth}%"
          ></div>
        </div>
        <div class="flex items-center justify-between text-[10px]">
          <span class="text-muted-foreground">{pct}% {t("context_used")}</span>
          <span class="{warningColor} rounded-full px-2 py-0.5 text-[9px] font-medium border">
            {warningLabel}
          </span>
        </div>
      </div>

      <!-- 详细数据 -->
      <div class="space-y-2 border-t border-border/40 pt-3">
        <div class="flex items-center justify-between text-xs">
          <span class="text-muted-foreground">{t("context_usedTokens")}</span>
          <span class="font-mono font-medium text-foreground">{formatTokenCount(usedTokens)}</span>
        </div>
        <div class="flex items-center justify-between text-xs">
          <span class="text-muted-foreground">{t("context_remainingTokens")}</span>
          <span class="font-mono font-medium text-emerald-500"
            >{formatTokenCount(remainingTokens)}</span
          >
        </div>
        <div class="flex items-center justify-between text-xs">
          <span class="text-muted-foreground">{t("context_totalWindow")}</span>
          <span class="font-mono font-medium text-foreground"
            >{formatTokenCount(contextWindow)}</span
          >
        </div>
      </div>

      <!-- 操作提示 -->
      <div class="mt-3 border-t border-border/40 pt-3">
        <p class="text-[10px] text-muted-foreground/70 text-center">
          {t("context_hint")}
        </p>
      </div>
    </div>
  {/if}
</div>
