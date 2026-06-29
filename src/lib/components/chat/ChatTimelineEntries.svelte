<script lang="ts">
  import type { TimelineEntry, UserSettings, BusToolItem } from "$lib/types";
  import type { ProcessVisibility } from "$lib/utils/process-visibility";
  import type { ToolBurst } from "$lib/utils/tool-rendering";
  import type { SessionStore } from "$lib/stores/session-store.svelte";
  import type { BurstCollapseHandle } from "$lib/chat/use-tool-burst-collapse.svelte";
  import type { TurnUsage } from "$lib/stores/types";
  import BatchProgressBar from "$lib/components/BatchProgressBar.svelte";
  import ToolBurstHeader from "$lib/components/ToolBurstHeader.svelte";
  import GuidedToolTimelineRow from "$lib/components/GuidedToolTimelineRow.svelte";
  import ChatUsageAnnotation from "$lib/components/ChatUsageAnnotation.svelte";
  import MarkdownContent from "$lib/components/MarkdownContent.svelte";
  import ChatRenderBoundary from "$lib/components/chat/ChatRenderBoundary.svelte";
  import ConversationTimeline from "$lib/components/chat/ConversationTimeline.svelte";
  import { TAIL_LIVE_ENTRIES } from "$lib/chat/selectors/timeline-presentation";
  import {
    shouldMountFullToolCardInOutputMode,
    shouldMountFullToolCardInGuidedMode,
    shouldShowContextDetails,
  } from "$lib/utils/process-visibility";
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

  function reloadFromEventLog() {
    return store.recoverFromEventLog();
  }

  /** Historical rows are static — skip live tail effects and eager markdown.
   *  perf(F16): precompute once per render as a parallel boolean[]; previous
   *  implementation called `isFrozenEntry(i)` 5× per entry inside {#each},
   *  which for 200 visible entries meant 1000 function calls per render.
   *  Indexing into a flat $derived array removes the per-iteration overhead. */
  const frozenMap = $derived.by<boolean[]>(() => {
    const liveThreshold = visibleTimeline.length - TAIL_LIVE_ENTRIES;
    const out: boolean[] = new Array(visibleTimeline.length);
    for (let i = 0; i < visibleTimeline.length; i++) {
      out[i] = i < liveThreshold;
    }
    return out;
  });

  /**
   * Tool-result cache handle shape that satisfies ConversationTimeline.
   * Only `fetchToolResult` is read by the renderer; the chat page owns
   * the cache lifecycle via its existing `createToolResultCache` instance.
   */
  const toolResultCache = $derived({ fetchToolResult });
</script>

{#each visibleTimeline as entry, i (entry.id)}
  {#if !(burstCollapse.collapsedIndices.has(i) && !toolBursts.has(i))}
    <div
      id="msg-{entry.anchorId}"
      data-entry-id={entry.id}
      class:timeline-entry-frozen={frozenMap[i]}
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
            <ConversationTimeline
              {entry}
              agent={store.agent}
              model={store.run?.model ?? store.model}
              platformId={store.platformId ?? undefined}
              animated={false}
              debugRunId={store.run?.id}
              debugSessionId={store.run?.session_id ?? undefined}
              lastToolId=""
              {processVisibility}
              {permissionCoordinator}
              permissionMode={store.permissionMode}
              {toolResultCache}
              onApprove={handleToolApprove}
              onPermissionRespond={handlePermissionRespond}
              onExitPlanClearContext={() => handleExitPlanClearContext("")}
              onExitPlanBypass={handleExitPlanBypass}
              onToolAnswer={handleToolAnswer}
              getPlanContentForExitPlan={(id) => getPlanContentForExitPlan(id)}
              taskNotifications={store.taskNotifications}
              showPermissionInPanel={showPermissionPanel}
              onPreviewFile={openPreviewForPath}
              frozen={frozenMap[i]}
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
            <ConversationTimeline
              {entry}
              agent={store.agent}
              model={store.run?.model ?? store.model}
              platformId={store.platformId ?? undefined}
              animated={!frozenMap[i] && i === lastAssistantIdx && store.isRunning}
              debugRunId={store.run?.id}
              debugSessionId={store.run?.session_id ?? undefined}
              lastToolId=""
              {processVisibility}
              {permissionCoordinator}
              permissionMode={store.permissionMode}
              {toolResultCache}
              onApprove={handleToolApprove}
              onPermissionRespond={handlePermissionRespond}
              onExitPlanClearContext={() => handleExitPlanClearContext("")}
              onExitPlanBypass={handleExitPlanBypass}
              onToolAnswer={handleToolAnswer}
              getPlanContentForExitPlan={(id) => getPlanContentForExitPlan(id)}
              taskNotifications={store.taskNotifications}
              showPermissionInPanel={showPermissionPanel}
              onPreviewFile={openPreviewForPath}
              frozen={frozenMap[i]}
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
              <ConversationTimeline
                {entry}
                agent={store.agent}
                model={store.run?.model ?? store.model}
                platformId={store.platformId ?? undefined}
                animated={false}
                debugRunId={store.run?.id}
                debugSessionId={store.run?.session_id ?? undefined}
                lastToolId={latestPlanToolId ?? ""}
                {processVisibility}
                {permissionCoordinator}
                permissionMode={store.permissionMode}
                {toolResultCache}
                onApprove={handleToolApprove}
                onPermissionRespond={handlePermissionRespond}
                onExitPlanClearContext={() => handleExitPlanClearContext(entry.tool.tool_use_id)}
                onExitPlanBypass={handleExitPlanBypass}
                onToolAnswer={handleToolAnswer}
                getPlanContentForExitPlan={(id) => getPlanContentForExitPlan(id)}
                taskNotifications={store.taskNotifications}
                showPermissionInPanel={showPermissionPanel}
                onPreviewFile={openPreviewForPath}
              />
            </div>
          {/if}
        {/if}
      {:else if entry.kind === "command_output" || entry.kind === "separator"}
        <ConversationTimeline
          {entry}
          agent={store.agent}
          model={store.run?.model ?? store.model}
          platformId={store.platformId ?? undefined}
          animated={false}
          debugRunId={store.run?.id}
          debugSessionId={store.run?.session_id ?? undefined}
          lastToolId=""
          {processVisibility}
          {permissionCoordinator}
          permissionMode={store.permissionMode}
          {toolResultCache}
          onApprove={handleToolApprove}
          onPermissionRespond={handlePermissionRespond}
          onExitPlanClearContext={() => handleExitPlanClearContext("")}
          onExitPlanBypass={handleExitPlanBypass}
          onToolAnswer={handleToolAnswer}
          getPlanContentForExitPlan={(id) => getPlanContentForExitPlan(id)}
          taskNotifications={store.taskNotifications}
          showPermissionInPanel={showPermissionPanel}
          onPreviewFile={openPreviewForPath}
        >
          {#snippet commandOutputMarkdown(text)}
            <ChatRenderBoundary
              runId={store.run?.id ?? null}
              entryId={entry.id}
              componentName="MarkdownContent"
              onReload={reloadFromEventLog}
            >
              <MarkdownContent {text} lazy={frozenMap[i]} />
            </ChatRenderBoundary>
          {/snippet}
        </ConversationTimeline>
      {/if}
    </div>
  {/if}
{/each}
