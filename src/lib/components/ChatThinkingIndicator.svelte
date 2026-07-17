<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import AgentIdentity from "$lib/components/AgentIdentity.svelte";
  import { formatElapsed } from "$lib/chat/utils/format";

  interface Props {
    elapsed: number;
    activeToolName: string | null;
    thinkingDurationSec: number | null;
    approving: boolean;
    sending: boolean;
    spinnerVerb: string;
    agent: string;
    platformId?: string;
    model: string;
  }

  let {
    elapsed,
    activeToolName,
    thinkingDurationSec,
    approving,
    sending,
    spinnerVerb,
    agent,
    platformId,
    model,
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
    </div>
  </div>
</div>
