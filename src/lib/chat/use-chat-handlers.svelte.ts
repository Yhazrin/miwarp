/**
 * Composable: chat page handler functions.
 *
 * Extracted from +page.svelte to reduce component size. Owns handler-level
 * state (fork overlay, toast, rewind modal, tool panel, drag-drop, etc.)
 * and exposes all handler functions + owned reactive state to the page.
 */
import { goto } from "$app/navigation";
import { tick, onMount } from "svelte";
import { getTransport } from "$lib/transport";
import * as api from "$lib/api";
import { getEventMiddleware, getCliCurrentModel, getCliCommands } from "$lib/stores";
import type { SessionStore } from "$lib/stores";
import type {
  Attachment,
  UserSettings,
  AgentSettings,
  SessionMode,
  RemoteHost,
  AuthOverview,
  TaskRun,
  TimelineEntry,
  PermissionSuggestion,
  BtwDelta,
  BtwComplete,
  BtwError,
  ContextSnapshot,
  PromptInputSnapshot,
} from "$lib/types";
import { PLATFORM_PRESETS, findCredential } from "$lib/utils/platform-presets";
import { isPlanFilePath, planFileName, extractPlanContent } from "$lib/utils/tool-rendering";
import { t } from "$lib/i18n/index.svelte";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { shouldAutoName } from "$lib/utils/auto-name";
import { resolvePermissionOptimistic } from "$lib/utils/resolve-permission";
import { createHandleVirtualCommand } from "$lib/chat/virtual-commands";
import { PROJECT_CWD_KEY, RUNS_CHANGED_KEY } from "$lib/utils/storage-keys";
import type { RewindCandidate, RewindMarker } from "$lib/utils/rewind";
import { mapSettled } from "$lib/utils/async-utils";
import { uuid } from "$lib/utils/uuid";
import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
import type { useProgressiveTimeline } from "$lib/chat/use-progressive-timeline.svelte";
import type { useChatScroll } from "$lib/chat/use-chat-scroll.svelte";
import type { useTeamDispatch } from "$lib/chat/use-team-dispatch.svelte";
import type { useProjectPreload } from "$lib/chat/use-project-preload.svelte";
import type { useChatController } from "$lib/chat/use-chat-controller.svelte";
import type PromptInput from "$lib/components/PromptInput.svelte";
import type XTerminal from "$lib/components/XTerminal.svelte";
import type SessionStatusBar from "$lib/components/SessionStatusBar.svelte";

// ── Permission mode name translation ──
// Store/dropdown use CLI names; UserSettings uses app names; adapter.rs maps app→CLI.
const CLI_TO_APP_MODE: Record<string, string> = {
  default: "ask",
  acceptEdits: "auto_read",
  bypassPermissions: "auto_all",
  plan: "plan",
  auto: "auto",
  dontAsk: "dont_ask",
};
const APP_TO_CLI_MODE: Record<string, string> = {
  ask: "default",
  auto_read: "acceptEdits",
  auto_all: "bypassPermissions",
  plan: "plan",
  auto: "auto",
  dont_ask: "dontAsk",
};

function getPermModeLabel(mode: string): string {
  const map: Record<string, () => string> = {
    default: () => t("prompt_permAskShort"),
    acceptEdits: () => t("prompt_permAutoReadShort"),
    bypassPermissions: () => t("prompt_permAutoAllShort"),
    plan: () => t("prompt_permPlanShort"),
    auto: () => t("prompt_permAutoShort"),
    dontAsk: () => t("prompt_permDontAskShort"),
  };
  return map[mode]?.() ?? mode;
}

export interface UseChatHandlersOptions {
  store: SessionStore;
  progressive: ReturnType<typeof useProgressiveTimeline>;
  preload: ReturnType<typeof useProjectPreload>;
  chatScroll: ReturnType<typeof useChatScroll>;
  team: ReturnType<typeof useTeamDispatch>;
  ctrl: ReturnType<typeof useChatController>;
  // Refs
  promptRef: () => PromptInput | undefined;
  xtermRef: () => XTerminal | undefined;
  statusBarRef: () => SessionStatusBar | undefined;
  chatAreaRef: () => HTMLDivElement | undefined;
  // State getters
  getSettings: () => UserSettings | null;
  getAgentSettings: () => AgentSettings | null;
  getRemoteHosts: () => RemoteHost[];
  getAuthOverview: () => AuthOverview | null;
  getCurrentEffort: () => string;
  setCurrentEffort: (v: string) => void;
  getVerboseEnabled: () => boolean;
  setVerboseEnabled: (v: boolean) => void;
  getToolFilter: () => string | null;
  setToolFilter: (v: string | null) => void;
  getFilteredTimeline: () => TimelineEntry[];
  getVisibleTimeline: () => TimelineEntry[];
  getSidebarCollapsed: () => boolean;
  setSidebarCollapsed: (v: boolean) => void;
  getFolderCwdOverride: () => string;
  setFolderCwdOverride: (v: string) => void;
  // From page
  reloadProjectData: (cwd: string) => void;
  openFolderPicker: (opts: any) => Promise<any>;
  openPreviewForPath: (path: string) => void;
  // Context relay
  contextHistoryMap: Map<string, ContextSnapshot[]>;
  localProxyStatuses: Record<string, { running: boolean; needsAuth: boolean }>;
  setLocalProxyStatuses: (v: Record<string, { running: boolean; needsAuth: boolean }>) => void;
  authOverview: AuthOverview | null;
  setAuthOverview: (v: AuthOverview | null) => void;
  // Page-owned state setters (for handlers that modify page state)
  setLastContinuableRun: (v: TaskRun | null) => void;
  // Rewind candidates (derived)
  getRewindCandidates: () => RewindCandidate[];
}

