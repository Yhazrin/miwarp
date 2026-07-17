/**
 * Lifecycle handler context interface — the dependency contract for chat lifecycle.
 *
 * Defines the full set of stores, refs, and actions that lifecycle handlers
 * need from the chat page. This keeps the handler logic decoupled from the
 * page component's internal state.
 */

import type { SessionStore } from "$lib/stores/session-store.svelte";
import type { EventMiddleware } from "$lib/stores/event-middleware";
import type { KeybindingStore } from "$lib/stores/keybindings.svelte";
import type {
  UserSettings,
  AgentSettings,
  RemoteHost,
  AuthOverview,
  ContextSnapshot,
  TaskRun,
} from "$lib/types";
import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
import type { ForkOverlayState } from "$lib/chat/use-fork-lifecycle";
import type { SettingsCacheContext } from "$lib/layout-chrome-context";
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
  /** v1.0.10 perf: optional handle to the layout-cached UserSettings so init()
   *  can skip the cold getUserSettings() IPC when layout already loaded it. */
  getSettingsCache?: () => SettingsCacheContext | undefined;
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
