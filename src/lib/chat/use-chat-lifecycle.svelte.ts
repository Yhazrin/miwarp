/**
 * Composable: chat page lifecycle, effects, and remaining page-level state.
 *
 * Extracts from +page.svelte:
 *   - All settings/auth/init state + settings load lifecycle (Phase 1-3)
 *   - Thinking timer + spinner state
 *   - Fork timer + phase watcher effects (delegates to sessionLifecycle)
 *   - Task notification effect
 *   - URL param consumption (?folder=, ?host=, ?resume=)
 *   - Run ID $effect (load run + subscribe middleware)
 *   - scrollTo $effect for already-loaded runs
 *   - Model contamination detection + self-heal
 *   - Model restore $effect
 *   - Permission mode init
 *   - Effort guard $effect
 *   - Run filter reset $effect
 *   - Auto-name latch $effect
 *   - Rewind markers clear $effect
 *   - Verbose sync function + $effect
 *   - Tool result lazy-load cache
 *   - Folder picker state + openFolderPicker
 *   - onMount: focus, keybindings, screenshot/drag-drop listeners
 *   - onMount: context-snapshot listener
 *   - onMount: BTW event listeners
 *   - onMount: project folder change listener
 *   - onMount: file IPC warmup
 *   - onMount: run name sync (ocv:runs-changed)
 *   - onMount: middleware start + pipe/run handlers
 *   - Permission panel visibility log effect
 */
import { page } from "$app/stores";
import { replaceState } from "$app/navigation";
import { tick, onMount, untrack } from "svelte";
import { fromStore, get } from "svelte/store";
import { getTransport } from "$lib/transport";
import * as api from "$lib/api";
import {
  loadCliInfo,
  getCliCurrentModel,
  getCliModels,
  loadCliVersionInfo,
  KeybindingStore,
} from "$lib/stores";
import type { SessionStore } from "$lib/stores/session-store.svelte";
import type { EventMiddleware } from "$lib/stores/event-middleware";
import type {
  UserSettings,
  AgentSettings,
  RemoteHost,
  AuthOverview,
  ProjectInitStatus,
  ScreenshotPayload,
  CliModelInfo,
  BtwDelta,
  BtwComplete,
  BtwError,
  Attachment,
} from "$lib/types";
import { PLATFORM_PRESETS, findCredential } from "$lib/utils/platform-presets";
import { parseContextMarkdown } from "$lib/utils/context-parser";
import type { ContextSnapshot } from "$lib/types";
import { getLastTarget, setLastTarget, setStoredRemoteCwd } from "$lib/utils/remote-cwd";
import { PROJECT_CWD_KEY, RUNS_CHANGED_KEY, PROJECT_CHANGED_KEY } from "$lib/utils/storage-keys";
import { randomSpinnerVerb } from "$lib/utils/spinner-verbs";
import { t } from "$lib/i18n/index.svelte";
import { dbg, dbgWarn } from "$lib/utils/debug";

import {
  getCachedUserSettings,
  setCachedUserSettings,
  getCachedAgentSettings,
  setCachedAgentSettings,
} from "$lib/stores/chat-page-singletons";

import type { useProjectPreload } from "$lib/chat/use-project-preload.svelte";
import type { useProgressiveTimeline } from "$lib/chat/use-progressive-timeline.svelte";
import type { useChatController } from "$lib/chat/use-chat-controller.svelte";
import type { useExportController } from "$lib/chat/use-export-controller.svelte";
import type XTerminal from "$lib/components/XTerminal.svelte";
import type PromptInput from "$lib/components/PromptInput.svelte";
import type SessionStatusBar from "$lib/components/SessionStatusBar.svelte";
import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
import type { PromptInputSnapshot } from "$lib/types";
import type { RewindMarker } from "$lib/utils/rewind";

// ── Permission mode translation maps ──

/** Store/dropdown use CLI names; UserSettings uses app names; adapter.rs maps app→CLI. */
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

// ── Types ──

export interface UseChatLifecycleOptions {
  store: SessionStore;
  middleware: EventMiddleware;
  preload: ReturnType<typeof useProjectPreload>;
  progressive: ReturnType<typeof useProgressiveTimeline>;
  ctrl: ReturnType<typeof useChatController>;

  // Refs (reactive getters)
  xtermRef: () => XTerminal | undefined;
  promptRef: () => PromptInput | undefined;
  statusBarRef: () => SessionStatusBar | undefined;

  // From other composables
  sessionLifecycle: {
    handleResume: (
      mode: import("$lib/types").SessionMode,
      overrideRunId?: string,
      opts?: { initialMessage?: string; initialAttachments?: Attachment[] },
    ) => Promise<void>;
    resuming: { get: () => boolean };
  };
  dragDrop: {
    pageDragActive: boolean;
    dragProcessing: boolean;
    handleTauriDrop: (payload: { paths: string[] }) => Promise<void>;
  };
  exportCtrl: ReturnType<typeof useExportController>;

  // Context
  keybindingStore: KeybindingStore;

  // Callbacks
  showChatToast: (msg: string) => void;
  scrollToMessage: (ts: string) => Promise<void>;
  handleRewind: () => void;
  handlePermissionModeChange: (mode: string) => Promise<boolean>;

