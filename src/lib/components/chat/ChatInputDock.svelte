<script lang="ts">
  import type { SessionStore } from "$lib/stores/session-store.svelte";
  import type {
    AgentSettings,
    BusToolItem,
    CliCommand,
    CliModelInfo,
    AgentDefinitionSummary,
    PermissionSuggestion,
    PromptInputSnapshot,
    AuthOverview,
  } from "$lib/types";
  import type { ProcessVisibility } from "$lib/utils/process-visibility";
  import type { ConversationInsightHandle } from "$lib/conversation-insight/use-conversation-insight.svelte";
  import { canResumeNow, getResumeWarning, TERMINAL_PHASES, getCliCommands } from "$lib/stores";
  import { mergeProjectCommands } from "$lib/utils/slash-commands";
  import { t } from "$lib/i18n/index.svelte";
  import PromptInput from "$lib/components/PromptInput.svelte";
  import CreatedFiles from "$lib/components/CreatedFiles.svelte";
  import PermissionPanel from "$lib/components/PermissionPanel.svelte";
  import ElicitationDialog from "$lib/components/ElicitationDialog.svelte";
  import ChatBtwDrawer from "$lib/components/ChatBtwDrawer.svelte";
  import ChatRalphLoopBar from "$lib/components/ChatRalphLoopBar.svelte";
  import ConversationInsightCard from "$lib/components/insight/ConversationInsightCard.svelte";
  import { dbg } from "$lib/utils/debug";

  interface BtwState {
    active: boolean;
    btwId: string | null;
    question: string;
    answer: string;
    error: string | null;
    loading: boolean;
  }

  // ── Store ──
  let {
    store,

    // Permission / Elicitation
    showPermissionPanel,
    pendingToolPermissions,
    handlePermissionRespond,
    handleElicitationRespond,

    // BTW
    btwState,
    handleBtwSend,
    setBtwState,

    // Created files
    hasCreatedFiles,
    createdFiles,

    // Insight
    insight,

    // Input
    inputBlockedByPermission,
    agentSettings,
    effectiveModels,
    skillItems,
    preloadedAgents,
    stashedInput = $bindable(null),
    userHistory,
    processVisibility,
    authOverview,
    localProxyStatuses,
    folderCwdOverride,
    teamHintVisible,
    projectCommands = [],
    settings = null,
    showAuthBadge = true,

    // Handlers
    sendMessage,
    handleModelChange,
    handlePermissionModeChange,
    handleFastModeSwitch,
    handleVirtualCommand,
    handleAuthModeChange,
    handlePlatformChange,
    handleInputValueChange,
    handleRalphCancel,
    onShortcutHelp,
    onRestoreStash,
    onInterrupt,
    onAgentChange,

    // PromptInput ref (bindable)
    promptRef = $bindable(),
  }: {
    store: SessionStore;

    // Permission / Elicitation
    showPermissionPanel: boolean;
    pendingToolPermissions: Array<{ tool: BusToolItem; requestId: string }>;
    handlePermissionRespond: (
      requestId: string,
      behavior: "allow" | "deny",
      updatedPermissions?: PermissionSuggestion[],
      updatedInput?: Record<string, unknown>,
      denyMessage?: string,
      interrupt?: boolean,
    ) => void | Promise<void>;
    handleElicitationRespond: (
      requestId: string,
      action: "accept" | "decline" | "cancel",
      content?: Record<string, unknown>,
    ) => void | Promise<void>;

    // BTW
    btwState: BtwState;
    handleBtwSend: (question: string) => void;
    setBtwState: (v: BtwState) => void;

    // Created files
    hasCreatedFiles: boolean;
    createdFiles: Array<{ path: string; name: string; tool: string; timestamp: number }>;

    // Insight
    insight: ConversationInsightHandle;

    // Input
    inputBlockedByPermission: boolean;
    agentSettings: AgentSettings | null;
    effectiveModels: CliModelInfo[];
    skillItems: Array<{ name: string; description: string }>;
    preloadedAgents: AgentDefinitionSummary[];
    stashedInput?: PromptInputSnapshot | null;
    userHistory: string[];
    processVisibility: ProcessVisibility;
    authOverview: AuthOverview | null;
    localProxyStatuses: Record<string, { running: boolean; needsAuth: boolean }>;
    folderCwdOverride: string;
    teamHintVisible: boolean;
    projectCommands?: CliCommand[];
    settings?: import("$lib/types").UserSettings | null;
    showAuthBadge?: boolean;

    // Handlers
    sendMessage: (msg: string) => void;
    handleModelChange: (model: string) => void;
    handlePermissionModeChange: (mode: string) => void;
    handleFastModeSwitch: () => void;
    handleVirtualCommand: (cmd: string) => void;
    handleAuthModeChange: (mode: string) => void;
    handlePlatformChange: (platformId: string) => void;
    handleInputValueChange: (value: string) => void;
    handleRalphCancel: () => void;
    onShortcutHelp: () => void;
    onRestoreStash: () => void;
    onInterrupt: () => void;
    onAgentChange: ((agent: string) => void) | undefined;

    // PromptInput ref
    promptRef?: import("$lib/components/PromptInput.svelte").default | undefined;
  } = $props();
