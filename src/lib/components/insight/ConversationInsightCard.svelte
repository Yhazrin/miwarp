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

<div class="insight-card">
  {#if status === "generating"}
    <div class="insight-generating">
      <div class="generating-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path
            d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
          />
        </svg>
      </div>
      <div class="generating-text">
        <p class="generating-title">{t("insight_generating_title")}</p>
        <p class="generating-desc">{t("insight_generating_desc")}</p>
      </div>
    </div>
  {:else if status === "error"}
    <div class="insight-error">
      <div class="error-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div class="error-content">
        <p class="error-title">{t("insight_error_title")}</p>
        <p class="error-desc">{error || t("insight_error_default")}</p>
        {#if onRegenerate}
          <button class="btn btn-secondary" onclick={onRegenerate}>
            {t("insight_retry")}
          </button>
        {/if}
      </div>
    </div>
  {:else if status === "ready" && report}
    <div class="insight-ready">
      <div class="insight-header">
        <div class="insight-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <line x1="10" y1="9" x2="8" y2="9" />
          </svg>
        </div>
        <div class="insight-title-group">
          <h3 class="insight-title">{t("insight_ready_title")}</h3>
          <p class="insight-subtitle">{report.title}</p>
        </div>
      </div>

      <div class="insight-summary">
        <p>{report.oneSentenceSummary}</p>
      </div>

      <div class="insight-actions">
        {#if onPreview}
          <button class="btn btn-secondary" onclick={onPreview}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="btn-icon"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {t("insight_preview")}
          </button>
        {/if}
        {#if onCopy}
          <button class="btn btn-secondary" onclick={onCopy}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="btn-icon"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {t("insight_copy")}
          </button>
        {/if}
        {#if onExport}
          <button class="btn btn-primary" onclick={onExport}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="btn-icon"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {t("insight_export")}
          </button>
        {/if}
        {#if onRegenerate}
          <button class="btn btn-ghost" onclick={onRegenerate}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="btn-icon"
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

<style>
  .insight-card {
    border: 1px solid hsl(var(--miwarp-border));
    border-radius: 12px;
    overflow: hidden;
  }

  /* Generating state */
  .insight-generating {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 20px;
    background: hsl(var(--miwarp-bg-surface));
  }

  .generating-icon {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: hsl(var(--miwarp-accent-primary) / 0.1);
    border-radius: 10px;
    color: hsl(var(--miwarp-accent-primary));
    animation: spin 2s linear infinite;
  }

  .generating-icon svg {
    width: 20px;
    height: 20px;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .generating-text {
    flex: 1;
  }

  .generating-title {
    font-size: 14px;
    font-weight: 600;
    color: hsl(var(--miwarp-text-primary));
    margin-bottom: 4px;
  }

  .generating-desc {
    font-size: 13px;
    color: hsl(var(--miwarp-text-secondary));
    margin: 0;
  }

  /* Error state */
  .insight-error {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 20px;
    background: hsl(var(--miwarp-status-error) / 0.08);
  }

  .error-icon {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: hsl(var(--miwarp-status-error) / 0.15);
    border-radius: 10px;
    color: hsl(var(--miwarp-status-error));
  }

  .error-icon svg {
    width: 20px;
    height: 20px;
  }

  .error-content {
    flex: 1;
  }

  .error-title {
    font-size: 14px;
    font-weight: 600;
    color: hsl(var(--miwarp-status-error));
    margin-bottom: 4px;
  }

  .error-desc {
    font-size: 13px;
    color: hsl(var(--miwarp-status-error) / 0.8);
    margin: 0 0 12px 0;
  }

  /* Ready state */
  .insight-ready {
    padding: 20px;
    background: hsl(var(--miwarp-bg-surface));
  }

  .insight-header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 16px;
  }

  .insight-icon {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: hsl(var(--miwarp-accent-primary));
    border-radius: 8px;
    color: hsl(var(--miwarp-accent-on-accent));
  }

  .insight-icon svg {
    width: 18px;
    height: 18px;
  }

  .insight-title-group {
    flex: 1;
    min-width: 0;
  }

  .insight-title {
    font-size: 14px;
    font-weight: 600;
    color: hsl(var(--miwarp-text-primary));
    margin: 0 0 2px 0;
  }

  .insight-subtitle {
    font-size: 12px;
    color: hsl(var(--miwarp-text-tertiary));
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .insight-summary {
    padding: 12px;
    background: hsl(var(--miwarp-bg-base));
    border-radius: 8px;
    margin-bottom: 16px;
  }

  .insight-summary p {
    font-size: 13px;
    color: hsl(var(--miwarp-text-secondary));
    line-height: 1.5;
    margin: 0;
  }

  .insight-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  /* Buttons */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 500;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    transition: all 120ms ease;
  }

  .btn-icon {
    width: 14px;
    height: 14px;
  }

  .btn-primary {
    background: hsl(var(--miwarp-accent-primary));
    color: hsl(var(--miwarp-accent-on-accent));
  }

  .btn-primary:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  .btn-secondary {
    background: hsl(var(--miwarp-bg-base));
    color: hsl(var(--miwarp-text-primary));
    border: 1px solid hsl(var(--miwarp-border));
  }

  .btn-secondary:hover {
    background: hsl(var(--miwarp-bg-elevated));
  }

  .btn-ghost {
    background: transparent;
    color: hsl(var(--miwarp-text-secondary));
  }

  .btn-ghost:hover {
    background: hsl(var(--miwarp-bg-base));
    color: hsl(var(--miwarp-text-primary));
  }
</style>
