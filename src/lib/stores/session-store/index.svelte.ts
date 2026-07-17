/**
 * SessionStore: single source of truth for chat session state.
 *
 * Replaces 25 scattered $state variables and 3 booleans (running x sending x sessionStarted)
 * with a state-machine (SessionPhase) + organized fields + idempotent reducers.
 */
import * as api from "$lib/api";
import type {
  TaskRun,
  RunStatus,
  HookEvent,
  BusEvent,
  BusToolItem,
  TimelineEntry,
  Attachment,
  CliCommand,
  McpServerInfo,
  ElicitationSchema,
  SessionMode,
  RunSurface,
} from "$lib/types";
import { usesStreamSession, getCliCapabilities } from "$lib/runtime";
import type { CliCapabilities } from "$lib/runtime";
import { isKeyOptionalPlatform } from "$lib/utils/platform-presets";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { t } from "$lib/i18n/index.svelte";
import { yieldToMain } from "$lib/utils/yield";
import { eventTs } from "$lib/utils/event-ts";
import { uuid } from "$lib/utils/uuid";
import {
  type SessionPhase,
  type UsageState,
  type TurnUsage,
  ACTIVE_PHASES,
  TERMINAL_PHASES,
  SESSION_ALIVE_PHASES,
} from "../types";
import { getEventMiddleware } from "../event-middleware";
import type { ReduceCtx } from "../reducers/types";
import { getCliCommands } from "../cli-info.svelte";
import * as snapshotCache from "$lib/utils/snapshot-cache";
import { getTransport } from "$lib/transport";
import { SessionRunConnection } from "$lib/chat/session-run-connection";
import { SessionRecoveryController } from "$lib/chat/session-recovery-controller";
import { SessionAsyncLifecycleCoordinator } from "$lib/chat/session-async-lifecycle";
import { getAgentFeatures, type AgentFeatures } from "$lib/utils/agent-features";
import { dedupeMcpServersByName } from "$lib/utils/mcp";
import { beginHistorySoundMute, endHistorySoundMute } from "$lib/services/sound-feedback-service";
import { TransportController, DEFAULT_TIMEOUTS } from "../session/transport-controller";
import {
  activeToolName as activeToolNameProjection,
  mapAttachments,
  timelineAttachments,
} from "../session/timeline-projection";
import {
  contextWindow as contextWindowProjection,
  totalTokens as totalTokensProjection,
} from "../session/usage-projection";
import {
  applySnapshot,
  buildSnapshot,
  parseSnapshotBody,
  saveSnapshotToIdb,
} from "../session/snapshot-repository";
import {
  findToolIdx,
  findHeIdx,
  findHeIdxByStatus,
  findParentToolIdx,
  updateToolInAnySubTimeline,
  appendToSubTimeline,
  updateSubTimelineTool,
  appendSubTimelineStreamingDelta,
  extractSubTimelineThinking,
  removeSubTimelineStreamingEntry,
  extractSubTimelineStreamingContent,
  patchAssistantContentIfEmpty,
  resolveStaleTools,
  accumulateJsonInput,
} from "./timeline-helpers";
import {
  applyHookEvent as applyHookEventCore,
  applyHookUsage as applyHookUsageCore,
  applyHookEventBatch as applyHookEventBatchCore,
  applyHookUsageBatch as applyHookUsageBatchCore,
} from "./hook-processor";
import { finalizeSnapshotCtxTools, finalizeTimelineForDeadSession } from "./snapshot-manager";
import { runReduce, type ReduceStore } from "./event-handlers";

// eventTs / eventTsMs moved to $lib/utils/event-ts so reducers can use them.
// normalizePermissionMode and CLI_PERM_MODE_ALIASES moved to ./session-store/event-handlers.ts.

// `backfillAnchorId` / `timelineAttachments` / `mapAttachments` / `appendCapped`
// moved to ./session/timeline-projection.ts (Worker-4 P0/P1/P2 refactor).

// ── Internal batch state (plain objects, no reactivity) ──

// ReduceCtx is imported from ./reducers/types

// ── Exported types ──

export interface ElicitationState {
  requestId: string;
  mcpServerName: string;
  message: string;
  elicitationId?: string;
  mode?: string;
  url?: string;
  requestedSchema?: ElicitationSchema;
}

export interface TaskNotificationItem {
  task_id: string;
  status: string;
  message: string;
  startedAt: number;
  data: unknown;
  output_file?: string;
  task_type?: string;
  summary?: string;
  tool_use_id?: string;
}

// ── Store ──

export class SessionStore {
  // ── State fields ──
  phase: SessionPhase = $state("empty");
  run: TaskRun | null = $state(null);
  timeline: TimelineEntry[] = $state([]);
  streamingText: string = $state("");
  /** Accumulated thinking/reasoning text (extended thinking). Cleared on new turn. */
  thinkingText: string = $state("");
  /** Timestamp (ms) of the first thinking_delta event in the current turn. 0 = no thinking yet. */
  thinkingStartMs: number = $state(0);
  /** Timestamp (ms) when thinking ended (first message_delta after thinking). 0 = still thinking or no thinking. */
  thinkingEndMs: number = $state(0);
  tools: HookEvent[] = $state([]);
  usage: UsageState = $state({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
  });
  model: string = $state("");
  error: string = $state("");
  /** Shown briefly after live recovery from persisted events.jsonl. */
  recoveryNotice: string | null = $state(null);
  /** v1.0.9: last projected SessionLifecycle connection generation. */
  recoveryConnectionGeneration = $state(0);
  recoveryPhase = $state("");
  recoveryState = $state("healthy");
  recoveryCrashReason = $state<string | null>(null);
  recoveryUnrecoverable = $state(false);
  /** Optional hook for SendCoordinator transport phase sync (v1.0.9). */
  recoveryLifecycleListener: ((recoveryState: string, generation: number) => void) | null = null;
  agent: string = $state("claude");
  authMode: string = $state("cli");

  // ── Protocol extension fields ──
  systemStatus = $state<{ status?: string } | null>(null);
  authStatus = $state<{ is_authenticating: boolean; output: string[] } | null>(null);
  hookEvents = $state<
    Array<{
      type: string;
      hook_id: string;
      data: unknown;
      request_id?: string;
      status?: "hook_pending" | "allowed" | "denied" | "cancelled";
      hook_name?: string;
      stdout?: string;
      stderr?: string;
      exit_code?: number;
    }>
  >([]);
  taskNotifications = $state<Map<string, TaskNotificationItem>>(new Map());
  /** Pending MCP elicitation prompts keyed by request_id. */
  pendingElicitations = $state<Map<string, ElicitationState>>(new Map());
  persistedFiles = $state<unknown[]>([]);

  /** Ralph loop state — null when no loop has been active. */
  ralphLoop = $state<{
    active: boolean;
    prompt: string;
    iteration: number;
    maxIterations: number;
    completionPromise: string | null;
    startedAt: string;
    reason: import("$lib/types").RalphCompleteReason | "interrupted" | null;
  } | null>(null);

  /** CLI slash commands from session_init (session-specific, includes custom commands). */
  sessionCommands = $state<CliCommand[]>([]);
  /** MCP servers from session_init (per-session state). */
  mcpServers = $state<McpServerInfo[]>([]);

  // ── CLI verbose fields (from session_init / usage_update) ──
  cliVersion = $state<string>("");
  permissionMode = $state<string>("");
  /** True when permissionMode was set by user/settings AND successfully persisted.
   *  Prevents session_init / snapshot from overwriting.
   *  NOT cleared by _clearContentState() unless permissionModePersistFailed is true. */
  permissionModeSetByUser = $state<boolean>(false);
  /** True when mode was switched via control protocol but settings persist failed.
   *  Cleared on _clearContentState() (new run/session), allowing session_init to
   *  re-sync from CLI's actual startup mode. */
  permissionModePersistFailed = $state<boolean>(false);
  fastModeState = $state<string>("");
  apiKeySource = $state<string>("");
  availableAgents = $state<string[]>([]);
  availableSkills = $state<string[]>([]);
  availablePlugins = $state<unknown[]>([]);
  /** Rate limit status: "allowed", "allowed_warning", "rejected" */
  rateLimitStatus = $state<string>("");
  /** Which rate limit: "five_hour", "seven_day", etc. */
  rateLimitType = $state<string>("");
  /** Utilization 0.0-1.0 */
  rateLimitUtilization = $state<number | null>(null);
  /** When the rate limit resets (epoch seconds) */
  rateLimitResetsAt = $state<number | null>(null);
  /** CLI's current working directory (updated from session_init). */
  sessionCwd = $state<string>("");
  /** CLI's available tools (updated from session_init). */
  sessionTools = $state<string[]>([]);
  /** CLI's output style (updated from session_init). */
  outputStyle = $state<string>("");
  /** Saved permission mode before plan mode (restored on ExitPlanMode). */
  previousPermissionMode = $state<string>("");
  /** Override mode after ExitPlanMode completes (user chose specific mode via approval card). */
  pendingPermissionModeOverride = $state<string | null>(null);
  /** Plan content for "clear context" restart (set before allow, consumed after tool_end). */
  pendingClearContextPlan = $state<string | null>(null);
  /** True after first session_init received for this session (gates sessionCommands exposure). */
  sessionInitReceived = $state<boolean>(false);
  numTurns = $state<number>(0);
  durationMs = $state<number>(0);
  /** Count of unknown event types hitting _reduce default case. */
  unknownEventCount = $state<number>(0);
  /** Count of Raw events with non-stdout/stderr source (fallback path). */
  rawFallbackCount = $state<number>(0);
  /** When true, throw on unknown/fallback events instead of counting. Test-only. */
  strictMode = false;
  /** Per-turn usage snapshots (append-only, one per usage_update event). */
  turnUsages: TurnUsage[] = $state([]);
  /** Timestamp of the most recent compact_boundary event (0 = never). */
  lastCompactedAt: number = $state(0);
  /** Number of full compaction events in this session. */
  compactCount: number = $state(0);
  /** Number of micro-compaction events in this session. */
  microcompactCount: number = $state(0);

  /** Remote host name (if this session runs on a remote machine). */
  remoteHostName = $state<string | null>(null);
  /** Derived: true if running on a remote host via SSH. */
  get isRemote(): boolean {
    return !!this.remoteHostName;
  }

  /** Per-session platform_id — set before first message, locked after. */
  platformId = $state<string | null>(null);

  /** True while stop() is in progress — suppresses RunState error display from dying CLI. */
  private _stopping = false;

  // Internal dedup sets (not reactive — only used inside reducers)
  private _seenMessageIds = new Set<string>();
  private _seenToolIds = new Set<string>();

  /** Highest _seq processed — used for WS checkpoint on reconnect/subscribe */
  private _lastProcessedSeq = 0;
  /** Last bus event type applied by _reduce (for render error diagnostics). */
  private _lastReduceEventType = "";
  private _needsIdleHealthCheck = false;
  private _recovery = new SessionRecoveryController({
    setNotice: (notice) => {
      this.recoveryNotice = notice;
    },
  });

  /** Phase 2: owns transport subscription lifecycle for this store instance. */
  private _connection = new SessionRunConnection();

  // ── Reducer tool indexes (runtime-only, not serialized) ──
  /** tool_use_id → timeline[] index for tool entries (first-match, reducer fast-path). */
  private _toolTlIndex = new Map<string, number>();
  /** tool_use_id → tools[] (HookEvent) index (first-match, reducer fast-path). */
  private _toolHeIndex = new Map<string, number>();
  /** _lastProcessedSeq at last snapshot write — throttles idle snapshot rewrites. */
  private _lastSnapshotSeq = 0;

