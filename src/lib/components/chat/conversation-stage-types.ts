/**
 * Grouped prop interfaces for ChatConversationStage.
 *
 * These VMs reduce the component's interface surface from ~70 individual
 * props to 7 semantic groups. Template code is unchanged — the component
 * destructures each VM at the top level.
 */
import type { TimelineEntry, TeamRun, AuthOverview, BusToolItem } from "$lib/types";
import type { ToolBurst } from "$lib/utils/tool-rendering";
import type { BurstCollapseHandle } from "$lib/chat/use-tool-burst-collapse.svelte";
import type { TurnUsage } from "$lib/stores/types";
import type { RewindMarker } from "$lib/utils/rewind";
import type { TaskRun } from "$lib/types";
import type XTerminal from "$lib/components/XTerminal.svelte";

// ── Timeline rendering state ──

export interface TimelineVm {
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
  /**
   * Permission coordinator used by InlineToolCard and PermissionPanel
   * to project per-request state. When omitted, components fall back
   * to local busy flags.
   */
  permissionCoordinator?: import("$lib/chat/permission-coordinator").PermissionCoordinator;
}

// ── Welcome / session info ──

export interface SessionVm {
  welcomeVisible: boolean;
  lastContinuableRun: TaskRun | null;
  authOverview: AuthOverview | null;
  localProxyStatuses: Record<string, { running: boolean; needsAuth: boolean }>;
  showInitHint: boolean;
  cliVersionInfo: import("$lib/stores").CliVersionInfo | null;
  channelLatest: string | undefined;
  remoteHosts: import("$lib/types").RemoteHost[];
  availableWorkspaces: import("$lib/stores/workspaces-store.svelte").WorkspaceOption[];
  selectedCwd: string;
}

// ── Loading / route state ──

export interface LoadingVm {
  routeRunLoadFailed: boolean;
  routeRunPending: boolean;
  runId: string;
  notificationVisible: boolean;
  latestNotification: { task_id: string; status: string } | null;
  rewindMarkers: RewindMarker[];
  activeTeamRuns: TeamRun[];
}

// ── Thinking / streaming state ──

export interface ThinkingVm {
  thinkingElapsed: number;
  thinkingVisible: boolean;
  spinnerVerb: string;
  processingSlashCmd: string | null;
  approving: boolean;
  sending: boolean;
}

// ── Fork overlay state ──

export interface ForkVm {
  forkOverlay: {
    active: boolean;
    sourceRunId: string;
    startedAt: number;
    error: string | null;
  } | null;
  forkElapsed: number;
  resuming: boolean;
}

// ── Handlers (callbacks) ──

export interface StageHandlers {
  goto: (path: string, opts?: { replaceState?: boolean }) => void;
  sendMessage: (
    text: string,
    attachments: import("$lib/types").Attachment[],
    creationMode?: "single" | "worktree",
  ) => Promise<void>;
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
  handleExitPlanBypass: () => void;
  getPlanContentForExitPlan: (entryId: string) => { content: string; fileName: string } | null;
  openPreviewForPath: (path: string) => void;
  handleHookCallbackRespond: (requestId: string, decision: "allow" | "deny") => Promise<void>;
  onCwdChange: (cwd: string) => void;
  onAddWorkspace: () => void;
  handleElicitationRespond: (
    requestId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
  ) => void | Promise<void>;
  handleChatScroll: () => void;
  handleChatWheel: (e: WheelEvent) => void;
  scrollChatToBottom: () => void;
  handleTermResize: (cols: number, rows: number) => void;
  handleTermReady: (cols: number, rows: number) => void;
  handleForkCancel: () => void;
  handleForkRetry: () => void;
  dismissInitHint: () => void;
  dismissTaskNotificationBanner: () => void;
  loadRunProgressive: (id: string, xtermRef: XTerminal | undefined) => void;
  setLastTarget: (hostName: string | null) => void;
}