  // Page-owned state access (for BTW listeners and fork cleanup)
  getBtwState: () => {
    active: boolean;
    btwId: string | null;
    question: string;
    answer: string;
    error: string | null;
    loading: boolean;
  };
  getForkOverlay: () => {
    active: boolean;
    sourceRunId: string;
    startedAt: number;
    error: string | null;
  } | null;

  // Page-owned state access (getter/setter pairs for state that stays in page)
  getRewindMarkers: () => RewindMarker[];
  setRewindMarkers: (v: RewindMarker[]) => void;
  getCurrentEffort: () => string;
  setCurrentEffort: (v: string) => void;
  getStashedInput: () => PromptInputSnapshot | null;
  setStashedInput: (v: PromptInputSnapshot | null) => void;
  getShortcutHelpOpen: () => boolean;
  setShortcutHelpOpen: (v: boolean) => void;
  getFolderCwdOverride: () => string;
  setFolderCwdOverride: (v: string) => void;
  getContextHistoryMap: () => Map<string, ContextSnapshot[]>;
  setContextHistoryMap: (v: Map<string, ContextSnapshot[]>) => void;
  // Page-owned derived/state needed by effects
  effectiveModels: () => CliModelInfo[];
  pendingToolPermissions: () => Array<{ requestId: string; tool: { tool_name: string } }>;
  // Sidebar tab state (keybinding callback)
  setSidebarRequestedTab: (v: ToolActivityPanelTab) => void;
}

// ── Main composable ──

