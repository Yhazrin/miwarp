<script lang="ts">
  import type { TimelineEntry, UserSettings, BusToolItem } from "$lib/types";
  import type { ProcessVisibility } from "$lib/utils/process-visibility";
  import type { ToolBurst } from "$lib/utils/tool-rendering";
  import type { SessionStore } from "$lib/stores/session-store.svelte";
  import type { BurstCollapseHandle } from "$lib/chat/use-tool-burst-collapse.svelte";
  import type { TurnUsage } from "$lib/stores/types";
  import ChatMessage from "$lib/components/ChatMessage.svelte";
  import InlineToolCard from "$lib/components/InlineToolCard.svelte";
  import BatchProgressBar from "$lib/components/BatchProgressBar.svelte";
  import ToolBurstHeader from "$lib/components/ToolBurstHeader.svelte";
  import GuidedToolTimelineRow from "$lib/components/GuidedToolTimelineRow.svelte";
  import ChatUsageAnnotation from "$lib/components/ChatUsageAnnotation.svelte";
  import ContextUsageGrid from "$lib/components/ContextUsageGrid.svelte";
  import CostSummaryView from "$lib/components/CostSummaryView.svelte";
  import ReleaseNotesCard from "$lib/components/ReleaseNotesCard.svelte";
  import MarkdownContent from "$lib/components/MarkdownContent.svelte";
  import { ansiToHtml, hasAnsiCodes } from "$lib/utils/ansi";
  import {
    isTimelineSeparatorContent,
    shouldShowTimelineCommandOutput,
    shouldMountFullToolCardInOutputMode,
    shouldMountFullToolCardInGuidedMode,
    shouldShowContextDetails,
  } from "$lib/utils/process-visibility";
  import { t as tFn } from "$lib/i18n/index.svelte";

  let {
    visibleTimeline,
    store,
    burstCollapse,
    toolBursts,
    lastClearSepId,
    timelineIdIndex,
    batchGroups,
    processVisibility,
    usageAnnotations,
    settings,
    lastAssistantIdx,
    claudeTurnStarts,
    latestPlanToolId,
    showPermissionPanel,
    fetchToolResult,
    handleRewindToMessage,
    handleToolAnswer,
    handleToolApprove,
    handlePermissionRespond,
    handleExitPlanClearContext,
    handleExitPlanBypass,
    getPlanContentForExitPlan,
    openPreviewForPath,
    toggleBurst,
  }: {
    visibleTimeline: TimelineEntry[];
    store: SessionStore;
    burstCollapse: BurstCollapseHandle;
    toolBursts: Map<number, ToolBurst>;
    lastClearSepId: string | null;
    timelineIdIndex: Map<string, number>;
    batchGroups: Map<number, BusToolItem[]>;
    processVisibility: ProcessVisibility;
    usageAnnotations: Map<number, TurnUsage>;
    settings: UserSettings | null;
    lastAssistantIdx: number;
    claudeTurnStarts: Set<number>;
    latestPlanToolId: string | null;
    showPermissionPanel: boolean;
    fetchToolResult: (runId: string, toolUseId: string) => Promise<Record<string, unknown> | null>;
    handleRewindToMessage: (entry: { cliUuid: string; content: string; ts: string }) => void;
    handleToolAnswer: (toolUseId: string, answer: string) => void;
    handleToolApprove: (toolUseId: string) => void;
    handlePermissionRespond: (
      requestId: string,
      behavior: "allow" | "deny",
      updatedPermissions?: import("$lib/types").PermissionSuggestion[],
      updatedInput?: Record<string, unknown>,
      denyMessage?: string,
      interrupt?: boolean,
    ) => Promise<void>;
    handleExitPlanClearContext: (toolUseId: string) => void;
    handleExitPlanBypass: () => void;
    getPlanContentForExitPlan: (entryId: string) => { content: string; fileName: string } | null;
    openPreviewForPath: (path: string) => void;
    toggleBurst: (key: string) => void;
  } = $props();

  const t = tFn;
</script>

