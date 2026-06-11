<script lang="ts">
  import type { SessionStore } from "$lib/stores/session-store.svelte";
  import type { UserSettings } from "$lib/types";
  import type { ProcessVisibility } from "$lib/utils/process-visibility";
  import type XTerminal from "$lib/components/XTerminal.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import type {
    TimelineVm,
    SessionVm,
    LoadingVm,
    ThinkingVm,
    ForkVm,
    StageHandlers,
  } from "./conversation-stage-types";
  import ChatWelcomeScreen from "$lib/components/ChatWelcomeScreen.svelte";
  import ChatForkedBanner from "$lib/components/ChatForkedBanner.svelte";
  import ChatNotificationBanner from "$lib/components/ChatNotificationBanner.svelte";
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
  import RecoveringBanner from "$lib/components/RecoveringBanner.svelte";
  import ElicitationDialog from "$lib/components/ElicitationDialog.svelte";
  import ForwardToSessionDialog from "./ForwardToSessionDialog.svelte";
  import { showToast as _showToast } from "$lib/stores/toast-store.svelte";
  import { dbgWarn } from "$lib/utils/debug";
  import * as api from "$lib/api";
  import ChatInitHint from "$lib/components/ChatInitHint.svelte";
  import ChatHeroMeta from "$lib/components/ChatHeroMeta.svelte";
  import XTerminalComponent from "$lib/components/XTerminal.svelte";
  import { timelineHasHiddenRoutineWorkRunning } from "$lib/utils/process-visibility";
  import { APP_LOGO_URL } from "$lib/utils/brand-assets";
  import { fade, scale } from "svelte/transition";
  import { t as tFn } from "$lib/i18n/index.svelte";
  import Spinner from "$lib/components/Spinner.svelte";

  const t = tFn;

  let {
    store,
    settings,
    processVisibility,
    // Grouped view models
    timelineVm,
    sessionVm,
    loadingVm,
    thinkingVm,
    forkVm,
    handlers,
    // Bindable state (not groupable into VMs)
    thinkingExpanded = $bindable(false),
    // Refs
    xtermRef = $bindable<XTerminal | undefined>(),
    chatAreaRef = $bindable<HTMLDivElement | undefined>(),
    // Local UI state
    showChatScrollHint,
    isChatAutoScroll = true,
    readingHistory = false,
    // Snippets
    heroMetaFooter,
    inputDock,
  }: {
    store: SessionStore;
    settings: UserSettings | null;
    processVisibility: ProcessVisibility;
    timelineVm: TimelineVm;
    sessionVm: SessionVm;
    loadingVm: LoadingVm;
    thinkingVm: ThinkingVm;
    forkVm: ForkVm;
    handlers: StageHandlers;
    thinkingExpanded?: boolean;
    xtermRef?: XTerminal;
    chatAreaRef?: HTMLDivElement;
    showChatScrollHint: boolean;
    /** When false, disable content-visibility and enable overflow anchoring for stable history scroll. */
    isChatAutoScroll?: boolean;
    readingHistory?: boolean;
    heroMetaFooter: import("svelte").Snippet;
    inputDock: import("svelte").Snippet;
  } = $props();

  // Destructure VMs so template references stay flat (no behavior change).
  const {
    visibleTimeline,
    filteredTimeline,
    toolNamesInTimeline: _toolNamesInTimeline,
    toolFilter: _toolFilter,
    setToolFilter: _setToolFilter,
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
    topSentinelRef: _topSentinelRef,
    setTopSentinel,
  } = $derived(timelineVm);

  const {
    welcomeVisible,
    lastContinuableRun,
    authOverview,
    localProxyStatuses,
    showInitHint,
    cliVersionInfo,
    channelLatest,
    remoteHosts,
    availableWorkspaces,
    selectedCwd,
  } = $derived(sessionVm);

  const {
    routeRunLoadFailed,
    routeRunPending,
    runId,
    notificationVisible,
    latestNotification,
    rewindMarkers,
    activeTeamRuns,
  } = $derived(loadingVm);

  const { thinkingElapsed, thinkingVisible, spinnerVerb, processingSlashCmd, approving, sending } =
    $derived(thinkingVm);

  const { forkOverlay, forkElapsed, resuming } = $derived(forkVm);

  const {
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
    handleExitPlanBypass,
    getPlanContentForExitPlan,
    openPreviewForPath,
    handleHookCallbackRespond,
    handleElicitationRespond,
    handleChatScroll,
    scrollChatToBottom,
    handleTermResize,
    handleTermReady,
    handleForkCancel,
    handleForkRetry,
    dismissInitHint,
    loadRunProgressive,
    setLastTarget,
  } = $derived(handlers);

  function onTopSentinelMount(el: HTMLDivElement) {
    setTopSentinel(el);
    return { destroy: () => setTopSentinel(null) };
  }

  // ── Runtime agent selector ──
  type AgentKind = "claude" | "mimo";
  let selectedAgent = $state<AgentKind>("claude");
  let mimoAvailable = $state(false);

  $effect(() => {
    api
      .detectMimoRuntime()
      .then((r) => {
        mimoAvailable = r.available;
      })
      .catch(() => {
        mimoAvailable = false;
      });
  });

  function handleAgentChange(agent: AgentKind) {
    selectedAgent = agent;
    store.agent = agent;
  }

  // ── Text selection toolbar ──
  let selectionText = $state("");
  let selectionX = $state(0);
  let selectionY = $state(0);
  let showSelectionToolbar = $state(false);
  let showForwardDialog = $state(false);
  let pendingForwardText = $state("");

  $effect(() => {
    function handleSelectionChange() {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!text || text.length < 2) {
        showSelectionToolbar = false;
        return;
      }
      const anchorNode = sel?.anchorNode;
      if (!anchorNode) {
        showSelectionToolbar = false;
        return;
      }
      const container = document.querySelector("[data-conversation-root]");
      if (!container?.contains(anchorNode)) {
        showSelectionToolbar = false;
        return;
      }
      const range = sel?.getRangeAt(0);
      if (!range) return;
      const rect = range.getBoundingClientRect();
      selectionText = text;
      selectionX = rect.left + rect.width / 2;
      selectionY = rect.top + window.scrollY - 8;
      showSelectionToolbar = true;
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  });

  function copySelection() {
    navigator.clipboard.writeText(selectionText);
    showSelectionToolbar = false;
    window.getSelection()?.removeAllRanges();
  }

  function forwardSelection() {
    // Stash the text + close the floating toolbar; the actual pick happens
    // inside ForwardToSessionDialog. Don't fill the input — forwarding goes
    // to a different run, not the current one.
    pendingForwardText = selectionText;
    showSelectionToolbar = false;
    window.getSelection()?.removeAllRanges();
    showForwardDialog = true;
  }

  async function forwardToRun(targetRunId: string) {
    const text = pendingForwardText;
    pendingForwardText = "";
    if (!text) return;
    try {
      // Reuse send_chat_message — it appends the text as a user prompt to
      // the target run (pipe_exec path) and spawns the agent. Run id is
      // decoupled from the current session, so cross-run forwarding works.
      await api.sendChatMessage(targetRunId, text);
      _showToast(t("chat_forwardSent"));
      handlers.goto(`/chat?run=${targetRunId}`, { replaceState: true });
    } catch (e) {
      dbgWarn("forward", "send failed", e);
      _showToast(t("chat_forwardFailed"), "error");
    }
  }
