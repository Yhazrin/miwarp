import { onMount } from "svelte";
import { getTransport } from "$lib/transport";
import * as api from "$lib/api";
import { LS_PROJECT_CWD } from "$lib/utils/storage-keys";
import {
  EVT_CWD_CHANGED,
  EVT_PROJECT_CHANGED,
  EVT_RUNS_CHANGED,
  EVT_STATUSBAR_TOGGLE,
  EVT_SUMMARIZE_CHAT,
  EVT_SUMMARIZE_CHAT_ACK,
} from "$lib/utils/bus-events";
import { dbg, dbgWarn } from "$lib/utils/debug";
import {
  PLATFORM_PRESETS,
  findCredential,
  isKeyOptionalPlatform,
} from "$lib/utils/platform-presets";
import { APP_TO_CLI_MODE } from "$lib/chat/utils/permission-modes";
import {
  normalizeProcessVisibility,
  persistCachedProcessVisibility,
} from "$lib/utils/process-visibility";
import { parseContextMarkdown } from "$lib/utils/context-parser";
import { handleTauriDrop as execTauriDrop } from "$lib/chat/handle-tauri-drop";
import { isSessionDragActive } from "$lib/utils/session-drag-state";
import type { ForkOverlayState } from "$lib/chat/use-fork-lifecycle";
import { getLastTarget } from "$lib/utils/remote-cwd";
import type { SessionStore } from "$lib/stores/session-store.svelte";
import type { EventMiddleware } from "$lib/stores/event-middleware";
import type { KeybindingStore } from "$lib/stores/keybindings.svelte";
import type {
  UserSettings,
  AgentSettings,
  RemoteHost,
  AuthOverview,
  ScreenshotPayload,
  ContextSnapshot,
  TaskRun,
  BtwDelta,
  BtwComplete,
  BtwError,
} from "$lib/types";
import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
import { chatViewCache } from "$lib/chat/chat-view-cache.svelte";
import { consumeChatBootstrap } from "$lib/chat/chat-bootstrap-cache";
import { disarmChatSettingsHop, isChatSettingsHop } from "$lib/utils/chat-settings-nav";
import type { BtwStateData } from "$lib/chat/use-chat-actions";

// ── Component ref types (minimum interface needed by lifecycle handlers) ──

export interface XTerminalRef {
  writeText(s: string): void;
  clear(): void;
}

export interface PromptInputRef {
  focus(): void;
  triggerSend(): void;
  getInputSnapshot(): import("$lib/types").PromptInputSnapshot | null;
  restoreSnapshot(snap: import("$lib/types").PromptInputSnapshot): void;
  clearAll(): void;
  addFiles(files: File[]): Promise<void>;
  setValue(text: string): void;
  addPathRefs(refs: { path: string; name: string; isDir: boolean }[]): void;
}

export interface StatusBarRef {
  openModelDropdown(): void;
}

// ── Context interface ──

export interface LifecycleHandlerContext {
  // Core stores
  store: SessionStore;
  middleware: EventMiddleware;
  keybindingStore: KeybindingStore;

  // ── Settings & config state ──
  getSettings: () => UserSettings | null;
  setSettings: (v: UserSettings | null) => void;
  setRemoteHosts: (v: RemoteHost[]) => void;
  setAuthOverview: (v: AuthOverview | null) => void;
  checkAllLocalProxies: () => void;

  // ── Agent settings state ──
  getAgentSettings: () => AgentSettings | null;
  setAgentSettings: (v: AgentSettings | null) => void;
  setCurrentEffort: (v: string) => void;

  // ── Permission mode ──
  handlePermissionModeChange: (mode: string) => void;
  getPermModeLabel: (mode: string) => string;

  // ── CLI info & model contamination ──
  loadCliInfo: () => Promise<unknown>;
  getCliCurrentModel: () => string | undefined;
  loadCliVersionInfo: () => void;
  isContaminatedDefaultModel: (dm: string) => boolean | null;
  setLastKnownGoodModel: (v: string) => void;

  // ── Project init ──
  checkProjectInit: () => void;
  reloadProjectData: (cwd: string) => void;

