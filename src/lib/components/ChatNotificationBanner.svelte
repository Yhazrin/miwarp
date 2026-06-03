<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";

  interface Props {
    taskId: string;
    status: string;
    onDismiss?: () => void;
  }

  let { taskId, status, onDismiss }: Props = $props();

  let statusLabel = $derived.by(() => {
    switch (status.toLowerCase()) {
      case "running":
        return t("taskNotification_status_running");
      case "pending":
        return t("taskNotification_status_pending");
      case "stopped":
        return t("taskNotification_status_stopped");
      case "completed":
      case "done":
        return t("taskNotification_status_completed");
      case "failed":
      case "error":
        return t("taskNotification_status_failed");
      default:
        return status;
    }
  });
</script>

<div class="chat-content-width py-1" data-export-exclude>
  <div
    class="flex items-center gap-2 rounded border border-[hsl(var(--miwarp-status-info)/0.2)] bg-[hsl(var(--miwarp-status-info)/0.05)] px-3 py-1.5 text-xs text-muted-foreground animate-fade-in"
    role="status"
  >
    <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-miwarp-status-info"></span>
    <span class="min-w-0 flex-1 truncate"
      >{t("taskNotification_banner", { taskId, status: statusLabel })}</span
    >
    {#if onDismiss}
      <button
        type="button"
        class="shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground"
        aria-label={t("common_close")}
        onclick={onDismiss}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M1 1l10 10M11 1L1 11"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
      </button>
    {/if}
  </div>
</div>