export function useChatHandlers(opts: UseChatHandlersOptions) {
  const {
    store,
    progressive,
    preload,
    ctrl,
    promptRef,
    chatAreaRef,
    getSettings,
    setCurrentEffort,
    getVerboseEnabled: _getVerboseEnabled,
    setVerboseEnabled,
    getToolFilter,
    setToolFilter,
    getFilteredTimeline,
    getVisibleTimeline,
    getSidebarCollapsed,
    setSidebarCollapsed,
    setFolderCwdOverride: _setFolderCwdOverride,
    openFolderPicker: _openFolderPicker,
    setLocalProxyStatuses,
    setAuthOverview,
    setLastContinuableRun,
    getRewindCandidates: _getRewindCandidates,
  } = opts;

  const { projectCommands } = preload;

  // ── Owned state ──

  // Fork overlay
  let forkOverlay = $state<{
    active: boolean;
    sourceRunId: string;
    startedAt: number;
    error: string | null;
  } | null>(null);
  let forkElapsed = $state(0);

  // BTW side question
  let btwState = $state<{
    active: boolean;
    btwId: string | null;
    question: string;
    answer: string;
    error: string | null;
    loading: boolean;
  }>({ active: false, btwId: null, question: "", answer: "", error: null, loading: false });

  // Toast
  let chatToast = $state<string | null>(null);
  let chatToastTimeout: ReturnType<typeof setTimeout> | null = null;

  // Rewind
  let rewindModalOpen = $state(false);
  let rewindDirectTarget = $state<RewindCandidate | null>(null);
  let rewindMarkers = $state<RewindMarker[]>([]);

  // Tool panel
  let sidebarRequestedTab = $state<ToolActivityPanelTab | null>(null);
  let toolPanelActiveTab = $state<ToolActivityPanelTab>("workspace");
  let toolPanelIndicators = $state({ context: false, files: false, tasks: false });
  let requestedPreviewPath = $state<string | null>(null);
  let requestedPreviewUrl = $state<string | null>(null);
  let shortcutHelpOpen = $state(false);
  // eslint-disable-next-line prefer-const -- $state proxy mutated via property access
  let stashedInput = $state<PromptInputSnapshot | null>(null);

  // Approving flag
  let approving = $state(false);

  // Drag-drop
  let pageDragActive = $state(false);
  let dragProcessingCount = $state(0);
  const dragProcessing = $derived(dragProcessingCount > 0);

  // Permission change seq
  let permissionModeChangeSeq = 0;
  let pendingPersist: Promise<void> = Promise.resolve();

  // Auto-name
  let prevAutoNameRunId = "";
  let autoNameDone = $state(false);

  // Resuming
  let resuming = $state(false);

  // Model contamination cache
  let lastKnownGoodAnthropicModel: string | undefined;

  // ── Effects: auto-name latch (reset on run ID change) ──
  $effect(() => {
    const id = store.run?.id ?? "";
    if (id !== prevAutoNameRunId) {
      prevAutoNameRunId = id;
      autoNameDone = false;
    }
  });

  // ── Effects: rewind markers clear on run switch ──
  let prevRewindRunId = "";
  $effect(() => {
    const id = store.run?.id ?? "";
    if (id !== prevRewindRunId) {
      prevRewindRunId = id;
      rewindMarkers = [];
    }
  });

  // ── Effects: clear direct target on modal close ──
  $effect(() => {
    if (!rewindModalOpen) rewindDirectTarget = null;
  });

  // ── Effects: fork overlay timer ──
  $effect(() => {
    if (forkOverlay?.active && !forkOverlay.error) {
      const interval = setInterval(() => {
        forkElapsed = Math.floor((Date.now() - forkOverlay!.startedAt) / 1000);
      }, 1000);
      return () => clearInterval(interval);
    }
    if (forkElapsed !== 0) forkElapsed = 0;
  });

  // Fork overlay phase watcher: show error on failure during step 1 (fork_oneshot).
  $effect(() => {
    if (!forkOverlay?.active) return;
    const phase = store.phase;
    if ((phase === "failed" || phase === "stopped") && !forkOverlay.error) {
      forkOverlay = { ...forkOverlay, error: store.error || t("chat_forkFailedFallback") };
    }
  });

  // ── Effects: auto-name (on first idle, one-shot per run) ──
  $effect(() => {
    const result = shouldAutoName({
      phase: store.phase,
      runId: store.run?.id,
      runName: store.run?.name,
      prompt: store.run?.prompt,
      autoNameDone,
    });
    if (result.fire && result.autoName) {
      autoNameDone = true;
      const suggested = result.autoName;
      // Defer IPC so this effect commits before rename mutates store (avoids flush cycles).
      queueMicrotask(() => void handleRename(suggested));
    }
  });

  // ── Effects: BTW event listeners ──
  onMount(() => {
    const transport = getTransport();
    const deltaUnlisten = transport.listen<BtwDelta>("btw-delta", (ev) => {
      if (btwState.active) {
        dbg("chat", "btw-delta", { len: ev.text.length });
        btwState.answer += ev.text;
      }
    });
    const completeUnlisten = transport.listen<BtwComplete>("btw-complete", (ev) => {
      if (btwState.active) {
        dbg("chat", "btw-complete", { btwId: ev.btw_id });
        btwState.loading = false;
      }
    });
    const errorUnlisten = transport.listen<BtwError>("btw-error", (ev) => {
      if (btwState.active) {
        dbgWarn("chat", "btw-error", { error: ev.error });
        btwState.error = ev.error;
        btwState.loading = false;
      }
    });
    return () => {
      deltaUnlisten.then((f) => f());
      completeUnlisten.then((f) => f());
      errorUnlisten.then((f) => f());
    };
  });

  // ── Derived: O(1) timeline entry id → index ──
  const timelineIdIndex = $derived.by(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < store.timeline.length; i++) {
      map.set(store.timeline[i].id, i);
    }
    return map;
  });

  // ── Toast ──
  function showChatToast(msg: string) {
    chatToast = msg;
    if (chatToastTimeout) clearTimeout(chatToastTimeout);
    chatToastTimeout = setTimeout(() => {
      chatToast = null;
    }, 2500);
  }

  // ── Permission mode ──

  async function handlePermissionModeChange(
    newMode: string,
    opts?: { toast?: boolean },
  ): Promise<boolean> {
    const seq = ++permissionModeChangeSeq;
    const oldMode = store.permissionMode;
    const oldFlag = store.permissionModeSetByUser;
    const oldPersistFailed = store.permissionModePersistFailed;
    const hadActiveSession = store.sessionAlive; // capture at entry, before awaits
    dbg("chat", "permission mode change", { from: oldMode, to: newMode, seq, hadActiveSession });

    // Optimistic UI + protect from session_init during awaits
    store.permissionMode = newMode;
    store.permissionModeSetByUser = true;
    store.permissionModePersistFailed = false;

    if (hadActiveSession && store.run) {
      // Active session: hot-switch via control protocol (CLI expects CLI names)
      try {
        await api.setPermissionMode(store.run.id, newMode);
        dbg("chat", "permission mode changed via control protocol", { newMode });
      } catch (e) {
        if (seq !== permissionModeChangeSeq) return false;
        // Restore mode, flag, AND persistFailed
        store.permissionMode = oldMode;
        store.permissionModeSetByUser = oldFlag;
        store.permissionModePersistFailed = oldPersistFailed;
        dbgWarn("chat", "permission mode change failed:", e);
        store.error = t("chat_permModeFailed", { mode: newMode, error: String(e) });
        if (opts?.toast !== false) {
          showChatToast(t("toast_permissionFailed"));
        }
        return false;
      }
    }

    if (seq !== permissionModeChangeSeq) return false;

    if (opts?.toast !== false) {
      showChatToast(t("toast_permissionMode", { mode: getPermModeLabel(newMode) }));
    }

    // Persist — serialized to prevent concurrent writes overwriting each other.
    // persistFailed flag signals whether the no-active-session branch reverted.
    let persistFailed = false;
    const appName = CLI_TO_APP_MODE[newMode] ?? newMode;

    pendingPersist = pendingPersist
      .then(async () => {
        if (seq !== permissionModeChangeSeq) return;
        try {
          await api.updateUserSettings({ permission_mode: appName });
          dbg("chat", "permission mode persisted", { appName });
        } catch (e) {
          if (seq !== permissionModeChangeSeq) return;
          dbgWarn("chat", "permission mode persist failed:", e);
          if (hadActiveSession) {
            // CLI was already switched via control protocol → current session correct.
            // Mark persist-failed so _clearContentState() resets flag on next run,
            // allowing new session's session_init to re-sync from CLI's startup mode.
            store.permissionModePersistFailed = true;
            if (opts?.toast !== false) showChatToast(t("toast_permissionPersistFailed"));
          } else {
            // No active session → persist was ONLY path for mode to take effect.
            // Revert everything.
            persistFailed = true;
            store.permissionMode = oldMode;
            store.permissionModeSetByUser = oldFlag;
            store.permissionModePersistFailed = oldPersistFailed;
            dbgWarn("chat", "no active session — reverting UI to match persisted settings");
            if (opts?.toast !== false) showChatToast(t("toast_permissionChangeFailed"));
          }
        }
      })
      .catch(() => {}); // ensure chain never breaks

    await pendingPersist;

    if (persistFailed) return false;

    // Sync legacy plan_mode (fire-and-forget)
    if (seq === permissionModeChangeSeq) {
      api.updateAgentSettings("claude", { plan_mode: newMode === "plan" }).catch((e) => {
        dbgWarn("chat", "plan_mode sync failed:", e);
      });
    }

    return seq === permissionModeChangeSeq;
  }

  // ── HTML Export ──

  async function handleExportHtml() {
    if (!store.run) {
      dbgWarn("chat", "handleExportHtml: no run");
      showChatToast(t("export_noConversation"));
      return;
    }
    dbg("chat", "handleExportHtml: start");

    let html: string;
    let title: string;
    const prevFilter = getToolFilter();
    const prevLimit = progressive.renderLimit;
    try {
      // Force full render (clear filter + unlimited)
      setToolFilter(null);
      progressive.renderLimit = Infinity;
      await tick();
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));

      // Re-query after Svelte re-render (DOM may have been replaced)
      const rootEl = document.querySelector<HTMLElement>("[data-conversation-root]");
      if (!rootEl) {
        dbgWarn("chat", "handleExportHtml: data-conversation-root not found");
        showChatToast(t("export_noConversation"));
        return;
      }

      const { exportConversationToHtml, buildExportFilename: buildFn } =
        await import("$lib/utils/html-export");

      title = store.run.name ?? store.run.prompt?.slice(0, 80) ?? "Untitled";
      html = await exportConversationToHtml(rootEl, {
        title,
        sessionInfo: {
          model: store.model,
          cwd: store.effectiveCwd,
          startedAt: store.run.started_at,
          turnCount:
            store.numTurns || store.timeline.filter((e: TimelineEntry) => e.kind === "user").length,
        },
      });

      // Restore UI immediately (HTML already captured, no need to keep filter cleared)
      setToolFilter(prevFilter);
      progressive.renderLimit = prevLimit;

      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: buildFn(title),
        filters: [{ name: "HTML", extensions: ["html"] }],
      });
      if (!path) {
        dbg("chat", "handleExportHtml: user cancelled");
        return;
      }

      await api.writeHtmlExport(path, html);
      dbg("chat", "handleExportHtml: done", { path });
      showChatToast(t("export_htmlSuccess"));
    } catch (e) {
      dbgWarn("chat", "handleExportHtml failed", e);
      showChatToast(t("export_htmlFailed"));
    } finally {
      // Ensure restore even on early return paths
      setToolFilter(prevFilter);
      progressive.renderLimit = prevLimit;
    }
  }

  // ── Model/Effort/Auth/Platform ──

  async function handleModelChange(newModel: string) {
    dbg("chat", "model change", { from: store.model, to: newModel });
    store.model = newModel;

    const isThirdParty = store.platformId && store.platformId !== "anthropic";

    // Hot-switch model if session is alive (only for Anthropic — third-party models
    // are set via ANTHROPIC_MODEL env var at spawn time, not via control protocol)
    if (!isThirdParty && store.sessionAlive && store.run) {
      try {
        await api.sendSessionControl(store.run.id, "set_model", { model: newModel });
        dbg("chat", "model hot-switched via control protocol");
      } catch (e) {
        dbgWarn("chat", "model hot-switch failed, will use new model on next session", e);
      }
    }

    // Persist model to run meta (per-run model memory)
    if (store.run) {
      api.updateRunModel(store.run.id, newModel).catch((e) => {
        dbgWarn("chat", "failed to persist run model", e);
      });
    }

    // Only persist default_model for Anthropic — third-party models managed per-credential
    if (!isThirdParty) {
      lastKnownGoodAnthropicModel = newModel;
      try {
        await api.updateUserSettings({ default_model: newModel });
      } catch (e) {
        dbgWarn("chat", "failed to persist model change", e);
      }
    }
  }

  async function handleEffortChange(newEffort: string) {
    dbg("chat", "effort change", { from: opts.getCurrentEffort(), to: newEffort });
    setCurrentEffort(newEffort);
    // Write to CLI config (~/.claude/settings.json) — the CLI reads effortLevel
    // per-request, so changes take effect immediately within a running session.
    // Deliberately NOT writing to agentSettings.effort — that would cause --effort
    // to be passed at spawn, which locks the CLI's in-memory effort and prevents
    // settings.json changes from being picked up during the session.
    api.updateCliConfig({ effortLevel: newEffort || null }).catch((e) => {
      dbgWarn("chat", "failed to persist effort to CLI config", e);
    });
  }

  async function handleAuthModeChange(mode: string) {
    dbg("chat", "auth mode change", { from: store.authMode, to: mode });
    store.authMode = mode;
    try {
      await api.updateUserSettings({ auth_mode: mode } as Partial<UserSettings>);
      // Refresh auth overview after mode change
      const overview = await api.getAuthOverview();
      setAuthOverview(overview);
    } catch (e) {
      dbgWarn("chat", "failed to persist auth mode change", e);
    }
  }

  async function checkAllLocalProxies() {
    const settings = getSettings();
    const localPresets = PLATFORM_PRESETS.filter((p) => p.category === "local");
    const results = await Promise.allSettled(
      localPresets.map((p) => {
        const cred = findCredential(settings?.platform_credentials ?? [], p.id);
        const url = cred?.base_url || p.base_url;
        return api.detectLocalProxy(p.id, url);
      }),
    );
    const statuses: Record<string, { running: boolean; needsAuth: boolean }> = {};
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        statuses[localPresets[i].id] = { running: r.value.running, needsAuth: r.value.needsAuth };
      } else {
        statuses[localPresets[i].id] = { running: false, needsAuth: false };
      }
    });
    setLocalProxyStatuses(statuses);
    dbg("chat", "checkAllLocalProxies", statuses);
  }

  async function handlePlatformChange(platformId: string) {
    dbg("chat", "platform change", { from: store.platformId, to: platformId });
    store.platformId = platformId;

    const settings = getSettings();

    // Auto-switch model to provider's default when switching to a third-party platform
    // Priority: credential.models (user-configured) > preset.models (static defaults)
    const cred = findCredential(settings?.platform_credentials ?? [], platformId);
    const preset = PLATFORM_PRESETS.find((p) => p.id === platformId);
    const models = cred?.models?.length ? cred.models : preset?.models;
    if (models?.length) {
      const defaultModel = models[0];
      dbg("chat", "auto-switch model for platform", { platformId, model: defaultModel });
      store.model = defaultModel;
    } else if (platformId === "anthropic") {
      // Switching back to Anthropic: always overwrite — don't keep third-party model;
      // don't fallback to settings.default_model which might be contaminated.
      const cliModel = getCliCurrentModel();
      store.model = cliModel || "";
      dbg("chat", "restore model on switch to anthropic", { cliModel, using: store.model });
    } else {
      // Custom/unknown platform without preset models: clear model
      // (let CLI use whatever default it has, or the user can set manually)
      store.model = "";
    }

    // Only persist default_model when switching to Anthropic with a validated CLI model.
    // Don't persist empty or potentially-stale model values.
    const persistUpdate: Partial<UserSettings> = { active_platform_id: platformId };
    if (platformId === "anthropic") {
      const validated = getCliCurrentModel();
      if (validated) persistUpdate.default_model = validated;
    }
    try {
      await api.updateUserSettings(persistUpdate);
    } catch (e) {
      dbgWarn("chat", "failed to persist platform change", e);
    }
    // Refresh local proxy statuses after platform switch
    checkAllLocalProxies();
  }

  // ── Helpers ──

  function appendCommandOutput(text: string) {
    const cmdId = uuid();
    store.timeline = [
      ...store.timeline,
      {
        kind: "command_output",
        id: cmdId,
        anchorId: cmdId,
        content: text,
        ts: new Date().toISOString(),
      },
    ];
  }

  // ── Rename / Auto-name ──

  async function handleRename(name: string) {
    if (!store.run) return;
    try {
      await api.renameRun(store.run.id, name);
      store.run = { ...store.run, name };
      window.dispatchEvent(new Event(RUNS_CHANGED_KEY));
      dbg("chat", "renamed run", { id: store.run.id, name });
    } catch (e) {
      dbgWarn("chat", "rename failed", e);
    }
  }

  // ── Fast mode ──

  async function handleFastModeSwitch(mode: "on" | "off") {
    const enabling = mode === "on";
    const current = store.fastModeState === "on";
    if (enabling === current) {
      appendCommandOutput(t(enabling ? "fast_alreadyOn" : "fast_alreadyOff"));
      return;
    }
    try {
      await api.updateCliConfig({ fastMode: enabling });
      store.fastModeState = enabling ? "on" : "";
      dbg("chat", "fastMode set", { mode });
      showChatToast(t(enabling ? "toast_fastModeOn" : "toast_fastModeOff"));
      appendCommandOutput(t(enabling ? "fast_enabled" : "fast_disabled"));
    } catch (e) {
      dbgWarn("chat", "fastMode set failed:", e);
    }
  }

  // ── BTW ──

  async function handleBtwSend(question: string) {
    if (!store.run?.id) return;
    dbg("chat", "btwSend", { runId: store.run.id, question: question.slice(0, 50) });
    btwState = { active: true, btwId: null, question, answer: "", error: null, loading: true };
    try {
      const btwId = await api.sideQuestion(store.run.id, question);
      btwState.btwId = btwId;
    } catch (e) {
      btwState.error = String(e);
      btwState.loading = false;
    }
  }

  // ── Preview ──

  function openPreviewInSidebar(url?: string) {
    const targetUrl = url?.trim() || localStorage.getItem("ocv:preview-url") || "";
    if (!targetUrl) {
      appendCommandOutput(t("preview_usage"));
      return;
    }
    requestedPreviewUrl = targetUrl;
    sidebarRequestedTab = "preview";
    if (getSidebarCollapsed()) setSidebarCollapsed(false);
    appendCommandOutput(t("preview_opened"));
  }

  // ── Ralph ──

  async function handleRalphCancel() {
    if (!store.run?.id) return;
    try {
      const result = await api.cancelRalphLoop(store.run.id);
      if (result.immediate) {
        appendCommandOutput(`Loop cancelled (iteration ${result.iteration})`);
      } else {
        appendCommandOutput(
          `Loop will stop after current iteration (iteration ${result.iteration})`,
        );
      }
    } catch (err) {
      appendCommandOutput(
        `Failed to cancel loop: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Virtual commands (delegated to shared module) ──

  function showSessionInfoSidebar() {
    if (getSidebarCollapsed()) setSidebarCollapsed(false);
    sidebarRequestedTab = "info";
  }

  const handleVirtualCommand = createHandleVirtualCommand({
    store,
    t,
    appendCommandOutput,
    handleRename,
    sendMessage: (text, attachments) => ctrl.sendMessage(text, attachments),
    handlePermissionModeChange,
    getCliCommands,
    projectCommands,
    handleFastModeSwitch,
    handleRewind,
    handleRalphCancel,
    openPreviewInSidebar,
    showSessionInfoSidebar,
  });

  // ── Stop / Resume / Fork ──

  async function handleStop() {
    await store.stop();
    window.dispatchEvent(new Event(RUNS_CHANGED_KEY));
  }

  async function handleResume(
    mode: SessionMode,
    overrideRunId?: string,
    initialMessage?: string,
    initialAttachments?: Attachment[],
  ) {
    const middleware = getEventMiddleware();
    const targetRunId = overrideRunId ?? store.run?.id;
    if (!targetRunId || resuming) return;
    resuming = true;

    // Per-session platform: resume automatically uses run's saved platform_id
    // via backend resolve_auth_env_for_platform() — no mismatch dialog needed.

    // Fork: activate overlay immediately for progress feedback
    if (mode === "fork") {
      forkOverlay = { active: true, sourceRunId: targetRunId, startedAt: Date.now(), error: null };
    }

    try {
      // Fork: don't subscribe to source — backend emits RunState(stopped)
      // for the source which would interfere with the fork state machine.
      if (mode !== "fork") {
        middleware.subscribeCurrent(targetRunId, store);
      }
      const resultId = await store.resumeSession(
        targetRunId,
        mode,
        initialMessage,
        initialAttachments,
      );
      if (resultId) {
        middleware.subscribeCurrent(resultId, store);
        if (mode === "fork") {
          // Check if user cancelled during fork_oneshot
          if (!forkOverlay) {
            dbg("chat", "fork: cancelled during fork_oneshot, skipping step 2");
          } else {
            // Step 1 complete — dismiss overlay, use normal session startup UI for step 2
            forkOverlay = null;
            goto(`/chat?run=${resultId}`, { replaceState: true });
            // Step 2: establish stream-json connection (shows "Starting session..." spinner)
            try {
              await store.connectSession(resultId);
            } catch (e) {
              store.error = String(e);
            }
          }
        } else {
          goto(`/chat?run=${resultId}`, { replaceState: true });
        }
      } else if (mode === "fork") {
        // Fork failed — don't clear overlay or navigate away.
        // The phase watcher $effect will show the error in the overlay.
        // User can Retry or Cancel from there.
        dbg("chat", "fork failed, keeping overlay for retry/cancel");
      } else {
        // Non-fork resume failed — stay on the target run's view instead of
        // navigating to blank new-session page (the run's history is still useful).
        setLastContinuableRun(null);
        await goto(`/chat?run=${targetRunId}`, { replaceState: true });
        // Initial navigation used ?resume=… so loadRun was skipped; after stripping resume
        // the URL may already be /chat?run=id, making goto a no-op — effects won't re-run.
        // Always replay history from disk/backend so the chat is never stuck empty.
        await ctrl.loadRunProgressive(targetRunId);
      }
      window.dispatchEvent(new Event(RUNS_CHANGED_KEY));
    } catch (e) {
      // Fork sync failure → show error in overlay instead of error bar
      if (mode === "fork" && forkOverlay) {
        forkOverlay = { ...forkOverlay, error: String(e) };
      } else if (mode !== "fork") {
        const tid = overrideRunId ?? store.run?.id;
        if (tid) {
          setLastContinuableRun(null);
          try {
            await goto(`/chat?run=${tid}`, { replaceState: true });
            await ctrl.loadRunProgressive(tid);
          } catch {
            /* best-effort: surface already via store.error when resumeSession failed */
          }
        }
      }
    } finally {
      resuming = false;
    }
  }

  /** Stop the fork run's process (if it exists and isn't the source run). */
  async function stopForkProcess(sourceRunId: string) {
    if (store.run && store.run.id !== sourceRunId) {
      try {
        await api.stopSession(store.run.id);
      } catch {
        /* best-effort */
      }
    }
  }

  async function handleForkCancel() {
    if (!forkOverlay) return;
    const sourceRunId = forkOverlay.sourceRunId;
    await stopForkProcess(sourceRunId);
    forkOverlay = null;
    store.error = "";
    goto(`/chat?run=${sourceRunId}`, { replaceState: true });
    // Explicit reload — URL may not change if we're returning to the same run
    await ctrl.loadRunProgressive(sourceRunId);
    window.dispatchEvent(new Event(RUNS_CHANGED_KEY));
  }

  async function handleForkRetry() {
    if (!forkOverlay || resuming) return;
    const sourceRunId = forkOverlay.sourceRunId;
    await stopForkProcess(sourceRunId);
    forkOverlay = { active: true, sourceRunId, startedAt: Date.now(), error: null };
    store.error = "";
    await handleResume("fork", sourceRunId);
  }

  // ── CLI config toggle ──

  async function toggleCliConfigBool(key: string) {
    try {
      const config = await api.getCliConfig();
      const current = config[key] === true;
      await api.updateCliConfig({ [key]: !current });
      dbg("chat", `toggled ${key}`, { from: current, to: !current });
      // Immediately mirror UI state
      if (key === "fastMode") {
        store.fastModeState = !current ? "on" : "";
        dbg("chat", "fastMode UI mirrored", { state: store.fastModeState });
      } else if (key === "verbose") {
        setVerboseEnabled(!current);
        dbg("chat", "verbose UI mirrored", { verbose: !current });
      }
      const label =
        key === "fastMode"
          ? !current
            ? "toast_fastModeOn"
            : "toast_fastModeOff"
          : !current
            ? "toast_verboseOn"
            : "toast_verboseOff";
      showChatToast(t(label as Parameters<typeof t>[0]));
    } catch (e) {
      dbgWarn("chat", `toggle ${key} failed:`, e);
    }
  }

  // ── Drag-drop ──

  /** Concurrency-limited parallel map returning PromiseSettledResult for each item. */
  async function handleTauriDrop(payload: { paths: string[] }) {
    pageDragActive = false;
    const paths = payload.paths;
    const input = promptRef(); // cache ref — promptRef may become undefined after awaits
    if (!paths?.length || !input) return;

    dragProcessingCount++;
    dbg("chat", "tauri-drop", { count: paths.length });

    try {
      // Phase 1: parallel classify (concurrency=5 to avoid IPC flood on large batches)
      const classified = await mapSettled(
        paths,
        async (p) => {
          const name = p.split(/[/\\]/).pop() || "file";
          const isDir = await api.checkIsDirectory(p);
          return { p, name, isDir };
        },
        5,
      );

      const dirRefs: Array<{ path: string; name: string; isDir: true }> = [];
      const fileEntries: Array<{ p: string; name: string }> = [];

      for (let i = 0; i < classified.length; i++) {
        const result = classified[i];
        const p = paths[i];
        const name = p.split(/[/\\]/).pop() || "file";
        if (result.status === "fulfilled") {
          if (result.value.isDir) {
            dirRefs.push({ path: p, name, isDir: true });
            dbg("chat", "tauri-drop: dir", { name });
          } else {
            fileEntries.push({ p, name });
          }
        } else {
          // checkIsDirectory IPC failed — conservatively treat as file
          fileEntries.push({ p, name });
          dbgWarn("chat", "tauri-drop: classify failed, treating as file", {
            name,
            error: result.reason,
          });
        }
      }

      // Phase 2: parallel file read (concurrency=2 to limit memory)
      const fileResults = await mapSettled(
        fileEntries,
        async ({ p, name }) => {
          const [base64, mime] = await api.readFileBase64(p);
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          return { file: new File([bytes], name, { type: mime }), name, mime, size: bytes.length };
        },
        2,
      );

      const filesToProcess: File[] = [];
      const fileRefs: Array<{ path: string; name: string; isDir: false }> = [];

      for (let i = 0; i < fileResults.length; i++) {
        const result = fileResults[i];
        const { p, name } = fileEntries[i];
        if (result.status === "fulfilled") {
          filesToProcess.push(result.value.file);
          dbg("chat", "tauri-drop: file", {
            name: result.value.name,
            mime: result.value.mime,
            size: result.value.size,
          });
        } else {
          fileRefs.push({ path: p, name, isDir: false });
          dbgWarn("chat", "tauri-drop: fallback to path ref", { name, error: result.reason });
        }
      }

      // Guard: if page navigated away during processing, promptRef is stale
      if (promptRef() !== input) {
        dbgWarn("chat", "tauri-drop: promptRef stale after processing, discarding");
        return;
      }

      // Add path refs (dirs + failed files)
      const allPathRefs = [...dirRefs, ...fileRefs];
      if (allPathRefs.length > 0) {
        input.addPathRefs(allPathRefs);
      }

      // Normal files → existing addFiles pipeline (await so spinner covers processFiles)
      if (filesToProcess.length > 0) {
        await input.addFiles(filesToProcess);
      }

      // Single summary toast
      if (allPathRefs.length > 0) {
        const parts: string[] = [];
        if (dirRefs.length > 0) {
          parts.push(t("drag_foldersInserted", { count: String(dirRefs.length) }));
        }
        if (fileRefs.length > 0) {
          parts.push(t("drag_filesAsPathRef", { count: String(fileRefs.length) }));
        }
        input.showToast(parts.join(t("common_listSeparator")));
      }
    } finally {
      dragProcessingCount--;
    }
  }

  // ── Scroll / Tool navigation ──

  function selectToolPanelTab(tab: ToolActivityPanelTab) {
    if (!getSidebarCollapsed() && toolPanelActiveTab === tab) {
      setSidebarCollapsed(true);
      return;
    }
    toolPanelActiveTab = tab;
    setSidebarCollapsed(false);
  }

  async function scrollToTool(toolUseId: string) {
    // Clear filter first — target may be filtered out, and burst/visible indices
    // depend on the unfiltered timeline.
    if (getToolFilter()) {
      setToolFilter(null);
      await tick();
    }
    // Locate target in the data layer (DOM may not be mounted yet under progressive render).
    const ft = getFilteredTimeline();
    const ftIdx = ft.findIndex((e) => e.kind === "tool" && e.tool.tool_use_id === toolUseId);
    if (ftIdx < 0) return;
    progressive.expandRenderLimitTo(ftIdx);
    await tick();
    // Re-map to visibleTimeline-local index for burst expansion.
    const visibleIdx = getVisibleTimeline().findIndex(
      (e) => e.kind === "tool" && e.tool.tool_use_id === toolUseId,
    );
    if (visibleIdx >= 0) await progressive.ensureBurstExpandedFor(visibleIdx);
    const el = document.getElementById("tool-" + toolUseId);
    if (el) {
      // Temporarily disable content-visibility so the browser knows real heights and
      // scrollIntoView lands at the correct offset (mirrors scrollToMessage).
      const container = chatAreaRef();
      const cvEls = container
        ? Array.from(container.querySelectorAll<HTMLElement>(".cv-auto"))
        : [];
      for (const c of cvEls) c.style.contentVisibility = "visible";
      el.getBoundingClientRect();
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary/50");
      requestAnimationFrame(() => {
        for (const c of cvEls) c.style.contentVisibility = "";
      });
      setTimeout(() => el.classList.remove("ring-2", "ring-primary/50"), 2000);
    }
  }

  async function scrollToMessage(ts: string) {
    dbg("chat", "scrollToMessage", { ts });
    if (getToolFilter()) {
      setToolFilter(null);
      await tick();
    }
    // Resolve target from data — `ts` may be ts, anchorId, cliUuid, or id.
    const match = store.timeline.find(
      (e: TimelineEntry) =>
        e.ts === ts || e.anchorId === ts || (e.kind === "user" && e.cliUuid === ts) || e.id === ts,
    );
    if (!match) return;
    const ft = getFilteredTimeline();
    const ftIdx = ft.findIndex((e) => e.id === match.id);
    if (ftIdx < 0) return;
    progressive.expandRenderLimitTo(ftIdx);
    await tick();
    const visibleIdx = getVisibleTimeline().findIndex((e) => e.id === match.id);
    if (visibleIdx >= 0) await progressive.ensureBurstExpandedFor(visibleIdx);
    // DOM id uses anchorId (see `id="msg-{entry.anchorId}"` in the each block).
    const el = document.getElementById("msg-" + match.anchorId);
    if (el) {
      // Temporarily disable content-visibility on ALL entries so the browser
      // knows real heights and scrollIntoView lands at the correct offset.
      const container = chatAreaRef();
      const cvEls = container
        ? Array.from(container.querySelectorAll<HTMLElement>(".cv-auto"))
        : [];
      for (const c of cvEls) c.style.contentVisibility = "visible";

      el.getBoundingClientRect(); // force reflow
      el.scrollIntoView({ behavior: "instant", block: "center" });
      el.classList.add("ring-2", "ring-primary/50");

      // Restore content-visibility after scroll settles
      requestAnimationFrame(() => {
        for (const c of cvEls) c.style.contentVisibility = "";
      });
      setTimeout(() => {
        el!.classList.remove("ring-2", "ring-primary/50");
      }, 2000);
    } else {
      dbg("chat", "scrollToMessage: element not found", { anchor: ts });
    }
  }

  // ── Tool / Permission / Elicitation / Hook ──

  async function handleToolAnswer(toolUseId: string, answer: string) {
    await store.answerToolQuestion(toolUseId, answer);
  }

  function handleRewind() {
    if (!store.run || !store.sessionAlive || store.isRunning) return;
    rewindModalOpen = true;
  }

  function handleRewindToMessage(entry: { cliUuid: string; content: string; ts: string }) {
    if (!store.run || !store.sessionAlive || store.isRunning) return;
    rewindDirectTarget = {
      cliUuid: entry.cliUuid,
      content: entry.content,
      ts: entry.ts,
      timelineIndex: store.timeline.findIndex(
        (e: TimelineEntry) => e.kind === "user" && e.cliUuid === entry.cliUuid,
      ),
    };
    rewindModalOpen = true;
  }

  async function handleToolApprove(toolName: string) {
    if (!store.run) return;
    approving = true;
    dbg("chat", "approving tool", { runId: store.run.id, toolName });
    try {
      await api.approveSessionTool(store.run.id, toolName);
    } catch (e) {
      dbgWarn("chat", "approve failed:", e);
      store.error = String(e);
    } finally {
      // approving resets when new RunState events arrive (spawning/running)
      setTimeout(() => {
        approving = false;
      }, 3000);
    }
  }

  async function handlePermissionRespond(
    requestId: string,
    behavior: "allow" | "deny",
    updatedPermissions?: PermissionSuggestion[],
    updatedInput?: Record<string, unknown>,
    denyMessage?: string,
    interrupt?: boolean,
  ) {
    if (!store.run || !store.sessionAlive) return;
    const runId = store.run.id; // snapshot — store.run may change after await
    dbg("chat", "inline permission respond", {
      runId,
      requestId,
      behavior,
      updatedPermissions,
      updatedInput,
      denyMessage,
      interrupt,
    });
    try {
      // Set pending mode override BEFORE responding (so reducer picks it up)
      if (behavior === "allow" && updatedPermissions) {
        const modePerm = updatedPermissions.find((p) => p.type === "setMode");
        if (modePerm && modePerm.mode) {
          store.pendingPermissionModeOverride = modePerm.mode;
          dbg("chat", "set pendingPermissionModeOverride", { mode: modePerm.mode });
        }
      }

      await api.respondPermission(
        runId,
        requestId,
        behavior,
        updatedPermissions,
        updatedInput,
        denyMessage,
        interrupt,
      );
      // Optimistic resolve + clear attention flag
      resolvePermissionOptimistic(store, runId, requestId, behavior);
    } catch (e) {
      dbgWarn("chat", "permission respond failed:", e);
      // If the CLI rejected the response (e.g. session already idle after interrupt),
      // still resolve the card locally so buttons are removed.
      if (behavior === "deny") {
        resolvePermissionOptimistic(store, runId, requestId, "deny");
      }
      // allow failure: don't change status — submitting timeout auto-resets (§5)
      store.error = String(e);
      throw e; // Let component-side wrapper catch and unlock buttons
    }
  }

  async function handleElicitationRespond(
    requestId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
  ) {
    if (!store.run || !store.sessionAlive) return;
    const runId = store.run.id;
    dbg("chat", "elicitation respond", { runId, requestId, action });
    try {
      await api.respondElicitation(runId, requestId, action, content);
      // Cleanup after successful response — not optimistic, avoids card loss on failure
      const { resolveElicitationOptimistic } = await import("$lib/utils/resolve-elicitation");
      resolveElicitationOptimistic(store, runId, requestId);
    } catch (e) {
      dbgWarn("chat", "elicitation respond failed:", e);
      store.error = String(e);
    }
  }

  function getPlanContentForExitPlan(
    entryId: string,
  ): { content: string; fileName: string } | null {
    const idx = timelineIdIndex.get(entryId);
    if (idx == null) {
      dbgWarn("chat", "ExitPlanMode entry not found in timeline index", { id: entryId });
      return null;
    }
    const result = extractPlanContent(store.timeline, idx);
    if (result) return result;
    // Fallback: use tool_use_result.plan (--permission-mode=plan auto-approves
    // ExitPlanMode without Write, plan content is in the result directly)
    const entry = store.timeline[idx];
    if (entry?.kind === "tool" && entry.tool.status === "success") {
      const toolResult = entry.tool.tool_use_result as
        | { plan?: string; filePath?: string }
        | undefined;
      if (toolResult?.plan && typeof toolResult.plan === "string") {
        const fp = String(toolResult.filePath ?? "");
        const name = isPlanFilePath(fp) ? (planFileName(fp) ?? "plan") : "plan";
        return { content: toolResult.plan, fileName: name };
      }
    }
    return null;
  }

  /** Get the latest plan content for an approved ExitPlanMode card.
   *  Applies subsequent Edits to the approved plan content. */
  async function handleExitPlanClearContext() {
    if (!store.run) return;
    const runId = store.run.id;
    const cwd = localStorage.getItem(PROJECT_CWD_KEY) || "";
    dbg("chat", "ExitPlanMode: clear context + auto-accept");

    // Find the ExitPlanMode tool's permission request ID from timeline
    const exitPlanEntry = store.timeline.find(
      (e: TimelineEntry) =>
        e.kind === "tool" &&
        e.tool.tool_name === "ExitPlanMode" &&
        e.tool.status === "permission_prompt" &&
        e.tool.permission_request_id,
    );
    if (!exitPlanEntry || exitPlanEntry.kind !== "tool") return;
    const requestId = exitPlanEntry.tool.permission_request_id!;

    try {
      // 1. Set flags BEFORE responding
      store.pendingPermissionModeOverride = "acceptEdits";
      store.pendingClearContextPlan = "__pending__"; // marker: waiting for tool_end

      // 2. Allow ExitPlanMode (with setMode) — satisfies the control_response requirement
      await api.respondPermission(
        runId,
        requestId,
        "allow",
        [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
        exitPlanEntry.tool.input,
      );
      resolvePermissionOptimistic(store, runId, requestId, "allow");

      // 3. Wait for tool_end to deliver plan content (via pendingClearContextPlan)
      //    Poll briefly — tool_end should arrive within a few hundred ms
      let planContent: string | null = null;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (store.pendingClearContextPlan && store.pendingClearContextPlan !== "__pending__") {
          planContent = store.pendingClearContextPlan;
          break;
        }
      }
      store.pendingClearContextPlan = null;

      if (!planContent) {
        dbgWarn("chat", "ExitPlanMode: timed out waiting for plan content");
        // Fallback: continue in current session (ExitPlanMode already allowed)
        return;
      }

      // 4. Interrupt + stop current session
      await api.interruptSession(runId).catch(() => {});
      await api.stopSession(runId);
      dbg("chat", "ExitPlanMode: session stopped");

      // 5. Navigate to fresh chat URL, then start a new session inline.
      //    Using sessionStorage + onMount doesn't work: /chat?run=X → /chat
      //    is the same route component and onMount won't re-fire.
      //    permissionModeOverride threads through api.startSession → backend
      //    adapter_settings, so the CLI spawns with --permission-mode acceptEdits
      //    and the first "Implement..." turn runs in auto-accept (not plan).
      const planPrompt = `Implement the following plan:\n\n${planContent}`;
      await goto("/chat", { replaceState: true });
      await tick(); // let runId effect run loadRun("") → store.reset()
      const newRunId = await store.startSession(planPrompt, cwd, [], "acceptEdits");
      await goto(`/chat?run=${newRunId}`, { replaceState: true });
      dbg("chat", "ExitPlanMode: new session started", { newRunId });
    } catch (e) {
      dbgWarn("chat", "ExitPlanMode clear context failed:", e);
      store.pendingClearContextPlan = null;
      store.error = String(e);
      throw e; // Let component-side wrapper catch and unlock buttons
    }
  }

  async function handleHookCallbackRespond(requestId: string, decision: "allow" | "deny") {
    if (!store.run) return;
    dbg("chat", "hook callback respond", { runId: store.run.id, requestId, decision });
    try {
      await api.respondHookCallback(store.run.id, requestId, decision);
      // Update hook event status in store
      store.hookEvents = store.hookEvents.map((h: (typeof store.hookEvents)[number]) =>
        h.request_id === requestId
          ? { ...h, status: decision === "allow" ? ("allowed" as const) : ("denied" as const) }
          : h,
      );
    } catch (e) {
      dbgWarn("chat", "hook callback respond failed:", e);
      store.error = String(e);
    }
  }

  // ── Return ──
  // NOTE: Props used with bind:* from pages must use getter/setters; returning a
  // shorthand field from `$state(...)` binds to the initial snapshot (non-reactive).
  return {
    // Owned state
    forkOverlay,
    forkElapsed,
    btwState,
    chatToast,
    get rewindModalOpen() {
      return rewindModalOpen;
    },
    set rewindModalOpen(v: boolean) {
      rewindModalOpen = v;
    },
    rewindDirectTarget,
    rewindMarkers,
    get sidebarRequestedTab() {
      return sidebarRequestedTab;
    },
    set sidebarRequestedTab(v: ToolActivityPanelTab | null) {
      sidebarRequestedTab = v;
    },
    get toolPanelActiveTab() {
      return toolPanelActiveTab;
    },
    set toolPanelActiveTab(v: ToolActivityPanelTab) {
      toolPanelActiveTab = v;
    },
    get toolPanelIndicators() {
      return toolPanelIndicators;
    },
    set toolPanelIndicators(v: { context: boolean; files: boolean; tasks: boolean }) {
      toolPanelIndicators = v;
    },
    get requestedPreviewPath() {
      return requestedPreviewPath;
    },
    set requestedPreviewPath(v: string | null) {
      requestedPreviewPath = v;
    },
    get requestedPreviewUrl() {
      return requestedPreviewUrl;
    },
    set requestedPreviewUrl(v: string | null) {
      requestedPreviewUrl = v;
    },
    get shortcutHelpOpen() {
      return shortcutHelpOpen;
    },
    set shortcutHelpOpen(v: boolean) {
      shortcutHelpOpen = v;
    },
    stashedInput,
    approving,
    pageDragActive,
    dragProcessingCount,
    dragProcessing,
    resuming,
    autoNameDone,
    timelineIdIndex,

    // Toast
    showChatToast,

    // Permission mode
    CLI_TO_APP_MODE,
    APP_TO_CLI_MODE,
    getPermModeLabel,
    handlePermissionModeChange,

    // Export
    handleExportHtml,

    // Model/Effort/Auth/Platform
    handleModelChange,
    handleEffortChange,
    handleAuthModeChange,
    checkAllLocalProxies,
    handlePlatformChange,
    lastKnownGoodAnthropicModel: () => lastKnownGoodAnthropicModel,

    // Helpers
    appendCommandOutput,

    // Rename
    handleRename,

    // Fast mode
    handleFastModeSwitch,

    // BTW
    handleBtwSend,

    // Preview
    openPreviewInSidebar,

    // Ralph
    handleRalphCancel,

    // Virtual commands
    handleVirtualCommand,

    // Stop / Resume / Fork
    handleStop,
    handleResume,
    stopForkProcess,
    handleForkCancel,
    handleForkRetry,

    // CLI config toggle
    toggleCliConfigBool,

    // Drag-drop
    handleTauriDrop,

    // Scroll / Tool navigation
    selectToolPanelTab,
    scrollToTool,
    scrollToMessage,

    // Tool / Permission / Elicitation / Hook
    handleToolAnswer,
    handleRewind,
    handleRewindToMessage,
    handleToolApprove,
    handlePermissionRespond,
    handleElicitationRespond,
    handleExitPlanClearContext,
    handleHookCallbackRespond,
    getPlanContentForExitPlan,
  };
}
