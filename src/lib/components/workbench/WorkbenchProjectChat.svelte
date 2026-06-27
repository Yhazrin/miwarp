<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount, tick } from "svelte";
  import * as api from "$lib/api";
  import { runProjectCwd, workbenchStore } from "$lib/workbench/workbench-store.svelte";
  import {
    sessionStore,
    getEventMiddleware,
    getCliCommands,
    getCliModels,
    loadCliInfo,
  } from "$lib/stores";
  import type { Attachment, UserSettings } from "$lib/types";
  import { t } from "$lib/i18n/index.svelte";
  import {
    EVT_CWD_CHANGED,
    EVT_RUNS_CHANGED,
    EVT_WORKBENCH_STAGE_PROMPT,
  } from "$lib/utils/bus-events";
  import { LS_PROJECT_CWD } from "$lib/utils/storage-keys";
  import { deriveAutoName } from "$lib/utils/auto-name";
  import { relativeTime, truncate } from "$lib/utils/format";
  import { createPermissionHandlers } from "$lib/chat/use-permission-handlers";
  import { createToolResultCache } from "$lib/chat/use-tool-result-cache";
  import Icon from "$lib/components/Icon.svelte";
  import PromptInput from "$lib/components/PromptInput.svelte";
  import ConversationTimeline from "$lib/components/chat/ConversationTimeline.svelte";
  import type { LucideIconName } from "$lib/lucide-icon";

  type QuickAction = {
    icon: LucideIconName;
    label: string;
    prompt: string;
  };

  type BriefingAction = QuickAction & {
    value: string;
    tone: "default" | "attention" | "active";
  };

  type DeskMode = QuickAction & {
    description: string;
  };

  let settings = $state<UserSettings | null>(null);
  let promptRef = $state<PromptInput | undefined>();
  let streamRef = $state<HTMLDivElement | undefined>();
  let sendBusy = $state(false);
  let bootingRunId = $state("");
  let approving = $state(false);

  const store = sessionStore;
  const toolResultCache = createToolResultCache(() => store.run?.id);

  const project = $derived(workbenchStore.selectedProject);
  const projectId = $derived(workbenchStore.selectedProjectId);
  const activeRunId = $derived(workbenchStore.selectedActiveRunId);
  const ownsCurrentRun = $derived(!!activeRunId && store.run?.id === activeRunId);
  const timeline = $derived(ownsCurrentRun ? store.timeline : []);
  const effectiveModels = $derived(getCliModels(store.agent));
  const projectRuns = $derived(
    project ? workbenchStore.allRuns.filter((run) => runProjectCwd(run) === project.cwd) : [],
  );
  const activeProjectRuns = $derived(
    projectRuns.filter(
      (run) =>
        run.status === "running" ||
        run.status === "pending" ||
        run.status === "waiting_input" ||
        run.status === "waiting_approval",
    ),
  );
  const attentionProjectRuns = $derived(
    projectRuns.filter(
      (run) => run.status === "waiting_input" || run.status === "waiting_approval",
    ),
  );
  const projectDeskRunCount = $derived(
    projectRuns.filter((run) => run.run_surface === "project_desk").length,
  );
  const latestProjectActivity = $derived.by(() => {
    const latest = projectRuns
      .map((run) => run.last_activity_at ?? run.ended_at ?? run.started_at)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
    return latest ? relativeTime(latest) : t("workbench_noProjectActivity");
  });
  const cliCommands = $derived(
    store.sessionInitReceived && store.sessionCommands.length > 0
      ? store.sessionCommands
      : getCliCommands(store.agent),
  );
  const timelineIdIndex = $derived.by(() => {
    const index = new Map<string, number>();
    timeline.forEach((entry, i) => index.set(entry.id, i));
    return index;
  });
  const lastToolId = $derived.by(() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const entry = timeline[i];
      if (entry.kind === "tool") return entry.tool.tool_use_id;
    }
    return "";
  });
  const quickActions: QuickAction[] = $derived(
    project
      ? [
          {
            icon: "target",
            label: t("workbench_quickCatchUp"),
            prompt: t("workbench_quickCatchUpPrompt", { project: project.label }),
          },
          {
            icon: "clipboard-list",
            label: t("workbench_quickPlan"),
            prompt: t("workbench_quickPlanPrompt", { project: project.label }),
          },
          {
            icon: "shield",
            label: t("workbench_quickAudit"),
            prompt: t("workbench_quickAuditPrompt", { project: project.label }),
          },
        ]
      : [],
  );
  const briefingActions: BriefingAction[] = $derived(
    project
      ? [
          {
            icon: "triangle-alert",
            label: t("workbench_briefingNeedsYou"),
            value: String(attentionProjectRuns.length),
            prompt: t("workbench_briefingNeedsYouPrompt", { project: project.label }),
            tone: attentionProjectRuns.length > 0 ? "attention" : "default",
          },
          {
            icon: "radio",
            label: t("workbench_briefingActive"),
            value: String(activeProjectRuns.length),
            prompt: t("workbench_briefingActivePrompt", { project: project.label }),
            tone: activeProjectRuns.length > 0 ? "active" : "default",
          },
          {
            icon: "layout",
            label: t("workbench_briefingDeskRuns"),
            value: String(projectDeskRunCount),
            prompt: t("workbench_briefingDeskRunsPrompt", { project: project.label }),
            tone: "default",
          },
          {
            icon: "clock",
            label: t("workbench_briefingLastSignal"),
            value: latestProjectActivity,
            prompt: t("workbench_quickCatchUpPrompt", { project: project.label }),
            tone: "default",
          },
        ]
      : [],
  );
  const deskModes: DeskMode[] = $derived(
    project
      ? [
          {
            icon: "folder-open",
            label: t("workbench_modeOrient"),
            description: t("workbench_modeOrientDescription"),
            prompt: t("workbench_modeOrientPrompt", { project: project.label }),
          },
          {
            icon: "zap",
            label: t("workbench_modeExecute"),
            description: t("workbench_modeExecuteDescription"),
            prompt: t("workbench_modeExecutePrompt", { project: project.label }),
          },
          {
            icon: "users",
            label: t("workbench_modeDelegate"),
            description: t("workbench_modeDelegateDescription"),
            prompt: t("workbench_modeDelegatePrompt", { project: project.label }),
          },
          {
            icon: "check-square",
            label: t("workbench_modeVerify"),
            description: t("workbench_modeVerifyDescription"),
            prompt: t("workbench_modeVerifyPrompt", { project: project.label }),
          },
        ]
      : [],
  );

  onMount(() => {
    const handleStagePrompt = (event: Event) => {
      const prompt = (event as CustomEvent<{ prompt?: string }>).detail?.prompt?.trim();
      if (prompt) fillPrompt(prompt);
    };

    void hydrateSettings();
    void loadCliInfo(false, store.agent);
    window.addEventListener(EVT_WORKBENCH_STAGE_PROMPT, handleStagePrompt);

    return () => {
      window.removeEventListener(EVT_WORKBENCH_STAGE_PROMPT, handleStagePrompt);
    };
  });

  const {
    handleToolApprove,
    handlePermissionRespond,
    getPlanContentForExitPlan,
    handleExitPlanClearContext,
    handleExitPlanBypass,
    permissionCoordinator,
  } = createPermissionHandlers({
    store,
    get timelineIdIndex() {
      return timelineIdIndex;
    },
    setApproving: (value) => {
      approving = value;
    },
    goto,
    tick,
  });

  $effect(() => {
    if (!activeRunId || store.run?.id === activeRunId || bootingRunId === activeRunId) return;
    bootingRunId = activeRunId;
    void store
      .loadRun(activeRunId)
      .then(() => {
        getEventMiddleware().subscribeCurrent(activeRunId, store);
        reconcilePermissionRun(activeRunId);
      })
      .finally(() => {
        if (bootingRunId === activeRunId) bootingRunId = "";
      });
  });

  $effect(() => {
    const id = activeRunId;
    if (!id || store.run?.id !== id) return;
    reconcilePermissionRun(id);
  });

  $effect(() => {
    const _runId = store.run?.id;
    toolResultCache.clearCache();
  });

  $effect(() => {
    const _length = timeline.length;
    void tick().then(() => {
      if (!streamRef) return;
      streamRef.scrollTop = streamRef.scrollHeight;
    });
  });

  async function hydrateSettings(): Promise<void> {
    try {
      const next = await api.getUserSettings();
      settings = next;
      if (next.default_agent && !store.run) store.agent = next.default_agent;
      if (next.default_model && !store.run) store.model = next.default_model;
      if (next.active_platform_id && !store.run) store.platformId = next.active_platform_id;
      await loadCliInfo(false, store.agent);
    } catch {
      // The input still works with store defaults; settings only enrich controls.
    }
  }

  function persistProjectCwd(cwd: string): void {
    try {
      localStorage.setItem(LS_PROJECT_CWD, cwd);
    } catch {
      // Browser privacy settings can reject localStorage writes.
    }
    window.dispatchEvent(new Event(EVT_CWD_CHANGED));
  }

  async function sendProjectMessage(text: string, attachments: Attachment[]): Promise<void> {
    const currentProject = project;
    if (!currentProject || sendBusy) return;
    const prompt = text.trim();
    if (!prompt) return;

    sendBusy = true;
    try {
      persistProjectCwd(currentProject.cwd);
      if (ownsCurrentRun && store.run) {
        await store.sendMessage(prompt, attachments);
      } else {
        const runId = await store.startSession(
          prompt,
          currentProject.cwd,
          attachments,
          undefined,
          undefined,
          undefined,
          "project_desk",
        );
        workbenchStore.setActiveRun(currentProject.id, runId);
        reconcilePermissionRun(runId);
        await nameWorkbenchRun(runId, currentProject.label, prompt);
        window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
        void workbenchStore.refresh();
      }
    } finally {
      sendBusy = false;
      requestAnimationFrame(() => promptRef?.focus());
    }
  }

  async function nameWorkbenchRun(
    runId: string,
    projectLabel: string,
    prompt: string,
  ): Promise<void> {
    const promptTitle = truncate(deriveAutoName(prompt) || prompt, 40);
    const name = t("workbench_sessionName", { project: projectLabel, prompt: promptTitle });
    try {
      await api.renameRun(runId, name);
      if (store.run?.id === runId) {
        store.run = { ...store.run, name };
      }
    } catch {
      // Naming is helpful for history, but the session itself is already live.
    }
  }

  function fillPrompt(value: string): void {
    promptRef?.setValue(value);
  }

  function openActiveRun(): void {
    const runId = activeRunId || store.run?.id || "";
    if (runId) {
      void goto(`/chat?run=${encodeURIComponent(runId)}`);
      return;
    }
    if (project?.cwd) {
      void goto(`/chat?new=1&folder=${encodeURIComponent(project.cwd)}`);
    }
  }

  function reconcilePermissionRun(runId: string): void {
    if (permissionCoordinator.lastActiveRunId === runId) return;
    permissionCoordinator.reconcileActiveRun(runId);
    permissionCoordinator.bumpGeneration();
    permissionCoordinator.lastActiveRunId = runId;
  }

  async function handleToolAnswer(toolUseId: string, answer: string): Promise<void> {
    await store.answerToolQuestion(toolUseId, answer);
  }

  function openPreviewInFullChat(_path: string): void {
    openActiveRun();
  }
