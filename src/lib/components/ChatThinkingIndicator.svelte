<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { formatElapsed } from "$lib/chat/utils/format";

  interface Props {
    elapsed: number;
    activeToolName: string | null;
    thinkingDurationSec: number | null;
    approving: boolean;
    sending: boolean;
    spinnerVerb: string;
  }

  let { elapsed, activeToolName, thinkingDurationSec, approving, sending, spinnerVerb }: Props =
    $props();
</script>

<div class="w-full animate-fade-in" data-export-exclude>
  <div class="chat-content-width py-4">
    <div class="mb-1.5 flex items-center gap-2">
      <div
        class="flex h-5 w-5 items-center justify-center rounded-sm bg-orange-500/10 text-orange-500"
      >
        <svg
          class="h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z"
          />
        </svg>
      </div>
      <span class="text-sm font-semibold text-foreground">{t("chat_claude")}</span>
      {#if elapsed > 0}
        <span class="ml-auto text-[10px] tabular-nums text-muted-foreground"
          >{formatElapsed(elapsed)}</span
        >
      {/if}
    </div>
    <div class="pl-7">
      {#if activeToolName}
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <div
            class="h-3.5 w-3.5 rounded-full border-2 border-border border-t-muted-foreground animate-spin"
          ></div>
          <span
            >{t("chat_usingTool")}
            <span class="text-foreground font-medium">{activeToolName}</span></span
          >
          {#if thinkingDurationSec && thinkingDurationSec > 0}
            <span class="text-xs tabular-nums">· thought for {thinkingDurationSec}s</span>
          {/if}
        </div>
      {:else if approving}
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <div
            class="h-3.5 w-3.5 rounded-full border-2 border-border border-t-muted-foreground animate-spin"
          ></div>
          <span>{t("chat_restartingApproved")}</span>
        </div>
      {:else if sending}
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <div
            class="h-3.5 w-3.5 rounded-full border-2 border-border border-t-muted-foreground animate-spin"
          ></div>
          <span>{t("chat_startingSession")}</span>
        </div>
      {:else}
        <div class="flex items-center gap-2 text-sm">
          <span class="spinner-star">✦</span>
          <span class="spinner-shimmer">{spinnerVerb}…</span>
          {#if thinkingDurationSec && thinkingDurationSec > 0}
            <span class="text-muted-foreground text-xs tabular-nums"
              >· thought for {thinkingDurationSec}s</span
            >
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
