<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import MarkdownContent from "./MarkdownContent.svelte";

  interface Props {
    question: string;
    answer: string;
    error: string | null;
    loading: boolean;
    onClose: () => void;
  }

  let { question, answer, error, loading, onClose }: Props = $props();
</script>

<div
  class="pointer-events-auto border-t border-[hsl(var(--miwarp-status-info)/0.3)] bg-[hsl(var(--miwarp-status-info)/0.05)]"
  style="max-height: 40vh; overflow-y: auto;"
>
  <div class="flex items-center justify-between px-4 py-2 border-b border-border/50">
    <span class="text-xs font-medium text-[hsl(var(--miwarp-status-info))]">{t("chat_btw")}</span>
    <button
      onclick={onClose}
      title="Close side question"
      class="text-muted-foreground hover:text-foreground transition-colors"
    >
      <svg
        class="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M18 6 6 18" /><path d="m6 6 12 12" />
      </svg>
    </button>
  </div>
  <div class="px-4 py-3 space-y-2">
    <p class="text-xs text-muted-foreground">Q: {question}</p>
    <div class="text-sm">
      {#if error}
        <p class="text-destructive">{error}</p>
      {:else if answer}
        <MarkdownContent text={answer} streaming={loading} />
      {/if}
      {#if loading}
        <span class="inline-block w-2 h-4 bg-[hsl(var(--miwarp-status-info))] animate-pulse rounded-sm"></span>
      {/if}
    </div>
  </div>
</div>
