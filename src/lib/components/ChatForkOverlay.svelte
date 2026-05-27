<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { formatElapsed } from "$lib/chat/utils/format";

  interface Props {
    error: string | null;
    elapsed: number;
    resuming: boolean;
    onCancel: () => void;
    onRetry: () => void;
  }

  let { error, elapsed, resuming, onCancel, onRetry }: Props = $props();
</script>

<div
  class="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-fade-in"
>
  {#if error}
    <div class="flex flex-col items-center gap-4 max-w-sm text-center animate-slide-up">
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <svg
          class="h-6 w-6 text-destructive"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" />
        </svg>
      </div>
      <div>
        <h3 class="text-sm font-semibold text-foreground mb-1">{t("chat_forkFailed")}</h3>
        <p class="text-xs text-muted-foreground">{error}</p>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="rounded-lg border border-border bg-muted px-4 py-2 text-sm text-foreground hover:bg-accent transition-colors"
          onclick={onCancel}>{t("common_cancel")}</button
        >
        <button
          class="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          disabled={resuming}
          onclick={onRetry}>{t("common_retry")}</button
        >
      </div>
    </div>
  {:else}
    <div class="flex flex-col items-center gap-4 max-w-sm text-center animate-slide-up">
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--miwarp-status-info)/0.1)]">
        <svg
          class="h-6 w-6 text-[hsl(var(--miwarp-status-info))] animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>
      <div>
        <h3 class="text-sm font-semibold text-foreground mb-1">
          {t("chat_forkingSession")}
        </h3>
        <p class="text-xs text-muted-foreground">
          {t("chat_forkingDesc")}
        </p>
      </div>
      {#if elapsed > 0}
        <span class="text-xs tabular-nums text-muted-foreground">{formatElapsed(elapsed)}</span>
      {/if}
      <button
        class="rounded-lg border border-border bg-muted px-4 py-2 text-sm text-foreground hover:bg-accent transition-colors"
        onclick={onCancel}>{t("common_cancel")}</button
      >
    </div>
  {/if}
</div>