{#each visibleTimeline as entry, i (entry.id)}
  {#if !(burstCollapse.collapsedIndices.has(i) && !toolBursts.has(i))}
    <div
      id="msg-{entry.anchorId}"
      data-entry-id={entry.id}
      class:cv-auto={true}
      class="group/msg"
      class:opacity-40={lastClearSepId !== null &&
        (timelineIdIndex.get(entry.id) ?? 0) < (timelineIdIndex.get(lastClearSepId) ?? 0)}
    >
      {#if batchGroups.has(i) && processVisibility !== "output"}
        {@const batch = batchGroups.get(i)}
        {#if batch}
          <div class="w-full py-1">
            <div class="chat-content-width pl-7">
              <BatchProgressBar tools={batch} />
            </div>
          </div>
        {/if}
      {/if}
      {#if toolBursts.has(i) && processVisibility !== "output"}
        {@const burst = toolBursts.get(i)}
        {#if burst}
          <div class="w-full py-1">
            <div class="chat-content-width pl-7">
              <ToolBurstHeader
                {burst}
                collapsed={burstCollapse.effectiveCollapsed.has(burst.key)}
                onToggle={() => toggleBurst(burst.key)}
              />
            </div>
          </div>
        {/if}
      {/if}
      {#if usageAnnotations.has(i)}
        {@const tu = usageAnnotations.get(i)}
        {#if tu && settings?.show_token_usage_report !== false && shouldShowContextDetails(processVisibility)}
          <ChatUsageAnnotation usage={tu} />
        {/if}
      {/if}
      {#if entry.kind === "user"}
        <ChatMessage
          message={{
            id: entry.id,
            role: "user",
            content: entry.content,
            timestamp: entry.ts,
          }}
          attachments={entry.attachments}
          onRewind={entry.cliUuid && store.sessionAlive && !store.isRunning
            ? () =>
                handleRewindToMessage({
                  cliUuid: entry.cliUuid!,
                  content: entry.content,
                  ts: entry.ts,
                })
            : undefined}
        />
      {:else if entry.kind === "assistant"}
        <ChatMessage
          message={{
            id: entry.id,
            role: "assistant",
            content: entry.content,
            timestamp: entry.ts,
          }}
          thinkingText={entry.thinkingText}
          agent={store.agent}
          platformId={store.platformId ?? undefined}
          model={store.run?.model ?? store.model}
          animated={i === lastAssistantIdx && store.isRunning}
          {processVisibility}
          debugRunId={store.run?.id}
          debugSessionId={store.run?.session_id ?? undefined}
        />
      {:else if entry.kind === "tool"}
        {#if claudeTurnStarts.has(i)}
          <div class="pt-3"></div>
        {/if}
        {#if !burstCollapse.collapsedIndices.has(i)}
          {#if processVisibility === "output" && !shouldMountFullToolCardInOutputMode(entry.tool)}
            <div
              id="tool-{entry.tool.tool_use_id}"
              class="pointer-events-none h-0 w-full scroll-mt-24 overflow-hidden"
              aria-hidden="true"
            ></div>
          {:else if processVisibility === "guided" && !shouldMountFullToolCardInGuidedMode(entry.tool)}
            <div class="w-full py-1" id="tool-{entry.tool.tool_use_id}">
              <div class="chat-content-width">
                <GuidedToolTimelineRow tool={entry.tool} />
              </div>
            </div>
          {:else}
            <div
              class="w-full py-1"
              id="tool-{entry.tool.tool_use_id}"
              class:collapsing-burst-tool={burstCollapse.collapsingIndices.has(i)}
            >
              <div class="chat-content-width">
                <InlineToolCard
                  tool={entry.tool}
                  subTimeline={entry.subTimeline}
                  runId={store.run?.id ?? ""}
                  {fetchToolResult}
                  {processVisibility}
                  onAnswer={entry.tool.tool_name === "AskUserQuestion" &&
                  (entry.tool.status === "running" || entry.tool.status === "ask_pending")
                    ? (answer) => handleToolAnswer(entry.tool.tool_use_id, answer)
                    : undefined}
                  onApprove={handleToolApprove}
                  onPermissionRespond={handlePermissionRespond}
                  onExitPlanClearContext={() => handleExitPlanClearContext(entry.tool.tool_use_id)}
                  onExitPlanBypass={handleExitPlanBypass}
                  taskNotifications={store.taskNotifications}
                  planContent={entry.tool.tool_name === "ExitPlanMode" &&
                  (entry.tool.status === "permission_prompt" || entry.tool.status === "success")
                    ? getPlanContentForExitPlan(entry.id)
                    : undefined}
                  latestPlanTool={entry.kind === "tool" &&
                    entry.tool.tool_use_id === latestPlanToolId}
                  showPermissionInPanel={showPermissionPanel}
                  permissionMode={store.permissionMode}
                  onPreviewFile={openPreviewForPath}
                />
              </div>
            </div>
          {/if}
        {/if}
      {:else if entry.kind === "command_output" || entry.kind === "separator"}
        {#if isTimelineSeparatorContent(entry.content)}
          <div class="w-full py-3">
            <div class="chat-content-width">
              <div class="flex items-center gap-3">
                <div class="h-px flex-1 bg-amber-500/20"></div>
                <span class="text-xs text-amber-500/70 font-medium whitespace-nowrap">
                  {t("chat_contextCleared")}
                </span>
                <div class="h-px flex-1 bg-amber-500/20"></div>
              </div>
            </div>
          </div>
        {:else if shouldShowTimelineCommandOutput(processVisibility, entry.content)}
          <div class="w-full py-2">
            <div class="chat-content-width pl-7">
              <div
                class="command-output rounded-lg border border-border/40 bg-[#1a1b26] px-4 py-3 text-sm overflow-x-auto"
              >
                {#if entry.content.includes("## Context Usage")}
                  <ContextUsageGrid text={entry.content} />
                {:else if entry.content.includes("Total cost:") && entry.content.includes("Total duration")}
                  <CostSummaryView text={entry.content} />
                {:else if entry.content
                  .trimStart()
                  .startsWith("Version ") && entry.content.includes("•")}
                  <ReleaseNotesCard text={entry.content} />
                {:else if hasAnsiCodes(entry.content)}
                  <pre
                    class="whitespace-pre font-mono text-xs leading-relaxed text-[#c0caf5] m-0">{@html ansiToHtml(
                      entry.content,
                    )}</pre>
                {:else}
                  <MarkdownContent text={entry.content} />
                {/if}
              </div>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
{/each}
