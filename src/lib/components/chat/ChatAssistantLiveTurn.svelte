<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { slide } from "svelte/transition";
  import AgentIdentity from "$lib/components/AgentIdentity.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import MarkdownContent from "$lib/components/MarkdownContent.svelte";
  import { formatElapsed } from "$lib/chat/utils/format";

  interface Props {
    agent: string;
    platformId?: string;
    model: string;
    elapsed: number;
    activeToolName: string | null;
    thinkingDurationSec: number | null;
    approving: boolean;
    sending: boolean;
    spinnerVerb: string;
    processingSlashCmd: string | null;
    thinkingText: string;
    thinkingExpanded: boolean;
    onToggleThinkingExpand: () => void;
    streamingText: string;
    showStreaming: boolean;
    showWaiting: boolean;
  }

  let {
    agent,
    platformId,
    model,
    elapsed,
    activeToolName,
    thinkingDurationSec,
    approving,
    sending,
    spinnerVerb,
    processingSlashCmd,
    thinkingText,
    thinkingExpanded,
    onToggleThinkingExpand,
    streamingText,
    showStreaming,
    showWaiting,
  }: Props = $props();
</script>

<div class="w-full" data-export-exclude>
  <div class="w-full pl-[3.75rem] pr-8 py-4">
    <div class="mb-1.5 flex items-center gap-2">
      <AgentIdentity
        {agent}
        {platformId}
        {model}
        size="md"
        animated={true}
        showName={true}
        showModel={false}
      />
      {#if elapsed > 0}
        <span class="ml-auto text-[10px] tabular-nums text-muted-foreground"
          >{formatElapsed(elapsed)}</span
        >
      {/if}
    </div>

    <div class="max-w-64rem min-w-0 text-sm leading-relaxed text-foreground">
      {#if thinkingText}
        {#if thinkingExpanded}
          <div class="mb-2" transition:slide={{ duration: 200 }}>
            <div
              class="max-h-28 overflow-hidden rounded-lg border border-[hsl(var(--miwarp-glass-border)/0.5)] bg-[hsl(var(--miwarp-bg-deep)/0.6)]"
            >
              <div
                class="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] text-muted-foreground"
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
                <span class="font-medium">{t("chat_thinking")}</span>
                <button
                  type="button"
                  class="ml-auto opacity-50 transition-opacity hover:opacity-100"
                  aria-label="Toggle thinking panel"
                  onclick={onToggleThinkingExpand}
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
                class="max-h-[calc(7rem-2.25rem)] overflow-y-auto overscroll-y-contain border-t border-[hsl(var(--miwarp-glass-border)/0.3)] px-2.5 py-2"
              >
                <pre
                  class="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground/70">{thinkingText.trimEnd()}</pre>
              </div>
            </div>
          </div>
        {:else}
          <button
            type="button"
            class="mb-2 inline-flex items-center gap-1.5 rounded-full px-2 py-px text-[10px] text-muted-foreground transition-all hover:bg-muted/50"
            onclick={onToggleThinkingExpand}
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
        {/if}
      {/if}

      {#if showStreaming}
        <div class="prose-chat">
          <MarkdownContent text={streamingText} streaming={true} lazy={false} />
        </div>
      {:else if processingSlashCmd}
        <div class="flex items-center gap-2 text-muted-foreground">
          <Spinner size="sm" class="border-border border-t-muted-foreground" />
          <span>{t("chat_processingCommand", { command: processingSlashCmd })}</span>
        </div>
      {:else if showWaiting}
        {#if activeToolName}
          <div class="flex items-center gap-2 text-muted-foreground">
            <Spinner size="sm" class="border-border border-t-muted-foreground" />
            <span
              >{t("chat_usingTool")}
              <span class="font-medium text-foreground">{activeToolName}</span></span
            >
            {#if thinkingDurationSec && thinkingDurationSec > 0}
              <span class="text-xs tabular-nums">· thought for {thinkingDurationSec}s</span>
            {/if}
          </div>
        {:else if approving}
          <div class="flex items-center gap-2 text-muted-foreground">
            <Spinner size="sm" class="border-border border-t-muted-foreground" />
            <span>{t("chat_restartingApproved")}</span>
          </div>
        {:else if sending}
          <div class="flex items-center gap-2 text-muted-foreground">
            <Spinner size="sm" class="border-border border-t-muted-foreground" />
            <span>{t("chat_startingSession")}</span>
          </div>
        {:else}
          <div class="flex items-center gap-2">
            <span class="spinner-star">✦</span>
            <span class="spinner-shimmer">{spinnerVerb}…</span>
            {#if thinkingDurationSec && thinkingDurationSec > 0}
              <span class="text-xs tabular-nums text-muted-foreground"
                >· thought for {thinkingDurationSec}s</span
              >
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  </div>
</div>