</script>

<div class="chat-input-dock pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col">
  <!-- Resume warning (if applicable) -->
  {#if canResumeNow(store.run, store.phase, agentSettings?.no_session_persistence ?? false) && getResumeWarning(store.run)}
    <div
      class="pointer-events-auto mx-3 mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-400"
    >
      {getResumeWarning(store.run)}
    </div>
  {/if}

  <!-- Floating permission panel (above input bar) -->
  {#if showPermissionPanel}
    <div class="pointer-events-auto px-2 pb-2">
      <PermissionPanel
        pendingTools={pendingToolPermissions}
        onPermissionRespond={handlePermissionRespond}
      />
    </div>
  {/if}

  <!-- MCP Elicitation dialog (above input bar) -->
  {#if store.hasElicitation && store.sessionAlive}
    <div class="pointer-events-auto px-2 pb-2">
      <ElicitationDialog
        elicitations={store.pendingElicitations}
        onRespond={handleElicitationRespond}
      />
    </div>
  {/if}

  <!-- BTW side question drawer -->
  {#if btwState.active}
    <ChatBtwDrawer
      question={btwState.question}
      answer={btwState.answer}
      error={btwState.error}
      loading={btwState.loading}
      onClose={() => setBtwState({ ...btwState, active: false })}
    />
  {/if}

  <!-- Created Files Panel -->
  {#if store.phase === "completed" && hasCreatedFiles}
    <div class="chat-content-width pb-2">
      <CreatedFiles files={createdFiles} onOpenFile={(path) => dbg("open", path)} />
    </div>
  {/if}

  <!-- Insight / HTML Report Card -->
  {#if insight.insightCardOpen}
    <div class="chat-content-width pb-2">
      <ConversationInsightCard
        status={insight.insightState.status}
        report={insight.insightState.report}
        error={insight.insightState.error}
        onPreview={() => {
          insight.insightPreviewOpen = true;
        }}
        onCopy={() => void insight.copyHtml()}
        onExport={() => void insight.exportHtml()}
        onRegenerate={() => void insight.regenerate()}
      />
    </div>
  {/if}

  <!-- Input bar -->
  <!-- Ralph Loop status bar -->
  {#if store.ralphLoop?.active}
    <ChatRalphLoopBar
      iteration={store.ralphLoop.iteration}
      maxIterations={store.ralphLoop.maxIterations}
      completionPromise={store.ralphLoop.completionPromise}
      onCancel={handleRalphCancel}
    />
  {/if}

  {#if store.sessionAlive || !store.run || store.phase === "empty" || store.phase === "ready" || TERMINAL_PHASES.includes(store.phase)}
    <div
      class="pointer-events-auto relative z-10 px-2 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-1"
    >
      <div class="pointer-events-auto">
        <PromptInput
          bind:this={promptRef}
          agent={store.agent}
          running={store.isActivelyRunning}
          disabled={inputBlockedByPermission}
          pendingPermission={store.hasInlinePermission}
          hasRun={!!store.run}
          sessionAlive={store.sessionAlive}
          canResume={!store.sessionAlive &&
            canResumeNow(store.run, store.phase, agentSettings?.no_session_persistence ?? false)}
          useStreamSession={store.useStreamSession}
          isRemote={store.isRemote}
          cliCommands={store.sessionInitReceived && store.sessionCommands.length > 0
            ? store.sessionCommands
            : mergeProjectCommands(getCliCommands(), projectCommands)}
          models={effectiveModels}
          currentModel={store.model}
          permissionMode={store.permissionMode}
          cwd={store.effectiveCwd ||
            folderCwdOverride ||
            localStorage.getItem("ocv:project-cwd") ||
            ""}
          authMode={store.authMode}
          platformId={store.platformId ?? "anthropic"}
          platformCredentials={settings?.platform_credentials ?? []}
          onSend={sendMessage}
          onBtwSend={handleBtwSend}
          {onAgentChange}
          {onInterrupt}
          onModelSwitch={handleModelChange}
          onPermissionModeChange={store.features.permissionModeSwitch
            ? handlePermissionModeChange
            : undefined}
          onVirtualCommand={handleVirtualCommand}
          fastModeState={store.fastModeState}
          onFastModeSwitch={handleFastModeSwitch}
          onPlatformChange={handlePlatformChange}
          {authOverview}
          authSourceLabel={store.authSourceLabel}
          authSourceCategory={store.authSourceCategory}
          apiKeySource={store.apiKeySource}
          onAuthModeChange={handleAuthModeChange}
          {localProxyStatuses}
          {showAuthBadge}
          {onShortcutHelp}
          availableSkills={store.availableSkills}
          {skillItems}
          agents={preloadedAgents.map((a) => ({ name: a.name, description: a.description }))}
          hasStash={!!stashedInput}
          {userHistory}
          runId={store.run?.id ?? ""}
          {onRestoreStash}
          onValueChange={handleInputValueChange}
          contextWindow={store.contextWindow}
          {processVisibility}
        />
        {#if teamHintVisible}
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
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>{t("teamRun_teamHint")}</span>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
