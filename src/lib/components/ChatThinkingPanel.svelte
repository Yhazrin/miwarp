<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";

  interface Props {
    thinkingText: string;
    expanded: boolean;
    onToggleExpand: () => void;
  }

  let { thinkingText, expanded, onToggleExpand }: Props = $props();
</script>

{#if expanded}
  <div class="w-full animate-fade-in">
    <div class="chat-content-width py-1">
      <div
        class="max-h-28 overflow-hidden rounded-lg border border-[hsl(var(--miwarp-glass-border)/0.5)] bg-[hsl(var(--miwarp-bg-deep)/0.6)]"
      >
        <div class="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] text-muted-foreground">
          <svg
            class="h-2.5 w-2.5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.4V19a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1.6c2.9-1.1 5-4 5-7.4a8 8 0 0 0-8-8z"
            />
            <path d="M10 22h4" />
          </svg>
          <span class="font-medium">{t("chat_thinking")}</span>
          <button
            class="ml-auto opacity-50 hover:opacity-100 transition-opacity"
            onclick={onToggleExpand}
          >
            <svg
              class="h-2.5 w-2.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m18 15-6-6-6 6" />
            </svg>
          </button>
        </div>
        <div
          class="border-t border-[hsl(var(--miwarp-glass-border)/0.3)] px-2.5 py-2 overflow-y-auto overscroll-y-contain max-h-[calc(7rem-2.25rem)]"
        >
          <pre
            class="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground/70">{thinkingText.trimEnd()}</pre>
        </div>
      </div>
    </div>
  </div>
{:else}
  <div class="w-full animate-fade-in">
    <div class="chat-content-width py-1">
      <button
        class="inline-flex items-center gap-1.5 rounded-full px-2 py-px text-[10px] text-muted-foreground hover:bg-muted/50 transition-all"
        onclick={onToggleExpand}
      >
        <svg
          class="h-2.5 w-2.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.4V19a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1.6c2.9-1.1 5-4 5-7.4a8 8 0 0 0-8-8z"
          />
          <path d="M10 22h4" />
        </svg>
        <span class="thinking-shimmer">{t("chat_thinking")}</span>
      </button>
    </div>
  </div>
{/if}