  /** Async load / resume / fork / reload generation and mount lifetime. */
  private _asyncLifecycle = new SessionAsyncLifecycleCoordinator();
  /** True while loadRun is replaying events — suppresses isThinking flash on session switch. */
  private _isLoadingReplay = false;

  /**
   * Transport controller — owns phase transitions, spawn/response timeouts
   * and stream-mode detection (Worker-4 P0/P1/P2 refactor, item #5
   * "Phase Transition Guard"). The controller's callbacks close over `this`
   * for the actual recovery side effects (set `error`, transition phase,
   * kill the backend process).
   */
  private _transport = new TransportController({
    onSpawnTimeout: (runId) => {
      if (this.phase === "spawning" && this.run?.id === runId) {
        dbgWarn("store", "spawn timeout: CLI did not respond");
        this.error =
          "Session failed to start (CLI did not respond). Try again or check CLI installation.";
        // Kill the hung backend process to prevent orphans
        api
          .stopSession(runId)
          .catch((e) => dbgWarn("store", "spawn timeout: failed to stop session:", e));
        this._setPhase("failed");
        if (this.run) {
          this.run = { ...this.run, status: "failed" };
        }
      }
    },
    onResponseTimeout: (runId) => {
      if (
        this.run?.id === runId &&
        this.phase === "running" &&
        !this.streamingText &&
        !this.thinkingText
      ) {
        this._isTimeoutError = true;
        this.error = "No response after 60s — still waiting for API.";
        dbgWarn("store", "response timeout: no content after 60s");
      }
    },
  });
  /** Backwards-compat alias exposed to reducers that check the legacy flag. */
  private _isTimeoutError = false;
  /** Backwards-compat static constant the legacy `_SPAWN_TIMEOUT_MS` exposed. */
  private static readonly _SPAWN_TIMEOUT_MS = DEFAULT_TIMEOUTS.spawnMs;
  /** Backwards-compat static constant the legacy `_RESPONSE_TIMEOUT_MS` exposed. */
  private static readonly _RESPONSE_TIMEOUT_MS = DEFAULT_TIMEOUTS.responseMs;

  /** Set phase with dev-mode transition guard. Delegates to TransportController. */
  private _setPhase(to: SessionPhase): void {
    this._transport.setPhase(this, to);
    // Any phase change away from spawning clears the spawn timeout
    if (to !== "spawning") {
      this._clearSpawnTimeout();
    }
    // Clear response timeout on terminal/idle phases
    if (to !== "running") {
      this._clearResponseTimeout();
    }
  }

  /** Start a timeout that fails the session if phase stays at spawning.
   *  The kill-process side effect lives in the controller's onSpawnTimeout
   *  callback, which closes over `this` to reach the live store fields. */
  private _startSpawnTimeout(runId: string): void {
    this._transport.startSpawnTimeout(runId);
  }

  private _clearSpawnTimeout(): void {
    this._transport.clearSpawnTimeout();
  }

  /** Start a timeout that warns if no response content arrives after sending a message. */
  private _startResponseTimeout(runId: string): void {
    this._transport.startResponseTimeout(runId);
  }

  private _clearResponseTimeout(): void {
    this._transport.clearResponseTimeout();
  }

  /** Clear response timeout error (only if it was set by the timeout, not a real error). */
  private _clearTimeoutError(): void {
    this._transport.clearResponseTimeout();
    if (this._isTimeoutError) {
      this.error = "";
      this._isTimeoutError = false;
    }
  }

  /** Check if text is a known CLI slash command (not path like /home/user). */
  isKnownSlashCommand(text: string): boolean {
    const m = text.match(/^\/([a-z][\w-]*)(?:\s|$)/i);
    if (!m) return false;
    const name = m[1].toLowerCase();
    // Check available skills (preloaded from filesystem, available before session_init)
    if (this.availableSkills.some((s) => s.toLowerCase() === name)) return true;
    // Check session commands (available after session_init) or static CLI info
    const cmds =
      this.sessionCommands.length > 0 ? this.sessionCommands : getCliCommands(this.agent);
    if (cmds.length > 0) {
      return cmds.some(
        (c) =>
          c.name.toLowerCase() === name || (c.aliases ?? []).some((a) => a.toLowerCase() === name),
      );
    }
    // Cold start: no command list available yet — trust the regex pattern.
    // The (?:\s|$) boundary already filters out paths like /home/user.
    // False positive risk (e.g. "/hello") only skips 60s timeout, acceptable.
    dbg("store", "isKnownSlashCommand cold-start fallback", { name });
    return true;
  }

  // ── Derived getters ──

  get isRunning(): boolean {
    return ACTIVE_PHASES.includes(this.phase);
  }

  get isIdle(): boolean {
    return this.phase === "idle";
  }

  get sessionAlive(): boolean {
    return SESSION_ALIVE_PHASES.includes(this.phase);
  }

  get canSend(): boolean {
    // v1.0.6: cached/stale_cached sessions can accept input — send triggers lazy resume
    return ["empty", "ready", "idle", "cached", "stale_cached"].includes(this.phase);
  }

  get activeToolName(): string {
    return activeToolNameProjection(this.timeline, this.useStreamSession, this.tools);
  }

  /** Cached permission scan — invalidated when timeline changes. */
  private _permScan: {
    timelineRef: TimelineEntry[];
    hasPending: boolean;
    hasInline: boolean;
    pendingTools: Array<{ tool: BusToolItem; requestId: string }>;
  } | null = null;

  /** Single-walk scan for all permission state. Result is cached per timeline reference. */
  private _getPermissionScan() {
    if (this._permScan && this._permScan.timelineRef === this.timeline) {
      return this._permScan;
    }
    let hasPending = false;
    let hasInline = false;
    const toolMap = new Map<string, BusToolItem>();

    const walk = (entries: TimelineEntry[]) => {
      for (const entry of entries) {
        if (entry.kind !== "tool") continue;
        if (entry.tool.status === "permission_prompt" && entry.tool.permission_request_id) {
          hasPending = true;
          const name = entry.tool.tool_name;
          if (name === "AskUserQuestion" || name === "ExitPlanMode") {
            hasInline = true;
          } else {
            const rid = entry.tool.permission_request_id;
            toolMap.delete(rid);
            toolMap.set(rid, entry.tool);
          }
        }
        if (entry.subTimeline) walk(entry.subTimeline);
      }
    };
    walk(this.timeline);

    this._permScan = {
      timelineRef: this.timeline,
      hasPending,
      hasInline,
      pendingTools: Array.from(toolMap, ([requestId, tool]) => ({ tool, requestId })),
    };
    return this._permScan;
  }

  /** Whether any permission prompt is pending user approval (recursive, includes subTimelines). */
  get hasPendingPermission(): boolean {
    return this._getPermissionScan().hasPending;
  }

  /** Whether any MCP elicitation prompt is pending user response. */
  get hasElicitation(): boolean {
    return this.pendingElicitations.size > 0;
  }

  /** Whether an inline-only permission (AskUserQuestion / ExitPlanMode) is pending. */
  get hasInlinePermission(): boolean {
    return this._getPermissionScan().hasInline;
  }

  /** Pending generic tool permission prompts (recursive, excludes AskUserQuestion/ExitPlanMode). */
  get pendingToolPermissions(): Array<{ tool: BusToolItem; requestId: string }> {
    return this._getPermissionScan().pendingTools;
  }

  /** Whether the latest user turn is still waiting for an assistant reply in timeline. */
  private _awaitingAssistantResponse(): boolean {
    let lastUserIdx = -1;
    let lastAssistantIdx = -1;
    for (let i = this.timeline.length - 1; i >= 0; i--) {
      const entry = this.timeline[i];
      if (entry.kind === "user" && lastUserIdx < 0) lastUserIdx = i;
      if (entry.kind === "assistant" && lastAssistantIdx < 0) lastAssistantIdx = i;
      if (lastUserIdx >= 0 && lastAssistantIdx >= 0) break;
    }
    if (lastUserIdx < 0) return false;
    return lastAssistantIdx < lastUserIdx;
  }

  get isThinking(): boolean {
    if (!this.isRunning || this.streamingText.trim()) return false;
    // During loadRun replay, phase is set to "running" before events are loaded.
    // Without this guard, isThinking flashes true on session switch (especially on
    // Windows where replay is slower). Suppress during the loading window.
    if (this._isLoadingReplay) return false;
    if (!this._awaitingAssistantResponse()) return false;
    return !this.hasPendingPermission && !this.hasElicitation;
  }

  /** isRunning but not blocked on a permission prompt or elicitation.
   *  Used for UI elements (stop button, spinner) that should hide during approval. */
  get isActivelyRunning(): boolean {
    return this.isRunning && !this.hasPendingPermission && !this.hasElicitation;
  }

  /** Agent blocked on permission, elicitation, or inline user choice. */
  get taskWaiting(): boolean {
    return this.hasPendingPermission || this.hasElicitation || this.hasInlinePermission;
  }

  /** Duration of extended thinking in seconds (0 if no thinking happened). */
  get thinkingDurationSec(): number {
    if (!this.thinkingStartMs) return 0;
    const end = this.thinkingEndMs || Date.now();
    return Math.floor((end - this.thinkingStartMs) / 1000);
  }

  get totalTokens(): number {
    return totalTokensProjection(this.usage);
  }

  get contextWindow(): number {
    return contextWindowProjection(this.usage);
  }

  get contextUtilization(): number {
    if (this.usage.contextWindowUsedPercentage != null) {
      const pct = this.usage.contextWindowUsedPercentage;
      const normalized = pct > 1 ? pct / 100 : pct;
      if (Number.isFinite(normalized)) return Math.min(Math.max(normalized, 0), 1);
    }

    // Approximate tokens sent to the model in the latest API call:
    //   input_tokens (new non-cached) + cache_read (from cache) + cache_write (first-time cached)
    // Claude Code native usage_update events are session-cumulative, so raw cache_read can exceed
    // the context window after a few turns. When that happens, derive latest-call usage from the
    // delta between the last two snapshots; otherwise fall back to the raw value.
    const cw = this.contextWindow;
    if (cw <= 0) return 0;
    const rawUsed =
      this.usage.inputTokens + this.usage.cacheReadTokens + this.usage.cacheWriteTokens;
    let used = rawUsed;

    if (rawUsed > cw && this.turnUsages.length >= 2) {
      const last = this.turnUsages[this.turnUsages.length - 1];
      const prev = this.turnUsages[this.turnUsages.length - 2];
      const lastUsed = last.inputTokens + last.cacheReadTokens + last.cacheWriteTokens;
      const prevUsed = prev.inputTokens + prev.cacheReadTokens + prev.cacheWriteTokens;
      const delta = lastUsed - prevUsed;
      const looksCumulative =
        lastUsed >= prevUsed && last.cost >= prev.cost && delta > 0 && delta <= cw * 1.25;
      if (looksCumulative) used = delta;
    }

    if (used <= 0) return 0;
    return Math.min(used / cw, 1);
  }

  get contextWarningLevel(): "none" | "moderate" | "high" | "critical" {
    const u = this.contextUtilization;
    if (u >= 0.9) return "critical";
    if (u >= 0.75) return "high";
    if (u >= 0.5) return "moderate";
    return "none";
  }

  /** Background tasks that are still running/started (not completed/failed). */
  get activeBackgroundTasks(): TaskNotificationItem[] {
    const active: TaskNotificationItem[] = [];
    for (const item of this.taskNotifications.values()) {
      if (item.status !== "completed" && item.status !== "failed" && item.status !== "error") {
        active.push(item);
      }
    }
    return active;
  }

  /** Whether there are any background tasks (active or recently completed). */
  get hasBackgroundTasks(): boolean {
    return this.taskNotifications.size > 0;
  }