</script>

<div class="project-desk-chat relative flex min-h-0 flex-1 flex-col">
  <!--
    工作台顶部黄色审批条：仅在 store.hasInlinePermission 时显示。
    这是显眼的“全局警示”，位于 timeline 之上，提醒用户整个项目在等他们。
    点按钮会跳到 timeline 里 pendingTool 的位置（如果已经在 timeline 中）；
    否则通过 EVT_WORKBENCH_STAGE_PROMPT 让 PromptInput 准备好焦点。
  -->
  {#if store.hasInlinePermission}
    <div
      class="shrink-0 border-b border-[hsl(var(--miwarp-status-warning)/0.32)] bg-[hsl(var(--miwarp-status-warning)/0.1)] px-4 py-2"
      role="status"
    >
      <div class="flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <Icon name="triangle-alert" size="sm" class="shrink-0 text-miwarp-status-warning" />
          <div class="min-w-0">
            <p class="truncate text-xs font-semibold text-foreground">
              {t("workbench_approvalBarTitle")}
            </p>
            <p class="truncate text-[11px] text-muted-foreground">
              {t("workbench_approvalBarHint")}
            </p>
          </div>
        </div>
        <button
          type="button"
          class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-[hsl(var(--miwarp-status-warning)/0.4)] bg-background/80 px-2.5 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-background"
          onclick={() => promptRef?.focus()}
        >
          <Icon name="target" size="xs" />
          {t("workbench_focusPending")}
        </button>
      </div>
    </div>
  {/if}
  <div bind:this={streamRef} class="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-40">
    {#if !ownsCurrentRun && timeline.length === 0}
      <div
        class="mx-auto flex h-full max-w-3xl flex-col justify-center gap-5 px-2 text-center sm:text-left"
      >
        <div class="space-y-2">
          <p class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t("workbench_projectChat")}
          </p>
          <h2 class="text-2xl font-semibold tracking-normal text-foreground">
            {t("workbench_projectDeskHeadline")}
          </h2>
          <p class="max-w-2xl text-sm leading-6 text-muted-foreground">
            {t("workbench_projectDeskDescription")}
          </p>
        </div>
        <div class="grid gap-2 sm:grid-cols-4">
          {#each briefingActions as item (item.label)}
            <button
              type="button"
              class="group rounded-2xl border px-3 py-2.5 text-left transition-colors {item.tone ===
              'attention'
                ? 'border-[hsl(var(--miwarp-status-warning)/0.32)] bg-[hsl(var(--miwarp-status-warning)/0.08)] hover:bg-[hsl(var(--miwarp-status-warning)/0.12)]'
                : item.tone === 'active'
                  ? 'border-[hsl(var(--miwarp-status-info)/0.28)] bg-[hsl(var(--miwarp-status-info)/0.07)] hover:bg-[hsl(var(--miwarp-status-info)/0.11)]'
                  : 'border-border/45 bg-background/45 hover:border-primary/30 hover:bg-primary/5'}"
              onclick={() => fillPrompt(item.prompt)}
            >
              <div class="mb-2 flex items-center justify-between gap-2">
                <Icon name={item.icon} size="sm" class="text-muted-foreground" />
                <span class="truncate text-[10px] font-medium text-muted-foreground">
                  {item.label}
                </span>
              </div>
              <p class="truncate text-lg font-semibold tracking-normal text-foreground">
                {item.value}
              </p>
            </button>
          {/each}
        </div>
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-xs font-semibold text-foreground">{t("workbench_deskModes")}</h3>
            <span class="text-[10px] text-muted-foreground">{t("workbench_deskModesHint")}</span>
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            {#each deskModes as mode (mode.label)}
              <button
                type="button"
                class="group flex min-h-[74px] items-start gap-3 rounded-2xl border border-border/45 bg-background/45 px-3 py-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
                onclick={() => fillPrompt(mode.prompt)}
              >
                <span
                  class="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/45 bg-card/60 text-muted-foreground transition-colors group-hover:border-primary/30 group-hover:text-primary"
                >
                  <Icon name={mode.icon} size="sm" />
                </span>
                <span class="min-w-0">
                  <span class="block text-sm font-semibold text-foreground">{mode.label}</span>
                  <span class="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                    {mode.description}
                  </span>
                </span>
              </button>
            {/each}
          </div>
        </div>
        {#if workbenchStore.selectedSessions.length > 0}
          <div class="grid gap-2 sm:grid-cols-2">
            {#each workbenchStore.selectedSessions.slice(0, 4) as session (session.id)}
              <button
                type="button"
                class="rounded-2xl border border-border/45 bg-background/45 px-3 py-2 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
                onclick={() => {
                  workbenchStore.setActiveRun(projectId, session.id);
                }}
              >
                <div class="flex items-center justify-between gap-2">
                  <p class="truncate text-xs font-medium text-foreground">{session.title}</p>
                  <span
                    class="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium {session.surface ===
                    'project_desk'
                      ? 'border-primary/25 bg-primary/10 text-primary'
                      : 'border-border/40 bg-muted/35 text-muted-foreground'}"
                  >
                    {session.surface === "project_desk"
                      ? t("workbench_projectDeskSession")
                      : t("workbench_chatSession")}
                  </span>
                </div>
                <p class="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                  {session.preview || session.status}
                </p>
              </button>
            {/each}
          </div>
        {/if}
        <div class="flex flex-wrap gap-2">
          {#each quickActions as action}
            <button
              type="button"
              class="inline-flex h-9 items-center gap-2 rounded-full border border-border/45 bg-background/50 px-3 text-xs font-medium text-foreground transition-colors hover:border-primary/35 hover:bg-primary/5"
              onclick={() => fillPrompt(action.prompt)}
            >
              <Icon name={action.icon} size="sm" class="text-muted-foreground" />
              {action.label}
            </button>
          {/each}
        </div>
        {#if workbenchStore.selectedActiveRunId}
          {@const lastRun = workbenchStore.allRuns.find(
            (run) => run.id === workbenchStore.selectedActiveRunId,
          )}
          {#if lastRun && lastRun.run_surface === "project_desk"}
            <button
              type="button"
              class="mt-1 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 px-4 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-primary/15"
              onclick={() => {
                workbenchStore.setActiveRun(projectId, lastRun.id);
                promptRef?.focus();
              }}
            >
              <Icon name="message-square" size="sm" />
              {t("workbench_continueLastSession")}
              <span class="ml-auto text-[10px] font-normal text-primary/70">
                {relativeTime(lastRun.last_activity_at || lastRun.started_at)}
              </span>
            </button>
          {/if}
        {/if}
      </div>
    {:else}
      <div class="mx-auto w-full max-w-4xl">
        <ConversationTimeline
          {timeline}
          agent={store.agent}
          model={store.run?.model ?? store.model}
          platformId={store.platformId ?? undefined}
          animated={store.isRunning}
          debugRunId={store.run?.id}
          debugSessionId={store.run?.session_id ?? undefined}
          {lastToolId}
          processVisibility="developer"
          {permissionCoordinator}
          permissionMode={store.permissionMode}
          {toolResultCache}
          onApprove={handleToolApprove}
          onPermissionRespond={handlePermissionRespond}
          onExitPlanClearContext={() => handleExitPlanClearContext()}
          onExitPlanBypass={handleExitPlanBypass}
          onToolAnswer={handleToolAnswer}
          getPlanContentForExitPlan={(entryId) => getPlanContentForExitPlan(entryId) ?? undefined}
          taskNotifications={store.taskNotifications}
          showPermissionInPanel={false}
          onPreviewFile={openPreviewInFullChat}
        />
        {#if store.isActivelyRunning && timeline.length === 0}
          <div
            class="mx-auto mt-10 inline-flex items-center gap-2 rounded-full border border-border/50 bg-background/60 px-3 py-2 text-xs text-muted-foreground"
          >
            <Icon name="loader-2" size="sm" class="animate-spin" />
            {t("workbench_dispatching")}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="pointer-events-none absolute inset-x-0 bottom-0 z-20">
    {#if activeRunId}
      <div class="pointer-events-auto mx-auto mb-2 flex w-full max-w-3xl justify-end px-4">
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/50 bg-background/70 px-3 text-xs text-muted-foreground shadow-sm backdrop-blur-xl transition-colors hover:bg-muted/70 hover:text-foreground"
          onclick={openActiveRun}
        >
          <Icon name="external-link" size="sm" />
          {t("workbench_openActiveRun")}
        </button>
      </div>
    {/if}
    <div class="pointer-events-auto px-2 pb-4">
      <PromptInput
        bind:this={promptRef}
        agent={store.agent}
        running={store.isActivelyRunning}
        disabled={!project || sendBusy || approving}
        busy={sendBusy || approving}
        pendingPermission={store.hasInlinePermission}
        hasRun={ownsCurrentRun}
        sessionAlive={ownsCurrentRun && store.sessionAlive}
        canResume={false}
        useStreamSession={store.useStreamSession}
        isRemote={false}
        {cliCommands}
        models={effectiveModels}
        currentModel={store.model}
        permissionMode={store.permissionMode}
        cwd={project?.cwd ?? ""}
        authMode={store.authMode}
        platformId={store.platformId ?? "anthropic"}
        platformCredentials={settings?.platform_credentials ?? []}
        onSend={sendProjectMessage}
        placeholder={t("workbench_projectChatPlaceholder")}
        onBtwSend={undefined}
        onAgentChange={undefined}
        onInterrupt={() => store.interrupt()}
        onModelSwitch={(model) => (store.model = model)}
        onPermissionModeChange={(mode) => (store.permissionMode = mode)}
        onVirtualCommand={async () => undefined}
        fastModeState={store.fastModeState}
        onFastModeSwitch={async (mode) => {
          store.fastModeState = mode;
        }}
        onPlatformChange={(id) => (store.platformId = id)}
        authOverview={null}
        authSourceLabel={store.authSourceLabel}
        authSourceCategory={store.authSourceCategory}
        apiKeySource={store.apiKeySource}
        onAuthModeChange={(mode) => (store.authMode = mode)}
        localProxyStatuses={{}}
        showAuthBadge={true}
        onShortcutHelp={undefined}
        availableSkills={store.availableSkills}
        skillItems={[]}
        agents={[]}
        hasStash={false}
        userHistory={[]}
        runId={store.run?.id ?? ""}
        onRestoreStash={undefined}
        onValueChange={undefined}
        contextWindow={store.contextWindow}
        processVisibility="developer"
      />
    </div>
  </div>
</div>
