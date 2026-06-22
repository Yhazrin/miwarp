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
  import ChatRenderBoundary from "$lib/components/chat/ChatRenderBoundary.svelte";
  import { TAIL_LIVE_ENTRIES } from "$lib/chat/selectors/timeline-presentation";
  import { ansiToHtml, hasAnsiCodes } from "$lib/utils/ansi";
  import {
    isTimelineSeparatorContent,
    shouldShowTimelineCommandOutput,
    shouldMountFullToolCardInOutputMode,
    shouldMountFullToolCardInGuidedMode,
    shouldShowContextDetails,
  } from "$lib/utils/process-visibility";
  import { t as tFn } from "$lib/i18n/index.svelte";
  import { IS_WEBKIT } from "$lib/utils/platform";

  let {
    /** v1.0.6 / 3.1: enabled by default — browser skips off-screen rendering.
     *  WebKit excluded due to scroll jitter with placeholder heights. */
    contentVisibilityEnabled = true,
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
    permissionCoordinator,
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
    permissionCoordinator?: import("$lib/chat/permission-coordinator").PermissionCoordinator;
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
    contentVisibilityEnabled?: boolean;
  } = $props();

  const useCvAuto = $derived(contentVisibilityEnabled && !IS_WEBKIT);

  const t = tFn;

  function reloadFromEventLog() {
    return store.recoverFromEventLog();
  }

  /** Historical rows are static — skip live tail effects and eager markdown. */
  function isFrozenEntry(index: number): boolean {
    return index < visibleTimeline.length - TAIL_LIVE_ENTRIES;
  }
</script>

{#each visibleTimeline as entry, i (entry.id)}
  {#if !(burstCollapse.collapsedIndices.has(i) && !toolBursts.has(i))}
    <div
      id="msg-{entry.anchorId}"
      data-entry-id={entry.id}
      class:timeline-entry-frozen={isFrozenEntry(i)}
      class:cv-auto={useCvAuto}
      class="group/msg"
      style={useCvAuto ? "contain-intrinsic-block-size: 80px" : undefined}
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
        <div class="w-full">
          <ChatRenderBoundary
            runId={store.run?.id ?? null}
            entryId={entry.id}
            componentName="ChatMessage"
            onReload={reloadFromEventLog}
          >
            <ChatMessage
              message={{
                id: entry.id,
                role: "user",
                content: entry.content,
                timestamp: entry.ts,
              }}
              attachments={entry.attachments}
              frozen={isFrozenEntry(i)}
              onRewind={entry.cliUuid && store.sessionAlive && !store.isRunning
                ? () =>
                    handleRewindToMessage({
                      cliUuid: entry.cliUuid!,
                      content: entry.content,
                      ts: entry.ts,
                    })
                : undefined}
            />
          </ChatRenderBoundary>
        </div>
      {:else if entry.kind === "assistant"}
        <div class="w-full">
          <ChatRenderBoundary
            runId={store.run?.id ?? null}
            entryId={entry.id}
            componentName="ChatMessage"
            onReload={reloadFromEventLog}
          >
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
              animated={!isFrozenEntry(i) && i === lastAssistantIdx && store.isRunning}
              frozen={isFrozenEntry(i)}
              {processVisibility}
              debugRunId={store.run?.id}
              debugSessionId={store.run?.session_id ?? undefined}
            />
          </ChatRenderBoundary>
        </div>
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
                  {permissionCoordinator}
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
                <div class="h-px flex-1 bg-[hsl(var(--miwarp-status-warning)/0.2)]"></div>
                <span
                  class="text-xs text-[hsl(var(--miwarp-status-warning)/0.7)] font-medium whitespace-nowrap"
                >
                  {t("chat_contextCleared")}
                </span>
                <div class="h-px flex-1 bg-[hsl(var(--miwarp-status-warning)/0.2)]"></div>
              </div>
            </div>
          </div>
        {:else if shouldShowTimelineCommandOutput(processVisibility, entry.content)}
          <div class="w-full py-2">
            <div class="chat-content-width pl-7">
              <div
                class="command-output rounded-lg border border-border/40 bg-miwarp-bg-deepest px-4 py-3 text-sm overflow-x-auto"
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
                    class="whitespace-pre font-mono text-xs leading-relaxed text-miwarp-text-primary m-0">{@html ansiToHtml(
                      entry.content,
                    )}</pre>
                {:else}
                  <ChatRenderBoundary
                    runId={store.run?.id ?? null}
                    entryId={entry.id}
                    componentName="MarkdownContent"
                    onReload={reloadFromEventLog}
                  >
                    <MarkdownContent text={entry.content} lazy={isFrozenEntry(i)} />
                  </ChatRenderBoundary>
                {/if}
              </div>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
{/each}