  /** CLI capabilities derived from session_init.claude_code_version. */
  get cliCapabilities(): CliCapabilities {
    return getCliCapabilities(this.cliVersion);
  }

  get effectiveCwd(): string {
    return this.sessionCwd || this.run?.cwd || "";
  }

  get isApiMode(): boolean {
    return this.run ? this.run.auth_mode === "api" : this.authMode === "api";
  }

  get useStreamSession(): boolean {
    // Run-level: check execution_path if run exists (resolved, non-undefined)
    if (this.run) return this.run.execution_path === "session_actor";
    // Pre-run: predict from agent (startSession decides which IPC to call)
    return usesStreamSession(this.agent);
  }

  /** Per-agent UI feature flags. */
  get features(): AgentFeatures {
    return getAgentFeatures(this.agent);
  }

  /** CLI-reported authentication source label. Empty before session_init. */
  get authSourceLabel(): string {
    if (!this.apiKeySource) return "";
    // When auth_mode="api", the App may inject ANTHROPIC_AUTH_TOKEN (Bearer auth)
    // and explicitly clear ANTHROPIC_API_KEY. CLI only tracks ANTHROPIC_API_KEY,
    // so it reports "none" even though auth works via ANTHROPIC_AUTH_TOKEN.
    if (this.apiKeySource === "none" && this.isApiMode) return "API Key";
    const map: Record<string, string> = {
      "/login managed key": "Login Key",
      ANTHROPIC_API_KEY: "API Key",
      apiKeyHelper: "Key Helper",
      none: "No Auth",
    };
    return map[this.apiKeySource] ?? this.apiKeySource;
  }

  /** Authentication source category for badge coloring. */
  get authSourceCategory(): string {
    if (!this.apiKeySource) return "unknown";
    if (this.apiKeySource === "/login managed key") return "login";
    if (this.apiKeySource === "ANTHROPIC_API_KEY") return "env_key";
    // Same ANTHROPIC_AUTH_TOKEN case — treat as env_key (blue badge)
    if (this.apiKeySource === "none" && this.isApiMode) return "env_key";
    if (this.apiKeySource === "none") return "none";
    return "other";
  }

  // ── Reducer index helpers ──

  /** Append a timeline entry and update tool index if applicable.
   *  Index uses first-match semantics (matching findIndex behavior) — only set if not already present. */
  private _pushTimeline(ctx: ReduceCtx | null, entry: TimelineEntry): void {
    if (ctx) {
      ctx.tl.push(entry);
      if (entry.kind === "tool" && !ctx.toolTlIndex.has(entry.id)) {
        ctx.toolTlIndex.set(entry.id, ctx.tl.length - 1);
      }
    } else {
      this.timeline = [...this.timeline, entry];
      if (entry.kind === "tool" && !this._toolTlIndex.has(entry.id)) {
        this._toolTlIndex.set(entry.id, this.timeline.length - 1);
      }
    }
  }

  /** Push an optimistic user message to the timeline (deduped by content in _reduce). Returns the entry ID for rollback. */
  private _pushOptimisticUser(content: string, attachments?: Attachment[]): string {
    const id = uuid();
    this._pushTimeline(null, {
      kind: "user",
      id,
      anchorId: id,
      content,
      ts: new Date().toISOString(),
      ...(attachments && attachments.length > 0
        ? { attachments: timelineAttachments(attachments) }
        : {}),
    });
    return id;
  }

  /** Remove an optimistic user message from the timeline by ID (rollback on send failure). */
  private _removeOptimisticUser(entryId: string): void {
    this.timeline = this.timeline.filter((e) => e.id !== entryId);
  }

  /** Append a hook event entry and update tool index if applicable.
   *  Index uses first-match semantics — only set if not already present. */
  private _pushHookEntry(ctx: ReduceCtx | null, heEntry: HookEvent): void {
    const toolUseId = (heEntry as Record<string, unknown>).tool_use_id as string | undefined;
    if (ctx) {
      ctx.he.push(heEntry);
      if (toolUseId && !ctx.toolHeIndex.has(toolUseId))
        ctx.toolHeIndex.set(toolUseId, ctx.he.length - 1);
    } else {
      this.tools = [...this.tools, heEntry];
      if (toolUseId && !this._toolHeIndex.has(toolUseId))
        this._toolHeIndex.set(toolUseId, this.tools.length - 1);
    }
  }

  /** Find tool timeline entry by tool_use_id. Map fast-path + findIndex fallback. */
  private _findToolIdx(ctx: ReduceCtx | null, toolUseId: string): number {
    const tl = ctx ? ctx.tl : this.timeline;
    const index = ctx ? ctx.toolTlIndex : this._toolTlIndex;
    return findToolIdx(tl, index, toolUseId);
  }

  /** Simple id-only lookup for hook events. Map fast-path + findIndex fallback. */
  private _findHeIdx(ctx: ReduceCtx | null, toolUseId: string): number {
    const he = ctx ? ctx.he : this.tools;
    const index = ctx ? ctx.toolHeIndex : this._toolHeIndex;
    return findHeIdx(he, index, toolUseId);
  }

  /** Status-aware hook event lookup: Map fast-path + status validation + scan fallback.
   *  Used by user_message and tool_end which filter by status==="running". */
  private _findHeIdxByStatus(ctx: ReduceCtx | null, toolUseId: string, status: string): number {
    const he = ctx ? ctx.he : this.tools;
    const index = ctx ? ctx.toolHeIndex : this._toolHeIndex;
    return findHeIdxByStatus(he, index, toolUseId, status);
  }

  // ── SubTimeline helpers (subagent routing) ──

  /** Find the parent tool entry in timeline by tool_use_id; return index or -1.
   *  Uses _findToolIdx for Map fast-path with findIndex fallback. */
  private _findParentToolIdx(ctx: ReduceCtx | null, parentToolUseId: string): number {
    const tl = ctx ? ctx.tl : this.timeline;
    const index = ctx ? ctx.toolTlIndex : this._toolTlIndex;
    return findParentToolIdx(tl, index, parentToolUseId);
  }

  /** Search ALL subTimelines (one level deep) for a tool with the given id.
   *  Used when parent_tool_use_id is missing but the tool exists in a subTimeline.
   *  Returns true if found and updated; false if not found. */
  private _updateToolInAnySubTimeline(
    toolUseId: string,
    updater: (old: BusToolItem) => BusToolItem,
    ctx: ReduceCtx | null,
  ): boolean {
    const tl = ctx ? ctx.tl : this.timeline;
    if (!ctx) {
      const cloned = [...this.timeline];
      const result = updateToolInAnySubTimeline(cloned, toolUseId, updater);
      if (result) this.timeline = cloned;
      return result;
    }
    return updateToolInAnySubTimeline(tl, toolUseId, updater);
  }

  /** Append an entry to a parent tool's subTimeline. */
  private _appendToSubTimeline(
    tl: TimelineEntry[],
    parentIdx: number,
    entry: TimelineEntry,
    ctx: ReduceCtx | null,
  ): void {
    if (ctx) {
      appendToSubTimeline(ctx.tl, parentIdx, entry);
    } else {
      const cloned = [...this.timeline];
      appendToSubTimeline(cloned, parentIdx, entry);
      this.timeline = cloned;
    }
  }

  /** Update a tool entry inside a parent tool's subTimeline (3-level immutable update). */
  private _updateSubTimelineTool(
    parentToolUseId: string,
    childToolUseId: string,
    updater: (old: BusToolItem) => BusToolItem,
    ctx: ReduceCtx | null,
  ): boolean {
    const index = ctx ? ctx.toolTlIndex : this._toolTlIndex;
    if (ctx) {
      return updateSubTimelineTool(ctx.tl, index, parentToolUseId, childToolUseId, updater);
    }
    const cloned = [...this.timeline];
    const result = updateSubTimelineTool(cloned, index, parentToolUseId, childToolUseId, updater);
    if (result) this.timeline = cloned;
    return result;
  }

  /** Append/update a synthetic assistant entry in a parent tool's subTimeline for streaming deltas.
   *  Single-active-stream per parent: synthetic ID = `__sub_stream_{parentToolUseId}`.
   *  If the entry doesn't exist yet, creates it; otherwise appends to content or thinkingText. */
  private _appendSubTimelineStreamingDelta(
    parentToolUseId: string,
    field: "content" | "thinkingText",
    text: string,
    ctx: ReduceCtx | null,
  ): void {
    const index = ctx ? ctx.toolTlIndex : this._toolTlIndex;
    if (ctx) {
      appendSubTimelineStreamingDelta(ctx.tl, index, parentToolUseId, field, text);
    } else {
      const cloned = [...this.timeline];
      appendSubTimelineStreamingDelta(cloned, index, parentToolUseId, field, text);
      this.timeline = cloned;
    }
  }

  /** Extract thinkingText from a parent tool's synthetic streaming entry (before removal). */
  private _extractSubTimelineThinking(
    parentToolUseId: string,
    ctx: ReduceCtx | null,
  ): string | undefined {
    const tl = ctx ? ctx.tl : this.timeline;
    const index = ctx ? ctx.toolTlIndex : this._toolTlIndex;
    return extractSubTimelineThinking(tl, index, parentToolUseId);
  }

  /** Remove the synthetic streaming entry from a parent tool's subTimeline (called on message_complete). */
  private _removeSubTimelineStreamingEntry(parentToolUseId: string, ctx: ReduceCtx | null): void {
    const index = ctx ? ctx.toolTlIndex : this._toolTlIndex;
    if (ctx) {
      removeSubTimelineStreamingEntry(ctx.tl, index, parentToolUseId);
    } else {
      const cloned = [...this.timeline];
      removeSubTimelineStreamingEntry(cloned, index, parentToolUseId);
      this.timeline = cloned;
    }
  }

  /** Extract streamed assistant content from a parent tool's synthetic subTimeline entry. */
  private _extractSubTimelineStreamingContent(
    parentToolUseId: string,
    ctx: ReduceCtx | null,
  ): string {
    const tl = ctx ? ctx.tl : this.timeline;
    const index = ctx ? ctx.toolTlIndex : this._toolTlIndex;
    return extractSubTimelineStreamingContent(tl, index, parentToolUseId);
  }

  /** Drop in-flight stream/thinking buffers (live turn shell or orphan recovery). */
  private _clearStreamingState(ctx: ReduceCtx | null): void {
    if (ctx) {
      ctx.streamText = "";
      ctx.thinkingText = "";
    } else {
      this.streamingText = "";
      this.thinkingText = "";
    }
    this.thinkingStartMs = 0;
    this.thinkingEndMs = 0;
  }

  private _patchAssistantContentIfEmpty(
    ctx: ReduceCtx | null,
    messageId: string,
    content: string,
  ): boolean {
    const tl = ctx ? ctx.tl : this.timeline;
    return patchAssistantContentIfEmpty(tl, messageId, content);
  }

  private _materializeOrphanStreamingOnIdle(
    ctx: ReduceCtx | null,
    ev: Extract<BusEvent, { type: "run_state" }>,
    replayOnly: boolean,
    getTl: () => TimelineEntry[],
  ): void {
    if (replayOnly) return;
    const streamText = ctx ? ctx.streamText : this.streamingText;
    const trimmed = streamText.trim();
    if (!trimmed) return;

    const lastAssistant = [...getTl()]
      .reverse()
      .find((e): e is Extract<TimelineEntry, { kind: "assistant" }> => e.kind === "assistant");
    if (lastAssistant && lastAssistant.content.trim() === trimmed) {
      dbg("store", "orphan streamingText dropped — already materialized in timeline", {
        runId: ev.run_id,
        len: streamText.length,
        messageId: lastAssistant.id,
      });
      this._clearStreamingState(ctx);
      return;
    }

    const id = `synthetic_assistant_${ev.run_id}_${this._lastProcessedSeq}`;
    if (getTl().some((e) => e.kind === "assistant" && e.id === id)) {
      this._clearStreamingState(ctx);
      return;
    }
    dbgWarn("store", "orphan streamingText materialized on idle", {
      runId: ev.run_id,
      len: streamText.length,
      lastProcessedSeq: this._lastProcessedSeq,
    });
    const entry: TimelineEntry = {
      kind: "assistant",
      id,
      anchorId: id,
      content: streamText,
      ts: eventTs(ev),
    };
    this._pushTimeline(ctx, entry);
    this._clearStreamingState(ctx);
  }