  // ── UI state ──
  getShortcutHelpOpen: () => boolean;
  setShortcutHelpOpen: (v: boolean) => void;
  getStatusBarRef: () => StatusBarRef | undefined;
  getStashedInput: () => import("$lib/types").PromptInputSnapshot | null;
  setStashedInput: (v: import("$lib/types").PromptInputSnapshot | null) => void;
  getPromptRef: () => PromptInputRef | undefined;
  setStatusBarExpanded: (v: boolean) => void;
  getSidebarCollapsed: () => boolean;
  setSidebarCollapsed: (v: boolean) => void;
  setSidebarRequestedTab: (v: ToolActivityPanelTab | null) => void;
  setShowChatToast: (msg: string) => void;
  setPageDragActive: (v: boolean) => void;
  setDragProcessingCount: (fn: (prev: number) => number) => void;
  getXtermRef: () => XTerminalRef | undefined;

  // ── BTW state ──
  getBtwState: () => BtwStateData;
  setBtwState: (v: BtwStateData) => void;

  // ── Context history ──
  contextHistoryMap: Map<string, ContextSnapshot[]>;
  triggerContextHistoryReactivity: () => void;

  // ── Run state ──
  getRunId: () => string;
  setLastContinuableRun: (v: TaskRun | null) => void;
  setMiddlewareReady: (v: boolean) => void;
  setAutoNameDone: (v: boolean) => void;

  // ── Fork overlay ──
  getForkOverlay: () => ForkOverlayState | null;

  // ── Verbose ──
  cleanupVerbose: () => void;
  cancelProgressive: () => void;

  // ── Actions ──
  handleSummarize: () => Promise<void>;
  handleRewind: () => void;
  toggleCliConfigBool: (key: string) => Promise<void>;
  goto: (path: string, opts?: { replaceState?: boolean }) => void;

  // ── i18n ──
  t: (key: string, params?: Record<string, string>) => string;
}

// ── Composable ──

