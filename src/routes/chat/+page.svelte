<script lang="ts">
  import { getContext } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import {
    KeybindingStore,
    getEventMiddleware,
    getCliVersionInfo_cached,
    TERMINAL_PHASES,
    canResumeNow,
    getResumeWarning,
    getCliCommands,
  } from "$lib/stores";
  import { t } from "$lib/i18n/index.svelte";
  import { dbg } from "$lib/utils/debug";
  import { truncate, formatTokenCount } from "$lib/utils/format";
  import { getToolColor } from "$lib/utils/tool-colors";
  import { ansiToHtml, hasAnsiCodes } from "$lib/utils/ansi";
  import { classifyError } from "$lib/stores/types";
  import { mergeProjectCommands } from "$lib/utils/slash-commands";
  import { uuid } from "$lib/utils/uuid";
  import { PLATFORM_PRESETS } from "$lib/utils/platform-presets";
  import { PROJECT_CWD_KEY } from "$lib/utils/storage-keys";

  // ── Components ──
  import XTerminal from "$lib/components/XTerminal.svelte";
  import ChatMessage from "$lib/components/ChatMessage.svelte";
  import AgentIdentity from "$lib/components/AgentIdentity.svelte";
  import InlineToolCard from "$lib/components/InlineToolCard.svelte";
  import BatchProgressBar from "$lib/components/BatchProgressBar.svelte";
  import ToolBurstHeader from "$lib/components/ToolBurstHeader.svelte";
  import SessionStatusBar from "$lib/components/SessionStatusBar.svelte";
  import McpStatusPanel from "$lib/components/McpStatusPanel.svelte";
  import PromptInput from "$lib/components/PromptInput.svelte";
  import CreatedFiles from "$lib/components/CreatedFiles.svelte";
  import PermissionPanel from "$lib/components/PermissionPanel.svelte";
  import ElicitationDialog from "$lib/components/ElicitationDialog.svelte";
  import ToolActivity from "$lib/components/ToolActivity.svelte";
  import ShortcutHelpPanel from "$lib/components/ShortcutHelpPanel.svelte";
  import MarkdownContent from "$lib/components/MarkdownContent.svelte";
  import HookReviewCard from "$lib/components/HookReviewCard.svelte";
  import ViewModeToggle from "$lib/components/ViewModeToggle.svelte";
  import ContextUsageGrid from "$lib/components/ContextUsageGrid.svelte";
  import CostSummaryView from "$lib/components/CostSummaryView.svelte";
  import ReleaseNotesCard from "$lib/components/ReleaseNotesCard.svelte";
  import RewindModal from "$lib/components/RewindModal.svelte";
  import FolderPicker from "$lib/components/FolderPicker.svelte";
  import TeamDispatchConfirm from "$lib/components/TeamDispatchConfirm.svelte";
  import TeamRunCard from "$lib/components/TeamRunCard.svelte";
  import WelcomeScreen from "$lib/components/chat/WelcomeScreen.svelte";
  import Spinner from "$lib/components/Spinner.svelte";

  // ── Composables ──
  import { useProgressiveTimeline } from "$lib/chat/use-progressive-timeline.svelte";
  import { useChatScroll } from "$lib/chat/use-chat-scroll.svelte";
  import { useTeamDispatch } from "$lib/chat/use-team-dispatch.svelte";
  import { useProjectPreload } from "$lib/chat/use-project-preload.svelte";
  import { useChatController } from "$lib/chat/use-chat-controller.svelte";
  import { useChatHandlers } from "$lib/chat/use-chat-handlers.svelte";
  import { useChatLifecycle } from "$lib/chat/use-chat-lifecycle.svelte";
  import { useChatDerived } from "$lib/chat/use-chat-derived.svelte";

  // ── Page-level singletons ──
  import { getChatSessionStore } from "$lib/stores/chat-page-singletons";

  // ── Layout context ──
  const toggleLayoutSidebar = getContext<() => void>("toggleSidebar");
  const keybindingStore = getContext<KeybindingStore>("keybindings");

  // ── Store + Middleware ──
  const store = getChatSessionStore();
  const middleware = getEventMiddleware();

  // ── Refs ──
  let xtermRef: XTerminal | undefined = $state();
  let promptRef: PromptInput | undefined = $state();
  let statusBarRef: SessionStatusBar | undefined = $state();
  let chatAreaRef: HTMLDivElement | undefined = $state();
  let mcpPanelOpen = $state(false);
  const routeRunId = $derived($page.url.searchParams.get("run") ?? "");
  /** True while URL names a run that the singleton SessionStore has not adopted yet. */
  const routeRunPending = $derived(!!routeRunId && store.run?.id !== routeRunId);

  /** Run bound but timeline not yet usable — avoids a blank gutter when phase wrongly left non-loading */
  const timelineRecoveryVisible = $derived(
    store.useStreamSession &&
      !!store.run?.id &&
      store.timeline.length === 0 &&
      !store.streamingText &&
      !store.thinkingText &&
      store.phase !== "empty" &&
      store.phase !== "loading",
  );

  // ── Composable chain ──
  const preload = useProjectPreload({ store, availableSkills: () => store.availableSkills });
  const { preloadedSkills, preloadedAgents, projectCommands, reloadProjectData } = preload;

  /** Breaks TDZ: deriveds/composables above `useChatLifecycle` must not close over `let lifecycle` before it exists. */
  const lifecycleRef: { current: ReturnType<typeof useChatLifecycle> | null } = { current: null };

  /** Same pattern: `useChatDerived` reads `visibleTimeline` during init, before `useProgressiveTimeline` returns. */
  const progressiveRef: { current: ReturnType<typeof useProgressiveTimeline> | null } = {
    current: null,
  };

  const team = useTeamDispatch({
    effectiveCwd: () => store.effectiveCwd || "",
    onSendMessage: (text) => ctrl.sendMessage(text, []),
  });

  // ── CLI version info (standalone, no forward refs) ──
  const cliVersionInfo = $derived(getCliVersionInfo_cached());
  const channelLatest = $derived.by(() => {
    if (!cliVersionInfo?.installed) return undefined;
    return cliVersionInfo.channel === "stable" ? cliVersionInfo.stable : cliVersionInfo.latest;
  });
  const platformDisplayName = $derived.by(() => {
    const pid = store.platformId;
    if (!pid) return undefined;
    const preset = PLATFORM_PRESETS.find((p) => p.id === pid);
    return preset?.name ?? lifecycleRef.current?.authOverview?.app_platform_name ?? pid;
  });

  // ── Computed standalone ──
  const filteredTimeline = $derived.by(() => {
    const tf = lifecycleRef.current?.toolFilter ?? null;
    if (!tf) return store.timeline;
    return store.timeline.filter((e) => e.kind !== "tool" || e.tool.tool_name === tf);
  });

  // ── Core composables (let for TDZ — callbacks reference each other) ──
  let chatDerived = useChatDerived({
    store,
    filteredTimeline: () => filteredTimeline,
    visibleTimeline: () => progressiveRef.current?.visibleTimeline ?? filteredTimeline,
    toolFilter: () => lifecycleRef.current?.toolFilter ?? null,
    settings: () => lifecycleRef.current?.settings ?? null,
    cliVersionInfo: () => cliVersionInfo,
    channelLatest: () => channelLatest,
    platformDisplayName: () => platformDisplayName,
    authOverview: () => lifecycleRef.current?.authOverview ?? null,
  });

  const progressive = useProgressiveTimeline({
    filteredTimeline: () => filteredTimeline,
    chatAreaRef: () => chatAreaRef,
    burstHiddenIndices: () => chatDerived.burstHiddenIndices,
    toolBursts: () => chatDerived.toolBursts,
    manualOverrides: () => chatDerived.manualOverrides,
    onManualOverridesChange: (next) => {
      chatDerived.manualOverrides = next;
    },
  });
  progressiveRef.current = progressive;
  const { rearmLoadMore } = progressive;

  /**
   * Bridge DOM ref — `bind:this={progressive.topSentinel}` breaks in production (no component `$set`).
   * Use an action instead of `$effect`; an effect that writes composable `$state` can participate in
   * `effect_update_depth_exceeded` when combined with IntersectionObserver + layout flushes.
   */
  function topSentinelSync(node: HTMLDivElement) {
    progressive.topSentinel = node;
    return {
      destroy() {
        if (progressive.topSentinel === node) progressive.topSentinel = null;
      },
    };
  }

  const chatScroll = useChatScroll({
    chatAreaRef: () => chatAreaRef,
    isStreamSession: () => store.useStreamSession,
    timelineLength: () => store.timeline.length,
    streamingTextLength: () => store.streamingText.length,
    runId: () => store.run?.id ?? "",
    hasInlinePermission: () => store.hasInlinePermission,
    scrollToInFlight: () => lifecycleRef.current?.getScrollToInFlight() ?? false,
    rearmLoadMore,
  });
  const { handleChatScroll, scrollChatToBottom } = chatScroll;

  const ctrl = useChatController({
    store,
    progressive,
    preload,
    chatScroll,
    team,
    getSearchParam: (key) => new URLSearchParams(window.location.search).get(key),
    getChatAreaRef: () => chatAreaRef,
    scrollToMessage: (ts) => handlers.scrollToMessage(ts),
    handleResume: (mode, runId, msg, att) => handlers.handleResume(mode, runId, msg, att),
    showChatToast: (msg) => handlers.showChatToast(msg),
    openFolderPicker: (opts) =>
      lifecycleRef.current?.openFolderPicker(opts) ?? Promise.resolve(null),
    promptRef: () => promptRef,
    getRemoteHosts: () => lifecycleRef.current?.remoteHosts ?? [],
    getSettings: () => lifecycleRef.current?.settings ?? null,
    onBeforeLoadRun: () => {
      handlers.clearDragState();
      lifecycleRef.current?.setToolFilter(null);
      folderCwdOverride = "";
    },
    getScrollToInFlight: () => lifecycleRef.current?.getScrollToInFlight() ?? false,
    setScrollToInFlight: (v) => lifecycleRef.current?.setScrollToInFlight(v),
  });

  // ── Page state (must precede handlers/lifecycle for TDZ) ──
  let currentEffort = $state("");
  let folderCwdOverride = $state("");
  let contextHistoryMap = $state<Map<string, import("$lib/types").ContextSnapshot[]>>(new Map());

  const handlers = useChatHandlers({
    store,
    progressive,
    preload,
    chatScroll,
    team,
    ctrl,
    promptRef: () => promptRef,
    xtermRef: () => xtermRef,
    statusBarRef: () => statusBarRef,
    chatAreaRef: () => chatAreaRef,
    getSettings: () => lifecycleRef.current?.settings ?? null,
    getAgentSettings: () => lifecycleRef.current?.agentSettings ?? null,
    getRemoteHosts: () => lifecycleRef.current?.remoteHosts ?? [],
    getAuthOverview: () => lifecycleRef.current?.authOverview ?? null,
    getCurrentEffort: () => currentEffort,
    setCurrentEffort: (v) => {
      currentEffort = v;
    },
    getVerboseEnabled: () => lifecycleRef.current?.verboseEnabled ?? false,
    setVerboseEnabled: (v) => lifecycleRef.current?.setVerboseEnabled(v),
    getToolFilter: () => lifecycleRef.current?.toolFilter ?? null,
    setToolFilter: (v) => lifecycleRef.current?.setToolFilter(v),
    getFilteredTimeline: () => filteredTimeline,
    getVisibleTimeline: () => progressive.visibleTimeline,
    getSidebarCollapsed: () => lifecycleRef.current?.sidebarCollapsed ?? false,
    setSidebarCollapsed: (v) => lifecycleRef.current?.setSidebarCollapsed(v),
    getFolderCwdOverride: () => folderCwdOverride,
    setFolderCwdOverride: (v) => {
      folderCwdOverride = v;
    },
    reloadProjectData,
    openFolderPicker: (opts) =>
      lifecycleRef.current?.openFolderPicker(opts) ?? Promise.resolve(null),
    openPreviewForPath,
    contextHistoryMap,
    localProxyStatuses: {} as Record<string, { running: boolean; needsAuth: boolean }>,
    setLocalProxyStatuses: (v) => lifecycleRef.current?.setLocalProxyStatuses(v),
    authOverview: null,
    setAuthOverview: (v) => lifecycleRef.current?.setAuthOverview(v),
    setLastContinuableRun: (v) => lifecycleRef.current?.setLastContinuableRun(v),
    getRewindCandidates: () => rewindCandidates,
  });

  let lifecycle = useChatLifecycle({
    store,
    middleware,
    preload,
    progressive,
    ctrl,
    xtermRef: () => xtermRef,
    promptRef: () => promptRef,
    statusBarRef: () => statusBarRef,
    sessionLifecycle: {
      handleResume: (mode, runId, opts) =>
        handlers.handleResume(mode, runId, opts?.initialMessage, opts?.initialAttachments),
      resuming: { get: () => handlers.resuming },
    },
    dragDrop: {
      get pageDragActive() {
        return handlers.pageDragActive;
      },
      set pageDragActive(v: boolean) {
        handlers.pageDragActive = v;
      },
      get dragProcessing() {
        return handlers.dragProcessing;
      },
      handleTauriDrop: handlers.handleTauriDrop,
      clearDragState: handlers.clearDragState,
      getDragProcessingCount() {
        return handlers.dragProcessingCount;
      },
    },
    exportCtrl: { handleExportHtml: handlers.handleExportHtml },
    keybindingStore,
    showChatToast: (msg) => handlers.showChatToast(msg),
    scrollToMessage: (ts) => handlers.scrollToMessage(ts),
    handleRewind: () => handlers.handleRewind(),
    handlePermissionModeChange: (mode) => handlers.handlePermissionModeChange(mode),
    getBtwState: () => handlers.btwState,
    getForkOverlay: () => handlers.forkOverlay,
    getRewindMarkers: () => handlers.rewindMarkers,
    setRewindMarkers: (v) => {
      handlers.rewindMarkers = v;
    },
    getCurrentEffort: () => currentEffort,
    setCurrentEffort: (v) => {
      currentEffort = v;
    },
    getStashedInput: () => handlers.stashedInput,
    setStashedInput: (v) => {
      handlers.stashedInput = v;
    },
    getShortcutHelpOpen: () => handlers.shortcutHelpOpen,
    setShortcutHelpOpen: (v) => {
      handlers.shortcutHelpOpen = v;
    },
    getFolderCwdOverride: () => folderCwdOverride,
    setFolderCwdOverride: (v) => {
      folderCwdOverride = v;
    },
    getContextHistoryMap: () => contextHistoryMap,
    setContextHistoryMap: (v) => {
      contextHistoryMap = v;
    },
    effectiveModels: () => chatDerived.effectiveModels,
    pendingToolPermissions: () => chatDerived.pendingToolPermissions,
    setSidebarRequestedTab: (v) => {
      handlers.sidebarRequestedTab = v;
    },
  });

  lifecycleRef.current = lifecycle;

  // ── Helpers ──
  function fillPrompt(text: string) {
    promptRef?.setValue(text);
  }
  function openPreviewForPath(path: string) {
    if (!path) return;
    handlers.requestedPreviewPath = path;
    handlers.sidebarRequestedTab = "files";
    if (lifecycle.sidebarCollapsed) lifecycle.setSidebarCollapsed(false);
  }

  // ── Rewind candidates (lazy, only when modal open) ──
  const rewindCandidates = $derived(
    handlers.rewindModalOpen
      ? store.timeline
          .map((e, i) => ({ entry: e, idx: i }))
          .filter(
            (
              x,
            ): x is {
              entry: Extract<import("$lib/types").TimelineEntry, { kind: "user" }> & {
                cliUuid: string;
              };
              idx: number;
            } => x.entry.kind === "user" && !!x.entry.cliUuid,
          )
          .reverse()
          .map(({ entry, idx }) => ({
            cliUuid: entry.cliUuid,
            content: entry.content,
            ts: entry.ts,
            timelineIndex: idx,
          }))
      : [],
  );