</script>

<div class="chat-conversation-stage relative flex flex-1 min-h-0 overflow-hidden">
  <div class="absolute inset-0 min-h-0">
    {#if store.useStreamSession}
      <!-- API mode: chat messages -->
      <div
        class="chat-messages-scroll h-full overflow-y-auto relative z-0"
        style:overflow-anchor={readingHistory ? "auto" : "none"}
        bind:this={chatAreaRef}
        onscroll={handleChatScroll}
        onwheel={handlers.handleChatWheel}
      >
        {#if welcomeVisible}
          <ChatWelcomeScreen
            {lastContinuableRun}
            onContinueSession={(id) => goto(`/chat?run=${id}&resume=continue`)}
            onQuickAnalyze={(mode, agent) => {
              handleAgentChange(agent);
              sendMessage(t("chat_quickAnalyzePrompt"), [], mode);
            }}
            onQuickFix={() => fillPrompt(t("chat_quickFixPrompt"))}
            onQuickDaily={(mode, agent) => {
              handleAgentChange(agent);
              sendMessage(t("chat_quickDailyPrompt"), [], mode);
            }}
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
            {availableWorkspaces}
            {selectedCwd}
            onCwdChange={handlers.onCwdChange}
            onAddWorkspace={handlers.onAddWorkspace}
            {selectedAgent}
            onAgentChange={handleAgentChange}
            {mimoAvailable}
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
              type="button"
              class="rounded-lg border border-border bg-muted px-4 py-2 text-sm hover:bg-accent transition-colors"
              onclick={() => loadRunProgressive(runId, xtermRef)}
            >
              {t("common_retry")}
            </button>
          </div>
        {:else if routeRunPending || (store.phase === "loading" && store.timeline.length === 0 && !!runId)}
          <div class="flex h-full flex-col items-center justify-center gap-3">
            <Spinner size="md" class="border-muted-foreground/30" />
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
                onDismiss={handlers.dismissTaskNotificationBanner}
              />
            {/if}
            {#if filteredTimeline.length - renderLimit > 0}
              <div use:onTopSentinelMount aria-hidden="true" class="h-px w-full"></div>
            {/if}
            <ChatTimelineEntries
              contentVisibilityEnabled={true}
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
              {handleExitPlanBypass}
              {getPlanContentForExitPlan}
              {openPreviewForPath}
              toggleBurst={burstCollapse.toggleBurst}
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
              <div class="w-full py-1">
                <div class="chat-content-width pl-7" data-export-exclude>
                  <HookReviewCard {hookEvent} onRespond={handleHookCallbackRespond} />
                </div>
              </div>
            {/each}

            {#if store.hasElicitation && store.sessionAlive}
              <div class="w-full py-1">
                <div class="chat-content-width pl-7" data-export-exclude>
                  <ElicitationDialog
                    elicitations={store.pendingElicitations}
                    onRespond={handleElicitationRespond}
                  />
                </div>
              </div>
            {/if}

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
                    <Spinner size="sm" class="border-border border-t-muted-foreground" />
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
          type="button"
          transition:fade={{ duration: 150 }}
          class="absolute bottom-[calc(var(--chat-input-dock-offset,13rem)+0.75rem)] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg transition-all duration-200 hover:bg-primary/90"
          onclick={scrollChatToBottom}
        >
          {t("chat_newMessages")}
          <Icon name="chevron-down" size="xs" />
        </button>
      {/if}
    {/if}

    {#if showSelectionToolbar}
      <div
        transition:scale={{ start: 0.95, duration: 100 }}
        class="fixed z-50 flex items-center gap-1 rounded-lg border border-border bg-popover px-2 py-1.5 shadow-xl"
        style="left: {selectionX}px; top: {selectionY}px; transform: translate(-50%, -100%);"
      >
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors"
          onclick={copySelection}
        >
          <Icon name="copy" size="sm" />
          {t("common_copy")}
        </button>
        <div class="h-4 w-px bg-border"></div>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors"
          onclick={forwardSelection}
        >
          <Icon name="arrow-right" size="sm" />
          {t("common_forward")}
        </button>
      </div>
    {/if}

    {#if store.run && store.run.status !== "pending"}
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

    {#if store.recoveryNotice}
      <RecoveringBanner message={store.recoveryNotice} />
    {/if}

    {#if store.error && !forkOverlay}
      <ChatErrorCard
        error={store.error}
        resultSubtype={store.run?.result_subtype}
        sessionId={store.run?.session_id}
        phase={store.phase}
        onDismiss={() => (store.error = "")}
        onGotoSettings={goto}
      />
    {/if}
  </div>

  <ForwardToSessionDialog bind:open={showForwardDialog} onSelect={forwardToRun} />

  <div class="chat-scroll-fade" aria-hidden="true"></div>

  {@render inputDock()}
</div>