export function initLifecycleHandlers(ctx: LifecycleHandlerContext): void {
  const {
    store,
    middleware,
    keybindingStore,
    getSettings,
    setSettings,
    setRemoteHosts,
    setAuthOverview,
    checkAllLocalProxies,
    getAgentSettings,
    setAgentSettings,
    setCurrentEffort,
    handlePermissionModeChange,
    loadCliInfo,
    getCliCurrentModel,
    loadCliVersionInfo,
    isContaminatedDefaultModel,
    setLastKnownGoodModel,
    checkProjectInit,
    reloadProjectData,
    getShortcutHelpOpen,
    setShortcutHelpOpen,
    getStatusBarRef,
    getStashedInput,
    setStashedInput,
    getPromptRef,
    setStatusBarExpanded,
    getSidebarCollapsed,
    setSidebarCollapsed,
    setSidebarRequestedTab,
    setShowChatToast,
    setPageDragActive,
    setDragProcessingCount,
    getXtermRef,
    getBtwState,
    setBtwState,
    contextHistoryMap,
    triggerContextHistoryReactivity,
    getRunId,
    setLastContinuableRun,
    setMiddlewareReady,
    setAutoNameDone,
    getForkOverlay,
    cleanupVerbose,
    cancelProgressive,
    handleSummarize,
    handleRewind,
    toggleCliConfigBool,
    goto,
    t,
  } = ctx;

  function applyLoadedSettings(loadedSettings: UserSettings): void {
    setSettings(loadedSettings);
    persistCachedProcessVisibility(normalizeProcessVisibility(loadedSettings.process_visibility));
    store.authMode = loadedSettings.auth_mode ?? "cli";
    const hosts = loadedSettings.remote_hosts ?? [];
    setRemoteHosts(hosts);
    if (!store.run && hosts.length > 0) {
      const lastTarget = getLastTarget();
      if (lastTarget && hosts.some((h) => h.name === lastTarget)) {
        store.remoteHostName = lastTarget;
      }
    }
    const activePid = loadedSettings.active_platform_id ?? "anthropic";
    if (
      !store.platformId ||
      loadedSettings.auth_mode === "api" ||
      isKeyOptionalPlatform(activePid)
    ) {
      store.platformId =
        loadedSettings.auth_mode === "api" || isKeyOptionalPlatform(activePid)
          ? activePid
          : "anthropic";
    }
    const runId = getRunId();
    if (!store.model && !runId && store.phase !== "loading") {
      const initCred = findCredential(
        loadedSettings.platform_credentials ?? [],
        store.platformId ?? "",
      );
      const initPreset = PLATFORM_PRESETS.find((p) => p.id === store.platformId);
      const initModels = initCred?.models?.length ? initCred.models : initPreset?.models;
      if (store.platformId !== "anthropic" && initModels?.[0]) {
        store.model = initModels[0];
      } else if (store.platformId === "anthropic" && loadedSettings.default_model) {
        store.model = loadedSettings.default_model;
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Block 1: Settings loading onMount
  // ════════════════════════════════════════════════════════════════════
  onMount(async () => {
    const runId = getRunId();
    const returningFromSettings = isChatSettingsHop();
    const bootstrap = returningFromSettings ? consumeChatBootstrap() : null;
    if (returningFromSettings) disarmChatSettingsHop();

    if (bootstrap) {
      dbg("chat", "bootstrap from settings return (skip cold API)");
      if (bootstrap.agentSettings) {
        setAgentSettings(bootstrap.agentSettings);
        setCurrentEffort("");
      }
      // Snapshot is taken before /settings edits — always reload persisted user settings.
      try {
        const freshSettings = await api.getUserSettings();
        applyLoadedSettings(freshSettings);
      } catch (e) {
        dbgWarn("chat", "failed to load settings after settings hop:", e);
        applyLoadedSettings(bootstrap.settings);
      }
      api
        .getAuthOverview()
        .then((ov) => setAuthOverview(ov))
        .catch((e) => dbgWarn("chat", "getAuthOverview failed:", e));
    } else {
      // Phase 1: load settings (required by everything else)
      try {
        const loadedSettings = await api.getUserSettings();
        applyLoadedSettings(loadedSettings);
        api
          .getAuthOverview()
          .then((ov) => setAuthOverview(ov))
          .catch((e) => dbgWarn("chat", "getAuthOverview failed:", e));
        checkAllLocalProxies();
      } catch (e) {
        dbgWarn("chat", "failed to load settings:", e);
      }
    }

    const hasRunContext = Boolean(runId || chatViewCache.lastRunId);
    const skipRunsFetch = Boolean(bootstrap && hasRunContext);

    if (!bootstrap || !skipRunsFetch) {
      checkAllLocalProxies();
    }

    // Phase 2: parallel fetch of independent data (skipped when returning to an active run)
    if (!skipRunsFetch) {
      const [agentResult, runsResult] = await Promise.allSettled([
        bootstrap ? Promise.resolve(null) : api.getAgentSettings("claude"),
        api.listRuns(),
      ]);

      if (!bootstrap && agentResult.status === "fulfilled") {
        setAgentSettings(agentResult.value);
        try {
          const cliCfg = await api.getCliConfig();
          const cliEffort = cliCfg.effortLevel;
          setCurrentEffort(typeof cliEffort === "string" && cliEffort ? cliEffort : "");
        } catch {
          setCurrentEffort("");
        }
        if (agentResult.value?.effort) {
          api
            .updateAgentSettings("claude", { effort: "" })
            .catch((e) => dbgWarn("chat", "clear effort failed:", e));
        }
      } else if (!bootstrap && agentResult.status === "rejected") {
        dbgWarn("chat", "failed to load agent settings:", agentResult.reason);
      }

      if (runsResult.status === "fulfilled") {
        const continuable =
          runsResult.value.find(
            (r) =>
              r.session_id &&
              (r.status === "completed" || r.status === "stopped" || r.status === "failed"),
          ) ?? null;
        setLastContinuableRun(continuable);

        if (!runId && continuable) {
          goto(`/chat?run=${continuable.id}&resume=continue`, { replaceState: true });
          return;
        }
      } else {
        dbgWarn("chat", "failed to load runs for continue:", runsResult.reason);
      }
    } else if (bootstrap?.agentSettings?.effort) {
      api
        .updateAgentSettings("claude", { effort: "" })
        .catch((e) => dbgWarn("chat", "clear effort failed:", e));
    }

    // Phase 3: permission mode init (depends on settings + agentSettings)
    if (!store.permissionModeSetByUser) {
      const currentSettings = getSettings();
      const currentAgentSettings = getAgentSettings();
      if (currentAgentSettings?.plan_mode) {
        store.permissionMode = "plan";
        store.permissionModeSetByUser = true;
      } else if (currentSettings?.permission_mode) {
        const cliName =
          APP_TO_CLI_MODE[currentSettings.permission_mode] ?? currentSettings.permission_mode;
        store.permissionMode = cliName;
        store.permissionModeSetByUser = true;
      }
    }
    let selfHealDone = false;
    let selfHealInFlight = false;
    loadCliInfo().then(() => {
      const currentSettings = getSettings();
      // Self-heal: detect and fix contaminated default_model
      if (currentSettings?.default_model && !selfHealDone && !selfHealInFlight) {
        const dm = currentSettings.default_model;
        const contaminated = isContaminatedDefaultModel(dm);
        if (contaminated === true) {
          const healModel = getCliCurrentModel();
          if (healModel) {
            selfHealInFlight = true;
            dbg("chat", "self-heal: default_model contaminated, persisting fix", {
              old: dm,
              new: healModel,
            });
            api
              .updateUserSettings({ default_model: healModel })
              .then(() => {
                const s = getSettings();
                if (s) setSettings({ ...s, default_model: healModel });
                setLastKnownGoodModel(healModel);
                selfHealDone = true;
                dbg("chat", "self-heal: persist succeeded");
              })
              .catch((e) => {
                dbgWarn("chat", "self-heal persist failed, will retry next loadCliInfo", e);
              })
              .finally(() => {
                selfHealInFlight = false;
              });
          } else {
            dbg("chat", "self-heal: contaminated but CLI model unavailable, deferring", { dm });
          }
        } else if (contaminated === false) {
          selfHealDone = true;
        }
      }

      const cliModel = getCliCurrentModel();
      const isThirdParty = store.platformId && store.platformId !== "anthropic";
      if (cliModel && !isThirdParty) {
        setLastKnownGoodModel(cliModel);
      }
      if (cliModel && !store.run && !getRunId() && store.phase !== "loading" && !isThirdParty) {
        dbg("chat", "set model from CLI after loadCliInfo", { cliModel, prev: store.model });
        store.model = cliModel;
      }
    });
    loadCliVersionInfo();
    checkProjectInit();
    // Preload project data from filesystem (no session needed)
    if (!runId) {
      const cwd = localStorage.getItem(LS_PROJECT_CWD) || "";
      reloadProjectData(cwd);
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // Block 2: Project folder change listener onMount
  // ════════════════════════════════════════════════════════════════════
  onMount(() => {
    const handler = () => {
      checkProjectInit();
      if (!getRunId() && !store.run) {
        const cwd = localStorage.getItem(LS_PROJECT_CWD) || "";
        reloadProjectData(cwd);
      }
    };
    window.addEventListener(EVT_PROJECT_CHANGED, handler);
    return () => window.removeEventListener(EVT_PROJECT_CHANGED, handler);
  });

  // ════════════════════════════════════════════════════════════════════
  // Block 3: File IPC warmup onMount
  // ════════════════════════════════════════════════════════════════════
  onMount(() => {
    const cwd = localStorage.getItem(LS_PROJECT_CWD) || "";
    if (!cwd) return;
    const t0 = performance.now();
    api
      .statTextFile(cwd, cwd)
      .then(() => dbg("file-ipc", "warmup done", { ms: +(performance.now() - t0).toFixed(0) }))
      .catch((e) =>
        dbg("file-ipc", "warmup err (still warmed)", {
          ms: +(performance.now() - t0).toFixed(0),
          err: String(e),
        }),
      );
  });

  // ════════════════════════════════════════════════════════════════════
  // Block 4: Runs-changed sync onMount
  // ════════════════════════════════════════════════════════════════════
  onMount(() => {
    function onRunsChanged() {
      if (!store.run) return;
      const id = store.run.id;
      api
        .getRun(id)
        .then((fresh) => {
          if (fresh && store.run?.id === id && fresh.name !== store.run.name) {
            dbg("chat", "runs-changed: syncing name", { id, name: fresh.name });
            store.run = { ...store.run, name: fresh.name ?? undefined };
            if (fresh.name) setAutoNameDone(true);
          }
        })
        .catch((e) => {
          dbgWarn("chat", "runs-changed: failed to sync name", e);
        });
    }
    window.addEventListener(EVT_RUNS_CHANGED, onRunsChanged);
    return () => window.removeEventListener(EVT_RUNS_CHANGED, onRunsChanged);
  });

  // ════════════════════════════════════════════════════════════════════
  // Block 5: Middleware start onMount
  // ════════════════════════════════════════════════════════════════════
  onMount(() => {
    let destroyed = false;
    if (middleware.isStarted()) {
      setMiddlewareReady(true);
    }
    (async () => {
      try {
        await middleware.start();
      } catch (e) {
        dbgWarn("chat", "middleware.start() failed:", e);
        store.error = t("chat_eventSystemFailed");
      }
      try {
        const { startNotificationListener } = await import("$lib/services/notification-listener");
        await startNotificationListener();
      } catch {
        // Non-critical: notifications are best-effort
      }
      try {
        const { startSoundFeedbackListener } =
          await import("$lib/services/sound-feedback-listener");
        await startSoundFeedbackListener();
      } catch {
        // Non-critical: semantic sounds are best-effort
      }
      if (!destroyed) setMiddlewareReady(true);
    })();

    middleware.setPipeHandler({
      onDelta(delta) {
        store.handleChatDelta(delta.text, getXtermRef());
      },
      onDone(done) {
        store.handleChatDone(done);
      },
    });

    middleware.setRunEventHandler({
      onRunEvent(event) {
        const xtermRef = getXtermRef();
        if (
          store.run?.execution_path === "pipe_exec" &&
          store.run &&
          event.run_id === store.run.id &&
          xtermRef
        ) {
          if (event.type === "stderr") {
            xtermRef.writeText(`\x1b[31m${event.text}\x1b[0m\r\n`);
          }
        }
      },
    });

    return () => {
      destroyed = true;
      const forkOverlay = getForkOverlay();
      if (forkOverlay?.active && store.run && store.run.id !== forkOverlay.sourceRunId) {
        api
          .stopSession(store.run.id)
          .catch((e) => dbgWarn("chat", "stopSession on unmount failed:", e));
      }
      store.unmountGuards();
      if (isChatSettingsHop()) {
        dbg("chat", "middleware preserved (navigating to settings)");
      } else {
        middleware.destroy();
      }
    };
  });

  // ════════════════════════════════════════════════════════════════════
  // Block 6: Keybinding registration onMount
  // ════════════════════════════════════════════════════════════════════
  onMount(() => {
    requestAnimationFrame(() => getPromptRef()?.focus());
    function onStatusBarToggle(e: Event) {
      setStatusBarExpanded((e as CustomEvent).detail.expanded);
    }
    window.addEventListener(EVT_STATUSBAR_TOGGLE, onStatusBarToggle);

    keybindingStore.registerCallback("chat:interrupt", () => {
      if (getShortcutHelpOpen()) {
        setShortcutHelpOpen(false);
        return;
      }
      if (store.isRunning) {
        store.interrupt();
      }
    });
    keybindingStore.registerCallback("chat:sendGlobal", () => {
      if (!store.isRunning) {
        getPromptRef()?.triggerSend();
      }
    });
    keybindingStore.registerCallback("app:shortcutHelp", () => {
      setShortcutHelpOpen(!getShortcutHelpOpen());
    });
    keybindingStore.registerCallback("app:modelPicker", () => {
      getStatusBarRef()?.openModelDropdown();
    });
    keybindingStore.registerCallback("chat:cyclePermission", () => {
      const active = document.activeElement;
      if (active && active !== document.body) {
        const el = active as HTMLElement;
        const isFocusable =
          el.tagName === "BUTTON" ||
          el.tagName === "SELECT" ||
          el.tagName === "A" ||
          (el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1") ||
          el.closest("[role='menu']") ||
          el.closest("[role='listbox']") ||
          el.closest("[role='dialog']") ||
          (el.hasAttribute("role") &&
            ["button", "link", "menuitem", "option", "tab"].includes(
              el.getAttribute("role") ?? "",
            ));
        if (isFocusable) return;
      }
      const modes = ["default", "acceptEdits", "bypassPermissions", "plan", "auto", "dontAsk"];
      const idx = modes.indexOf(store.permissionMode);
      const next = modes[(idx + 1) % modes.length];
      handlePermissionModeChange(next);
    });
    keybindingStore.registerCallback("chat:stashPrompt", () => {
      const stashedInput = getStashedInput();
      const promptRef = getPromptRef();
      if (stashedInput) {
        promptRef?.restoreSnapshot(stashedInput);
        setStashedInput(null);
        setShowChatToast(t("toast_stashRestored"));
      } else {
        const snapshot = promptRef?.getInputSnapshot();
        if (
          snapshot &&
          (snapshot.text.trim() ||
            snapshot.attachments.length ||
            snapshot.pastedBlocks.length ||
            (snapshot.pathRefs?.length ?? 0) > 0)
        ) {
          setStashedInput(snapshot);
          promptRef?.clearAll();
          setShowChatToast(t("toast_stashSaved"));
        }
      }
    });
    keybindingStore.registerCallback("app:toggleFastMode", () => {
      toggleCliConfigBool("fastMode");
    });
    keybindingStore.registerCallback("chat:toggleVerbose", () => {
      toggleCliConfigBool("verbose");
    });
    keybindingStore.registerCallback("chat:toggleTasks", () => {
      if (store.hasBackgroundTasks) {
        if (getSidebarCollapsed()) setSidebarCollapsed(false);
        setSidebarRequestedTab("tasks");
      }
    });
    keybindingStore.registerCallback("chat:undoLastTurn", () => {
      handleRewind();
    });
    keybindingStore.registerCallback("app:summarizeChat", () => void handleSummarize());
    const onSummarizeEvent = () => {
      window.dispatchEvent(new CustomEvent(EVT_SUMMARIZE_CHAT_ACK));
      void handleSummarize();
    };
    window.addEventListener(EVT_SUMMARIZE_CHAT, onSummarizeEvent);

    const chatTransport = getTransport();
    const screenshotUnlisten = chatTransport.listen<ScreenshotPayload>(
      "screenshot-taken",
      (payload) => {
        dbg("chat", "screenshot-taken", { filename: payload.filename });
        const { contentBase64, mediaType, filename } = payload;
        const bytes = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
        const file = new File([bytes], filename, { type: mediaType });
        getPromptRef()?.addFiles([file]);
      },
    );

    const dragEnterUnlisten = chatTransport.listen<{ paths: string[] }>(
      "tauri://drag-enter",
      () => {
        if (isSessionDragActive()) return;
        setPageDragActive(true);
      },
    );
    const dragLeaveUnlisten = chatTransport.listen("tauri://drag-leave", () => {
      setPageDragActive(false);
    });
    const clearPageDrag = () => {
      setPageDragActive(false);
    };
    window.addEventListener("dragend", clearPageDrag);
    window.addEventListener("drop", clearPageDrag);
    const dragDropUnlisten = chatTransport.listen<{ paths: string[] }>(
      "tauri://drag-drop",
      (payload) => {
        const promptRef = getPromptRef();
        if (!promptRef) return;
        execTauriDrop(
          {
            promptRef,
            t: t as unknown as (key: string, params?: Record<string, string>) => string,
            onDragEnd: () => setPageDragActive(false),
            onProcessingStart: () => setDragProcessingCount((prev) => prev + 1),
            onProcessingEnd: () => setDragProcessingCount((prev) => prev - 1),
          },
          payload,
        );
      },
    );

    return () => {
      window.removeEventListener(EVT_STATUSBAR_TOGGLE, onStatusBarToggle);
      keybindingStore.unregisterCallback("chat:interrupt");
      keybindingStore.unregisterCallback("chat:sendGlobal");
      keybindingStore.unregisterCallback("app:shortcutHelp");
      keybindingStore.unregisterCallback("app:modelPicker");
      keybindingStore.unregisterCallback("chat:cyclePermission");
      keybindingStore.unregisterCallback("chat:stashPrompt");
      keybindingStore.unregisterCallback("app:toggleFastMode");
      keybindingStore.unregisterCallback("chat:toggleVerbose");
      keybindingStore.unregisterCallback("chat:toggleTasks");
      keybindingStore.unregisterCallback("chat:undoLastTurn");
      keybindingStore.unregisterCallback("app:summarizeChat");
      window.removeEventListener(EVT_SUMMARIZE_CHAT, onSummarizeEvent);
      screenshotUnlisten.then((fn) => fn());
      dragEnterUnlisten.then((fn) => fn());
      dragLeaveUnlisten.then((fn) => fn());
      dragDropUnlisten.then((fn) => fn());
      window.removeEventListener("dragend", clearPageDrag);
      window.removeEventListener("drop", clearPageDrag);
      cleanupVerbose();
      cancelProgressive();
    };
  });

  // ════════════════════════════════════════════════════════════════════
  // Block 7: Context snapshot listener onMount
  // ════════════════════════════════════════════════════════════════════
  onMount(() => {
    const unlisten = getTransport().listen<{
      runId: string;
      content: string;
      turnIndex: number;
      ts: string;
    }>("context-snapshot", (payload) => {
      const { runId, content, turnIndex, ts } = payload;
      dbg("chat", "context-snapshot-recv", { runId, turnIndex, len: content.length });
      if (runId !== store.run?.id) return;
      const data = parseContextMarkdown(content);
      if (!data) {
        dbgWarn("chat", "context-parse-failed", {
          runId,
          turnIndex,
          head: content.slice(0, 200),
        });
        return;
      }
      const prev = contextHistoryMap.get(runId) ?? [];
      const existingIdx = prev.findIndex((s) => s.turnIndex === turnIndex);
      const replaced = existingIdx >= 0;
      const updated = replaced
        ? prev.map((s, i) => (i === existingIdx ? { runId, turnIndex, ts, data } : s))
        : [...prev, { runId, turnIndex, ts, data }];
      contextHistoryMap.set(runId, updated);
      // Evict oldest runs if map grows beyond cap (keeps last 20 runs)
      if (contextHistoryMap.size > 20) {
        const oldest = contextHistoryMap.keys().next().value;
        if (oldest) contextHistoryMap.delete(oldest);
      }
      triggerContextHistoryReactivity();
      dbg("chat", "context-snapshot", { turn: turnIndex, pct: data.percentage, replaced });
    });
    return () => {
      unlisten.then((f) => f());
    };
  });

  // ════════════════════════════════════════════════════════════════════
  // Block 8: BTW event listeners onMount
  // ════════════════════════════════════════════════════════════════════
  onMount(() => {
    const transport = getTransport();
    const deltaUnlisten = transport.listen<BtwDelta>("btw-delta", (ev) => {
      const btwState = getBtwState();
      if (btwState.active) {
        dbg("chat", "btw-delta", { len: ev.text.length });
        setBtwState({ ...btwState, answer: btwState.answer + ev.text });
      }
    });
    const completeUnlisten = transport.listen<BtwComplete>("btw-complete", (ev) => {
      const btwState = getBtwState();
      if (btwState.active) {
        dbg("chat", "btw-complete", { btwId: ev.btw_id });
        setBtwState({ ...btwState, loading: false });
      }
    });
    const errorUnlisten = transport.listen<BtwError>("btw-error", (ev) => {
      const btwState = getBtwState();
      if (btwState.active) {
        dbgWarn("chat", "btw-error", { error: ev.error });
        setBtwState({ ...btwState, error: ev.error, loading: false });
      }
    });
    return () => {
      deltaUnlisten.then((f) => f());
      completeUnlisten.then((f) => f());
      errorUnlisten.then((f) => f());
    };
  });
}