  private _runIdleHealthCheckIfNeeded(): void {
    if (!this._needsIdleHealthCheck || !this.run) return;
    this._needsIdleHealthCheck = false;

    const lastAssistant = [...this.timeline]
      .reverse()
      .find((e): e is Extract<TimelineEntry, { kind: "assistant" }> => e.kind === "assistant");
    if (lastAssistant && !lastAssistant.content.trim() && this.usage.outputTokens > 0) {
      dbgWarn("store", "idle health: empty assistant with output tokens", {
        runId: this.run.id,
        messageId: lastAssistant.id,
        outputTokens: this.usage.outputTokens,
      });
      void this.recoverFromEventLog("Recovered from persisted event log");
      return;
    }

    if (this.streamingText.trim()) {
      dbgWarn("store", "idle health: orphan streamingText remains", {
        runId: this.run.id,
        len: this.streamingText.length,
      });
      this._materializeOrphanStreamingOnIdle(
        null,
        { type: "run_state", run_id: this.run.id, state: "idle" },
        false,
        () => this.timeline,
      );
    }
  }

  /** Highest WS `_seq` processed — exposed for protocol quarantine seq invariants. */
  getLastProcessedSeq(): number {
    return this._lastProcessedSeq;
  }

  /** Brief protocol/recovery notice for RecoveringBanner (minimal UI hook). */
  setProtocolNotice(notice: string | null): void {
    this.recoveryNotice = notice;
  }

  /** Reload timeline from persisted events.jsonl with per-run single-flight recovery. */
  recoverFromEventLog(notice?: string): Promise<void> {
    const runId = this.run?.id;
    if (!runId) return Promise.resolve();

    return this._recovery.request(
      runId,
      notice ?? "Recovered from persisted event log",
      async () => {
        dbgWarn("store", "recoverFromEventLog", { runId, notice });
        try {
          await snapshotCache.deleteSnapshot(runId);
        } catch (e) {
          dbgWarn("snapshot", "delete failed before recover", e);
        }
        // A user-driven run switch supersedes recovery for the old run.
        if (this.run?.id !== runId) return;
        await this.loadRun(runId);
      },
    );
  }

  /** Accumulate partial JSON and try to parse. Returns merged tool fields. */
  private static _accumulateJsonInput(
    tool: Record<string, unknown>,
    partialJson: string,
  ): { input?: Record<string, unknown>; _inputJsonAccum: string } {
    return accumulateJsonInput(tool, partialJson);
  }

  /** Route tool_input_delta to a child tool inside a parent's subTimeline. */
  private _updateSubTimelineToolInput(
    parentToolUseId: string,
    childToolUseId: string,
    partialJson: string,
    ctx: ReduceCtx | null,
  ): void {
    this._updateSubTimelineTool(
      parentToolUseId,
      childToolUseId,
      (t) => {
        const accum = SessionStore._accumulateJsonInput(t as Record<string, unknown>, partialJson);
        return { ...t, ...accum } as typeof t;
      },
      ctx,
    );
  }

  // ── Reducers ──

  /** Apply a single live bus event (mutates $state directly). */
  applyEvent(ev: BusEvent): void {
    // v1.1.0 / 110-A17, 110-A4: `attention_changed` and
    // `runtime_health_changed` are global snapshot signals (no run_id)
    // — they don't belong to a single run, so SessionStore ignores
    // them. Observers on the AttentionStore / capability matrix
    // refresh themselves.
    if (ev.type === "attention_changed" || ev.type === "runtime_health_changed") {
      return;
    }
    // Guard: drop events for a run we're no longer viewing
    if (!this.run || ev.run_id !== this.run.id) {
      dbg("store", "drop stale event", ev.type, "run_id=", ev.run_id, "current=", this.run?.id);
      return;
    }
    // Track WS sequence checkpoint — skip already-processed events (dedup)
    const evSeq = ((ev as Record<string, unknown>)._seq as number) ?? 0;
    if (evSeq > 0) {
      if (evSeq <= this._lastProcessedSeq) {
        dbg(
          "store",
          "drop duplicate event",
          ev.type,
          "seq=",
          evSeq,
          "last=",
          this._lastProcessedSeq,
        );
        return;
      }
      this._lastProcessedSeq = evSeq;
    }
    this._reduce(ev, null);
    this._runIdleHealthCheckIfNeeded();
  }

  /** Build a reducer context snapshotted from current store state. Caller drives the
   * reduce loop and then passes the ctx to `_commitReduceCtx`. */
  private _createReduceCtx(): ReduceCtx {
    const batchTlIndex = new Map<string, number>();
    for (let i = 0; i < this.timeline.length; i++) {
      const e = this.timeline[i];
      if (e.kind === "tool" && !batchTlIndex.has(e.id)) batchTlIndex.set(e.id, i);
    }
    const batchHeIndex = new Map<string, number>();
    for (let i = 0; i < this.tools.length; i++) {
      const tid = (this.tools[i] as Record<string, unknown>).tool_use_id as string | undefined;
      if (tid && !batchHeIndex.has(tid)) batchHeIndex.set(tid, i);
    }
    return {
      tl: [...this.timeline],
      he: [...this.tools],
      streamText: this.streamingText,
      thinkingText: this.thinkingText,
      model: this.model,
      phase: this.phase,
      usage: { ...this.usage },
      error: this.error,
      seenMessageIds: new Set(this._seenMessageIds),
      seenToolIds: new Set(this._seenToolIds),
      runStatus: null,
      sessionId: null,
      isStream: this.useStreamSession,
      turnUsages: [...this.turnUsages],
      toolTlIndex: batchTlIndex,
      toolHeIndex: batchHeIndex,
    };
  }

  /** Apply the reducer ctx to live store state. Runs synchronously — no awaits inside,
   * so a stale check before this call is sufficient to skip publishing. */
  private _commitReduceCtx(ctx: ReduceCtx, replayOnly: boolean): void {
    // If the session ended, resolve any leftover incomplete tools
    // (running, ask_pending, permission_prompt — these will never receive results)
    const runStatus = this.run?.status;
    const sessionDead =
      runStatus === "stopped" || runStatus === "completed" || runStatus === "failed";
    if (sessionDead) {
      const finalized = finalizeTimelineForDeadSession(ctx.tl);
      if (finalized) ctx.tl = finalized;
    }

    this.timeline = ctx.tl;
    this.tools = ctx.he;
    this.streamingText = ctx.streamText;
    this.thinkingText = ctx.thinkingText;
    this.model = ctx.model;
    this.usage = ctx.usage;
    this.turnUsages = ctx.turnUsages;
    this._seenMessageIds = ctx.seenMessageIds;
    this._seenToolIds = ctx.seenToolIds;
    this._toolTlIndex = ctx.toolTlIndex;
    this._toolHeIndex = ctx.toolHeIndex;
    // Always clear timeouts on batch commit — even replayOnly batches can carry
    // terminal run_state events that should cancel pending spawn/response timers.
    this._clearSpawnTimeout();
    this._clearResponseTimeout();
    if (!replayOnly) {
      this._setPhase(ctx.phase);
      this.error = ctx.error;
      if ((ctx.runStatus || ctx.sessionId) && this.run) {
        const updates: Partial<TaskRun> = {};
        if (ctx.runStatus) updates.status = ctx.runStatus as RunStatus;
        if (ctx.sessionId) {
          dbg("store", "batch: updating session_id", {
            old: this.run.session_id,
            new: ctx.sessionId,
          });
          updates.session_id = ctx.sessionId;
        }
        this.run = { ...this.run, ...updates };
      }
    }

    if (this.ralphLoop?.active && replayOnly) {
      this.ralphLoop = { ...this.ralphLoop, active: false, reason: "interrupted" };
      dbg("store", "ralph loop marked interrupted after replay");
    }
  }

  /** Apply a batch of events (e.g. during loadRun replay). Avoids N reactive updates.
   *  opts.replayOnly=true skips phase and error assignments (used during resume).
   *  Returns elapsed milliseconds. Synchronous — for chunked replay use
   *  `applyEventBatchAsync` which yields between chunks. */
  applyEventBatch(events: BusEvent[], opts?: { replayOnly?: boolean }): number {
    const t0 = performance.now();
    const replayOnly = opts?.replayOnly ?? false;
    const ctx = this._createReduceCtx();
    // Keep the sequence checkpoint local until every reducer succeeds. If one
    // event throws, control exits before _commitReduceCtx / _lastProcessedSeq
    // are touched, so EventMiddleware can safely retry the batch per-event
    // without those events being misclassified as already processed.
    let localSeq = this._lastProcessedSeq;
    for (const ev of events) {
      const evSeq = ((ev as Record<string, unknown>)._seq as number) ?? 0;
      if (evSeq > 0) localSeq = Math.max(localSeq, evSeq);
      this._reduce(ev, ctx, replayOnly);
    }
    this._commitReduceCtx(ctx, replayOnly);
    this._lastProcessedSeq = localSeq;
    const cpuMs = performance.now() - t0;
    dbg(
      "store",
      `applyEventBatch:sync: ${events.length} events in ${cpuMs.toFixed(1)}ms cpu, timeline=${ctx.tl.length}`,
    );
    this._runIdleHealthCheckIfNeeded();
    return cpuMs;
  }

  /**
   * Async variant for replay paths (loadRun / resume / fork / idle catchup).
   *
   * Always reduces into a local ctx + `localSeq`; on stale abort neither
   * `this.timeline` nor `this._lastProcessedSeq` is touched (so a quick run
   * switch can't pollute the next subscribe's seq checkpoint).
   *
   * Large batches (> CHUNK_THRESHOLD) yield between chunks to keep the main
   * thread responsive. Small batches use the same code path but skip the
   * yields — slightly more overhead than the public sync `applyEventBatch`,
   * but worth it for the stale-safety guarantee.
   *
   * Returns elapsed ms (wall-time when chunked, cpu-time otherwise), or `null`
   * if `opts.isStale()` reported stale — caller must skip subsequent
   * subscribe/snapshot work in that case.
   */
  async applyEventBatchAsync(
    events: BusEvent[],
    opts: { replayOnly?: boolean; isStale?: () => boolean } = {},
  ): Promise<number | null> {
    if (opts.isStale?.()) return null;
    beginHistorySoundMute();
    try {
      const t0 = performance.now();
      const isStale = opts.isStale ?? (() => false);
      const replayOnly = opts.replayOnly ?? false;
      // Local accumulators — both ctx and `_lastProcessedSeq` stay isolated until commit.
      // This prevents stale aborts from polluting store state mid-replay.
      const ctx = this._createReduceCtx();
      let localSeq = this._lastProcessedSeq;
      const CHUNK = 200;
      const CHUNK_THRESHOLD = 500;
      const shouldYield = events.length > CHUNK_THRESHOLD;
      for (let i = 0; i < events.length; i += CHUNK) {
        if (isStale()) return null;
        const end = Math.min(i + CHUNK, events.length);
        for (let j = i; j < end; j++) {
          const ev = events[j];
          const evSeq = ((ev as Record<string, unknown>)._seq as number) ?? 0;
          if (evSeq > 0 && evSeq > localSeq) localSeq = evSeq;
          this._reduce(ev, ctx, replayOnly);
        }
        if (shouldYield) await yieldToMain();
      }
      if (isStale()) return null;
      // Atomic commit: seq + timeline + tools + phase land together.
      this._lastProcessedSeq = localSeq;
      this._commitReduceCtx(ctx, replayOnly);
      const wallMs = performance.now() - t0;
      dbg(
        "store",
        `applyEventBatch:async: ${events.length} events in ${wallMs.toFixed(1)}ms ${shouldYield ? "wall" : "cpu"}, timeline=${ctx.tl.length}`,
      );
      return wallMs;
    } finally {
      endHistorySoundMute();
    }
  }