export function useChatLifecycle(options: UseChatLifecycleOptions) {
  const {
    store,
    middleware,
    preload,
    progressive,
    ctrl,
    xtermRef,
    promptRef,
    statusBarRef,
    sessionLifecycle,
    dragDrop,
    exportCtrl,
    keybindingStore,
    showChatToast,
    scrollToMessage,
    handleRewind,
    handlePermissionModeChange,
    getBtwState,
    getForkOverlay,
    getRewindMarkers: _getRewindMarkers,
    setRewindMarkers,
    getCurrentEffort,
    setCurrentEffort,
    getStashedInput,
    setStashedInput,
    getShortcutHelpOpen,
    setShortcutHelpOpen,
    setFolderCwdOverride,
    getContextHistoryMap,
    setContextHistoryMap,
    effectiveModels,
    pendingToolPermissions,
    setSidebarRequestedTab,
  } = options;
  const pageState = fromStore(page);

  // ── Core state ──
  let middlewareReady = $state(false);
  let settings = $state<UserSettings | null>(null);
  let agentSettings = $state<AgentSettings | null>(null);

  // ── UI flags ──
  let lastContinuableRun = $state<import("$lib/types").TaskRun | null>(null);
  let welcomeQuickActionsReady = $state(false);
  let remoteHosts = $state<RemoteHost[]>([]);
  let authOverview = $state<AuthOverview | null>(null);
  let localProxyStatuses = $state<Record<string, { running: boolean; needsAuth: boolean }>>({});

  // ── Model contamination ──
  /** Cache of last confirmed-clean Anthropic model, used as final fallback. */
  let lastKnownGoodAnthropicModel: string | undefined;

  function isContaminatedDefaultModelFn(dm: string): boolean | null {
    const cliModels = getCliModels();
    if (!cliModels.length) return null;
    if (cliModels.some((m) => m.value === dm)) return false;

    const inThirdParty =
      PLATFORM_PRESETS.some(
        (p) => p.id !== "anthropic" && p.id !== "custom" && p.models?.includes(dm),
      ) ||
      (settings?.platform_credentials ?? []).some(
        (c) => c.platform_id !== "anthropic" && c.models?.includes(dm),
      );
    return inThirdParty ? true : null;
  }

  // ── Project init ──
  let projectInitStatus = $state<ProjectInitStatus | null>(null);
  let initCheckSeq = 0;

  const showInitHint = $derived(
    projectInitStatus !== null && !projectInitStatus.has_claude_md && !store.run,
  );

  async function checkProjectInit() {
    const cwd = localStorage.getItem(PROJECT_CWD_KEY) || "";
    if (!cwd || cwd === "/") {
      projectInitStatus = null;
      dbg("chat", "checkProjectInit: skip (no cwd)");
      return;
    }
    const seq = ++initCheckSeq;
    try {
      const status = await api.checkProjectInit(cwd);
      dbg("chat", "checkProjectInit result", {
        cwd,
        status,
        seq,
        currentSeq: initCheckSeq,
        hasRun: !!store.run,
        isApiMode: store.isApiMode,
      });
      if (seq !== initCheckSeq) return;
      const dismissKey = `ocv:init-dismissed:${status.cwd}`;
      const dismissed = localStorage.getItem(dismissKey);
      if (dismissed) {
        projectInitStatus = null;
        dbg("chat", "checkProjectInit: dismissed", dismissKey);
        return;
      }
      projectInitStatus = status;
    } catch (e) {
      dbgWarn("chat", "checkProjectInit failed", e);
      if (seq === initCheckSeq) projectInitStatus = null;
    }
  }

  function dismissInitHint() {
    if (projectInitStatus?.cwd) {
      localStorage.setItem(`ocv:init-dismissed:${projectInitStatus.cwd}`, "1");
    }
    projectInitStatus = null;
    dbg("chat", "init hint dismissed");
  }

  // ── Notification ──
  let notificationVisible = $state(false);
  let latestNotification = $state<{ task_id: string; status: string } | null>(null);

  // ── Verbose ──
  let verboseEnabled = $state(false);
  let verboseSeq = 0;
  let lastSyncedRunId = "__unset__";
  let verboseRetryTick = $state(0);
  let verboseRetryCount = 0;
  let verboseRetryTimer: ReturnType<typeof setTimeout> | null = null;
  const VERBOSE_MAX_RETRIES = 3;

  async function syncVerboseState(runId: string | undefined) {
    const key = runId ?? "__no_run__";
    if (key === lastSyncedRunId) return;
    const seq = ++verboseSeq;
    verboseRetryCount = 0;
    try {
      const cfg = await api.getCliConfig();
      if (seq !== verboseSeq) return;
      lastSyncedRunId = key;
      verboseEnabled = cfg.verbose === true;
      dbg("chat", "verbose state synced", { verbose: verboseEnabled, runId, seq });
    } catch {
      if (seq === verboseSeq && verboseRetryCount < VERBOSE_MAX_RETRIES) {
        verboseRetryCount++;
        verboseRetryTimer = setTimeout(() => {
          verboseRetryTimer = null;
          verboseRetryTick++;
        }, 3000);
      }
    }
  }

  // ── Tool result cache ──
  let toolResultCache = new Map<string, Record<string, unknown>>();
  let toolResultInflight = new Map<string, Promise<Record<string, unknown> | null>>();

  async function fetchToolResult(
    runId: string,
    toolUseId: string,
  ): Promise<Record<string, unknown> | null> {
    const key = `${runId}:${toolUseId}`;
    const cached = toolResultCache.get(key);
    if (cached) return cached;
    let pending = toolResultInflight.get(key);
    if (!pending) {
      pending = api.getToolResult(runId, toolUseId);
      toolResultInflight.set(key, pending);
    }
    try {
      const result = await pending;
      if (result && store.run?.id === runId) {
        toolResultCache.set(key, result);
      }
      return result;
    } finally {
      toolResultInflight.delete(key);
    }
  }

  // ── UI state ──
  let targetDropdownOpen = $state(false);
  let toolFilter = $state<string | null>(null);
  let sidebarCollapsed = $state(false);
  let statusBarExpanded = $state(
    typeof window !== "undefined"
      ? localStorage.getItem("ocv:statusbar-expanded") !== "false"
      : true,
  );

  // ── Folder picker ──
  let folderPickerOpen = $state(false);
  let folderPickerInitialHost = $state<string | null>(null);
  let folderPickerInitialPath = $state("");
  let folderPickerHideTarget = $state(false);
  let folderPickerResolve: ((v: { hostName: string | null; path: string } | null) => void) | null =
    null;

  function openFolderPicker(opts: {
    initialHost?: string | null;
    initialPath?: string;
    hideTargetSelector?: boolean;
  }): Promise<{ hostName: string | null; path: string } | null> {
    folderPickerInitialHost = opts.initialHost ?? null;
    folderPickerInitialPath = opts.initialPath ?? "";
    folderPickerHideTarget = opts.hideTargetSelector ?? false;
    folderPickerOpen = true;
    return new Promise((resolve) => {
      folderPickerResolve = resolve;
    });
  }

  // ── Thinking timer + panel ──
  let thinkingElapsed = $state(0);
  let thinkingExpanded = $state(true);
  let spinnerVerb = $state(randomSpinnerVerb());
  /** Plain flag (not $state) — avoids $effect dependency cycle with thinkingElapsed. */
  let thinkingVerbPicked = false;
  /** Debounced visibility — prevents spinner flash on fast CLI commands (/context, /cost). */
  let thinkingVisible = $state(false);

  function formatElapsed(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  // ── Context snapshot tracking ──
  // (contextHistoryMap is page-owned; this composable listens for events and updates it)

  // ── Page URL helpers ──
  // These are derived from the page store within effects to avoid coupling to $page directly.

  // ========================================================================
  // Effects
  // ========================================================================

  // ── Thinking timer effect ──
  $effect(() => {
    if (store.isThinking) {
      const base = store.thinkingStartMs || Date.now();
      if (!thinkingVerbPicked) {
        spinnerVerb = randomSpinnerVerb();
        thinkingVerbPicked = true;
      }
      const showTimer = setTimeout(() => {
        thinkingVisible = true;
      }, 300);
      // Avoid feeding this composable `$state` write back into the same effect scheduling graph as `store.isThinking`.
      untrack(() => {
        thinkingElapsed = Math.max(0, Math.floor((Date.now() - base) / 1000));
      });
      const interval = setInterval(() => {
        thinkingElapsed = Math.max(0, Math.floor((Date.now() - base) / 1000));
      }, 1000);
      return () => {
        clearTimeout(showTimer);
        clearInterval(interval);
      };
    } else {
      untrack(() => {
        thinkingElapsed = 0;
        thinkingVisible = false;
      });
      thinkingVerbPicked = false;
    }
  });

  // ── Task notification: auto-show and dismiss after 5s ──
  $effect(() => {
    const notifications = store.taskNotifications;
    if (notifications.size === 0) return;
    const latest = Array.from(notifications.values()).pop();
    if (!latest) return;
    latestNotification = { task_id: latest.task_id, status: latest.status };
    notificationVisible = true;
    const timer = setTimeout(() => {
      notificationVisible = false;
    }, 5000);
    return () => clearTimeout(timer);
  });

  // ── Tool result cache: clear on run switch ──
  $effect(() => {
    const _ = store.run?.id;
    toolResultCache = new Map();
    toolResultInflight = new Map();
  });

  // ── Effort guard: auto-clear effort when model doesn't support it;
  //    also auto-populate default effort ("high") when empty and model supports it. ──
  $effect(() => {
    if (store.agent !== "claude") return;
    const pid = store.platformId;
    if (pid && pid !== "anthropic") return;

    const modelInfo = effectiveModels().find((m) => m.value === store.model);
    if (!modelInfo) return;

    const effort = getCurrentEffort();
    if (effort && modelInfo.supportsEffort === false) {
      dbg("chat", "effort-guard: clearing for unsupported model", { model: store.model });
      setCurrentEffort("");
      api.updateCliConfig({ effortLevel: null }).catch((e) => {
        dbgWarn("chat", "effort-guard: CLI config clear failed", e);
      });
    } else if (!effort && modelInfo.supportsEffort === true) {
      dbg("chat", "effort-guard: defaulting to high", { model: store.model });
      setCurrentEffort("high");
      api.updateCliConfig({ effortLevel: "high" }).catch((e) => {
        dbgWarn("chat", "effort-guard: CLI config default failed", e);
      });
    }
  });

  // ── Reset filter on run change & auto-focus input ──
  $effect(() => {
    const _ = store.run?.id;
    toolFilter = null;
    requestAnimationFrame(() => promptRef()?.focus());
  });

  // ── Sync verbose state from CLI config when run changes (or on retry) ──
  $effect(() => {
    const _tick = verboseRetryTick;
    const rid = store.run?.id;
    untrack(() => {
      void syncVerboseState(rid);
    });
  });

  // ── Auto-name one-shot latch: reset only on actual run ID change ──
  let prevAutoNameRunId = "";
  let autoNameDone = false;
  $effect(() => {
    const id = store.run?.id ?? "";
    if (id !== prevAutoNameRunId) {
      prevAutoNameRunId = id;
      autoNameDone = false;
    }
  });
  // Expose autoNameDone for page's auto-name effect
  function getAutoNameDone() {
    return autoNameDone;
  }
  function setAutoNameDone(v: boolean) {
    autoNameDone = v;
  }

  // ── Clear rewind markers on run switch ──
  let prevRewindRunId = "";
  $effect(() => {
    const id = store.run?.id ?? "";
    if (id !== prevRewindRunId) {
      prevRewindRunId = id;
      setRewindMarkers([]);
    }
  });

  // ── Restore model when store.model is empty ──
  $effect(() => {
    if (!store.model) {
      if (store.phase === "loading") return;

      const isThirdParty = store.platformId && store.platformId !== "anthropic";
      if (isThirdParty) {
        const restoreCred = findCredential(
          settings?.platform_credentials ?? [],
          store.platformId ?? "",
        );
        const restorePreset = PLATFORM_PRESETS.find((p) => p.id === store.platformId);
        const restoreModels = restoreCred?.models?.length
          ? restoreCred.models
          : restorePreset?.models;
        if (restoreModels?.[0]) {
          dbg("chat", "restore model from credential/preset", {
            platform: store.platformId,
            model: restoreModels[0],
          });
          store.model = restoreModels[0];
          return;
        }
      }
      const cliModel = getCliCurrentModel();
      const isAnthropicPlatform = !store.platformId || store.platformId === "anthropic";
      const rawFallback = isAnthropicPlatform ? settings?.default_model : undefined;
      const contaminated = rawFallback ? isContaminatedDefaultModelFn(rawFallback) : null;
      const fallback = contaminated === false ? rawFallback : undefined;
      const model =
        cliModel || fallback || (isAnthropicPlatform ? lastKnownGoodAnthropicModel : undefined);
      if (model) {
        if (isAnthropicPlatform && (cliModel || contaminated === false)) {
          lastKnownGoodAnthropicModel = model;
        }
        dbg("chat", "restore model", {
          cliModel,
          rawFallback,
          contaminated,
          lastKnownGood: lastKnownGoodAnthropicModel,
          using: model,
        });
        store.model = model;
      }
    }
  });

  // ── Permission panel visibility log ──
  let _prevPanelCount = 0;
  $effect(() => {
    const count = pendingToolPermissions().length;
    if (count !== _prevPanelCount) {
      if (count > 0)
        dbg("chat", "permissionPanel visible", {
          count,
          ids: pendingToolPermissions().map((p) => p.requestId),
          tools: pendingToolPermissions().map((p) => p.tool.tool_name),
        });
      else if (_prevPanelCount > 0) dbg("chat", "permissionPanel hidden");
      _prevPanelCount = count;
    }
  });

  // ── URL param consumption: ?folder= and ?host= ──
  // NOTE: entire body is untracked because it calls replaceState which changes pageState.current.url
  $effect(() => {
    untrack(() => {
      const url = pageState.current.url;
      const folder = url.searchParams.get("folder");
      const host = url.searchParams.get("host");
      if (!folder && !host) return;
      dbg("chat", "url params", { folder, host });
      let resolvedHost: string | null = null;
      if (host !== null) {
        if (host === "") {
          resolvedHost = null;
        } else if (remoteHosts.length === 0 || remoteHosts.some((h) => h.name === host)) {
          resolvedHost = host;
        } else {
          dbgWarn("chat", "URL ?host= references unknown remote — ignoring", { host });
          resolvedHost = null;
        }
        store.remoteHostName = resolvedHost;
        setLastTarget(resolvedHost);
      }
      if (folder) {
        if (resolvedHost) {
          setStoredRemoteCwd(resolvedHost, folder);
        } else {
          try {
            localStorage.setItem(PROJECT_CWD_KEY, folder);
          } catch {
            // localStorage may fail in restricted contexts
          }
        }
        setFolderCwdOverride(folder);
        store.loadRun("", xtermRef());
      }
      const clean = new URL(url);
      clean.searchParams.delete("folder");
      clean.searchParams.delete("host");
      replaceState(clean, {});
      requestAnimationFrame(() => promptRef()?.focus());
    });
  });

  // ── Watch runId changes → load run + subscribe middleware ──
  // NOTE: entire body is untracked to avoid effect_update_depth_exceeded.
  // The effect only tracks pageState.current changes (URL navigation).
  $effect(() => {
    untrack(() => {
      const url = pageState.current.url;
      const id = url.searchParams.get("run") ?? "";
      const hasResume = url.searchParams.has("resume");
      middleware.subscribeCurrent(id, store);

      if (store.resumeInFlight || sessionLifecycle.resuming.get()) {
        dbg("effect", "skip loadRun — resume in progress");
        return;
      }
      if (hasResume) return;

      if (!id) {
        store.loadRun("", xtermRef());
        progressive.cancelProgressive();
        return;
      }

      const hasHydratedRunState =
        store.timeline.length > 0 ||
        store.tools.length > 0 ||
        store.turnUsages.length > 0 ||
        !!store.streamingText ||
        !!store.thinkingText ||
        !!store.error ||
        store.sessionAlive;

      if (
        store.run?.id === id &&
        store.phase !== "empty" &&
        store.phase !== "loading" &&
        hasHydratedRunState
      ) {
        dbg("effect", "skip loadRun — run already in singleton store", id, store.phase);
        const scrollTo = url.searchParams.get("scrollTo");
        if (scrollTo) {
          const clean = new URL(url);
          clean.searchParams.delete("scrollTo");
          replaceState(clean, {});
          tick().then(() => scrollToMessage(scrollTo));
        }
        return;
      }

      ctrl.loadRunProgressive(id, xtermRef());
    });
  });

  // ── Handle scrollTo for already-loaded runs ──
  let _scrollToInFlight = false;
  $effect(() => {
    untrack(() => {
      if (!middlewareReady) return;
      const url = pageState.current.url;
      const scrollTo = url.searchParams.get("scrollTo");
      if (!scrollTo) return;
      if (_scrollToInFlight) return;
      if (store.phase === "loading") return;
      const runId = url.searchParams.get("run") ?? "";
      if (store.run?.id !== runId) return;

      dbg("effect", "same-run scrollTo", { scrollTo, runId });
      _scrollToInFlight = true;
      const clean = new URL(url);
      clean.searchParams.delete("scrollTo");
      replaceState(clean, {});
      tick().then(() => {
        scrollToMessage(scrollTo);
        _scrollToInFlight = false;
      });
    });
  });

  // ── Consume ?resume= URL param ──
  // NOTE: entire body is untracked because it calls replaceState which changes pageState.current.url
  $effect(() => {
    untrack(() => {
      const url = pageState.current.url;
      const paramRunId = url.searchParams.get("run");
      const resumeMode = url.searchParams.get("resume") as import("$lib/types").SessionMode | null;

      if (paramRunId && resumeMode) {
        const clean = new URL(url);
        clean.searchParams.delete("resume");
        replaceState(clean, {});
        sessionLifecycle.handleResume(resumeMode, paramRunId);
      }
    });
  });

  // ========================================================================
  // onMount lifecycle hooks
  // ========================================================================

  // ── Phase 1-3: Load settings, agent settings, runs ──
  onMount(async () => {
    // Phase 1: load settings
    try {
      const cached = getCachedUserSettings();
      if (cached) {
        settings = cached;
        api
          .getUserSettings()
          .then(setCachedUserSettings)
          .catch(() => {});
      } else {
        settings = await api.getUserSettings();
        setCachedUserSettings(settings);
      }
      store.authMode = settings.auth_mode ?? "cli";
      remoteHosts = settings.remote_hosts ?? [];
      if (!store.run && remoteHosts.length > 0) {
        const lastTarget = getLastTarget();
        if (lastTarget && remoteHosts.some((h) => h.name === lastTarget)) {
          store.remoteHostName = lastTarget;
        }
      }
      if (!store.platformId) {
        store.platformId =
          settings.auth_mode === "api" ? (settings.active_platform_id ?? "anthropic") : "anthropic";
      }

      // Initialize model for new sessions
      const url = get(page).url;
      const runId = url.searchParams.get("run") ?? "";
      if (!store.model && !runId && store.phase !== "loading") {
        const initCred = findCredential(
          settings.platform_credentials ?? [],
          store.platformId ?? "",
        );
        const initPreset = PLATFORM_PRESETS.find((p) => p.id === store.platformId);
        const initModels = initCred?.models?.length ? initCred.models : initPreset?.models;
        if (store.platformId !== "anthropic" && initModels?.[0]) {
          store.model = initModels[0];
        } else if (store.platformId === "anthropic" && settings.default_model) {
          store.model = settings.default_model;
        }
      }

      api
        .getAuthOverview()
        .then((ov) => (authOverview = ov))
        .catch(() => {});
      checkAllLocalProxies();
    } catch (e) {
      dbgWarn("chat", "failed to load settings:", e);
    }

    // Phase 2: parallel fetch of independent data
    const cachedAgent = getCachedAgentSettings();
    const [agentResult, runsResult] = await Promise.allSettled([
      cachedAgent ? Promise.resolve(cachedAgent) : api.getAgentSettings("claude"),
      api.listRuns(),
    ]);

    const url = get(page).url;
    const runId = url.searchParams.get("run") ?? "";

    if (agentResult.status === "fulfilled") {
      agentSettings = agentResult.value;
      setCachedAgentSettings(agentSettings);
      try {
        const cliCfg = await api.getCliConfig();
        const cliEffort = cliCfg.effortLevel;
        setCurrentEffort(typeof cliEffort === "string" && cliEffort ? cliEffort : "");
      } catch {
        setCurrentEffort("");
      }
      if (agentSettings?.effort) {
        api.updateAgentSettings("claude", { effort: "" }).catch(() => {});
      }
    } else {
      dbgWarn("chat", "failed to load agent settings:", agentResult.reason);
    }

    if (runsResult.status === "fulfilled") {
      lastContinuableRun =
        runsResult.value.find(
          (r) =>
            r.session_id &&
            (r.status === "completed" || r.status === "stopped" || r.status === "failed"),
        ) ?? null;

      if (!runId && lastContinuableRun) {
        welcomeQuickActionsReady = true;
        // Import goto dynamically to avoid circular deps
        const { goto } = await import("$app/navigation");
        goto(`/chat?run=${lastContinuableRun.id}&resume=continue`, { replaceState: true });
        return;
      }
    } else {
      dbgWarn("chat", "failed to load runs for continue:", runsResult.reason);
    }
    welcomeQuickActionsReady = true;

    // Phase 3: permission mode init
    if (!store.permissionModeSetByUser) {
      if (agentSettings?.plan_mode) {
        store.permissionMode = "plan";
        store.permissionModeSetByUser = true;
      } else if (settings?.permission_mode) {
        const cliName = APP_TO_CLI_MODE[settings.permission_mode] ?? settings.permission_mode;
        store.permissionMode = cliName;
        store.permissionModeSetByUser = true;
      }
    }

    // Self-heal: detect and fix contaminated default_model
    let selfHealDone = false;
    let selfHealInFlight = false;
    loadCliInfo().then(() => {
      if (settings?.default_model && !selfHealDone && !selfHealInFlight) {
        const dm = settings.default_model;
        const contaminated = isContaminatedDefaultModelFn(dm);
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
                settings!.default_model = healModel;
                lastKnownGoodAnthropicModel = healModel;
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
        lastKnownGoodAnthropicModel = cliModel;
      }
      if (cliModel && !store.run && !runId && store.phase !== "loading" && !isThirdParty) {
        dbg("chat", "set model from CLI after loadCliInfo", { cliModel, prev: store.model });
        store.model = cliModel;
      }
    });
    loadCliVersionInfo();
    checkProjectInit();
    if (!runId) {
      const cwd = localStorage.getItem(PROJECT_CWD_KEY) || "";
      preload.reloadProjectData(cwd);
    }
  });

  // ── Listen for project folder changes ──
  onMount(() => {
    const handler = () => {
      checkProjectInit();
      const url = get(page).url;
      const runId = url.searchParams.get("run") ?? "";
      if (!runId && !store.run) {
        const cwd = localStorage.getItem(PROJECT_CWD_KEY) || "";
        preload.reloadProjectData(cwd);
      }
    };
    window.addEventListener(PROJECT_CHANGED_KEY, handler);
    return () => window.removeEventListener(PROJECT_CHANGED_KEY, handler);
  });

  // ── Warm up file IPC chain ──
  onMount(() => {
    const cwd = localStorage.getItem(PROJECT_CWD_KEY) || "";
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

  // ── Sync run name when sidebar/history renames the current run ──
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
            if (fresh.name) autoNameDone = true;
          }
        })
        .catch((e) => {
          dbgWarn("chat", "runs-changed: failed to sync name", e);
        });
    }
    window.addEventListener(RUNS_CHANGED_KEY, onRunsChanged);
    return () => window.removeEventListener(RUNS_CHANGED_KEY, onRunsChanged);
  });

  // ── Start middleware + register pipe/run handlers ──
  onMount(() => {
    if (middleware.isStarted) middlewareReady = true;

    let destroyed = false;
    (async () => {
      try {
        await middleware.start();
      } catch (e) {
        console.error("[chat] middleware.start() failed:", e);
        store.error = t("chat_eventSystemFailed");
      }
      try {
        const { startNotificationListener } = await import("$lib/services/notification-listener");
        await startNotificationListener();
      } catch {
        // Non-critical: notifications are best-effort
      }
      if (!destroyed) middlewareReady = true;
    })();

    // Pipe handler: chat-delta / chat-done (Codex pipe mode)
    middleware.setPipeHandler({
      onDelta(delta) {
        store.handleChatDelta(delta.text, xtermRef());
      },
      onDone(done) {
        store.handleChatDone(done);
      },
    });

    // Run event handler: stderr for Codex pipe mode
    middleware.setRunEventHandler({
      onRunEvent(event) {
        if (
          store.run?.execution_path === "pipe_exec" &&
          store.run &&
          event.run_id === store.run.id &&
          xtermRef()
        ) {
          if (event.type === "stderr") {
            xtermRef()!.writeText(`\x1b[31m${event.text}\x1b[0m\r\n`);
          }
        }
      },
    });

    return () => {
      destroyed = true;
      // Kill fork run process on unmount
      const fo = getForkOverlay();
      if (fo?.active && store.run && store.run.id !== fo.sourceRunId) {
        api.stopSession(store.run.id).catch(() => {});
      }
      store.unmountGuards();
      middleware.setPipeHandler(null);
      middleware.setRunEventHandler(null);
    };
  });

  // ── Auto-focus prompt input + register keybindings + screenshot/drag-drop ──
  onMount(() => {
    requestAnimationFrame(() => promptRef()?.focus());
    function onStatusBarToggle(e: Event) {
      statusBarExpanded = (e as CustomEvent).detail.expanded;
    }
    window.addEventListener("ocv:statusbar-toggle", onStatusBarToggle);

    // Register chat-context keybinding callbacks
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
        promptRef()?.triggerSend();
      }
    });
    keybindingStore.registerCallback("app:shortcutHelp", () => {
      setShortcutHelpOpen(!getShortcutHelpOpen());
    });
    keybindingStore.registerCallback("app:modelPicker", () => {
      statusBarRef()?.openModelDropdown();
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
      const stashed = getStashedInput();
      if (stashed) {
        promptRef()?.restoreSnapshot(stashed);
        setStashedInput(null);
        showChatToast(t("toast_stashRestored"));
      } else {
        const snapshot = promptRef()?.getInputSnapshot();
        if (
          snapshot &&
          (snapshot.text.trim() ||
            snapshot.attachments.length ||
            snapshot.pastedBlocks.length ||
            (snapshot.pathRefs?.length ?? 0) > 0)
        ) {
          setStashedInput(snapshot);
          promptRef()?.clearAll();
          showChatToast(t("toast_stashSaved"));
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
        if (sidebarCollapsed) sidebarCollapsed = false;
        setSidebarRequestedTab("tasks");
      }
    });
    keybindingStore.registerCallback("chat:undoLastTurn", () => {
      handleRewind();
    });
    keybindingStore.registerCallback(
      "app:exportChatHtml",
      () => void exportCtrl.handleExportHtml(),
    );
    const onExportHtmlEvent = () => {
      window.dispatchEvent(new CustomEvent("ocv:export-html-ack"));
      void exportCtrl.handleExportHtml();
    };
    window.addEventListener("ocv:export-html", onExportHtmlEvent);

    // Screenshot event listener
    const chatTransport = getTransport();
    const screenshotUnlisten = chatTransport.listen<ScreenshotPayload>(
      "screenshot-taken",
      (payload) => {
        dbg("chat", "screenshot-taken", { filename: payload.filename });
        const { contentBase64, mediaType, filename } = payload;
        const bytes = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
        const file = new File([bytes], filename, { type: mediaType });
        promptRef()?.addFiles([file]);
      },
    );

    // Tauri native drag-drop listeners
    const dragEnterUnlisten = chatTransport.listen<{ paths: string[] }>(
      "tauri://drag-enter",
      () => {
        dragDrop.pageDragActive = true;
      },
    );
    const dragLeaveUnlisten = chatTransport.listen("tauri://drag-leave", () => {
      dragDrop.pageDragActive = false;
    });
    const dragDropUnlisten = chatTransport.listen<{ paths: string[] }>(
      "tauri://drag-drop",
      dragDrop.handleTauriDrop,
    );

    return () => {
      window.removeEventListener("ocv:statusbar-toggle", onStatusBarToggle);
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
      keybindingStore.unregisterCallback("app:exportChatHtml");
      window.removeEventListener("ocv:export-html", onExportHtmlEvent);
      screenshotUnlisten.then((fn) => fn());
      dragEnterUnlisten.then((fn) => fn());
      dragLeaveUnlisten.then((fn) => fn());
      dragDropUnlisten.then((fn) => fn());
      if (verboseRetryTimer) clearTimeout(verboseRetryTimer);
      progressive.cancelProgressive();
    };
  });

  // ── Context snapshot listener ──
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
      const contextHistoryMap = getContextHistoryMap();
      const prev = contextHistoryMap.get(runId) ?? [];
      const existingIdx = prev.findIndex((s) => s.turnIndex === turnIndex);
      const replaced = existingIdx >= 0;
      const updated = replaced
        ? prev.map((s, i) => (i === existingIdx ? { runId, turnIndex, ts, data } : s))
        : [...prev, { runId, turnIndex, ts, data }];
      const next = new Map(contextHistoryMap);
      next.set(runId, updated);
      setContextHistoryMap(next);
      dbg("chat", "context-snapshot", { turn: turnIndex, pct: data.percentage, replaced });
    });
    return () => {
      unlisten.then((f) => f());
    };
  });

  // ── BTW event listeners ──
  onMount(() => {
    const transport = getTransport();
    const btwState = getBtwState();
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

  // ── Internal helper: toggle CLI config boolean ──
  async function toggleCliConfigBool(key: string) {
    try {
      const config = await api.getCliConfig();
      const current = config[key] === true;
      await api.updateCliConfig({ [key]: !current });
      dbg("chat", `toggled ${key}`, { from: current, to: !current });
      if (key === "fastMode") {
        store.fastModeState = !current ? "on" : "";
        dbg("chat", "fastMode UI mirrored", { state: store.fastModeState });
      } else if (key === "verbose") {
        verboseEnabled = !current;
        dbg("chat", "verbose UI mirrored", { verbose: verboseEnabled });
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

  // ── Local proxy detection ──
  async function checkAllLocalProxies() {
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
    localProxyStatuses = statuses;
    dbg("chat", "checkAllLocalProxies", statuses);
  }

  // ========================================================================
  // Return
  // ========================================================================

  return {
    // State
    settings,
    agentSettings,
    middlewareReady,
    remoteHosts,
    authOverview,
    localProxyStatuses,
    lastContinuableRun,
    welcomeQuickActionsReady,
    projectInitStatus,
    notificationVisible,
    latestNotification,
    verboseEnabled,
    verboseRetryTick,
    toolResultCache,
    toolResultInflight,
    targetDropdownOpen,
    toolFilter,
    sidebarCollapsed,
    statusBarExpanded,
    folderPickerOpen,
    folderPickerInitialHost,
    folderPickerInitialPath,
    folderPickerHideTarget,
    // Thinking state
    thinkingElapsed,
    thinkingExpanded,
    thinkingVisible,
    spinnerVerb,
    // Functions
    fetchToolResult,
    syncVerboseState,
    checkProjectInit,
    dismissInitHint,
    openFolderPicker,
    isContaminatedDefaultModel: isContaminatedDefaultModelFn,
    formatElapsed,
    toggleCliConfigBool,
    checkAllLocalProxies,
    // Auto-name latch
    getAutoNameDone,
    setAutoNameDone,
    // Setters (for page/handlers composable to use)
    setSettings: (v: UserSettings | null) => {
      settings = v;
    },
    setAgentSettings: (v: AgentSettings | null) => {
      agentSettings = v;
    },
    setAuthOverview: (v: AuthOverview | null) => {
      authOverview = v;
    },
    setLocalProxyStatuses: (v: Record<string, { running: boolean; needsAuth: boolean }>) => {
      localProxyStatuses = v;
    },
    setToolFilter: (v: string | null) => {
      toolFilter = v;
    },
    setSidebarCollapsed: (v: boolean) => {
      sidebarCollapsed = v;
    },
    setTargetDropdownOpen: (v: boolean) => {
      targetDropdownOpen = v;
    },
    setNotificationVisible: (v: boolean) => {
      notificationVisible = v;
    },
    setThinkingExpanded: (v: boolean) => {
      thinkingExpanded = v;
    },
    setFolderPickerOpen: (v: boolean) => {
      folderPickerOpen = v;
    },
    getFolderPickerResolve: () => folderPickerResolve,
    setFolderPickerResolve: (
      v: ((val: { hostName: string | null; path: string } | null) => void) | null,
    ) => {
      folderPickerResolve = v;
    },
    setLastContinuableRun: (v: import("$lib/types").TaskRun | null) => {
      lastContinuableRun = v;
    },
    setVerboseEnabled: (v: boolean) => {
      verboseEnabled = v;
    },
    // Derived
    showInitHint,
    // Scroll-to in-flight flag (for useChatController coordination)
    getScrollToInFlight: () => _scrollToInFlight,
    setScrollToInFlight: (v: boolean) => {
      _scrollToInFlight = v;
    },
    // Permission mode maps (exposed for page's handlePermissionModeChange)
    APP_TO_CLI_MODE,
    CLI_TO_APP_MODE,
  };
}