</script>

{#snippet initHintCard()}
  {#if lifecycle.showInitHint}
    <div class="mt-3 flex items-center gap-2 text-[11px] text-amber-400/80">
      <svg
        class="h-3.5 w-3.5 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M12 9v4" /><path d="M12 17h.01" />
        <path d="M3.6 15.4 10.2 4a2 2 0 0 1 3.6 0l6.6 11.4a2 2 0 0 1-1.8 3H5.4a2 2 0 0 1-1.8-3Z" />
      </svg>
      <span>
        Run <button
          class="font-mono text-amber-300 hover:text-amber-200 underline underline-offset-2 transition-colors"
          onclick={() => ctrl.sendMessage("/init", [])}>{t("chat_initHintAction")}</button
        > to create CLAUDE.md
      </span>
      <button
        class="ml-auto text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
        onclick={lifecycle.dismissInitHint}
        title={t("chat_initHintDismiss")}
      >
        <svg
          class="h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
        >
      </button>
    </div>
  {/if}
{/snippet}

<div
  class="miwarp-chat-page-root miwarp-immersive-page-root relative flex h-full min-h-0 w-full flex-col overflow-hidden"
>
  <!-- Page-level drag overlay -->
  {#if handlers.pageDragActive || handlers.dragProcessing}
    <div
      data-chat-drag-overlay=""
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-[2px]"
    >
      <div
        class="pointer-events-none flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-primary/50 bg-primary/5 px-12 py-8"
      >
        {#if handlers.dragProcessing}
          <svg
            class="h-8 w-8 text-primary/60 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg
          >
          <span class="text-sm font-medium text-primary/70">{t("drag_processing")}</span>
        {:else}
          <svg
            class="h-8 w-8 text-primary/60"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline
              points="17 8 12 3 7 8"
            /><line x1="12" x2="12" y1="3" y2="15" /></svg
          >
          <span class="text-sm font-medium text-primary/70">{t("prompt_dropFiles")}</span>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Session capsule + SessionPanelTabs: one strip spanning chat + tool rail -->
  <div class="relative z-30 min-w-0 shrink-0 px-2 sm:px-3">
    <SessionStatusBar
      bind:this={statusBarRef}
      fuseToolRailCapsule={true}
      running={store.sessionAlive}
      run={store.run}
      agent={store.run?.agent ?? store.agent}
      model={store.model}
      cost={store.usage.cost}
      inputTokens={chatDerived.cumulativeTokens.input}
      outputTokens={chatDerived.cumulativeTokens.output}
      cacheReadTokens={chatDerived.cumulativeTokens.cacheRead}
      cacheWriteTokens={chatDerived.cumulativeTokens.cacheWrite}
      parentRunId={store.run?.parent_run_id}
      onEndSession={handlers.handleStop}
      onFork={handlers.forkOverlay ? undefined : () => handlers.handleResume("fork")}
      onModelChange={handlers.handleModelChange}
      effort={store.features.effortSelector ? currentEffort : undefined}
      onEffortChange={store.features.effortSelector ? handlers.handleEffortChange : undefined}
      onNavigateParent={store.run?.parent_run_id
        ? () => goto(`/chat?run=${store.run!.parent_run_id}`)
        : undefined}
      cwd={store.effectiveCwd}
      onToggleSidebar={toggleLayoutSidebar}
      mcpServers={store.mcpServers}
      onMcpToggle={() => (mcpPanelOpen = !mcpPanelOpen)}
      cliVersion={store.cliVersion}
      permissionMode={store.permissionMode}
      platformModels={chatDerived.platformModels}
      fastModeState={store.fastModeState}
      verbose={lifecycle.verboseEnabled}
      numTurns={store.numTurns}
      durationMs={store.durationMs}
      persistedFiles={store.persistedFiles}
      onRewind={store.sessionAlive && !store.isRunning ? handlers.handleRewind : undefined}
      contextUtilization={store.contextUtilization}
      contextWarningLevel={store.contextWarningLevel}
      contextWindow={store.contextWindow}
      lastCompactedAt={store.lastCompactedAt}
      compactCount={store.compactCount}
      microcompactCount={store.microcompactCount}
      turnUsages={store.turnUsages}
      activeTaskCount={store.activeBackgroundTasks.length}
      mode={store.run ? (store.useStreamSession ? "Stream" : "CLI") : ""}
      remoteHostName={store.remoteHostName}
      onRename={store.run ? handlers.handleRename : undefined}
      authSourceLabel={store.authSourceLabel}
      authSourceCategory={store.authSourceCategory}
      apiKeySource={store.apiKeySource}
      onStatusClick={() => {
        if (lifecycle.sidebarCollapsed) lifecycle.setSidebarCollapsed(false);
        handlers.sidebarRequestedTab = "info";
      }}
      onExportHtml={store.run ? () => void handlers.handleExportHtml() : undefined}
      toolPanelActiveTab={handlers.toolPanelActiveTab}
      onToolPanelTabChange={handlers.selectToolPanelTab}
      toolPanelIndicators={handlers.toolPanelIndicators}
    />
  </div>

  <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <!-- Chat column -->
    <div class="relative z-20 flex min-h-0 min-w-0 flex-1 flex-col">
      <!-- MCP panel -->
      {#if mcpPanelOpen && store.mcpServers.length > 0}
        <div class="absolute {lifecycle.statusBarExpanded ? 'top-16' : 'top-9'} right-3 z-30">
          <McpStatusPanel
            runId={store.run?.id ?? ""}
            mcpServers={store.mcpServers}
            sessionAlive={store.sessionAlive}
            onClose={() => (mcpPanelOpen = false)}
            onServersUpdate={(servers) => store.updateMcpServers(servers)}
          />
        </div>
      {/if}

      <!-- Main area -->
      <div class="relative z-0 min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
        {#if store.useStreamSession}
          <!-- API mode: chat messages -->
          <div
            class="miwarp-chat-scroll-area h-full overflow-y-auto pb-32"
            bind:this={chatAreaRef}
            onscroll={handleChatScroll}
          >
            {#if routeRunPending || (store.phase === "loading" && store.timeline.length === 0)}
              <div class="flex h-full items-center justify-center">
                <Spinner size="md" class="text-primary" />
              </div>
            {:else if chatDerived.welcomeVisible}
              <WelcomeScreen
                welcomeQuickActionsReady={lifecycle.welcomeQuickActionsReady}
                lastContinuableRun={lifecycle.lastContinuableRun}
                showInitHint={lifecycle.showInitHint}
                authOverview={lifecycle.authOverview}
                authSourceLabel={store.authSourceLabel}
                authSourceCategory={store.authSourceCategory}
                apiKeySource={store.apiKeySource}
                authMode={store.authMode}
                platformCredentials={lifecycle.settings?.platform_credentials ?? []}
                platformId={store.platformId ?? "anthropic"}
                localProxyStatuses={lifecycle.localProxyStatuses}
                {cliVersionInfo}
                {channelLatest}
                remoteHosts={lifecycle.remoteHosts}
                remoteHostName={store.remoteHostName}
                targetDropdownOpen={lifecycle.targetDropdownOpen}
                onSendMessage={(text, att) => ctrl.sendMessage(text, att)}
                onFillPrompt={fillPrompt}
                onGoto={(path) => goto(path)}
                onDismissInitHint={lifecycle.dismissInitHint}
                onAuthModeChange={handlers.handleAuthModeChange}
                onPlatformChange={handlers.handlePlatformChange}
                onTargetChange={(name) => {
                  store.remoteHostName = name;
                  import("$lib/utils/remote-cwd").then((m) => m.setLastTarget(name));
                }}
                onTargetDropdownToggle={() =>
                  lifecycle.setTargetDropdownOpen(!lifecycle.targetDropdownOpen)}
                onTargetDropdownClose={() => lifecycle.setTargetDropdownOpen(false)}
              />
            {:else}
              <!-- Timeline -->
              <div data-conversation-root>
                {#if timelineRecoveryVisible}
                  <div
                    class="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-4 py-12"
                  >
                    <Spinner size="md" class="text-primary" />
                    <p class="text-center text-sm text-muted-foreground">
                      {t("chat_timelineRecovering")}
                    </p>
                    <button
                      type="button"
                      class="text-sm text-primary underline underline-offset-2"
                      onclick={() => {
                        const rid = store.run?.id;
                        if (rid) void ctrl.loadRunProgressive(rid, xtermRef);
                      }}
                    >
                      {t("chat_reloadSession")}
                    </button>
                  </div>
                {:else}
                  {#if store.run?.parent_run_id}
                    <div class="chat-content-width py-2" data-export-exclude>
                      <div
                        class="flex items-center gap-2 rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs text-blue-400"
                      >
                        <svg
                          class="h-3.5 w-3.5 shrink-0"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          ><circle cx="12" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><circle
                            cx="18"
                            cy="6"
                            r="3"
                          /><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" /><path
                            d="M12 12v3"
                          /></svg
                        >
                        <span class="text-foreground/60">{t("chat_forkedBanner")}</span>
                        <button
                          class="ml-auto shrink-0 text-blue-400 hover:text-blue-300 underline underline-offset-2"
                          onclick={() => goto(`/chat?run=${store.run!.parent_run_id}`)}
                          >{t("chat_viewParent")}</button
                        >
                      </div>
                    </div>
                  {/if}
                  {#if lifecycle.notificationVisible && lifecycle.latestNotification}
                    <div class="chat-content-width py-1" data-export-exclude>
                      <div
                        class="flex items-center gap-2 text-xs text-muted-foreground bg-teal-500/5 border border-teal-500/20 rounded px-3 py-1.5 animate-fade-in"
                      >
                        <span class="h-1.5 w-1.5 rounded-full bg-teal-500 animate-pulse"></span>
                        Task #{lifecycle.latestNotification.task_id}: {lifecycle.latestNotification
                          .status}
                      </div>
                    </div>
                  {/if}
                  {#if chatDerived.toolNamesInTimeline.length >= 2}
                    <div class="chat-content-width py-2" data-export-exclude>
                      <div class="flex flex-wrap items-center gap-1.5">
                        <button
                          class="rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors {!lifecycle.toolFilter
                            ? 'bg-foreground/10 text-foreground'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted'}"
                          onclick={() => lifecycle.setToolFilter(null)}
                          >{t("chat_filterAll")}</button
                        >
                        {#each chatDerived.toolNamesInTimeline as name}
                          {@const style = getToolColor(name)}
                          <button
                            class="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors {lifecycle.toolFilter ===
                            name
                              ? style.bg + ' ' + style.text
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted'}"
                            onclick={() =>
                              lifecycle.setToolFilter(lifecycle.toolFilter === name ? null : name)}
                          >
                            <svg
                              class="h-2.5 w-2.5"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"><path d={style.icon} /></svg
                            >
                            {name}
                          </button>
                        {/each}
                      </div>
                    </div>
                  {/if}
                  <div class="chat-content-width pb-1" data-export-exclude><ViewModeToggle /></div>
                  <!-- Keep sentinel mounted: {#if} mount churn can fight IntersectionObserver + renderLimit. -->
                  <div
                    use:topSentinelSync
                    aria-hidden="true"
                    class="h-px w-full shrink-0 {filteredTimeline.length - progressive.renderLimit >
                    0
                      ? ''
                      : 'hidden'}"
                  ></div>
                  {#each progressive.visibleTimeline as entry, i (entry.id)}
                    {#if !(chatDerived.burstHiddenIndices.has(i) && !chatDerived.toolBursts.has(i))}
                      <div
                        id="msg-{entry.anchorId}"
                        data-entry-id={entry.id}
                        class:cv-auto={true}
                        class="group/msg"
                        class:opacity-40={chatDerived.lastClearSepId !== null &&
                          (chatDerived.timelineIdIndex.get(entry.id) ?? 0) <
                            (chatDerived.timelineIdIndex.get(chatDerived.lastClearSepId) ?? 0)}
                      >
                        {#if chatDerived.batchGroups.has(i)}
                          {@const batch = chatDerived.batchGroups.get(i)}
                          {#if batch}
                            <div class="w-full py-1">
                              <div class="chat-content-width pl-7">
                                <BatchProgressBar tools={batch} />
                              </div>
                            </div>
                          {/if}
                        {/if}
                        {#if chatDerived.toolBursts.has(i)}
                          {@const burst = chatDerived.toolBursts.get(i)}
                          {#if burst}
                            <div class="w-full py-1">
                              <div class="chat-content-width pl-7">
                                <ToolBurstHeader
                                  {burst}
                                  collapsed={chatDerived.effectiveCollapsed.has(burst.key)}
                                  onToggle={() => chatDerived.toggleBurst(burst.key)}
                                />
                              </div>
                            </div>
                          {/if}
                        {/if}
                        {#if chatDerived.usageAnnotations.has(i)}
                          {@const tu = chatDerived.usageAnnotations.get(i)}
                          {#if tu && lifecycle.settings?.show_token_usage_report !== false}
                            <div class="w-full py-1.5">
                              <div class="chat-content-width">
                                <div class="flex items-center gap-3">
                                  <div class="h-px flex-1 bg-border/40"></div>
                                  <span class="text-[10px] tabular-nums text-muted-foreground"
                                    >{formatTokenCount(tu.inputTokens)}
                                    {t("chat_usageIn")} · {formatTokenCount(tu.outputTokens)}
                                    {t(
                                      "chat_usageOut",
                                    )}{#if tu.cacheReadTokens > 0 || tu.cacheWriteTokens > 0}
                                      · {t("chat_usageCache", {
                                        read: formatTokenCount(tu.cacheReadTokens),
                                        write: formatTokenCount(tu.cacheWriteTokens),
                                      })}{/if}</span
                                  >
                                  <div class="h-px flex-1 bg-border/40"></div>
                                </div>
                              </div>
                            </div>
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
                                  handlers.handleRewindToMessage({
                                    cliUuid: entry.cliUuid!,
                                    content: entry.content,
                                    ts: entry.ts,
                                  })
                              : undefined}
                            onDispatchToTeam={() => {
                              team.teamDispatchPrompt = entry.content;
                              team.teamDispatchOpen = true;
                            }}
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
                            animated={i ===
                              chatDerived.lastAssistantIdx(progressive.visibleTimeline) &&
                              store.isRunning}
                          />
                        {:else if entry.kind === "tool"}
                          {#if chatDerived.claudeTurnStarts.has(i)}<div class="pt-3"></div>{/if}
                          {#if !chatDerived.burstHiddenIndices.has(i)}
                            <div class="w-full py-1" id="tool-{entry.tool.tool_use_id}">
                              <div class="chat-content-width">
                                <InlineToolCard
                                  tool={entry.tool}
                                  subTimeline={entry.subTimeline}
                                  runId={store.run?.id ?? ""}
                                  fetchToolResult={lifecycle.fetchToolResult}
                                  onAnswer={entry.tool.tool_name === "AskUserQuestion" &&
                                  (entry.tool.status === "running" ||
                                    entry.tool.status === "ask_pending")
                                    ? (answer) =>
                                        handlers.handleToolAnswer(entry.tool.tool_use_id, answer)
                                    : undefined}
                                  onApprove={handlers.handleToolApprove}
                                  onPermissionRespond={handlers.handlePermissionRespond}
                                  onExitPlanClearContext={handlers.handleExitPlanClearContext}
                                  taskNotifications={store.taskNotifications}
                                  planContent={entry.tool.tool_name === "ExitPlanMode" &&
                                  (entry.tool.status === "permission_prompt" ||
                                    entry.tool.status === "success")
                                    ? handlers.getPlanContentForExitPlan(entry.id)
                                    : undefined}
                                  latestPlanTool={entry.kind === "tool" &&
                                    entry.tool.tool_use_id === chatDerived.latestPlanToolId}
                                  showPermissionInPanel={chatDerived.showPermissionPanel}
                                  onPreviewFile={openPreviewForPath}
                                />
                              </div>
                            </div>
                          {/if}
                        {:else if entry.kind === "command_output"}
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
                        {:else if entry.kind === "separator"}
                          <div class="w-full py-3">
                            <div class="chat-content-width">
                              <div class="flex items-center gap-3">
                                <div class="h-px flex-1 bg-amber-500/20"></div>
                                <span
                                  class="text-xs text-amber-500/70 font-medium whitespace-nowrap"
                                  >{entry.content === "__CONTEXT_CLEARED__"
                                    ? t("chat_contextCleared")
                                    : entry.content}</span
                                >
                                <div class="h-px flex-1 bg-amber-500/20"></div>
                              </div>
                            </div>
                          </div>
                        {/if}
                      </div>
                    {/if}
                  {/each}

                  <!-- Rewind markers -->
                  {#each handlers.rewindMarkers as marker, mi (marker.id)}
                    <div
                      class="w-full py-3"
                      id={mi === handlers.rewindMarkers.length - 1
                        ? "rewind-marker-latest"
                        : undefined}
                    >
                      <div class="chat-content-width">
                        <div class="flex items-center gap-3">
                          <div class="h-px flex-1 bg-blue-500/20"></div>
                          <div class="flex items-center gap-2 text-xs text-blue-500/80 font-medium">
                            <svg
                              class="h-3.5 w-3.5"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              ><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path
                                d="M3 3v5h5"
                              /></svg
                            ><span
                              >{t("rewind_separatorLabel", {
                                count: String(marker.filesReverted.length),
                              })}</span
                            >
                          </div>
                          <div class="h-px flex-1 bg-blue-500/20"></div>
                        </div>
                        <div class="mt-1 ml-8 text-[11px] text-muted-foreground/60 truncate">
                          &ldquo;{marker.targetContent}&rdquo;
                        </div>
                        {#if marker.filesReverted.length > 0}<details class="mt-1 ml-8">
                            <summary
                              class="cursor-pointer text-[10px] text-blue-500/50 hover:text-blue-500/80"
                              >{t("rewind_separatorFiles", {
                                count: String(marker.filesReverted.length),
                              })}</summary
                            >
                            <div class="mt-1 rounded bg-muted/30 px-2 py-1">
                              {#each marker.filesReverted as file}<div
                                  class="truncate font-mono text-[10px] text-muted-foreground"
                                >
                                  {file}
                                </div>{/each}
                            </div>
                          </details>{/if}
                      </div>
                    </div>
                  {/each}

                  <!-- Last turn usage -->
                  {#if chatDerived.lastTurnUsage && !store.isRunning && lifecycle.settings?.show_token_usage_report !== false}
                    <div class="w-full py-1.5">
                      <div class="chat-content-width">
                        <div class="flex items-center gap-3">
                          <div class="h-px flex-1 bg-border/40"></div>
                          <span class="text-[10px] tabular-nums text-muted-foreground"
                            >{formatTokenCount(chatDerived.lastTurnUsage.inputTokens)}
                            {t("chat_usageIn")} · {formatTokenCount(
                              chatDerived.lastTurnUsage.outputTokens,
                            )}
                            {t(
                              "chat_usageOut",
                            )}{#if chatDerived.lastTurnUsage.cacheReadTokens > 0 || chatDerived.lastTurnUsage.cacheWriteTokens > 0}
                              · {t("chat_usageCache", {
                                read: formatTokenCount(chatDerived.lastTurnUsage.cacheReadTokens),
                                write: formatTokenCount(chatDerived.lastTurnUsage.cacheWriteTokens),
                              })}{/if}</span
                          >
                          <div class="h-px flex-1 bg-border/40"></div>
                        </div>
                      </div>
                    </div>
                  {/if}

                  <!-- Team runs -->
                  {#each team.activeTeamRuns as teamRun (teamRun.id)}
                    <div class="w-full py-2">
                      <div class="chat-content-width pl-7"><TeamRunCard {teamRun} /></div>
                    </div>
                  {/each}

                  <!-- Hook callbacks -->
                  {#each store.hookEvents.filter((h) => h.status === "hook_pending") as hookEvent (hookEvent.request_id)}
                    <div class="chat-content-width pl-7" data-export-exclude>
                      <HookReviewCard {hookEvent} onRespond={handlers.handleHookCallbackRespond} />
                    </div>
                  {/each}

                  <!-- Thinking panel -->
                  {#if store.thinkingText}
                    <div class="w-full animate-fade-in">
                      <div class="chat-content-width py-2">
                        <button
                          class="glass-card w-full text-left px-3 py-2 transition-colors group"
                          onclick={() => lifecycle.setThinkingExpanded(!lifecycle.thinkingExpanded)}
                        >
                          <div class="flex items-center gap-2">
                            <div
                              class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[hsl(var(--miwarp-status-info)/0.15)]"
                            >
                              <svg
                                class="h-3 w-3 text-[hsl(var(--miwarp-status-info))]"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                ><path
                                  d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.4V19a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1.6c2.9-1.1 5-4 5-7.4a8 8 0 0 0-8-8z"
                                /><path d="M10 22h4" /></svg
                              >
                            </div>
                            <span class="text-xs font-medium text-[hsl(var(--miwarp-status-info))]"
                              >{t("chat_thinking")}</span
                            >
                            {#if store.isRunning && !store.streamingText}<Spinner
                                size="xs"
                                class="text-[hsl(var(--miwarp-status-info))]"
                              />{/if}
                            <svg
                              class="h-3 w-3 text-muted-foreground/40 shrink-0 transition-transform ml-auto {lifecycle.thinkingExpanded
                                ? 'rotate-180'
                                : ''}"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg
                            >
                          </div>
                          {#if lifecycle.thinkingExpanded}
                            <div class="mt-2 pl-7 max-h-60 overflow-y-auto">
                              <pre
                                class="text-xs font-mono whitespace-pre-wrap break-words text-[hsl(var(--miwarp-status-info)/0.7)] leading-relaxed">{store.thinkingText.trimEnd()}</pre>
                            </div>
                          {/if}
                        </button>
                      </div>
                    </div>
                  {/if}

                  <!-- Streaming text -->
                  {#if store.streamingText}
                    <div class="w-full animate-fade-in">
                      <div class="chat-content-width py-4">
                        <div class="mb-1.5 flex items-center gap-2">
                          <AgentIdentity
                            agent={store.agent}
                            platformId={store.platformId ?? undefined}
                            model={store.run?.model ?? store.model}
                            size="md"
                            animated={true}
                            showName={true}
                            showModel={false}
                          />
                        </div>
                        <div class="pl-7 prose-chat">
                          <MarkdownContent text={store.streamingText} streaming={true} />
                        </div>
                      </div>
                    </div>
                  {/if}

                  <!-- Slash command processing -->
                  {#if ctrl.processingSlashCmd && !lifecycle.thinkingVisible && !store.streamingText && !store.thinkingText}
                    <div class="w-full animate-fade-in" data-export-exclude>
                      <div class="chat-content-width py-2">
                        <div class="flex items-center gap-2 text-sm text-muted-foreground">
                          <Spinner size="sm" class="text-muted-foreground" />
                          <span
                            >{t("chat_processingCommand", {
                              command: ctrl.processingSlashCmd,
                            })}</span
                          >
                        </div>
                      </div>
                    </div>
                  {/if}

                  <!-- Thinking indicator -->
                  {#if lifecycle.thinkingVisible && !store.thinkingText}
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
                              ><path
                                d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z"
                              /></svg
                            >
                          </div>
                          <span class="text-sm font-semibold text-foreground"
                            >{t("chat_claude")}</span
                          >
                          {#if lifecycle.thinkingElapsed > 0}<span
                              class="ml-auto text-[10px] tabular-nums text-muted-foreground"
                              >{lifecycle.formatElapsed(lifecycle.thinkingElapsed)}</span
                            >{/if}
                        </div>
                        <div class="pl-7">
                          {#if store.activeToolName}
                            <div class="flex items-center gap-2 text-sm text-muted-foreground">
                              <Spinner size="sm" class="text-muted-foreground" />
                              <span
                                >{t("chat_usingTool")}
                                <span class="text-foreground font-medium"
                                  >{store.activeToolName}</span
                                ></span
                              >{#if store.thinkingEndMs && store.thinkingDurationSec > 0}<span
                                  class="text-xs tabular-nums"
                                  >· thought for {store.thinkingDurationSec}s</span
                                >{/if}
                            </div>
                          {:else if handlers.approving}
                            <div class="flex items-center gap-2 text-sm text-muted-foreground">
                              <Spinner size="sm" class="text-muted-foreground" />
                              <span>{t("chat_restartingApproved")}</span>
                            </div>
                          {:else if store.phase === "spawning"}
                            <div class="flex items-center gap-2 text-sm text-muted-foreground">
                              <Spinner size="sm" class="text-muted-foreground" />
                              <span>{t("chat_startingSession")}</span>
                            </div>
                          {:else}
                            <div class="flex items-center gap-2 text-sm">
                              <span class="spinner-star">✦</span><span class="spinner-shimmer"
                                >{lifecycle.spinnerVerb}…</span
                              >{#if store.thinkingEndMs && store.thinkingDurationSec > 0}<span
                                  class="text-muted-foreground text-xs tabular-nums"
                                  >· thought for {store.thinkingDurationSec}s</span
                                >{/if}
                            </div>
                          {/if}
                        </div>
                      </div>
                    </div>
                  {/if}
                {/if}
              </div>
            {/if}
          </div>
          {#if chatScroll.showChatScrollHint}
            <button
              class="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg transition-all duration-200 hover:bg-primary/90 animate-fade-in"
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
                stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg
              >
            </button>
          {/if}
        {:else if store.run && store.run.status !== "pending"}
          <XTerminal bind:this={xtermRef} onResize={() => {}} onReady={() => {}} class="h-full" />
        {:else}
          <div class="flex h-full items-center justify-center">
            <div class="text-center max-w-md animate-slide-up">
              <img src="/light.png" alt="MiWarp" class="mx-auto mb-4 h-10 w-10 rounded-xl" />
              <h2 class="text-lg font-semibold text-primary mb-2">{t("layout_appName")}</h2>
              <p class="text-sm text-muted-foreground mb-4">
                {store.run ? t("chat_typeToStartSession") : t("chat_startSessionHint")}
              </p>
              {@render initHintCard()}
            </div>
          </div>
        {/if}

        <!-- Fork overlay -->
        {#if handlers.forkOverlay}
          <div
            class="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-fade-in"
          >
            {#if handlers.forkOverlay.error}
              <div class="flex flex-col items-center gap-4 max-w-sm text-center animate-slide-up">
                <div
                  class="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10"
                >
                  <svg
                    class="h-6 w-6 text-destructive"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path
                      d="m9 9 6 6"
                    /></svg
                  >
                </div>
                <div>
                  <h3 class="text-sm font-semibold text-foreground mb-1">{t("chat_forkFailed")}</h3>
                  <p class="text-xs text-muted-foreground">{handlers.forkOverlay.error}</p>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    class="rounded-lg border border-border bg-muted px-4 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                    onclick={handlers.handleForkCancel}>{t("common_cancel")}</button
                  >
                  <button
                    class="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                    disabled={handlers.resuming}
                    onclick={handlers.handleForkRetry}>{t("common_retry")}</button
                  >
                </div>
              </div>
            {:else}
              <div class="flex flex-col items-center gap-4 max-w-sm text-center animate-slide-up">
                <div class="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10">
                  <svg
                    class="h-6 w-6 text-blue-400 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg
                  >
                </div>
                <div>
                  <h3 class="text-sm font-semibold text-foreground mb-1">
                    {t("chat_forkingSession")}
                  </h3>
                  <p class="text-xs text-muted-foreground">{t("chat_forkingDesc")}</p>
                </div>
                {#if handlers.forkElapsed > 0}<span
                    class="text-xs tabular-nums text-muted-foreground"
                    >{lifecycle.formatElapsed(handlers.forkElapsed)}</span
                  >{/if}
                <button
                  class="rounded-lg border border-border bg-muted px-4 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                  onclick={handlers.handleForkCancel}>{t("common_cancel")}</button
                >
              </div>
            {/if}
          </div>
        {/if}

        <!-- Error card -->
        {#if store.error && !handlers.forkOverlay}
          {@const classified = classifyError(store.run?.result_subtype, store.error)}
          {@const catIcon =
            classified.category === "context_limit"
              ? "⚠"
              : classified.category === "auth_issue"
                ? "🔑"
                : classified.category === "budget_limit"
                  ? "💰"
                  : classified.category === "server_issue"
                    ? "☁"
                    : classified.category === "session_timeout"
                      ? "⏱"
                      : classified.category === "tool_issue"
                        ? "🔧"
                        : "❌"}
          <div class="absolute bottom-14 left-3 right-3 z-10">
            <div
              class="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm backdrop-blur-sm animate-fade-in"
            >
              <div class="flex items-start gap-2">
                <span class="shrink-0 text-base leading-none mt-0.5">{catIcon}</span>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <span
                      class="text-[10px] font-medium uppercase tracking-wider text-destructive/70"
                      >{t(`error_category_${classified.category}`)}</span
                    >
                  </div>
                  <p class="text-destructive text-xs leading-relaxed break-words">{store.error}</p>
                  <p class="text-destructive/60 text-[10px] mt-1">
                    {t(`error_guidance_${classified.category}`)}
                  </p>
                </div>
                <button
                  class="shrink-0 text-destructive/50 hover:text-destructive text-xs"
                  onclick={() => (store.error = "")}>{t("common_dismiss")}</button
                >
              </div>
              <div class="flex items-center gap-2 mt-2 pl-6">
                {#if classified.canRetry && store.phase === "failed" && store.run?.session_id}<button
                    class="rounded px-2.5 py-1 text-xs bg-destructive/20 hover:bg-destructive/30 text-destructive transition-colors"
                    onclick={() => handlers.handleResume("continue")}>{t("common_retry")}</button
                  >{/if}
                {#if classified.canFork && store.run?.session_id}<button
                    class="rounded px-2.5 py-1 text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 transition-colors"
                    onclick={() => handlers.handleResume("fork")}>{t("statusbar_fork")}</button
                  >{/if}
                {#if classified.settingsLink}<button
                    class="rounded px-2.5 py-1 text-xs bg-destructive/20 hover:bg-destructive/30 text-destructive transition-colors"
                    onclick={() => goto(classified.settingsLink)}>{t("chat_checkSettings")}</button
                  >{/if}
              </div>
            </div>
          </div>
        {/if}
      </div>

      <!-- Resume warning -->
      {#if canResumeNow(store.run, store.phase, lifecycle.agentSettings?.no_session_persistence ?? false) && getResumeWarning(store.run)}
        <div
          class="mx-3 mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-400"
        >
          {getResumeWarning(store.run)}
        </div>
      {/if}

      <!-- Permission panel -->
      {#if chatDerived.showPermissionPanel}
        <PermissionPanel
          pendingTools={chatDerived.pendingToolPermissions}
          onPermissionRespond={handlers.handlePermissionRespond}
        />
      {/if}

      <!-- Elicitation dialog -->
      {#if store.hasElicitation && store.sessionAlive}
        <ElicitationDialog
          elicitations={store.pendingElicitations}
          onRespond={handlers.handleElicitationRespond}
        />
      {/if}

      <!-- BTW side question -->
      {#if handlers.btwState.active}
        <div
          class="border-t border-blue-500/30 bg-blue-500/5"
          style="max-height: 40vh; overflow-y: auto;"
        >
          <div class="flex items-center justify-between px-4 py-2 border-b border-border/50">
            <span class="text-xs font-medium text-blue-400">{t("chat_btw")}</span>
            <button
              onclick={() => (handlers.btwState = { ...handlers.btwState, active: false })}
              title="Close side question"
              class="text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg
                class="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
              >
            </button>
          </div>
          <div class="px-4 py-3 space-y-2">
            <p class="text-xs text-muted-foreground">Q: {handlers.btwState.question}</p>
            <div class="text-sm">
              {#if handlers.btwState.error}<p class="text-destructive">
                  {handlers.btwState.error}
                </p>{:else if handlers.btwState.answer}<MarkdownContent
                  text={handlers.btwState.answer}
                  streaming={handlers.btwState.loading}
                />{/if}
              {#if handlers.btwState.loading}<span
                  class="inline-block w-2 h-4 bg-blue-400 animate-pulse rounded-sm"
                ></span>{/if}
            </div>
          </div>
        </div>
      {/if}

      <!-- Created Files -->
      {#if store.phase === "completed" && chatDerived.hasCreatedFiles}
        <div class="chat-content-width pb-2">
          <CreatedFiles files={chatDerived.createdFiles} onOpenFile={(path) => dbg("open", path)} />
        </div>
      {/if}

      <!-- Ralph Loop -->
      {#if store.ralphLoop?.active}
        <div class="mx-auto w-full max-w-3xl px-4 pb-2">
          <div
            class="flex items-center justify-between rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm"
          >
            <div class="flex items-center gap-2 text-blue-400">
              <span class="animate-pulse">🔄</span>
              <span class="font-medium">{t("chat_ralphLoop")}</span>
              <span class="text-blue-400/70"
                >iteration {store.ralphLoop.iteration}/{store.ralphLoop.maxIterations || "∞"}</span
              >
              {#if store.ralphLoop.completionPromise}<span class="text-blue-400/50"
                  >· promise: "{store.ralphLoop.completionPromise}"</span
                >{/if}
            </div>
            <button
              class="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
              onclick={handlers.handleRalphCancel}>Cancel</button
            >
          </div>
        </div>
      {/if}

      <!-- Input bar -->
      {#if store.sessionAlive || !store.run || store.phase === "empty" || store.phase === "ready" || TERMINAL_PHASES.includes(store.phase)}
        <div
          class="pointer-events-none sticky bottom-0 z-20 bg-gradient-to-t from-background/95 via-background/70 to-transparent px-2 pb-5 pt-4 backdrop-blur-md [mask-image:linear-gradient(to_top,black_60%,transparent)]"
        >
          <div class="pointer-events-auto">
            <PromptInput
              bind:this={promptRef}
              agent={store.agent}
              running={store.isActivelyRunning}
              disabled={chatDerived.inputBlockedByPermission}
              pendingPermission={store.hasInlinePermission}
              hasRun={!!store.run}
              sessionAlive={store.sessionAlive}
              canResume={!store.sessionAlive &&
                canResumeNow(
                  store.run,
                  store.phase,
                  lifecycle.agentSettings?.no_session_persistence ?? false,
                )}
              useStreamSession={store.useStreamSession}
              isRemote={store.isRemote}
              cliCommands={store.sessionInitReceived && store.sessionCommands.length > 0
                ? store.sessionCommands
                : mergeProjectCommands(getCliCommands(), projectCommands)}
              models={chatDerived.effectiveModels}
              currentModel={store.model}
              permissionMode={store.permissionMode}
              cwd={store.effectiveCwd ||
                folderCwdOverride ||
                localStorage.getItem(PROJECT_CWD_KEY) ||
                ""}
              onSend={ctrl.sendMessage}
              onBtwSend={handlers.handleBtwSend}
              onAgentChange={undefined}
              onInterrupt={() => store.interrupt()}
              onModelSwitch={handlers.handleModelChange}
              onPermissionModeChange={store.features.permissionModeSwitch
                ? handlers.handlePermissionModeChange
                : undefined}
              onVirtualCommand={handlers.handleVirtualCommand}
              fastModeState={store.fastModeState}
              onFastModeSwitch={handlers.handleFastModeSwitch}
              onShortcutHelp={() => (handlers.shortcutHelpOpen = !handlers.shortcutHelpOpen)}
              availableSkills={store.availableSkills}
              skillItems={chatDerived.skillItems(preloadedSkills)}
              agents={preloadedAgents.map((a) => ({ name: a.name, description: a.description }))}
              hasStash={!!handlers.stashedInput}
              userHistory={chatDerived.userHistory}
              runId={store.run?.id ?? ""}
              onRestoreStash={() => {
                if (handlers.stashedInput) {
                  promptRef?.restoreSnapshot(handlers.stashedInput);
                  handlers.stashedInput = null;
                  handlers.showChatToast(t("toast_stashRestored"));
                }
              }}
              onValueChange={team.handleInputValueChange}
              contextWindow={store.contextWindow}
            />
            {#if team.teamHintVisible}
              <div
                class="mx-2 mb-1 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs text-muted-foreground animate-in fade-in slide-in-from-bottom-1 duration-150"
              >
                <svg
                  class="h-3.5 w-3.5 shrink-0 text-primary"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle
                    cx="9"
                    cy="7"
                    r="4"
                  /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path
                    d="M16 3.13a4 4 0 0 1 0 7.75"
                  /></svg
                >
                <span>{t("teamRun_teamHint")}</span>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <!-- Tool Activity sidebar -->
    <div
      class="miwarp-shell-tier-3 relative z-0 flex h-full min-h-0 shrink-0 flex-col bg-transparent"
    >
      <ToolActivity
        timeline={store.timeline}
        tools={store.tools}
        turnUsages={store.turnUsages}
        contextHistory={contextHistoryMap.get(store.run?.id ?? "") ?? []}
        persistedFiles={store.persistedFiles}
        sessionInfo={chatDerived.currentSessionInfo}
        collapsed={lifecycle.sidebarCollapsed}
        onScrollToTool={handlers.scrollToTool}
        onScrollToTurn={(anchorId) => handlers.scrollToMessage(anchorId)}
        bind:requestedTab={handlers.sidebarRequestedTab}
        bind:activeTab={handlers.toolPanelActiveTab}
        bind:panelIndicators={handlers.toolPanelIndicators}
        backgroundTasks={store.taskNotifications}
        activeBackgroundTasks={store.activeBackgroundTasks}
        cwd={store.effectiveCwd}
        runId={store.run?.id ?? ""}
        isRemote={store.isRemote}
        worktreePath={store.run?.worktree_path}
        worktreeBranch={store.run?.worktree_branch}
        creationMode={store.run?.creation_mode}
        parentCwd={store.run?.parent_cwd}
        bind:requestedPreviewPath={handlers.requestedPreviewPath}
        bind:requestedPreviewUrl={handlers.requestedPreviewUrl}
        underUnifiedCapsule={true}
      />
    </div>
  </div>

  <RewindModal
    bind:open={handlers.rewindModalOpen}
    runId={store.run?.id ?? ""}
    candidates={rewindCandidates}
    initialCandidate={handlers.rewindDirectTarget}
    onSuccess={(info) => {
      if (info.runId !== store.run?.id) return;
      handlers.rewindMarkers = [
        ...handlers.rewindMarkers,
        {
          id: uuid(),
          ts: new Date().toISOString(),
          targetContent: truncate(info.targetContent, 80),
          filesReverted: info.filesReverted,
        },
      ];
      if (info.degraded) handlers.showChatToast(t("rewind_degradedToFull"));
      else handlers.showChatToast(t("toast_rewindSuccess"));
    }}
  />

  <ShortcutHelpPanel bind:open={handlers.shortcutHelpOpen} />

  <FolderPicker
    bind:open={lifecycle.folderPickerOpen}
    initialHost={lifecycle.folderPickerInitialHost}
    initialPath={lifecycle.folderPickerInitialPath}
    hideTargetSelector={lifecycle.folderPickerHideTarget}
    onConfirm={(result) => {
      const fn = lifecycle.getFolderPickerResolve();
      lifecycle.setFolderPickerResolve(null);
      fn?.(result);
    }}
    onCancel={() => {
      const fn = lifecycle.getFolderPickerResolve();
      lifecycle.setFolderPickerResolve(null);
      fn?.(null);
    }}
  />

  <TeamDispatchConfirm
    bind:open={team.teamDispatchOpen}
    prompt={team.teamDispatchPrompt}
    cwd={store.effectiveCwd || ""}
    onDispatch={team.handleTeamDispatch}
    onUseSingleClaude={team.handleUseSingleClaude}
    onCancel={team.handleCancelTeamDispatch}
  />

  <!-- Toast -->
  {#if handlers.chatToast}
    <div
      class="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 rounded-lg border bg-background/95 px-4 py-2 text-sm shadow-lg backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      {handlers.chatToast}
    </div>
  {/if}
</div>
