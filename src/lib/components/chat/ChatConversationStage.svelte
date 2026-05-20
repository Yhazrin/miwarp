<script lang="ts">
  import type { SessionStore } from "$lib/stores/session-store.svelte";
  import type { UserSettings, TimelineEntry, TeamRun, AuthOverview, BusToolItem } from "$lib/types";
  import type { ProcessVisibility } from "$lib/utils/process-visibility";
  import type { ToolBurst } from "$lib/utils/tool-rendering";
  import type { BurstCollapseHandle } from "$lib/chat/use-tool-burst-collapse.svelte";
  import type { TurnUsage } from "$lib/stores/types";
  import type { RewindMarker } from "$lib/utils/rewind";
  import type { TaskRun } from "$lib/types";
  import type XTerminal from "$lib/components/XTerminal.svelte";
  import ChatWelcomeScreen from "$lib/components/ChatWelcomeScreen.svelte";
  import ChatForkedBanner from "$lib/components/ChatForkedBanner.svelte";
  import ChatNotificationBanner from "$lib/components/ChatNotificationBanner.svelte";
  import ChatToolFilterBar from "$lib/components/ChatToolFilterBar.svelte";
  import ViewModeToggle from "$lib/components/ViewModeToggle.svelte";
  import ChatTimelineEntries from "$lib/components/chat/ChatTimelineEntries.svelte";
  import ChatOutputWorkingHint from "$lib/components/ChatOutputWorkingHint.svelte";
  import ChatRewindMarkers from "$lib/components/ChatRewindMarkers.svelte";
  import ChatUsageAnnotation from "$lib/components/ChatUsageAnnotation.svelte";
  import TeamRunCard from "$lib/components/TeamRunCard.svelte";
  import HookReviewCard from "$lib/components/HookReviewCard.svelte";
  import ChatThinkingPanel from "$lib/components/ChatThinkingPanel.svelte";
  import ChatStreamingText from "$lib/components/ChatStreamingText.svelte";
  import ChatThinkingIndicator from "$lib/components/ChatThinkingIndicator.svelte";
  import ChatForkOverlay from "$lib/components/ChatForkOverlay.svelte";
  import ChatErrorCard from "$lib/components/ChatErrorCard.svelte";
  import ChatInitHint from "$lib/components/ChatInitHint.svelte";
  import ChatHeroMeta from "$lib/components/ChatHeroMeta.svelte";
  import XTerminalComponent from "$lib/components/XTerminal.svelte";
  import MarkdownContent from "$lib/components/MarkdownContent.svelte";
  import { timelineHasHiddenRoutineWorkRunning } from "$lib/utils/process-visibility";
  import { APP_LOGO_URL } from "$lib/utils/brand-assets";
  import { t as tFn } from "$lib/i18n/index.svelte";

  const t = tFn;

  let {
    store,
    settings,
    processVisibility,
    // Timeline state
    visibleTimeline,
    filteredTimeline,
    toolNamesInTimeline,
    toolFilter,
    setToolFilter,
    renderLimit,
    timelineIdIndex,
    lastClearSepId,
    latestPlanToolId,
    batchGroups,
    toolBursts,
    burstCollapse,
    lastAssistantIdx,
    usageAnnotations,
    lastTurnUsage,
    claudeTurnStarts,
    showPermissionPanel,
    fetchToolResult,
    topSentinelRef,
    setTopSentinel,
    // Welcome state
    welcomeVisible,
    lastContinuableRun,
    authOverview,
    localProxyStatuses,
    showInitHint,
    cliVersionInfo,
    channelLatest,
    remoteHosts,
    // Loading state
    routeRunLoadFailed,
    routeRunPending,
    runId,
    // Timeline items
    notificationVisible,
    latestNotification,
    rewindMarkers,
    activeTeamRuns,
    // Thinking/streaming
    thinkingExpanded = $bindable(false),
    thinkingElapsed,
    thinkingVisible,
    spinnerVerb,
    processingSlashCmd,
    approving,
    sending,
    // Fork overlay
    forkOverlay,
    forkElapsed,
    resuming,
    // Handlers
    goto,
    sendMessage,
    fillPrompt,
    handleAuthModeChange,
    handlePlatformChange,
    handleRewindToMessage,
    handleToolAnswer,
    handleToolApprove,
    handlePermissionRespond,
    handleExitPlanClearContext,
    getPlanContentForExitPlan,
    openPreviewForPath,
    handleHookCallbackRespond,
    handleChatScroll,
    scrollChatToBottom,
    handleTermResize,
    handleTermReady,
    handleForkCancel,
    handleForkRetry,
    dismissInitHint,
    loadRunProgressive,
    setLastTarget,
    // Team dispatch
    teamDispatchPrompt = $bindable(""),
    teamDispatchOpen = $bindable(false),
    // Refs
    xtermRef = $bindable<XTerminal | undefined>(),
    chatAreaRef = $bindable<HTMLDivElement | undefined>(),
    // Local UI state
    showChatScrollHint,
    // Snippets
    heroMetaFooter,
    inputDock,
  }: {
    store: SessionStore;
    settings: UserSettings | null;
    processVisibility: ProcessVisibility;
    visibleTimeline: TimelineEntry[];
    filteredTimeline: TimelineEntry[];
    toolNamesInTimeline: string[];
    toolFilter: string | null;
    setToolFilter: (v: string | null) => void;
    renderLimit: number;
    timelineIdIndex: Map<string, number>;
    lastClearSepId: string | null;
    latestPlanToolId: string | null;
    batchGroups: Map<number, BusToolItem[]>;
    toolBursts: Map<number, ToolBurst>;
    burstCollapse: BurstCollapseHandle;
    lastAssistantIdx: number;
    usageAnnotations: Map<number, TurnUsage>;
    lastTurnUsage: TurnUsage | null;
    claudeTurnStarts: Set<number>;
    showPermissionPanel: boolean;
    fetchToolResult: (runId: string, toolUseId: string) => Promise<Record<string, unknown> | null>;
    topSentinelRef: HTMLDivElement | null;
    setTopSentinel: (el: HTMLDivElement | null) => void;
    welcomeVisible: boolean;
    lastContinuableRun: TaskRun | null;
    authOverview: AuthOverview | null;
    localProxyStatuses: Record<string, { running: boolean; needsAuth: boolean }>;
    showInitHint: boolean;
    cliVersionInfo: import("$lib/stores").CliVersionInfo | null;
    channelLatest: string | undefined;
    remoteHosts: import("$lib/types").RemoteHost[];
    routeRunLoadFailed: boolean;
    routeRunPending: boolean;
    runId: string;
    notificationVisible: boolean;
    latestNotification: { task_id: string; status: string } | null;
    rewindMarkers: RewindMarker[];
    activeTeamRuns: TeamRun[];
    thinkingExpanded?: boolean;
    thinkingElapsed: number;
    thinkingVisible: boolean;
    spinnerVerb: string;
    processingSlashCmd: string | null;
    approving: boolean;
    sending: boolean;
    forkOverlay: {
      active: boolean;
      sourceRunId: string;
      startedAt: number;
      error: string | null;
    } | null;
    forkElapsed: number;
    resuming: boolean;
    goto: (path: string, opts?: { replaceState?: boolean }) => void;
    sendMessage: (text: string, attachments: import("$lib/types").Attachment[]) => Promise<void>;
    fillPrompt: (text: string) => void;
    handleAuthModeChange: (mode: string) => void;
    handlePlatformChange: (id: string) => void;
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
    getPlanContentForExitPlan: (entryId: string) => { content: string; fileName: string } | null;
    openPreviewForPath: (path: string) => void;
    handleHookCallbackRespond: (requestId: string, decision: "allow" | "deny") => Promise<void>;
    handleChatScroll: () => void;
    scrollChatToBottom: () => void;
    handleTermResize: (cols: number, rows: number) => void;
    handleTermReady: (cols: number, rows: number) => void;
    handleForkCancel: () => void;
    handleForkRetry: () => void;
    dismissInitHint: () => void;
    loadRunProgressive: (id: string, xtermRef: XTerminal | undefined) => void;
    setLastTarget: (hostName: string | null) => void;
    teamDispatchPrompt?: string;
    teamDispatchOpen?: boolean;
    xtermRef?: XTerminal;
    chatAreaRef?: HTMLDivElement;
    showChatScrollHint: boolean;
    heroMetaFooter: import("svelte").Snippet;
    inputDock: import("svelte").Snippet;
  } = $props();

  function onTopSentinelMount(el: HTMLDivElement) {
    setTopSentinel(el);
    return { destroy: () => setTopSentinel(null) };
  }
