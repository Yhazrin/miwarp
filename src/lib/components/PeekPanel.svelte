<script lang="ts">
  /**
   * Peek Panel: Space to preview session details without leaving list view.
   *
   * Based on Claude Cowork design patterns:
   * - Press space to preview session in side panel
   * - Shows latest output, current needs, pending actions
   * - Multi-choice shown as number key hints
   * - Tab to fill suggested responses
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { TaskRun } from "$lib/types";

  let {
    session,
    visible = false,
    onClose,
    onSelectSuggestion,
  }: {
    session: TaskRun | null;
    visible?: boolean;
    onClose: () => void;
    onSelectSuggestion?: (suggestion: string) => void;
  } = $props();

  // Extract preview data from session
  const previewData = $derived.by(() => {
    if (!session) return null;

    // Get latest assistant message
    const latestMessage = session.messages?.at(-1);

    // Check for pending user inputs / suggestions
    const suggestions = session.pending_responses || [];

    // Get current status summary
    const statusText = session.status === "running"
      ? t("peek_running")
      : session.status === "idle"
        ? t("peek_idle")
        : session.status;

    return {
      status: statusText,
      lastMessage: latestMessage?.content?.substring(0, 500) || t("peek_noMessages"),
      suggestions,
      model: session.model || "unknown",
      duration: formatDuration(session.duration_ms),
      turnCount: session.turn_count || 0,
      cwd: session.cwd || "",
    };
  });

  function formatDuration(ms?: number): string {
    if (!ms) return "-";
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key >= "1" && e.key <= "9") {
      const index = parseInt(e.key) - 1;
      const suggestion = previewData?.suggestions?.[index];
      if (suggestion && onSelectSuggestion) {
        onSelectSuggestion(suggestion);
        onClose();
      }
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains("peek-backdrop")) {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if visible && previewData}
  <!-- Backdrop -->
  <div
    class="peek-backdrop fixed inset-0 z-40 bg-black/20"
    onclick={handleBackdropClick}
    role="presentation"
  ></div>

  <!-- Panel -->
  <div
    class="peek-panel fixed right-4 top-20 z-50 w-96 max-h-[70vh] overflow-hidden rounded-lg border bg-background shadow-xl"
    role="dialog"
    aria-label={t("peek_title")}
  >
    <!-- Header -->
    <div class="flex items-center justify-between border-b px-4 py-3">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium">{t("peek_title")}</span>
        <kbd class="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Space</kbd>
      </div>
      <button
        class="rounded p-1 hover:bg-muted"
        onclick={onClose}
        aria-label={t("peek_close")}
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Content -->
    <div class="overflow-y-auto p-4">
      <!-- Status -->
      <div class="mb-4">
        <div class="flex items-center gap-2 text-sm">
          <span
            class="h-2 w-2 rounded-full"
            class:animate-pulse={session?.status === "running"}
            style="background-color: hsl(var(--miwarp-status-info))"
          ></span>
          <span class="font-medium">{previewData.status}</span>
          <span class="text-muted-foreground">
            {previewData.model} · {previewData.turnCount} turns · {previewData.duration}
          </span>
        </div>
        {#if previewData.cwd}
          <div class="mt-1 truncate text-xs text-muted-foreground">
            {previewData.cwd}
          </div>
        {/if}
      </div>

      <!-- Latest Output -->
      <div class="mb-4">
        <h4 class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("peek_latestOutput")}
        </h4>
        <div
          class="max-h-48 overflow-y-auto rounded-md bg-muted/50 p-3 text-sm"
        >
          {previewData.lastMessage}
          {#if (previewData.lastMessage?.length ?? 0) >= 500}
            <span class="text-muted-foreground">...</span>
          {/if}
        </div>
      </div>

      <!-- Suggestions / Pending Actions -->
      {#if previewData.suggestions && previewData.suggestions.length > 0}
        <div>
          <h4 class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("peek_suggestions")}
          </h4>
          <div class="space-y-1">
            {#each previewData.suggestions as suggestion, i}
              {#if i < 9}
                <button
                  class="flex w-full items-start gap-2 rounded-md p-2 text-left text-sm transition-colors hover:bg-muted"
                  onclick={() => onSelectSuggestion?.(suggestion)}
                >
                  <kbd
                    class="mt-0.5 shrink-0 rounded bg-muted-foreground/20 px-1.5 py-0.5 text-xs font-medium"
                  >
                    {i + 1}
                  </kbd>
                  <span class="flex-1 truncate">{suggestion}</span>
                </button>
              {/if}
            {/each}
          </div>
          <p class="mt-2 text-xs text-muted-foreground">
            {t("peek_tabHint")}
          </p>
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
      <span>{t("peek_escClose")}</span>
      <span>{t("peek_enterSelect")}</span>
    </div>
  </div>
{/if}

<style>
  .peek-panel {
    animation: slideIn 0.15s ease-out;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(8px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
</style>