<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { formatTokenCount } from "$lib/utils/format";
  import type { TurnUsage } from "$lib/stores/types";

  interface Props {
    usage: TurnUsage;
  }

  let { usage }: Props = $props();
</script>

<div class="w-full py-1.5">
  <div class="chat-content-width">
    <div class="flex items-center gap-3">
      <div class="h-px flex-1 bg-border/40"></div>
      <span class="text-[10px] tabular-nums text-muted-foreground">
        {formatTokenCount(usage.inputTokens)}
        {t("chat_usageIn")} · {formatTokenCount(usage.outputTokens)}
        {t("chat_usageOut")}
        {#if usage.cacheReadTokens > 0 || usage.cacheWriteTokens > 0}
          · {t("chat_usageCache", {
            read: formatTokenCount(usage.cacheReadTokens),
            write: formatTokenCount(usage.cacheWriteTokens),
          })}
        {/if}
      </span>
      <div class="h-px flex-1 bg-border/40"></div>
    </div>
  </div>
</div>
