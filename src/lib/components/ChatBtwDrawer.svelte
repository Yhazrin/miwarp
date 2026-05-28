<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import MarkdownContent from "./MarkdownContent.svelte";
  import Icon from "$lib/components/Icon.svelte";

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
    <span class="text-xs font-medium text-miwarp-status-info">{t("chat_btw")}</span>
    <button type="button"
      onclick={onClose}
      title={t("chat_closeSideQuestion")}
      aria-label={t("chat_closeSideQuestion")}
      class="text-muted-foreground hover:text-foreground transition-colors"
    >
      <Icon name="x" size="sm" />
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
        <span class="inline-block w-2 h-4 bg-miwarp-status-info animate-pulse rounded-sm"></span>
      {/if}
    </div>
  </div>
</div>
