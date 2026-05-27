<script lang="ts">
  import type { SessionStore } from "$lib/stores/session-store.svelte";
  import type { UserSettings, PromptInputSnapshot } from "$lib/types";
  import type { InputVm, PermissionVm, SidePanelsVm, InputDockHandlers } from "./input-dock-types";
  import { canResumeNow, getResumeWarning, TERMINAL_PHASES, getCliCommands } from "$lib/stores";
  import { mergeProjectCommands } from "$lib/utils/slash-commands";
  import { dbg } from "$lib/utils/debug";
  import { t as tFn } from "$lib/i18n/index.svelte";
  import ElicitationDialog from "$lib/components/ElicitationDialog.svelte";
  import CreatedFiles from "$lib/components/CreatedFiles.svelte";
  import ConversationInsightCard from "$lib/components/insight/ConversationInsightCard.svelte";
  import ChatBtwDrawer from "$lib/components/ChatBtwDrawer.svelte";
  import ChatRalphLoopBar from "$lib/components/ChatRalphLoopBar.svelte";
  import PromptInput from "$lib/components/PromptInput.svelte";
  import Icon from "$lib/components/Icon.svelte";

  const t = tFn;

  let {
    store,
    settings,
    // Grouped view models
    inputVm,
    permissionVm,
    sidePanelsVm,
    handlers,
    // Bindable state (not groupable into VMs)
    stashedInput = $bindable(null),
    shortcutHelpOpen = $bindable(false),
    promptRef = $bindable<PromptInput | undefined>(),
  }: {
    store: SessionStore;
    settings: UserSettings | null;
    inputVm: InputVm;
    permissionVm: PermissionVm;
    sidePanelsVm: SidePanelsVm;
    handlers: InputDockHandlers;
    stashedInput?: PromptInputSnapshot | null;
    shortcutHelpOpen?: boolean;
    promptRef?: PromptInput;
  } = $props();

  // Destructure VMs so template references stay flat (no behavior change).
  const {
    processVisibility,
    agentSettings,
    effectiveModels,
    folderCwdOverride,
    welcomeVisible,
    skillItems,
    preloadedAgents,
    teamHintVisible,
    userHistory,
    projectCommands,
    authOverview,
    localProxyStatuses,
  } = $derived(inputVm);

  const { inputBlockedByPermission } = $derived(permissionVm);

  const { btwState, insight, hasCreatedFiles, createdFiles, setBtwState } = $derived(sidePanelsVm);

  const {
    sendMessage,
    handleModelChange,
    handlePermissionModeChange,
    handleVirtualCommand,
    handleFastModeSwitch,
    handlePlatformChange,
    handleAuthModeChange,
    handleInputValueChange,
    handleElicitationRespond,
    handleBtwSend,
    handleRalphCancel,
    showChatToast,
  } = $derived(handlers);
</script>

<div class="chat-input-dock pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col">
  {#if canResumeNow(store.run, store.phase, agentSettings?.no_session_persistence ?? false) && getResumeWarning(store.run)}
    <div
      class="pointer-events-auto mx-3 mb-2 rounded-lg border border-[hsl(var(--miwarp-status-warning)/0.3)] bg-[hsl(var(--miwarp-status-warning)/0.1)] px-4 py-2 text-xs text-[hsl(var(--miwarp-status-warning))]"
    >
      {getResumeWarning(store.run)}
    </div>
  {/if}

  {#if store.hasElicitation && store.sessionAlive}
    <div class="pointer-events-auto px-2 pb-2">
      <ElicitationDialog
        elicitations={store.pendingElicitations}
        onRespond={handleElicitationRespond}
      />
    </div>
  {/if}

  {#if btwState.active}
    <ChatBtwDrawer
      question={btwState.question}
      answer={btwState.answer}
      error={btwState.error}
      loading={btwState.loading}
      onClose={() => setBtwState({ ...btwState, active: false })}
    />
  {/if}

  {#if store.phase === "completed" && hasCreatedFiles}
    <div class="chat-content-width pb-2">
      <CreatedFiles files={createdFiles} onOpenFile={(path) => dbg("open", path)} />
    </div>
  {/if}

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
          onAgentChange={undefined}
          onInterrupt={() => store.interrupt()}
          onModelSwitch={handleModelChange}
          onPermissionModeChange={handlePermissionModeChange}
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
          showAuthBadge={!welcomeVisible}
          onShortcutHelp={() => (shortcutHelpOpen = !shortcutHelpOpen)}
          availableSkills={store.availableSkills}
          {skillItems}
          agents={preloadedAgents.map((a) => ({ name: a.name, description: a.description }))}
          hasStash={!!stashedInput}
          {userHistory}
          runId={store.run?.id ?? ""}
          onRestoreStash={() => {
            if (stashedInput) {
              promptRef?.restoreSnapshot(stashedInput);
              stashedInput = null;
              showChatToast(t("toast_stashRestored"));
              dbg("chat", "stash restored via badge click");
            }
          }}
          onValueChange={handleInputValueChange}
          contextWindow={store.contextWindow}
          {processVisibility}
        />
        {#if teamHintVisible}
          <div
            class="mx-2 mb-1 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs text-muted-foreground animate-in fade-in slide-in-from-bottom-1 duration-150"
          >
            <Icon name="users" size="sm" class="shrink-0 text-primary" />
            <span>{t("teamRun_teamHint")}</span>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