</script>

<div class="chat-conversation-stage relative flex flex-1 min-h-0 overflow-hidden">
  <div class="absolute inset-0 min-h-0">
    {#if store.useStreamSession}
      <!-- API mode: chat messages -->
      <div
        class="chat-messages-scroll h-full overflow-y-auto relative z-0"
        style="overflow-anchor:auto"
        bind:this={chatAreaRef}
        onscroll={handleChatScroll}
      >
        {#if welcomeVisible}
          <ChatWelcomeScreen
            {lastContinuableRun}
            onContinueSession={(id) => goto(`/chat?run=${id}&resume=continue`)}
            onQuickAnalyze={() => sendMessage(t("chat_quickAnalyzePrompt"), [])}
            onQuickFix={() => fillPrompt(t("chat_quickFixPrompt"))}
            onQuickDaily={() => sendMessage(t("chat_quickDailyPrompt"), [])}
            onGotoSchedule={() => goto("/scheduled-tasks")}
            {authOverview}
            authSourceLabel={store.authSourceLabel}
            authSourceCategory={store.authSourceCategory}
            apiKeySource={store.apiKeySource}
            authMode={store.authMode}
            platformCredentials={settings?.platform_credentials ?? []}
            platformId={store.platformId ?? "anthropic"}
            onAuthModeChange={handleAuthModeChange}
            onPlatformChange={handlePlatformChange}
            {localProxyStatuses}
          >
            {#snippet initHint()}
              <ChatInitHint
                visible={showInitHint}
                onRunInit={() => sendMessage("/init", [])}
                onDismiss={dismissInitHint}
              />
            {/snippet}
            {#snippet heroMeta()}
              <ChatHeroMeta
                {cliVersionInfo}
                {channelLatest}
                {remoteHosts}
                currentRemoteHostName={store.remoteHostName}
                onTargetChange={(hostName) => {
                  store.remoteHostName = hostName;
                  setLastTarget(hostName);
                }}
                onNavigate={goto}
              />
            {/snippet}
          </ChatWelcomeScreen>
        {:else if routeRunLoadFailed}
          <div class="flex h-full flex-col items-center justify-center gap-3 px-4">
            <p class="text-sm text-destructive">{t("chat_sessionLoadFailed")}</p>
            <p class="text-xs text-muted-foreground max-w-md text-center break-words">
              {store.error}
            </p>
            <button
              class="rounded-lg border border-border bg-muted px-4 py-2 text-sm hover:bg-accent transition-colors"
              onclick={() => loadRunProgressive(runId, xtermRef)}
            >
              {t("common_retry")}
            </button>
          </div>
        {:else if routeRunPending || (store.phase === "loading" && store.timeline.length === 0 && !!runId)}
          <div class="flex h-full flex-col items-center justify-center gap-3">
            <div
              class="h-5 w-5 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin"
            ></div>
            <p class="text-xs text-muted-foreground">{t("chat_loadingSession")}</p>
          </div>
        {:else}
          <div data-conversation-root>
            {#if store.run?.parent_run_id}
              <ChatForkedBanner
                onViewParent={() => goto(`/chat?run=${store.run!.parent_run_id}`)}
              />
            {/if}
            {#if notificationVisible && latestNotification}
              <ChatNotificationBanner
                taskId={latestNotification.task_id}
                status={latestNotification.status}
              />
            {/if}
            {#if toolNamesInTimeline.length >= 2 && processVisibility !== "output"}
              <ChatToolFilterBar
                toolNames={toolNamesInTimeline}
                activeFilter={toolFilter}
                onFilterChange={(f) => setToolFilter(f)}
              />
            {/if}
            {#if processVisibility !== "output"}
              <div class="chat-content-width pb-1" data-export-exclude>
                <ViewModeToggle />
              </div>
            {/if}
            {#if filteredTimeline.length - renderLimit > 0}
              <div use:onTopSentinelMount aria-hidden="true" class="h-px w-full"></div>
            {/if}
            <ChatTimelineEntries
              {visibleTimeline}
              {store}
              {burstCollapse}
              {toolBursts}
              {lastClearSepId}
              {timelineIdIndex}
              {batchGroups}
              {processVisibility}
              {usageAnnotations}
              {settings}
              {lastAssistantIdx}
              {claudeTurnStarts}
              {latestPlanToolId}
              {showPermissionPanel}
              {fetchToolResult}
              {handleRewindToMessage}
              {handleToolAnswer}
              {handleToolApprove}
              {handlePermissionRespond}
              {handleExitPlanClearContext}
              {getPlanContentForExitPlan}
              {openPreviewForPath}
              toggleBurst={burstCollapse.toggleBurst}
              onDispatchToTeam={(content) => {
                teamDispatchPrompt = content;
                teamDispatchOpen = true;
              }}
            />

            {#if processVisibility === "output" && store.isRunning && timelineHasHiddenRoutineWorkRunning(store.timeline)}
              <ChatOutputWorkingHint />
            {/if}

            <ChatRewindMarkers markers={rewindMarkers} />

            {#if lastTurnUsage && !store.isRunning && settings?.show_token_usage_report !== false}
              <ChatUsageAnnotation usage={lastTurnUsage} />
            {/if}

            {#each activeTeamRuns as teamRun (teamRun.id)}
              <div class="w-full py-2">
                <div class="chat-content-width pl-7">
                  <TeamRunCard {teamRun} />
                </div>
              </div>
            {/each}

            {#each store.hookEvents.filter((h) => h.status === "hook_pending") as hookEvent (hookEvent.request_id)}
              <div class="chat-content-width pl-7" data-export-exclude>
                <HookReviewCard {hookEvent} onRespond={handleHookCallbackRespond} />
              </div>
            {/each}

            {#if store.thinkingText}
              <ChatThinkingPanel
                thinkingText={store.thinkingText}
                expanded={thinkingExpanded}
                onToggleExpand={() => (thinkingExpanded = !thinkingExpanded)}
              />
            {/if}

            {#if store.streamingText}
              <ChatStreamingText
                text={store.streamingText}
                agent={store.agent}
                platformId={store.platformId ?? undefined}
                model={store.run?.model ?? store.model}
              />
            {/if}

            {#if processingSlashCmd && !thinkingVisible && !store.streamingText && !store.thinkingText}
              <div class="w-full animate-fade-in" data-export-exclude>
                <div class="chat-content-width py-2">
                  <div class="flex items-center gap-2 text-sm text-muted-foreground">
                    <div
                      class="h-3.5 w-3.5 rounded-full border-2 border-border border-t-muted-foreground animate-spin"
                    ></div>
                    <span>{t("chat_processingCommand", { command: processingSlashCmd })}</span>
                  </div>
                </div>
              </div>
            {/if}

            {#if thinkingVisible && !store.thinkingText}
              <ChatThinkingIndicator
                elapsed={thinkingElapsed}
                activeToolName={store.activeToolName}
                thinkingDurationSec={store.thinkingEndMs ? store.thinkingDurationSec : null}
                {approving}
                {sending}
                {spinnerVerb}
              />
            {/if}
          </div>
        {/if}
      </div>
      {#if showChatScrollHint}
        <button
          class="absolute bottom-[calc(var(--chat-input-dock-offset,13rem)+0.75rem)] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg transition-all duration-200 hover:bg-primary/90 animate-fade-in"
          onclick={scrollChatToBottom}
        >
          {t("chat_newMessages")}
          <svg
            class="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      {/if}
    {:else if store.run && store.run.status !== "pending"}
      <XTerminalComponent
        bind:this={xtermRef}
        onResize={handleTermResize}
        onReady={handleTermReady}
        class="h-full"
      />
    {:else}
      <div class="flex h-full items-center justify-center">
        <div class="text-center max-w-md animate-slide-up">
          <img src={APP_LOGO_URL} alt="MiWarp" class="mx-auto mb-4 h-10 w-10 rounded-xl" />
          <h2 class="text-lg font-semibold text-primary mb-2">{t("layout_appName")}</h2>
          <p class="text-sm text-muted-foreground mb-4">
            {store.run ? t("chat_typeToStartSession") : t("chat_startSessionHint")}
          </p>
          <ChatInitHint
            visible={showInitHint}
            onRunInit={() => sendMessage("/init", [])}
            onDismiss={dismissInitHint}
          />
          {@render heroMetaFooter()}
        </div>
      </div>
    {/if}

    {#if forkOverlay}
      <ChatForkOverlay
        error={forkOverlay.error}
        elapsed={forkElapsed}
        {resuming}
        onCancel={handleForkCancel}
        onRetry={handleForkRetry}
      />
    {/if}

    {#if store.error && !forkOverlay}
      <ChatErrorCard
        error={store.error}
        resultSubtype={store.run?.result_subtype}
        sessionId={store.run?.session_id}
        phase={store.phase}
        onDismiss={() => (store.error = "")}
        onRetry={() => {}}
        onFork={() => {}}
        onGotoSettings={goto}
      />
    {/if}
  </div>

  <div class="chat-scroll-fade" aria-hidden="true"></div>

  {@render inputDock()}
</div>
