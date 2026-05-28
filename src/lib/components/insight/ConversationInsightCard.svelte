<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { InsightReport } from "$lib/conversation-insight/insight-types";

  let {
    report,
    html: _html,
    status,
    error,
    onPreview,
    onCopy,
    onExport,
    onRegenerate,
  }: {
    report?: InsightReport;
    html?: string;
    status: "idle" | "generating" | "ready" | "error";
    error?: string;
    onPreview?: () => void;
    onCopy?: () => void;
    onExport?: () => void;
    onRegenerate?: () => void;
  } = $props();
</script>

<div class="border border-miwarp-border rounded-xl overflow-hidden">
  {#if status === "generating"}
    <div class="flex items-start gap-4 p-5 bg-miwarp-bg-surface">
      <div
        class="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-[hsl(var(--miwarp-accent-primary)/0.1)] rounded-[10px] text-miwarp-accent-primary animate-spin"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5">
          <path
            d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
          />
        </svg>
      </div>
      <div class="flex-1">
        <p class="text-[14px] font-semibold text-miwarp-text-primary mb-1">
          {t("insight_generating_title")}
        </p>
        <p class="text-[13px] text-miwarp-text-secondary m-0">{t("insight_generating_desc")}</p>
      </div>
    </div>
  {:else if status === "error"}
    <div class="flex items-start gap-4 p-5 bg-[hsl(var(--miwarp-status-error)/0.08)]">
      <div
        class="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-[hsl(var(--miwarp-status-error)/0.15)] rounded-[10px] text-miwarp-status-error"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div class="flex-1">
        <p class="text-[14px] font-semibold text-miwarp-status-error mb-1">
          {t("insight_error_title")}
        </p>
        <p class="text-[13px] text-[hsl(var(--miwarp-status-error)/0.8)] m-0 mb-3">
          {error || t("insight_error_default")}
        </p>
        {#if onRegenerate}
          <button
            class="inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-lg border-none cursor-pointer transition-all duration-[120ms] bg-miwarp-bg-base text-miwarp-text-primary border border-miwarp-border hover:bg-miwarp-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onclick={onRegenerate}
          >
            {t("insight_retry")}
          </button>
        {/if}
      </div>
    </div>
  {:else if status === "ready" && report}
    <div class="p-5 bg-miwarp-bg-surface">
      <div class="flex items-start gap-3 mb-4">
        <div
          class="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-miwarp-accent-primary rounded-lg text-miwarp-accent-on-accent"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class="w-[18px] h-[18px]"
          >
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <line x1="10" y1="9" x2="8" y2="9" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="text-[14px] font-semibold text-miwarp-text-primary m-0 mb-[2px]">
            {t("insight_ready_title")}
          </h3>
          <p
            class="text-[12px] text-miwarp-text-tertiary m-0 overflow-hidden text-ellipsis whitespace-nowrap"
          >
            {report.title}
          </p>
        </div>
      </div>

      <div class="p-3 bg-miwarp-bg-base rounded-lg mb-4">
        <p class="text-[13px] text-miwarp-text-secondary leading-relaxed m-0">
          {report.oneSentenceSummary}
        </p>
      </div>

      <div class="flex flex-wrap gap-2">
        {#if onPreview}
          <button
            class="inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-lg border-none cursor-pointer transition-all duration-[120ms] bg-miwarp-bg-base text-miwarp-text-primary border border-miwarp-border hover:bg-miwarp-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onclick={onPreview}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="w-3.5 h-3.5"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {t("insight_preview")}
          </button>
        {/if}
        {#if onCopy}
          <button
            class="inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-lg border-none cursor-pointer transition-all duration-[120ms] bg-miwarp-bg-base text-miwarp-text-primary border border-miwarp-border hover:bg-miwarp-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onclick={onCopy}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="w-3.5 h-3.5"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {t("insight_copy")}
          </button>
        {/if}
        {#if onExport}
          <button
            class="inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-lg border-none cursor-pointer transition-all duration-[120ms] bg-miwarp-accent-primary text-miwarp-accent-on-accent hover:opacity-90 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onclick={onExport}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="w-3.5 h-3.5"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {t("insight_export")}
          </button>
        {/if}
        {#if onRegenerate}
          <button
            class="inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-lg border-none cursor-pointer transition-all duration-[120ms] bg-transparent text-miwarp-text-secondary hover:bg-miwarp-bg-base hover:text-miwarp-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onclick={onRegenerate}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="w-3.5 h-3.5"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            {t("insight_regenerate")}
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>