  /**
   * Offline replay for split-pane inactive snapshots. Does not mutate live
   * session state — uses an isolated reducer ctx with a temporary `run`.
   */
  buildSnapshotFromEvents(
    run: import("$lib/types").TaskRun,
    events: import("$lib/types").BusEvent[],
  ): {
    timeline: TimelineEntry[];
    tools: HookEvent[];
    turnUsages: TurnUsage[];
  } {
    const prevRun = this.run;
    this.run = run;
    try {
      const ctx = this._createReduceCtx();
      ctx.tl = [];
      ctx.he = [];
      ctx.streamText = "";
      ctx.thinkingText = "";
      ctx.turnUsages = [];
      ctx.seenMessageIds = new Set();
      ctx.seenToolIds = new Set();
      ctx.toolTlIndex = new Map();
      ctx.toolHeIndex = new Map();
      ctx.isStream = run.execution_path === "session_actor";
      ctx.model = run.model ?? "";
      ctx.phase = "idle";
      ctx.error = "";
      ctx.usage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0,
      };

      for (const ev of events) {
        if (ev.type === "attention_changed" || ev.type === "runtime_health_changed") continue;
        if (ev.run_id && ev.run_id !== run.id) continue;
        this._reduce(ev, ctx, true);
      }

      this._finalizeSnapshotCtxTools(ctx, run.status);
      return {
        timeline: ctx.tl,
        tools: ctx.he,
        turnUsages: ctx.turnUsages,
      };
    } finally {
      this.run = prevRun;
    }
  }

  private _finalizeSnapshotCtxTools(
    ctx: ReduceCtx,
    runStatus: import("$lib/types").RunStatus,
  ): void {
    finalizeSnapshotCtxTools(ctx, runStatus);
  }

  /** Apply a hook event (from hook-event Tauri listener). */
  applyHookEvent(event: HookEvent): void {
    if (!this.run) return;
    const result = applyHookEventCore(
      this.tools,
      event,
      this.run.id,
      this.useStreamSession || this.sessionAlive,
    );
    if (result) this.tools = result;
  }

  /** Apply hook usage (cumulative += not overwrite). */
  applyHookUsage(usage: {
    run_id: string;
    input_tokens: number;
    output_tokens: number;
    cost: number;
  }): void {
    if (!this.run) return;
    const result = applyHookUsageCore(this.usage, usage, this.run.id);
    if (result) this.usage = result;
  }

  /** Apply a batch of hook events (single reactive update instead of N). */
  applyHookEventBatch(events: HookEvent[]): void {
    if (!this.run) return;
    const result = applyHookEventBatchCore(
      this.tools,
      events,
      this.run.id,
      this.useStreamSession || this.sessionAlive,
    );
    if (result) this.tools = result;
  }

  /** Apply a batch of hook usage (single reactive update, cumulative). */
  applyHookUsageBatch(
    usages: Array<{ run_id: string; input_tokens: number; output_tokens: number; cost: number }>,
  ): void {
    if (!this.run) return;
    const result = applyHookUsageBatchCore(this.usage, usages, this.run.id);
    if (result) this.usage = result;
  }

  // ── Actions ──

  /** Clear in-flight turn streaming state before a new user message. */
  private _clearLiveTurnState(): void {
    this._clearStreamingState(null);
  }

  /** Clear all content/display state fields. Does not touch phase, run, or agent. */
  private _clearContentState(): void {
    this.timeline = [];
    this.streamingText = "";
    this.thinkingText = "";
    this.thinkingStartMs = 0;
    this.thinkingEndMs = 0;
    this.tools = [];
    this.usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
    };
    this.model = "";
    this.error = "";

    this.systemStatus = null;
    this.authStatus = null;
    this.hookEvents = [];
    this.taskNotifications = new Map();
    this.pendingElicitations = new Map();
    this.persistedFiles = [];
    this.ralphLoop = null;
    this.sessionCommands = [];
    this.mcpServers = [];
    this.cliVersion = "";
    // NOTE: permissionMode intentionally NOT cleared — user-level preference, same as platformId.
    // However, if persist had failed, reset the flag so next session_init can re-sync.
    if (this.permissionModePersistFailed) {
      this.permissionModeSetByUser = false;
      this.permissionModePersistFailed = false;
      dbg("store", "permissionMode flag reset — persist had failed, allowing session_init re-sync");
    }
    this.fastModeState = "";
    this.apiKeySource = "";
    this.rateLimitStatus = "";
    this.rateLimitType = "";
    this.rateLimitUtilization = null;
    this.rateLimitResetsAt = null;
    this.availableAgents = [];
    this.availableSkills = [];
    this.availablePlugins = [];
    this.numTurns = 0;
    this.durationMs = 0;
    this.turnUsages = [];
    this.lastCompactedAt = 0;
    this.compactCount = 0;
    this.microcompactCount = 0;
    this.sessionCwd = "";
    this.sessionTools = [];
    this.outputStyle = "";
    // If agent entered plan mode (previousPermissionMode is non-empty), restore the user's
    // actual preference. If user manually selected plan (previousPermissionMode is empty),
    // leave it alone — it's a user-level preference.
    if (this.permissionMode === "plan" && this.previousPermissionMode) {
      const restored = this.previousPermissionMode;
      this.permissionMode = restored;
      dbg("store", "permissionMode restored from agent plan on clear", { restored });
    }
    this.previousPermissionMode = "";
    this.pendingPermissionModeOverride = null;
    this.pendingClearContextPlan = null;
    this.sessionInitReceived = false;
    this.unknownEventCount = 0;
    this.rawFallbackCount = 0;
    // NOTE: remoteHostName and platformId are intentionally NOT cleared here —
    // they are run-level properties restored from run metadata, not per-session state.
    this._seenMessageIds.clear();
    this._seenToolIds.clear();
    this._lastProcessedSeq = 0;
    this._toolTlIndex.clear();
    this._toolHeIndex.clear();
    this._lastSnapshotSeq = 0;
  }

  /** Optimistically remove an elicitation after responding.
   *  Called by UI before the IPC call returns. */
  removeElicitation(requestId: string): void {
    if (!this.pendingElicitations.has(requestId)) return;
    const updated = new Map(this.pendingElicitations);
    updated.delete(requestId);
    this.pendingElicitations = updated;
  }

  /** Reset all state to empty. */
  reset(): void {
    this._asyncLifecycle.invalidate();
    this._connection.release();
    this._recovery.resetNotice();
    this._setPhase("empty");
    this.run = null;
    this._isLoadingReplay = false;
    this._clearContentState();
  }

  /** Mark a server-requested full reload without releasing this store's owner. */
  markConnectionReloading(runId: string): void {
    this._connection.markReloading(runId);
  }

  /** Release Store-owned communication lifecycles during page destruction. */
  releaseConnection(): void {
    this._connection.release();
    this._recovery.dispose();
  }

  // ── Snapshot cache helpers (delegating to ./session/snapshot-repository) ──

  /** Backwards-compat static alias for the repository constant. */
  private static readonly SNAPSHOT_MAX_TOOL_RESULT = 50_000;

  /** Serialize current store state into a JSON string for IDB caching.
   *  Delegates to snapshot-repository's pure `buildSnapshot` function. */
  private _buildSnapshot(): string {
    return buildSnapshot(this as unknown as Parameters<typeof buildSnapshot>[0]);
  }

  /** Parse snapshot body string. Returns parsed object or null if invalid JSON. */
  private _parseSnapshotBody(body: string): Record<string, unknown> | null {
    return parseSnapshotBody(body);
  }

  /** Try to restore store state from a pre-parsed snapshot object (or string for compat).
   *  Delegates to snapshot-repository's pure `applySnapshot` function. */
  private _tryApplySnapshot(bodyOrObj: string | Record<string, unknown>): boolean {
    return applySnapshot(this as unknown as Parameters<typeof applySnapshot>[0], bodyOrObj);
  }

  /** Fire-and-forget: serialize current state and write to IDB.
   *  Deferred to next event-loop tick so JSON.stringify doesn't block loadRun.
   *  Caller must check write guard before calling. */
  private _saveSnapshotToIdb(runId: string): void {
    if (!this.run) return;
    const runStatus = this.run.status;
    const gen = this._asyncLifecycle.currentGeneration;
    saveSnapshotToIdb(
      this as unknown as Parameters<typeof saveSnapshotToIdb>[0],
      runId,
      runStatus,
      {
        isStale: () => this._asyncLifecycle.isStale(gen),
        matchesRun: () => this.run?.id === runId,
        currentStatus: () => this.run?.status,
      },
    );
  }

  /** Load a run by ID. Handles replay of bus events / run events. */
  async loadRun(
    id: string,
    xtermRef?: { clear(): void; writeText(s: string): void },
  ): Promise<void> {
    const gen = this._asyncLifecycle.beginLoad();
    if (gen === null) return;
    const loadStart = performance.now();
    dbg("store", "loadRun id=", id, "gen=", gen);

    if (!id) {
      this.reset();
      return;
    }

    // Select the logical run before any asynchronous load. This releases the
    // previous run owner immediately and establishes an explicit replay phase.
    this._connection.beginReplay(id);

    // Reset state for new load
    this._setPhase("loading");
    this._clearContentState();

    if (xtermRef) {
      xtermRef.clear();
      xtermRef.writeText("\x1b[0m\x1b[2J\x1b[H");
    }

    try {
      const fetchedRun = await api.getRun(id);
      if (this._asyncLifecycle.isStale(gen)) {
        dbg("store", "stale after getRun, gen=", gen);
        return;
      }
      this.run = fetchedRun;
      // Cache for notification title lookup
      import("$lib/services/notification-listener")
        .then((m) => m.cacheRun(fetchedRun))
        .catch((e) => dbgWarn("store", "cacheRun failed:", e));

      // Auto-sync CLI imports to pick up events written after the initial import
      if (this.run.source === "cli_import") {
        try {
          const syncResult = await api.syncCliSession(id);
          if (syncResult.newEvents > 0) {
            dbg("store", "loadRun: auto-synced CLI import", {
              newEvents: syncResult.newEvents,
            });
            // Refresh run meta after sync (watermark/status may have updated)
            const refreshed = await api.getRun(id);
            if (this._asyncLifecycle.isStale(gen)) {
              dbg("store", "stale after auto-sync refresh, gen=", gen);
              return;
            }
            this.run = refreshed;
            // Sync appended events → IDB snapshot is stale
            snapshotCache.deleteSnapshot(id).catch((e) => dbgWarn("snapshot", "delete failed", e));
          }
        } catch (e) {
          dbg("store", "loadRun: auto-sync failed (non-fatal)", String(e));
        }
        if (this._asyncLifecycle.isStale(gen)) {
          dbg("store", "stale after auto-sync, gen=", gen);
          return;
        }
      }

      this.agent = this.run.agent;
      this.remoteHostName = this.run.remote_host_name ?? null;
      this.platformId = this.run.platform_id ?? null;
      // Suppress isThinking during event replay (prevents "thinking" flash on session switch)
      this._isLoadingReplay = true;

      // Determine phase from run status
      const st = this.run.status;
      if (st === "running") {
        // Health check: verify actor is actually alive for "running" runs.
        // Prevents UI from showing a fake running state when the actor crashed
        // but the run metadata still says "running".
        try {
          const status = await api.getSessionRuntimeStatus(id);
          if (this._asyncLifecycle.isStale(gen)) return;
          if (!status.actor_alive) {
            dbg("store", "loadRun: actor dead for running run, downgrading to ready", { id });
            this._setPhase("ready");
          } else {
            this._setPhase("running");
          }
        } catch {
          // Health check failed — assume actor is alive (optimistic)
          if (this._asyncLifecycle.isStale(gen)) return;
          this._setPhase("running");
        }
      } else if (st === "completed" || st === "failed" || st === "stopped") {
        this._setPhase(st as SessionPhase);
      } else if (st === "idle") {
        // Keep "loading" until the snapshot path chooses cached / idle — avoid
        // ready → cached which used to race and get blocked by the state machine.
      } else {
        this._setPhase("ready");
      }

      // Terminal runs use replayOnly — historical run_state events must not
      // overwrite the phase we just set from run.status. Same pattern as resumeSession.
      const isTerminal = TERMINAL_PHASES.includes(this.phase);

      if (this.useStreamSession) {
        let reducerMs = 0;
        let snapshotHit = false;

        // Try IDB snapshot (terminal + idle sessions)
        const snapshotEligible = isTerminal || this.run!.status === "idle";
        let snapshotBody: string | null = null;
        if (snapshotEligible) {
          try {
            snapshotBody = await snapshotCache.readSnapshot(id, this.run!.status);
          } catch {
            /* IDB unavailable → miss */
          }
          if (this._asyncLifecycle.isStale(gen)) return;
        }

        if (snapshotBody) {
          const isIdleSnap = !isTerminal;
          // Parse once, used for both seq check and apply
          const parsed = this._parseSnapshotBody(snapshotBody);
          if (!parsed) {
            snapshotBody = null; // corrupted JSON
          } else {
            const snapSeq = isIdleSnap ? ((parsed._lastProcessedSeq as number) ?? 0) : 1;

            if (snapSeq === 0 && isIdleSnap) {
              // seq=0: skip snapshot, delete stale entry to prevent repeated hit-then-skip
              dbg("store", "idle snapshot seq=0, skipping for full replay");
              snapshotCache
                .deleteSnapshot(id)
                .catch((e) => dbgWarn("snapshot", "delete failed", e));
              snapshotBody = null; // fall through to miss path
            } else if (this._tryApplySnapshot(parsed)) {
              snapshotHit = true;
              // Align _lastSnapshotSeq to prevent unnecessary rewrite on first idle
              this._lastSnapshotSeq = this._lastProcessedSeq;

              // Fix: idle snapshot hit → phase must be "idle", not "ready"
              // Optimization (v1.0.6 1.4 / Local-first 0.4): when the run is
              // idle and we are NOT subscribed to a live WS (desktop case),
              // prefer "cached" — we do not want to spawn the CLI until the
              // user actually sends a message (lazy resume).
              if (isIdleSnap) {
                if (getTransport().isDesktop()) {
                  this._setPhase("cached");
                  dbg("store", "loadRun: idle snapshot hit → cached (lazy resume)", { id });
                } else {
                  this._setPhase("idle");
                }
              }

              // Desktop idle: incremental catchup (no WS available)
              if (isIdleSnap && getTransport().isDesktop()) {
                const catchupEvents = await api.getBusEvents(id, this._lastProcessedSeq);
                if (this._asyncLifecycle.isStale(gen)) return;
                if (catchupEvents.length > 0) {
                  dbg("store", "idle snapshot catchup", { count: catchupEvents.length });
                  const catchupMs = await this.applyEventBatchAsync(catchupEvents, {
                    replayOnly: false,
                    isStale: this._asyncLifecycle.stalePredicate(gen),
                  });
                  // Stale (catchupMs === null) means a newer load owns the store —
                  // do NOT touch _isLoadingReplay; the new owner manages it.
                  if (catchupMs === null) return;
                  const catchupSt = this.run?.status;
                  if (
                    catchupSt === "idle" ||
                    catchupSt === "completed" ||
                    catchupSt === "failed" ||
                    catchupSt === "stopped"
                  ) {
                    this._saveSnapshotToIdb(id);
                  }
                  // If catchup revealed new activity, promote cached → idle.
                  if (this.phase === "cached") this._setPhase("idle");
                }
              } else if (isIdleSnap) {
                this._connection.subscribeFromSeq(id, this._lastProcessedSeq);
              }
              // Terminal: no catchup needed, just subscribe for WS if applicable
              if (!isIdleSnap) {
                this._connection.subscribeFromSeq(id, this._lastProcessedSeq);
              }
            } else {
              snapshotBody = null; // shape validation failed
            }
          }
        }

        if (!snapshotHit) {
          // Miss or snapshot corrupted → normal path
          const busEvents = await api.getBusEvents(id);
          if (this._asyncLifecycle.isStale(gen)) {
            dbg("store", "stale after getBusEvents, gen=", gen);
            return;
          }
          const ms = await this.applyEventBatchAsync(busEvents, {
            replayOnly: isTerminal,
            isStale: this._asyncLifecycle.stalePredicate(gen),
          });
          // Stale: a newer load owns the store; do not touch _isLoadingReplay.
          if (ms === null) return;
          reducerMs = ms;
          this._connection.subscribeFromReplay(id, busEvents);
          // Write guard: distinguish "legit empty session" from "reducer anomaly"
          if (snapshotEligible && (this.timeline.length > 0 || busEvents.length === 0)) {
            this._saveSnapshotToIdb(id);
          }
        }

        this._isLoadingReplay = false;
        // Idle load with no snapshot / no run_state in the log can leave phase
        // stuck on "loading" — settle to cached (desktop lazy) or idle.
        if (this.phase === "loading" && this.run?.status === "idle") {
          this._setPhase(getTransport().isDesktop() ? "cached" : "idle");
        }
        dbg("store", "loadRun", {
          total: Math.round(performance.now() - loadStart),
          snapshotHit,
          reducer: Math.round(reducerMs),
          entries: this.timeline.length,
        });
      } else {
        this._isLoadingReplay = false;
        // CLI mode: replay history in terminal
        const events = await api.getRunEvents(id);
        if (this._asyncLifecycle.isStale(gen)) {
          dbg("store", "stale after getRunEvents, gen=", gen);
          return;
        }
        let hasHistory = false;
        for (const event of events) {
          const text = String(
            (event.payload as Record<string, unknown>).text ??
              (event.payload as Record<string, unknown>).message ??
              "",
          );
          if (!text || !xtermRef) continue;
          if (event.type === "user") {
            xtermRef.writeText(`\x1b[1;36m> ${text}\x1b[0m\r\n`);
            hasHistory = true;
          } else if (event.type === "system") {
            xtermRef.writeText(`\x1b[90m${text}\x1b[0m\r\n`);
          }
        }
        if (hasHistory && !this.isRunning && xtermRef) {
          xtermRef.writeText(`\r\n\x1b[90m--- Session ended ---\x1b[0m\r\n`);
        }
      }

      // After replay, reconcile phase with run.status:
      // bus events may leave phase as "idle"/"running" even though the run
      // is actually terminal (e.g. process crashed without emitting run_state).
      const finalStatus = this.run?.status;
      if (finalStatus === "completed" || finalStatus === "failed" || finalStatus === "stopped") {
        if (!TERMINAL_PHASES.includes(this.phase as SessionPhase)) {
          dbg("store", "reconcile phase", this.phase, "→", finalStatus);
          this._setPhase(finalStatus as SessionPhase);
        }
        // Clear replayed errors for terminal runs — they're historical, not active
        this.error = "";
      }

      // Restore per-run model from meta.json (overrides session_init if user hot-switched)
      if (this.run?.model) {
        dbg("store", "restore run model from meta:", this.run.model);
        this.model = this.run.model;
      }
    } catch (e) {
      if (this._asyncLifecycle.isStale(gen)) return;
      this.error = String(e);
      this._setPhase("failed");
    } finally {
      if (!this._asyncLifecycle.isStale(gen)) {
        this._isLoadingReplay = false;
      }
    }
  }

  /** Create a new run and start the session. Returns the run ID.
   *  permissionModeOverride: session-scoped permission mode (CLI name, e.g. "acceptEdits").
   *  When set, takes priority over persisted user settings for this spawn only —
   *  used by ExitPlanMode "clear context + auto-accept" flow.
   *  folderId: optional logical-folder id (sidebar sub-folder). When set, the
   *  new run is created inside that folder instead of at the workspace root. */
  async startSession(
    prompt: string,
    cwd: string,
    attachments: Attachment[],
    permissionModeOverride?: string,
    creationMode?: "single" | "worktree",
    folderId?: string,
    runSurface?: RunSurface,
  ): Promise<string> {
    this.error = "";
    this._setPhase("spawning");

    try {
      // Refresh platformId and permissionMode from latest settings for new sessions.
      // Both may be stale (carried over from a previous run / earlier user selection)
      // if the user changed settings without navigating away from chat.
      try {
        const freshSettings = await api.getUserSettings();
        const freshPid = freshSettings.active_platform_id ?? "anthropic";
        if (freshSettings.auth_mode === "api" || isKeyOptionalPlatform(freshPid)) {
          if (freshPid !== this.platformId) {
            dbg("store", "startSession: refreshing platformId", {
              old: this.platformId,
              new: freshPid,
            });
            this.platformId = freshPid;
          }
        }
        // Settings stores app-internal names (auto_all, auto_read, etc.)
        // Store uses CLI names (bypassPermissions, acceptEdits, etc.)
        const APP_TO_CLI: Record<string, string> = {
          ask: "default",
          auto_read: "acceptEdits",
          auto_all: "bypassPermissions",
          plan: "plan",
          auto: "auto",
          dont_ask: "dontAsk",
        };
        if (permissionModeOverride) {
          // Session-scoped override wins — sync UI state to match what backend will spawn with.
          if (permissionModeOverride !== this.permissionMode) {
            this.permissionMode = permissionModeOverride;
            this.permissionModeSetByUser = true;
          }
        } else if (freshSettings.permission_mode) {
          const freshPerm =
            APP_TO_CLI[freshSettings.permission_mode] ?? freshSettings.permission_mode;
          if (freshPerm !== this.permissionMode) {
            dbg("store", "startSession: refreshing permissionMode", {
              old: this.permissionMode,
              new: freshPerm,
            });
            this.permissionMode = freshPerm;
            this.permissionModeSetByUser = true;
          }
        }
      } catch {
        // Non-fatal: fall through with current store values
      }

      // Explicitly pass execution_path — source of truth for run mode
      const executionPath = this.useStreamSession ? "session_actor" : "pipe_exec";
      const run = await api.startRun(
        prompt,
        cwd,
        this.agent,
        this.model || undefined,
        this.remoteHostName || undefined,
        this.platformId || undefined,
        executionPath,
        creationMode,
        folderId,
        undefined,
        runSurface,
      );
      this.run = run;

      if (this.useStreamSession) {
        // Optimistic user message — the backend emits UserMessage during
        // api.startSession(), but the middleware subscription isn't set up
        // until after goto() triggers the URL $effect.  Content-based dedup
        // in _reduce(user_message) prevents double display.
        const optimisticId = this._pushOptimisticUser(prompt, attachments);
        // Subscribe middleware BEFORE spawning so no bus-events are dropped.
        // The $effect in chat page will call subscribeCurrent again (idempotent).
        const mw = getEventMiddleware();
        mw.subscribeCurrent(run.id, this);
        this._connection.subscribeFresh(run.id);
        dbg("store", "stream session start, run=", run.id);
        const backendAtt = mapAttachments(attachments) ?? undefined;
        try {
          await api.startSession(
            run.id,
            undefined,
            undefined,
            undefined,
            backendAtt,
            this.platformId || undefined,
            permissionModeOverride,
          );
        } catch (startErr) {
          this._removeOptimisticUser(optimisticId);
          throw startErr;
        }
        dbg("store", "startSession resolved");
        // phase will be set by run_state bus event
        this._startSpawnTimeout(run.id);
        if (this.isKnownSlashCommand(prompt)) {
          dbg("store", "skip response timeout for slash command", { cmd: prompt.split(" ")[0] });
        } else {
          this._startResponseTimeout(run.id);
        }
      } else {
        // Codex pipe mode
        this._setPhase("running");
        await api.sendChatMessage(run.id, prompt, attachments.length > 0 ? attachments : undefined);
      }

      return run.id;
    } catch (e) {
      this.error = String(e);
      this._setPhase("failed");
      throw e;
    }
  }

  /** Send a subsequent message in an active session. */
  async sendMessage(
    text: string,
    attachments: Attachment[],
    clientMessageId?: string | null,
  ): Promise<void> {
    if (!this.run) throw new Error("No active run — message cannot be sent");
    this.error = "";
    this._clearLiveTurnState();
    // Invalidate idle snapshot — user is sending a new message
    snapshotCache.deleteSnapshot(this.run.id).catch((e) => dbgWarn("snapshot", "delete failed", e));

    try {
      if (this.useStreamSession && this.sessionAlive) {
        // Optimistic user message — matches the pattern in startSession().
        // Content-based dedup in _reduce(user_message) prevents double display
        // when the backend's UserMessage bus event arrives.
        const optimisticId = this._pushOptimisticUser(text, attachments);
        try {
          await api.sendSessionMessage(
            this.run.id,
            text,
            mapAttachments(attachments) ?? undefined,
            clientMessageId,
          );
        } catch (sendErr) {
          this._removeOptimisticUser(optimisticId);
          // If the backend reports "Session not found", the session actor
          // died but the frontend hasn't received the bus event yet.
          // Mark session as dead so the UI can recover.
          const msg = String(sendErr);
          if (msg.includes("not found") || msg.includes("not_found")) {
            dbg("store", "sendMessage: session actor gone, marking dead", { runId: this.run.id });
            this._setPhase("failed");
            throw new Error("session_dead: " + msg);
          }
          throw sendErr;
        }
        if (this.isKnownSlashCommand(text)) {
          dbg("store", "skip response timeout for slash command", { cmd: text.split(" ")[0] });
        } else {
          this._startResponseTimeout(this.run.id);
        }
      } else if (this.useStreamSession && !this.sessionAlive) {
        // Stream session died (e.g. spawn failed, process exited).
        // Cannot reuse the dead session — throw so the send coordinator
        // can handle it (start a new session or show error).
        throw new Error("session_dead: stream session is no longer alive — start a new session");
      } else {
        this._setPhase("running");
        await api.sendChatMessage(
          this.run.id,
          text,
          attachments.length > 0 ? attachments : undefined,
          undefined,
          clientMessageId,
        );
      }
    } catch (e) {
      this.error = String(e);
      // Pipe mode sets phase to "running" before the await; reset on failure
      // so the UI isn't stuck with isRunning=true and canSend=false.
      if (!this.useStreamSession && this.phase === "running") {
        this._setPhase("idle");
      }
      throw e;
    }
  }

  /** Send a slash command silently — no optimistic user message, no response timeout.
   *  Only whitelisted commands (/model, /effort) are allowed.
   *  Returns true if the command was sent, false if skipped. */
  async sendSilentCommand(command: string): Promise<boolean> {
    if (!this.run || !this.sessionAlive || !this.useStreamSession) return false;
    const trimmed = command.trim();
    if (!trimmed) return false;
    const cmd = trimmed.split(/\s+/)[0].toLowerCase();
    if (cmd !== "/model" && cmd !== "/effort") {
      dbgWarn("store", "sendSilentCommand rejected non-whitelisted command", { cmd });
      return false;
    }
    dbg("store", "sendSilentCommand", { command: trimmed });
    await api.sendSessionMessage(this.run.id, trimmed);
    return true;
  }

  /** Interrupt current turn. Falls back to kill if interrupt fails. */
  async interrupt(): Promise<void> {
    if (!this.run || !this.isRunning) return;
    if (!this.sessionAlive) {
      // Phase shows running but session is not alive — force cleanup
      this._setPhase("stopped");
      this.run = { ...this.run, status: "stopped" };
      return;
    }
    try {
      dbg("store", "interrupt current turn");
      await api.sendSessionControl(this.run.id, "interrupt");
    } catch (e) {
      // interrupt failed (timeout or actor dead) — kill process directly
      dbg("store", "interrupt failed, killing process:", e);
      try {
        await api.stopSession(this.run.id);
      } catch (e) {
        dbgWarn("store", "stopSession also failed (session may already be dead)", e);
      }
      this._setPhase("stopped");

      this.run = { ...this.run, status: "stopped" };
    }
  }

  /** Stop the current session. */
  async stop(): Promise<void> {
    if (!this.run) return;
    this._stopping = true;
    this._clearResponseTimeout();
    try {
      if (this.sessionAlive) {
        // Try graceful interrupt first if agent is currently running.
        // Skip during "spawning" — CLI hasn't initialized yet, interrupt would
        // wait for a control_response that may never come.
        if (this.phase === "running") {
          try {
            dbg("store", "sending interrupt before stop");
            await api.sendSessionControl(this.run.id, "interrupt");
            // Brief wait for CLI to process the interrupt
            await new Promise((r) => setTimeout(r, 500));
          } catch (e) {
            dbg("store", "interrupt failed (proceeding to kill):", e);
          }
        }
        try {
          await api.stopSession(this.run.id);
        } catch (e) {
          // Session may already be dead (process exited, actor cleaned up).
          // Force frontend state to stopped regardless.
          dbgWarn("store", "stopSession failed (forcing stopped):", e);
        }
      } else {
        await api.stopRun(this.run.id);
      }
    } catch (e) {
      dbgWarn("store", "stop failed:", e);
    } finally {
      // Always clean up frontend state, even if backend calls failed.
      // If the process is already dead, the UI must not stay stuck in "running".
      this._setPhase("stopped");

      this.run = { ...this.run!, status: "stopped" };
      this._stopping = false;
    }
  }

  // ── Resume ──

  /** Whether a resume/continue/fork operation is currently in progress. */
  get resumeInFlight(): boolean {
    return this._asyncLifecycle.resumeInFlight;
  }

  /** Resume/continue/fork a finished session. Returns the target run ID.
   *  Avoids flash by NOT calling reset() — clears content fields individually
   *  and uses replayOnly=true so replay doesn't overwrite phase.
   *  When initialMessage is provided, the message is written to CLI stdin atomically
   *  with the spawn — no separate send_session_message needed. */
  async resumeSession(
    runId: string,
    mode: SessionMode,
    initialMessage?: string,
    attachments?: Attachment[],
  ): Promise<string | null> {
    const loadGen = this._asyncLifecycle.beginResume();
    if (loadGen === null) return null;

    try {
      let run = await api.getRun(runId);
      if (this._asyncLifecycle.isStale(loadGen)) return runId;

      let metaActive = ACTIVE_PHASES.includes(run.status as SessionPhase);
      if (metaActive && mode !== "fork") {
        // meta.json says "running" — likely a stale status from an orphaned/crashed session.
        // Try to stop it first (kills process if alive, updates meta if not), then proceed.
        dbg("store", "resumeSession: meta says active, attempting stop first", {
          runId,
          status: run.status,
        });
        try {
          await api.stopRun(runId);
          // Re-fetch meta after stop to get updated status
          const refreshed = await api.getRun(runId);
          run = refreshed;
          metaActive = ACTIVE_PHASES.includes(run.status as SessionPhase);
        } catch (e) {
          dbgWarn("store", "resumeSession: stop attempt failed:", e);
        }
        if (metaActive) {
          // Still running after stop attempt — genuinely active, can't resume
          throw new Error(t("session_stillRunning"));
        }
      }
      // Fork validates session_id internally; resume/continue need it here.
      if (mode !== "continue" && mode !== "fork" && !run.session_id) {
        throw new Error(t("session_noId"));
      }

      // Invalidate any concurrent loadRun; loadGen captured at beginResume().
      const resumeT0 = performance.now();

      // ★ Phase 1: async data fetch BEFORE clearing state (avoids flash)
      const isStream = run.execution_path === "session_actor"; // run-level, not agent identity
      let snapshotBody: string | null = null;
      let busEvents: BusEvent[] = [];

      if (isStream) {
        try {
          snapshotBody = await snapshotCache.readSnapshot(runId, run.status);
        } catch {
          /* IDB unavailable */
        }
        if (this._asyncLifecycle.isStale(loadGen)) return runId;
        if (!snapshotBody) {
          busEvents = await api.getBusEvents(runId);
          if (this._asyncLifecycle.isStale(loadGen)) return runId;
          dbg("store", "resumeSession: fetched", busEvents.length, "bus events for replay");
        }
      }

      // ★ Phase 2: switch logical ownership before mutating visible state so
      // events from a previously viewed run cannot enter this replay window.
      this._connection.beginReplay(runId);
      this.run = run;
      this.agent = run.agent;
      this.platformId = run.platform_id ?? null;
      this._clearContentState();

      // ★ Phase 3: apply snapshot or events + force invalidate
      let reducerMs = 0;
      let snapshotHit = false;
      if (isStream) {
        if (snapshotBody && this._tryApplySnapshot(snapshotBody)) {
          snapshotHit = true;
          this._connection.subscribeFromSeq(runId, this._lastProcessedSeq);
        } else {
          // Fallback: snapshot corrupted → re-fetch events if needed
          if (!busEvents.length && snapshotBody) {
            busEvents = await api.getBusEvents(runId);
            if (this._asyncLifecycle.isStale(loadGen)) return runId;
          }
          if (busEvents.length > 0) {
            const ms = await this.applyEventBatchAsync(busEvents, {
              replayOnly: true,
              isStale: this._asyncLifecycle.stalePredicate(loadGen),
            });
            if (ms === null) return runId;
            reducerMs = ms;
          }
          // Always subscribe — even empty history needs real-time events
          this._connection.subscribeFromReplay(runId, busEvents);
        }

        // Resume makes session go live → old snapshot is always stale
        snapshotCache.deleteSnapshot(runId).catch((e) => dbgWarn("snapshot", "delete failed", e));
      }

      dbg("store", "resumeSession", {
        total: Math.round(performance.now() - resumeT0),
        snapshotHit,
        reducer: Math.round(reducerMs),
        entries: this.timeline.length,
      });

      // Restore per-run model from meta.json (overrides session_init if user hot-switched)
      if (run.model) {
        dbg("store", "resume: restore run model from meta:", run.model);
        this.model = run.model;
      }

      // Optimistic user message: add AFTER replay so it appears at the end of timeline.
      // Must be before startSession IPC so the user sees their message immediately.
      // Backend's UserMessage bus event will be deduped by content match in _reduce.
      if (initialMessage) {
        this._pushOptimisticUser(initialMessage, attachments ?? undefined);
      }

      // Explicitly set phase — replay didn't touch it
      this._setPhase("spawning");

      let targetRunId = runId;

      if (mode === "fork") {
        targetRunId = await this._handleFork(runId);
      } else {
        const sessionId = run.session_id;
        const backendAtt = attachments ? (mapAttachments(attachments) ?? undefined) : undefined;
        dbg("store", "resumeSession", {
          runId,
          targetRunId,
          mode,
          sessionId,
          hasMessage: !!initialMessage,
          attachments: backendAtt?.length ?? 0,
        });
        await api.startSession(
          targetRunId,
          mode,
          sessionId ?? undefined,
          initialMessage,
          backendAtt,
          run.platform_id ?? undefined,
        );
      }
      // Bus events via applyEvent (live) will transition phase:
      // - With message: spawning → running → idle (from CLI result)
      // - Without message: spawning → idle (synthetic, waiting for user input)

      // Timeout guard: if CLI never emits session_init, the UI would spin forever.
      // Fork skips this — connectSession() handles its own spawn timeout.
      if (mode !== "fork") {
        this._startSpawnTimeout(targetRunId);
        if (initialMessage && !this.isKnownSlashCommand(initialMessage)) {
          this._startResponseTimeout(targetRunId);
        } else if (initialMessage) {
          dbg("store", "skip response timeout for slash command (resume)", {
            cmd: initialMessage.split(" ")[0],
          });
        }
        // No initialMessage → no response timeout (just waiting for user input)
      }

      return targetRunId;
    } catch (e) {
      if (this._asyncLifecycle.isStale(loadGen)) return null;
      this.error = String(e);
      this._setPhase("failed");
      dbgWarn("store", "resumeSession failed:", e);
      return null;
    } finally {
      this._asyncLifecycle.endResume();
    }
  }

  /** Step 1 of two-step fork: create forked run, replay parent events.
   *  Returns the new run ID. Called from resumeSession when mode === "fork".
   *  Step 2 (connectSession) is called by the frontend after dismissing the fork overlay. */
  private async _handleFork(runId: string): Promise<string> {
    dbg("store", "resumeSession: two-step fork", { runId });
    const loadGen = this._asyncLifecycle.currentGeneration;

    // Clear both routing and this store's physical owner to prevent source
    // RunState(stopped) events from interfering with the fork replay.
    getEventMiddleware().subscribeCurrent("", this);
    this._connection.release();

    // Step 1: One-shot fork (backend does fork_oneshot, returns new run_id with new session_id)
    const newRunId = await api.forkSession(runId);
    if (this._asyncLifecycle.isStale(loadGen)) throw new Error("Unmounted during fork");

    const newRun = await api.getRun(newRunId);
    if (this._asyncLifecycle.isStale(loadGen)) throw new Error("Unmounted during fork");

    this._connection.beginReplay(newRunId);
    this.run = newRun;

    // Reset display state — start fresh for the fork run.
    // Without this, the source session's timeline stays in state and
    // message_delta events accumulate as duplicate streamingText.
    this._clearContentState();

    // Replay copied parent events for immediate display.
    // Subscribe to live events AFTER replay so a live applyEvent during chunked
    // replay can't slip in and be overwritten by `_commitReduceCtx` snapshotting
    // a now-stale `this.timeline`.
    const allForkEvents = await api.getBusEvents(newRunId);
    if (this._asyncLifecycle.isStale(loadGen)) throw new Error("Unmounted during fork");
    const newEvents = allForkEvents.filter(
      (ev) =>
        ev.type === "attention_changed" ||
        ev.type === "runtime_health_changed" ||
        ev.run_id === newRunId,
    );
    if (newEvents.length > 0) {
      dbg("store", "fork: replaying", newEvents.length, "parent events");
      const ms = await this.applyEventBatchAsync(newEvents, {
        replayOnly: true,
        isStale: this._asyncLifecycle.stalePredicate(loadGen),
      });
      // Match the existing fork pattern (line ~2157): treat a stale/unmount
      // mid-replay as a fatal interruption so the caller's catch path runs.
      if (ms === null) throw new Error("Stale during fork replay");
    }
    // Subscribe to NEW run — live events from stream-json will route here.
    getEventMiddleware().subscribeCurrent(newRunId, this);
    dbg("store", "fork: middleware subscribed to new run", newRunId);
    this._connection.subscribeFromReplay(newRunId, allForkEvents);

    // Step 2 (stream-json resume) is NOT started here.
    // handleResume will dismiss the overlay first, then call connectSession()
    // so the user sees normal "Starting session..." spinner instead of the fork overlay.
    dbg("store", "fork: step 1 complete, returning newRunId for step 2", {
      newRunId,
      sessionId: newRun.session_id,
    });
    return newRunId;
  }

  /**
   * Step 2 of two-step fork: establish stream-json connection to an already-forked session.
   * Called from handleResume AFTER the fork overlay is dismissed, so the user sees
   * the normal "Starting session..." spinner instead of the fork overlay.
   */
  async connectSession(runId: string, sessionId?: string): Promise<void> {
    const sid = sessionId ?? this.run?.session_id;
    if (!sid) throw new Error("No session_id available for connectSession");
    dbg("store", "connectSession: establishing stream-json connection", { runId, sessionId: sid });
    this._connection.subscribeFresh(runId);
    this._setPhase("spawning");
    await api.startSession(
      runId,
      "resume",
      sid,
      undefined,
      undefined,
      this.platformId || undefined,
    );
    this._startSpawnTimeout(runId);
  }

  /** Call from page cleanup to prevent stale async writes after unmount. */
  unmountGuards(): void {
    this._asyncLifecycle.unmount();
    this._clearSpawnTimeout();
    this._clearResponseTimeout();
  }

  /** Update MCP servers (e.g. after getMcpStatus refresh). Deduplicates by name. */
  updateMcpServers(servers: McpServerInfo[]): void {
    this.mcpServers = dedupeMcpServersByName(servers);
  }

  /** Resolve an AskUserQuestion tool: transition from ask_pending → success. */
  resolveAskQuestion(toolUseId: string, answer: string): void {
    dbg("store", "resolveAskQuestion", { toolUseId, answer });
    const tIdx = this._findToolIdx(null, toolUseId);
    if (tIdx >= 0) {
      const old = this.timeline[tIdx] as Extract<TimelineEntry, { kind: "tool" }>;
      const u = [...this.timeline];
      u[tIdx] = { ...old, tool: { ...old.tool, status: "success", output: { answer } } };
      this.timeline = u;
    }
    // Mirror to tools[] only in non-stream mode
    if (!this.useStreamSession) {
      const hIdx = this._findHeIdx(null, toolUseId);
      if (hIdx >= 0) {
        const u = [...this.tools];
        u[hIdx] = { ...u[hIdx], status: "done", hook_type: "PostToolUse" };
        this.tools = u;
      }
    }
  }

  /** Answer an AskUserQuestion tool via session message. */
  async answerToolQuestion(toolUseId: string, answer: string): Promise<void> {
    if (!this.run) return;
    dbg("store", "tool answer", { toolUseId, answer });
    // Transition UI immediately
    this.resolveAskQuestion(toolUseId, answer);
    try {
      // Send the user's answer as a follow-up message.
      // The session should be alive (idle phase) after the CLI auto-failed AskUserQuestion.
      if (this.sessionAlive) {
        await api.sendSessionMessage(this.run.id, answer);
      } else {
        dbgWarn("store", "session not alive for tool answer, skipping send");
      }
    } catch (e) {
      dbgWarn("store", "tool answer failed:", e);
      this.error = String(e);
      throw e;
    }
  }

  /** Unified permission resolution: traverses ALL timeline + subTimeline entries
   *  (no early return) to handle duplicate requestId entries from fallback/synthetic sources.
   *  - "deny" → permission_denied
   *  - "allow" → running (skips AskUserQuestion to avoid double-submit) */
  private _resolvePermission(action: "allow" | "deny", requestId: string): void {
    dbg("store", `resolvePermission${action === "allow" ? "Allow" : "Deny"}`, { requestId });
    const targetStatus = action === "allow" ? ("running" as const) : ("permission_denied" as const);
    const skipAsk = action === "allow";
    let changed = false;
    const u = [...this.timeline];
    for (let i = 0; i < u.length; i++) {
      const entry = u[i];
      if (entry.kind !== "tool") continue;
      if (
        entry.tool.status === "permission_prompt" &&
        entry.tool.permission_request_id === requestId
      ) {
        if (!(skipAsk && entry.tool.tool_name === "AskUserQuestion")) {
          u[i] = { ...entry, tool: { ...entry.tool, status: targetStatus } };
          changed = true;
        }
      }
      if (entry.subTimeline) {
        let subChanged = false;
        const newSub = [...entry.subTimeline];
        for (let j = 0; j < newSub.length; j++) {
          const sub = newSub[j];
          if (
            sub.kind === "tool" &&
            sub.tool.status === "permission_prompt" &&
            sub.tool.permission_request_id === requestId &&
            !(skipAsk && sub.tool.tool_name === "AskUserQuestion")
          ) {
            newSub[j] = { ...sub, tool: { ...sub.tool, status: targetStatus } };
            subChanged = true;
          }
        }
        if (subChanged) {
          u[i] = { ...u[i], subTimeline: newSub } as TimelineEntry;
          changed = true;
        }
      }
    }
    if (changed) this.timeline = u;
  }

  resolvePermissionDeny(requestId: string): void {
    this._resolvePermission("deny", requestId);
  }

  resolvePermissionAllow(requestId: string): void {
    this._resolvePermission("allow", requestId);
  }

  /** Handle chat-done event (pipe mode). */
  handleChatDone(_done: { ok: boolean; code: number; error?: string }): void {
    if (!this.run) return;

    if (!this.useStreamSession) {
      const runId = this.run.id;
      this._setPhase("completed");
      api
        .getRun(runId)
        .then((r) => {
          // Guard: only apply if we're still on the same run
          if (this.run?.id === runId) this.run = r;
        })
        .catch((e) => dbgWarn("store", "getRun after pipe-exec done failed:", e));
    }
  }

  /** Handle chat-delta event (pipe-exec mode). */
  handleChatDelta(text: string, xtermRef?: { writeText(s: string): void }): void {
    if (!this.run) return;
    if (!this.useStreamSession && xtermRef) {
      xtermRef.writeText(text);
    }
  }

  // ── Private ──

  /** Whether to skip tools (HookEvent[]) mirror writes. Stream mode tools are in timeline only. */
  private _isStreamMode(ctx: ReduceCtx | null): boolean {
    return ctx ? ctx.isStream : this.useStreamSession;
  }

  /**
   * Resolve stale tool entries to "error" across main timeline and all subTimelines.
   * Used by idle/spawning/control_cancelled cleanup.
   */
  private _resolveStaleTools(
    predicate: (tool: BusToolItem) => boolean,
    ctx: ReduceCtx | null,
  ): void {
    if (ctx) {
      resolveStaleTools(ctx.tl, predicate);
    } else {
      const cloned = [...this.timeline];
      resolveStaleTools(cloned, predicate);
      this.timeline = cloned;
    }
  }

  // ── Reducers (extracted to event-handlers.ts) ──

  /** Core reducer: delegates to the extracted runReduce function. */
  private _reduce(ev: BusEvent, ctx: ReduceCtx | null, replayOnly = false): void {
    this._lastReduceEventType = ev.type;
    runReduce(ev, ctx, this as unknown as ReduceStore, replayOnly);
  }
}

// ── Singleton instance ──
// Module-level singleton so the store survives across SvelteKit page navigations.
// The store is a leaf in the component tree — no other stores reference it, so
// there is no risk of stale cross-session state leakage.
export const sessionStore = new SessionStore();
