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
} from "$lib/types";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { t } from "$lib/i18n/index.svelte";
import { yieldToMain } from "$lib/utils/yield";
import { IMAGE_TYPES } from "$lib/utils/file-types";
import { eventTs, eventTsMs } from "$lib/utils/event-ts";
import { uuid } from "$lib/utils/uuid";
import {
  type SessionPhase,
  type UsageState,
  type TurnUsage,
  ACTIVE_PHASES,
  TERMINAL_PHASES,
  SESSION_ALIVE_PHASES,
  assertTransition,
} from "./types";
import { getEventMiddleware } from "./event-middleware";
import { REDUCERS } from "./reducers";
import type { ReduceCtx } from "./reducers/types";
import { updateInstalledVersion, getCliCommands } from "./cli-info.svelte";
import * as snapshotCache from "$lib/utils/snapshot-cache";
import { getTransport } from "$lib/transport";
import { SessionRunConnection } from "$lib/chat/session-run-connection";
import { SessionRecoveryController } from "$lib/chat/session-recovery-controller";
import { LS_CLI_VERSION } from "$lib/utils/storage-keys";
import { getAgentFeatures, type AgentFeatures } from "$lib/utils/agent-features";
import { dedupeMcpServersByName } from "$lib/utils/mcp";
import {
  beginHistorySoundMute,
  dispatchLiveBusSound,
  endHistorySoundMute,
} from "$lib/services/sound-feedback-service";

// ── CLI permission mode normalization ──
// CLI may return different names for the same mode across versions.
// Normalize to the canonical names used throughout the app.
const CLI_PERM_MODE_ALIASES: Record<string, string> = {
  delegate: "acceptEdits", // CLI v2.1.81+ renamed acceptEdits → delegate
};

function normalizePermissionMode(mode: string): string {
  return CLI_PERM_MODE_ALIASES[mode] ?? mode;
}

// ── OpGuard: async operation guard with mounted check ──

class OpGuard {
  private _active = false;
  private _mounted = true;

  get busy(): boolean {
    return this._active;
  }
  get isMounted(): boolean {
    return this._mounted;
  }

  acquire(): boolean {
    if (this._active) return false;
    this._active = true;
    return true;
  }
  release(): void {
    this._active = false;
  }
  unmount(): void {
    this._mounted = false;
  }
}

// eventTs / eventTsMs moved to $lib/utils/event-ts so reducers can use them.

// Backfill anchorId for old snapshots/entries that predate the anchor system. Recursive for subTimelines.
function backfillAnchorId(entry: TimelineEntry): TimelineEntry {
  const e = entry as Record<string, unknown>;
  if (e.anchorId) return entry; // already has anchorId
  const anchor = (e.cliUuid as string) || (e.id as string);
  const patched = { ...entry, anchorId: anchor } as TimelineEntry;
  if (patched.kind === "tool" && patched.subTimeline) {
    (patched as { subTimeline: TimelineEntry[] }).subTimeline =
      patched.subTimeline.map(backfillAnchorId);
  }
  return patched;
}

// ── Internal batch state (plain objects, no reactivity) ──

// ReduceCtx is imported from ./reducers/types

// ── Helpers ──

/** Strip contentBase64 from non-image attachments to avoid storing MB of data in reactive state.
 *  Images keep base64 for inline <img> preview; PDF/other show as file chip (metadata only). */
function timelineAttachments(atts: Attachment[]): Attachment[] | undefined {
  if (atts.length === 0) return undefined;
  return atts.map((a) =>
    (IMAGE_TYPES as readonly string[]).includes(a.type) ? a : { ...a, contentBase64: "" },
  );
}

/** Map frontend Attachment[] to backend AttachmentData format for IPC. */
function mapAttachments(
  atts: Attachment[],
): Array<{ content_base64: string; media_type: string; filename: string }> | null {
  if (atts.length === 0) return null;
  return atts.map((a) => ({
    content_base64: a.contentBase64,
    media_type: a.type,
    filename: a.name,
  }));
}

/** Append to an array with a cap of 100 entries (keeps most recent). */
function _appendCapped<T>(arr: T[], item: T): T[] {
  const next = [...arr, item];
  return next.length > 100 ? next.slice(-100) : next;
}

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

  // Generation counter: prevents stale async loadRun from overwriting state
  private _loadGen = 0;
  /** True while loadRun is replaying events — suppresses isThinking flash on session switch. */
  private _isLoadingReplay = false;

  // Spawn timeout: fail if CLI never emits session_init
  private _spawnTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly _SPAWN_TIMEOUT_MS = 30_000;

  // Response timeout: warn if no content after sending a message
  private _responseTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly _RESPONSE_TIMEOUT_MS = 60_000;
  /** True when current error was set by the response timeout (cleared when content arrives). */
  private _isTimeoutError = false;

  /** Set phase with dev-mode transition guard. */
  private _setPhase(to: SessionPhase): void {
    assertTransition(this.phase, to);
    this.phase = to;
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
   *  Also kills the backend process to prevent orphan CLI processes. */
  private _startSpawnTimeout(runId: string): void {
    this._clearSpawnTimeout();
    this._spawnTimer = setTimeout(async () => {
      if (this.phase === "spawning" && this.run?.id === runId) {
        dbgWarn(
          "store",
          "spawn timeout: CLI did not respond within",
          SessionStore._SPAWN_TIMEOUT_MS,
          "ms",
        );
        this.error =
          "Session failed to start (CLI did not respond). Try again or check CLI installation.";
        // Kill the hung backend process to prevent orphans
        try {
          await api.stopSession(runId);
        } catch (e) {
          dbgWarn("store", "spawn timeout: failed to stop session:", e);
        }
        this._setPhase("failed");
        if (this.run) {
          this.run = { ...this.run, status: "failed" };
        }
      }
    }, SessionStore._SPAWN_TIMEOUT_MS);
  }

  private _clearSpawnTimeout(): void {
    if (this._spawnTimer) {
      clearTimeout(this._spawnTimer);
      this._spawnTimer = null;
    }
  }

  /** Start a timeout that warns if no response content arrives after sending a message. */
  private _startResponseTimeout(runId: string): void {
    this._clearResponseTimeout();
    this._responseTimer = setTimeout(() => {
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
    }, SessionStore._RESPONSE_TIMEOUT_MS);
  }

  private _clearResponseTimeout(): void {
    if (this._responseTimer) {
      clearTimeout(this._responseTimer);
      this._responseTimer = null;
    }
  }

  /** Clear response timeout error (only if it was set by the timeout, not a real error). */
  private _clearTimeoutError(): void {
    this._clearResponseTimeout();
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
    // Stream mode: scan timeline (top-level only, equivalent to previous HookEvent behavior)
    if (this.useStreamSession) {
      for (let i = this.timeline.length - 1; i >= 0; i--) {
        const e = this.timeline[i];
        if (e.kind === "tool" && e.tool.status === "running") return e.tool.tool_name;
      }
      return "";
    }
    // Pipe/PTY fallback: use HookEvent tools array
    return this.tools.filter((e) => e.status === "running").at(-1)?.tool_name ?? "";
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

  get isThinking(): boolean {
    if (!this.isRunning || this.streamingText) return false;
    // During loadRun replay, phase is set to "running" before events are loaded.
    // Without this guard, isThinking flashes true on session switch (especially on
    // Windows where replay is slower). Suppress during the loading window.
    if (this._isLoadingReplay) return false;
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
    return (
      this.usage.inputTokens +
      this.usage.outputTokens +
      this.usage.cacheReadTokens +
      this.usage.cacheWriteTokens
    );
  }

  get contextWindow(): number {
    if (!this.usage.modelUsage) return 0;
    const entries = Object.values(this.usage.modelUsage);
    let max = 0;
    for (const e of entries) {
      if (e.context_window && e.context_window > max) max = e.context_window;
    }
    return max;
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
    // MiMo also uses session_actor (StreamJson protocol)
    return this.agent === "claude" || this.agent === "mimo";
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

  /** Push an optimistic user message to the timeline (deduped by content in _reduce). */
  private _pushOptimisticUser(content: string, attachments?: Attachment[]): void {
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
    const idx = ctx ? ctx.toolTlIndex.get(toolUseId) : this._toolTlIndex.get(toolUseId);
    // Fast path: Map hit + validation
    if (idx !== undefined && tl[idx]?.kind === "tool" && tl[idx].id === toolUseId) return idx;
    // Fallback: linear scan (covers stale/missing index entries)
    const fallback = tl.findIndex((e) => e.kind === "tool" && e.id === toolUseId);
    if (fallback >= 0) {
      dbgWarn("store", "_findToolIdx: index miss, found via scan", {
        toolUseId,
        mapIdx: idx,
        scanIdx: fallback,
      });
    }
    return fallback;
  }

  /** Simple id-only lookup for hook events. Map fast-path + findIndex fallback. */
  private _findHeIdx(ctx: ReduceCtx | null, toolUseId: string): number {
    const he = ctx ? ctx.he : this.tools;
    const idx = ctx ? ctx.toolHeIndex.get(toolUseId) : this._toolHeIndex.get(toolUseId);
    if (
      idx !== undefined &&
      he[idx] &&
      (he[idx] as Record<string, unknown>).tool_use_id === toolUseId
    )
      return idx;
    const fallback = he.findIndex((e) => (e as Record<string, unknown>).tool_use_id === toolUseId);
    if (fallback >= 0) {
      dbgWarn("store", "_findHeIdx: index miss, found via scan", {
        toolUseId,
        mapIdx: idx,
        scanIdx: fallback,
      });
    }
    return fallback;
  }

  /** Status-aware hook event lookup: Map fast-path + status validation + scan fallback.
   *  Used by user_message and tool_end which filter by status==="running". */
  private _findHeIdxByStatus(ctx: ReduceCtx | null, toolUseId: string, status: string): number {
    const he = ctx ? ctx.he : this.tools;
    const idx = ctx ? ctx.toolHeIndex.get(toolUseId) : this._toolHeIndex.get(toolUseId);
    // Fast path: Map hit + status match
    if (
      idx !== undefined &&
      he[idx] &&
      (he[idx] as Record<string, unknown>).tool_use_id === toolUseId &&
      he[idx].status === status
    ) {
      return idx;
    }
    // Fallback: linear scan (covers status mismatch or stale index)
    return he.findIndex(
      (e) => (e as Record<string, unknown>).tool_use_id === toolUseId && e.status === status,
    );
  }

  // ── SubTimeline helpers (subagent routing) ──

  /** Find the parent tool entry in timeline by tool_use_id; return index or -1.
   *  Uses _findToolIdx for Map fast-path with findIndex fallback. */
  private _findParentToolIdx(ctx: ReduceCtx | null, parentToolUseId: string): number {
    return this._findToolIdx(ctx, parentToolUseId);
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
    for (let pIdx = 0; pIdx < tl.length; pIdx++) {
      const entry = tl[pIdx];
      if (entry.kind !== "tool" || !entry.subTimeline) continue;
      const sub = entry.subTimeline;
      const cIdx = sub.findIndex((e) => e.kind === "tool" && e.id === toolUseId);
      if (cIdx < 0) continue;
      // Found in this parent's subTimeline — update it
      const oldChild = sub[cIdx] as Extract<TimelineEntry, { kind: "tool" }>;
      const newSub = [...sub];
      newSub[cIdx] = { ...oldChild, tool: updater(oldChild.tool) };
      const updatedParent: TimelineEntry = { ...entry, subTimeline: newSub };
      if (ctx) {
        ctx.tl[pIdx] = updatedParent;
      } else {
        const u = [...this.timeline];
        u[pIdx] = updatedParent;
        this.timeline = u;
      }
      dbg("store", "found tool in subTimeline (missing parent_tool_use_id)", {
        tool: toolUseId,
        parent: entry.id,
      });
      return true;
    }
    return false;
  }

  /** Append an entry to a parent tool's subTimeline. */
  private _appendToSubTimeline(
    tl: TimelineEntry[],
    parentIdx: number,
    entry: TimelineEntry,
    ctx: ReduceCtx | null,
  ): void {
    const old = tl[parentIdx] as Extract<TimelineEntry, { kind: "tool" }>;
    const updated: TimelineEntry = { ...old, subTimeline: [...(old.subTimeline ?? []), entry] };
    if (ctx) {
      ctx.tl[parentIdx] = updated;
    } else {
      const u = [...this.timeline];
      u[parentIdx] = updated;
      this.timeline = u;
    }
  }

  /** Update a tool entry inside a parent tool's subTimeline (3-level immutable update). */
  private _updateSubTimelineTool(
    parentToolUseId: string,
    childToolUseId: string,
    updater: (old: BusToolItem) => BusToolItem,
    ctx: ReduceCtx | null,
  ): boolean {
    const tl = ctx ? ctx.tl : this.timeline;
    const pIdx = this._findParentToolIdx(ctx, parentToolUseId);
    if (pIdx < 0) return false;
    const parent = tl[pIdx] as Extract<TimelineEntry, { kind: "tool" }>;
    const sub = parent.subTimeline ?? [];
    const cIdx = sub.findIndex((e) => e.kind === "tool" && e.id === childToolUseId);
    if (cIdx < 0) return false;
    const oldChild = sub[cIdx] as Extract<TimelineEntry, { kind: "tool" }>;
    const newSub = [...sub];
    newSub[cIdx] = { ...oldChild, tool: updater(oldChild.tool) };
    const updatedParent: TimelineEntry = { ...parent, subTimeline: newSub };
    if (ctx) {
      ctx.tl[pIdx] = updatedParent;
    } else {
      const u = [...this.timeline];
      u[pIdx] = updatedParent;
      this.timeline = u;
    }
    return true;
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
    const tl = ctx ? ctx.tl : this.timeline;
    const pIdx = this._findParentToolIdx(ctx, parentToolUseId);
    if (pIdx < 0) return;
    const parent = tl[pIdx] as Extract<TimelineEntry, { kind: "tool" }>;
    const sub = parent.subTimeline ?? [];
    const syntheticId = `__sub_stream_${parentToolUseId}`;
    const sIdx = sub.findIndex((e) => e.kind === "assistant" && e.id === syntheticId);
    let newSub: TimelineEntry[];
    if (sIdx >= 0) {
      // Update existing synthetic entry
      const old = sub[sIdx] as Extract<TimelineEntry, { kind: "assistant" }>;
      newSub = [...sub];
      if (field === "content") {
        newSub[sIdx] = { ...old, content: old.content + text };
      } else {
        newSub[sIdx] = { ...old, thinkingText: (old.thinkingText ?? "") + text };
      }
    } else {
      // Create new synthetic entry
      const entry: TimelineEntry =
        field === "content"
          ? {
              kind: "assistant",
              id: syntheticId,
              anchorId: syntheticId,
              content: text,
              ts: new Date().toISOString(),
            }
          : {
              kind: "assistant",
              id: syntheticId,
              anchorId: syntheticId,
              content: "",
              thinkingText: text,
              ts: new Date().toISOString(),
            };
      newSub = [...sub, entry];
    }
    const updatedParent: TimelineEntry = { ...parent, subTimeline: newSub };
    if (ctx) {
      ctx.tl[pIdx] = updatedParent;
    } else {
      const u = [...this.timeline];
      u[pIdx] = updatedParent;
      this.timeline = u;
    }
  }

  /** Extract thinkingText from a parent tool's synthetic streaming entry (before removal). */
  private _extractSubTimelineThinking(
    parentToolUseId: string,
    ctx: ReduceCtx | null,
  ): string | undefined {
    const tl = ctx ? ctx.tl : this.timeline;
    const pIdx = this._findParentToolIdx(ctx, parentToolUseId);
    if (pIdx < 0) return undefined;
    const parent = tl[pIdx] as Extract<TimelineEntry, { kind: "tool" }>;
    const sub = parent.subTimeline ?? [];
    const syntheticId = `__sub_stream_${parentToolUseId}`;
    const entry = sub.find((e) => e.kind === "assistant" && e.id === syntheticId);
    if (!entry || entry.kind !== "assistant") return undefined;
    return entry.thinkingText;
  }

  /** Remove the synthetic streaming entry from a parent tool's subTimeline (called on message_complete). */
  private _removeSubTimelineStreamingEntry(parentToolUseId: string, ctx: ReduceCtx | null): void {
    const tl = ctx ? ctx.tl : this.timeline;
    const pIdx = this._findParentToolIdx(ctx, parentToolUseId);
    if (pIdx < 0) return;
    const parent = tl[pIdx] as Extract<TimelineEntry, { kind: "tool" }>;
    const sub = parent.subTimeline ?? [];
    const syntheticId = `__sub_stream_${parentToolUseId}`;
    const sIdx = sub.findIndex((e) => e.kind === "assistant" && e.id === syntheticId);
    if (sIdx < 0) return;
    const newSub = [...sub];
    newSub.splice(sIdx, 1);
    const updatedParent: TimelineEntry = { ...parent, subTimeline: newSub };
    if (ctx) {
      ctx.tl[pIdx] = updatedParent;
    } else {
      const u = [...this.timeline];
      u[pIdx] = updatedParent;
      this.timeline = u;
    }
  }

  /** Extract streamed assistant content from a parent tool's synthetic subTimeline entry. */
  private _extractSubTimelineStreamingContent(
    parentToolUseId: string,
    ctx: ReduceCtx | null,
  ): string {
    const tl = ctx ? ctx.tl : this.timeline;
    const pIdx = this._findParentToolIdx(ctx, parentToolUseId);
    if (pIdx < 0) return "";
    const parent = tl[pIdx] as Extract<TimelineEntry, { kind: "tool" }>;
    const sub = parent.subTimeline ?? [];
    const syntheticId = `__sub_stream_${parentToolUseId}`;
    const entry = sub.find((e) => e.kind === "assistant" && e.id === syntheticId);
    if (!entry || entry.kind !== "assistant") return "";
    return entry.content;
  }

  private _patchAssistantContentIfEmpty(
    ctx: ReduceCtx | null,
    messageId: string,
    content: string,
  ): boolean {
    if (!content.trim()) return false;
    const tl = ctx ? ctx.tl : this.timeline;
    const idx = tl.findIndex((e) => e.kind === "assistant" && e.id === messageId);
    if (idx < 0) return false;
    const old = tl[idx] as Extract<TimelineEntry, { kind: "assistant" }>;
    if (old.content.trim()) return false;
    const updated: TimelineEntry = { ...old, content };
    if (ctx) ctx.tl[idx] = updated;
    else {
      const u = [...this.timeline];
      u[idx] = updated;
      this.timeline = u;
    }
    dbgWarn("store", "patched empty assistant entry", {
      messageId,
      contentLen: content.length,
    });
    return true;
  }

  private _materializeOrphanStreamingOnIdle(
    ctx: ReduceCtx | null,
    ev: Extract<BusEvent, { type: "run_state" }>,
    replayOnly: boolean,
    getTl: () => TimelineEntry[],
  ): void {
    if (replayOnly) return;
    const streamText = ctx ? ctx.streamText : this.streamingText;
    if (!streamText.trim()) return;
    const id = `synthetic_assistant_${ev.run_id}_${this._lastProcessedSeq}`;
    if (getTl().some((e) => e.kind === "assistant" && e.id === id)) {
      if (ctx) ctx.streamText = "";
      else this.streamingText = "";
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
    if (ctx) ctx.streamText = "";
    else this.streamingText = "";
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
    const prevAccum = ((tool as Record<string, unknown>)._inputJsonAccum as string) ?? "";
    const newAccum = prevAccum + partialJson;
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(newAccum);
    } catch {
      /* incomplete JSON */
    }
    return { ...(parsed ? { input: parsed } : {}), _inputJsonAccum: newAccum };
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
      const staleStatuses = new Set(["running", "ask_pending", "permission_prompt"]);
      const finalizeTools = (tl: TimelineEntry[]): TimelineEntry[] => {
        let changed = false;
        const result = tl.map((e) => {
          if (e.kind !== "tool") return e;
          const newSub = e.subTimeline ? finalizeTools(e.subTimeline) : e.subTimeline;
          const needsFinalize = staleStatuses.has(e.tool.status);
          if (!needsFinalize && newSub === e.subTimeline) return e;
          changed = true;
          return {
            ...e,
            ...(newSub !== e.subTimeline ? { subTimeline: newSub } : {}),
            tool: needsFinalize
              ? { ...e.tool, status: "error" as const, output: { error: "Session ended" } }
              : e.tool,
          };
        });
        return changed ? result : tl;
      };
      ctx.tl = finalizeTools(ctx.tl);
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
    for (const ev of events) {
      const evSeq = ((ev as Record<string, unknown>)._seq as number) ?? 0;
      if (evSeq > 0) this._lastProcessedSeq = Math.max(this._lastProcessedSeq, evSeq);
      this._reduce(ev, ctx, replayOnly);
    }
    const cpuMs = performance.now() - t0;
    dbg(
      "store",
      `applyEventBatch:sync: ${events.length} events in ${cpuMs.toFixed(1)}ms cpu, timeline=${ctx.tl.length}`,
    );
    this._commitReduceCtx(ctx, replayOnly);
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

  /** Apply a hook event (from hook-event Tauri listener). */
  applyHookEvent(event: HookEvent): void {
    if (!this.run || event.run_id !== this.run.id) return;

    // In stream session mode, bus events already handle tool tracking
    if (
      (this.useStreamSession || this.sessionAlive) &&
      (event.hook_type === "PreToolUse" || event.hook_type === "PostToolUse")
    ) {
      dbg("store", "skip hook tool event (stream mode):", event.hook_type, event.tool_name);
      return;
    }

    // PostToolUse should update matching PreToolUse entry
    if (event.hook_type === "PostToolUse" && event.tool_name) {
      const idx = this.tools.findLastIndex(
        (e) =>
          e.tool_name === event.tool_name && e.hook_type === "PreToolUse" && e.status === "running",
      );
      if (idx >= 0) {
        const updated = [...this.tools];
        updated[idx] = {
          ...updated[idx],
          status: "done",
          hook_type: "PostToolUse",
          tool_output: event.tool_output,
        };
        this.tools = updated;
        return;
      }
    }

    this.tools = [...this.tools, event];
  }

  /** Apply hook usage (cumulative += not overwrite). */
  applyHookUsage(usage: {
    run_id: string;
    input_tokens: number;
    output_tokens: number;
    cost: number;
  }): void {
    if (!this.run || usage.run_id !== this.run.id) return;
    this.usage = {
      ...this.usage,
      inputTokens: this.usage.inputTokens + usage.input_tokens,
      outputTokens: this.usage.outputTokens + usage.output_tokens,
      cost: this.usage.cost + usage.cost,
    };
  }

  /** Apply a batch of hook events (single reactive update instead of N). */
  applyHookEventBatch(events: HookEvent[]): void {
    if (!this.run) return;
    let tools = this.tools;
    let mutated = false;
    for (const event of events) {
      if (event.run_id !== this.run.id) continue;
      if (
        (this.useStreamSession || this.sessionAlive) &&
        (event.hook_type === "PreToolUse" || event.hook_type === "PostToolUse")
      ) {
        continue;
      }
      if (event.hook_type === "PostToolUse" && event.tool_name) {
        const idx = tools.findLastIndex(
          (e) =>
            e.tool_name === event.tool_name &&
            e.hook_type === "PreToolUse" &&
            e.status === "running",
        );
        if (idx >= 0) {
          if (!mutated) {
            tools = [...tools];
            mutated = true;
          }
          tools[idx] = {
            ...tools[idx],
            status: "done",
            hook_type: "PostToolUse",
            tool_output: event.tool_output,
          };
          continue;
        }
      }
      if (!mutated) {
        tools = [...tools];
        mutated = true;
      }
      tools.push(event);
    }
    if (mutated) this.tools = tools;
  }

  /** Apply a batch of hook usage (single reactive update, cumulative). */
  applyHookUsageBatch(
    usages: Array<{ run_id: string; input_tokens: number; output_tokens: number; cost: number }>,
  ): void {
    if (!this.run) return;
    let dInput = 0,
      dOutput = 0,
      dCost = 0;
    for (const u of usages) {
      if (u.run_id !== this.run.id) continue;
      dInput += u.input_tokens;
      dOutput += u.output_tokens;
      dCost += u.cost;
    }
    if (dInput === 0 && dOutput === 0 && dCost === 0) return;
    this.usage = {
      ...this.usage,
      inputTokens: this.usage.inputTokens + dInput,
      outputTokens: this.usage.outputTokens + dOutput,
      cost: this.usage.cost + dCost,
    };
  }

  // ── Actions ──

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
    this._loadGen += 1;
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

  // ── Snapshot cache helpers ──

  /** Maximum tool_use_result size to serialize (bytes). Larger results are skipped in snapshot. */
  private static readonly SNAPSHOT_MAX_TOOL_RESULT = 50_000;

  /** Serialize current store state into a JSON string for IDB caching.
   *  Large tool_use_result fields are skipped to keep snapshot size manageable. */
  private _buildSnapshot(): string {
    // Clone timeline with large tool results and image base64 pruned to keep snapshot small
    const prunedTimeline = this.timeline.map((entry) => {
      // Strip contentBase64 from user message attachments (images, screenshots)
      if (entry.kind === "user" && entry.attachments?.length) {
        return {
          ...entry,
          attachments: entry.attachments.map((a) => ({
            name: a.name,
            type: a.type,
            size: a.size,
          })),
        };
      }
      if (entry.kind !== "tool") return entry;
      const tur = entry.tool.tool_use_result;
      if (tur && typeof tur === "object") {
        const size = JSON.stringify(tur).length;
        if (size > SessionStore.SNAPSHOT_MAX_TOOL_RESULT) {
          // Keep metadata but skip the large result body
          return {
            ...entry,
            tool: {
              ...entry.tool,
              tool_use_result: { _truncated: true, _size: size },
            },
          };
        }
      }
      return entry;
    });

    const obj: Record<string, unknown> = {
      // A group (ReduceCtx-derived)
      timeline: prunedTimeline,
      tools: this.tools,
      hookEvents: this.hookEvents,
      streamingText: this.streamingText,
      thinkingText: this.thinkingText,
      model: this.model,
      usage: this.usage,
      turnUsages: this.turnUsages,
      _seenMessageIds: [...this._seenMessageIds],
      _seenToolIds: [...this._seenToolIds],
      // B group (direct fields)
      systemStatus: this.systemStatus,
      authStatus: this.authStatus,
      cliVersion: this.cliVersion,
      // NOTE: permissionMode intentionally excluded — user-level preference, not snapshot state.
      fastModeState: this.fastModeState,
      apiKeySource: this.apiKeySource,
      sessionCommands: this.sessionCommands,
      mcpServers: this.mcpServers,
      sessionTools: this.sessionTools,
      availableAgents: this.availableAgents,
      availableSkills: this.availableSkills,
      availablePlugins: this.availablePlugins,
      sessionCwd: this.sessionCwd,
      outputStyle: this.outputStyle,
      sessionInitReceived: this.sessionInitReceived,
      numTurns: this.numTurns,
      durationMs: this.durationMs,
      compactCount: this.compactCount,
      microcompactCount: this.microcompactCount,
      persistedFiles: this.persistedFiles,
      unknownEventCount: this.unknownEventCount,
      rawFallbackCount: this.rawFallbackCount,
      taskNotifications: [...this.taskNotifications.entries()],
      _lastProcessedSeq: this._lastProcessedSeq,
    };
    return JSON.stringify(obj);
  }

  /** Parse snapshot body string. Returns parsed object or null if invalid JSON. */
  private _parseSnapshotBody(body: string): Record<string, unknown> | null {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /** Try to restore store state from a pre-parsed snapshot object (or string for compat).
   *  Returns true on success, false if shape validation fails. */
  private _tryApplySnapshot(bodyOrObj: string | Record<string, unknown>): boolean {
    try {
      const obj =
        typeof bodyOrObj === "string"
          ? (JSON.parse(bodyOrObj) as Record<string, unknown>)
          : bodyOrObj;
      // Shape validation: timeline must be array, usage must be object
      if (!Array.isArray(obj.timeline) || typeof obj.usage !== "object" || obj.usage === null) {
        dbgWarn("snapshot", "apply:shape-fail", {
          hasTimeline: Array.isArray(obj.timeline),
          hasUsage: typeof obj.usage,
        });
        return false;
      }

      // A group
      // Backfill anchorId for old snapshots that predate the anchor system
      this.timeline = (obj.timeline as TimelineEntry[]).map(backfillAnchorId);
      this.tools = (obj.tools ?? []) as HookEvent[];
      this.hookEvents = (obj.hookEvents ?? []) as typeof this.hookEvents;
      this.streamingText = (obj.streamingText as string) ?? "";
      this.thinkingText = (obj.thinkingText as string) ?? "";
      this.model = (obj.model as string) ?? "";
      this.usage = obj.usage as UsageState;
      this.turnUsages = (obj.turnUsages ?? []) as TurnUsage[];
      this._seenMessageIds = new Set((obj._seenMessageIds ?? []) as string[]);
      this._seenToolIds = new Set((obj._seenToolIds ?? []) as string[]);

      // B group
      this.systemStatus = (obj.systemStatus as typeof this.systemStatus) ?? null;
      this.authStatus = (obj.authStatus as typeof this.authStatus) ?? null;
      this.cliVersion = (obj.cliVersion as string) ?? "";
      // NOTE: permissionMode intentionally NOT restored from snapshot — user-level preference.
      this.fastModeState = (obj.fastModeState as string) ?? "";
      this.apiKeySource = (obj.apiKeySource as string) ?? "";
      this.sessionCommands = (obj.sessionCommands ?? []) as CliCommand[];
      this.mcpServers = dedupeMcpServersByName((obj.mcpServers ?? []) as McpServerInfo[]);
      this.sessionTools = (obj.sessionTools ?? []) as string[];
      this.availableAgents = (obj.availableAgents ?? []) as string[];
      this.availableSkills = (obj.availableSkills ?? []) as string[];
      this.availablePlugins = (obj.availablePlugins ?? []) as unknown[];
      this.sessionCwd = (obj.sessionCwd as string) ?? "";
      this.outputStyle = (obj.outputStyle as string) ?? "";
      this.sessionInitReceived = (obj.sessionInitReceived as boolean) ?? false;
      this.numTurns = (obj.numTurns as number) ?? 0;
      this.durationMs = (obj.durationMs as number) ?? 0;
      this.compactCount = (obj.compactCount as number) ?? 0;
      this.microcompactCount = (obj.microcompactCount as number) ?? 0;
      this.persistedFiles = (obj.persistedFiles ?? []) as unknown[];
      this.unknownEventCount = (obj.unknownEventCount as number) ?? 0;
      this.rawFallbackCount = (obj.rawFallbackCount as number) ?? 0;
      this.taskNotifications = new Map(
        (obj.taskNotifications ?? []) as Array<[string, TaskNotificationItem]>,
      );
      this._lastProcessedSeq = (obj._lastProcessedSeq as number) ?? 0;

      // Rebuild runtime tool indexes from restored state
      this._toolTlIndex.clear();
      for (let i = 0; i < this.timeline.length; i++) {
        const e = this.timeline[i];
        if (e.kind === "tool" && !this._toolTlIndex.has(e.id)) this._toolTlIndex.set(e.id, i);
      }
      this._toolHeIndex.clear();
      for (let i = 0; i < this.tools.length; i++) {
        const tid = (this.tools[i] as Record<string, unknown>).tool_use_id as string | undefined;
        if (tid && !this._toolHeIndex.has(tid)) this._toolHeIndex.set(tid, i);
      }

      dbg("snapshot", "apply:ok", { timeline: this.timeline.length });
      return true;
    } catch (err) {
      dbgWarn("snapshot", "apply:error", err);
      return false;
    }
  }

  /** Fire-and-forget: serialize current state and write to IDB.
   *  Deferred to next event-loop tick so JSON.stringify doesn't block loadRun.
   *  Caller must check write guard before calling. */
  private _saveSnapshotToIdb(runId: string): void {
    if (!this.run) return;
    const runStatus = this.run.status;
    const gen = this._loadGen;
    const doSave = () => {
      // Guard: still viewing the same run (user may have navigated away)
      if (this._loadGen !== gen || this.run?.id !== runId) return;
      // Guard: status must still match (prevents stale write after idle→running transition)
      if (this.run.status !== runStatus) {
        dbg("snapshot", "save:skipped (status changed)", {
          runId,
          expected: runStatus,
          actual: this.run.status,
        });
        return;
      }
      const body = this._buildSnapshot();
      dbg("snapshot", "save", { runId, runStatus, bytes: body.length });
      snapshotCache
        .writeSnapshot(runId, runStatus, body)
        .catch((e) => dbgWarn("snapshot", "write failed", e));
    };
    // Use requestIdleCallback when available to avoid blocking main thread
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(doSave, { timeout: 2000 });
    } else {
      setTimeout(doSave, 50);
    }
  }

  /** Load a run by ID. Handles replay of bus events / run events. */
  async loadRun(
    id: string,
    xtermRef?: { clear(): void; writeText(s: string): void },
  ): Promise<void> {
    const gen = ++this._loadGen;
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
      this.run = await api.getRun(id);
      if (gen !== this._loadGen) {
        dbg("store", "stale after getRun, gen=", gen);
        return;
      }
      // Cache for notification title lookup
      import("$lib/services/notification-listener")
        .then((m) => m.cacheRun(this.run!))
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
            this.run = await api.getRun(id);
            // Sync appended events → IDB snapshot is stale
            snapshotCache.deleteSnapshot(id).catch((e) => dbgWarn("snapshot", "delete failed", e));
          }
        } catch (e) {
          dbg("store", "loadRun: auto-sync failed (non-fatal)", String(e));
        }
        if (gen !== this._loadGen) {
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
          if (gen !== this._loadGen) return;
          if (!status.actor_alive) {
            dbg("store", "loadRun: actor dead for running run, downgrading to ready", { id });
            this._setPhase("ready");
          } else {
            this._setPhase("running");
          }
        } catch {
          // Health check failed — assume actor is alive (optimistic)
          if (gen !== this._loadGen) return;
          this._setPhase("running");
        }
      } else if (st === "completed" || st === "failed" || st === "stopped") {
        this._setPhase(st as SessionPhase);
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
          if (gen !== this._loadGen) return;
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
                if (gen !== this._loadGen) return;
                if (catchupEvents.length > 0) {
                  dbg("store", "idle snapshot catchup", { count: catchupEvents.length });
                  const catchupMs = await this.applyEventBatchAsync(catchupEvents, {
                    replayOnly: false,
                    isStale: () => gen !== this._loadGen,
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
          if (gen !== this._loadGen) {
            dbg("store", "stale after getBusEvents, gen=", gen);
            return;
          }
          const ms = await this.applyEventBatchAsync(busEvents, {
            replayOnly: isTerminal,
            isStale: () => gen !== this._loadGen,
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
        if (gen !== this._loadGen) {
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
      if (gen !== this._loadGen) return;
      this.error = String(e);
      this._setPhase("failed");
    } finally {
      if (gen === this._loadGen) {
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
  ): Promise<string> {
    this.error = "";
    this._setPhase("spawning");

    try {
      // Refresh platformId and permissionMode from latest settings for new sessions.
      // Both may be stale (carried over from a previous run / earlier user selection)
      // if the user changed settings without navigating away from chat.
      try {
        const freshSettings = await api.getUserSettings();
        if (freshSettings.auth_mode === "api") {
          const freshPid = freshSettings.active_platform_id ?? "anthropic";
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
      );
      this.run = run;

      if (this.useStreamSession) {
        // Optimistic user message — the backend emits UserMessage during
        // api.startSession(), but the middleware subscription isn't set up
        // until after goto() triggers the URL $effect.  Content-based dedup
        // in _reduce(user_message) prevents double display.
        this._pushOptimisticUser(prompt, attachments);
        // Subscribe middleware BEFORE spawning so no bus-events are dropped.
        // The $effect in chat page will call subscribeCurrent again (idempotent).
        const mw = getEventMiddleware();
        mw.subscribeCurrent(run.id, this);
        this._connection.subscribeFresh(run.id);
        dbg("store", "stream session start, run=", run.id);
        const backendAtt = mapAttachments(attachments) ?? undefined;
        await api.startSession(
          run.id,
          undefined,
          undefined,
          undefined,
          backendAtt,
          this.platformId || undefined,
          permissionModeOverride,
        );
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
  async sendMessage(text: string, attachments: Attachment[]): Promise<void> {
    if (!this.run) return;
    this.error = "";
    // Invalidate idle snapshot — user is sending a new message
    snapshotCache.deleteSnapshot(this.run.id).catch((e) => dbgWarn("snapshot", "delete failed", e));

    try {
      if (this.useStreamSession && this.sessionAlive) {
        // Optimistic user message — matches the pattern in startSession().
        // Content-based dedup in _reduce(user_message) prevents double display
        // when the backend's UserMessage bus event arrives.
        this._pushOptimisticUser(text, attachments);
        await api.sendSessionMessage(this.run.id, text, mapAttachments(attachments) ?? undefined);
        if (this.isKnownSlashCommand(text)) {
          dbg("store", "skip response timeout for slash command", { cmd: text.split(" ")[0] });
        } else {
          this._startResponseTimeout(this.run.id);
        }
      } else {
        this._setPhase("running");
        await api.sendChatMessage(
          this.run.id,
          text,
          attachments.length > 0 ? attachments : undefined,
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

  private _resumeGuard = new OpGuard();

  /** Whether a resume/continue/fork operation is currently in progress. */
  get resumeInFlight(): boolean {
    return this._resumeGuard.busy;
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
    if (!this._resumeGuard.acquire()) return null;

    try {
      let run = await api.getRun(runId);
      if (!this._resumeGuard.isMounted) return runId;

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

      // Invalidate any concurrent loadRun, then snapshot the gen for our own
      // stale-check (a later loadRun would bump _loadGen and we'd see the change).
      const loadGen = ++this._loadGen;
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
        if (!this._resumeGuard.isMounted) return runId;
        if (!snapshotBody) {
          busEvents = await api.getBusEvents(runId);
          if (!this._resumeGuard.isMounted) return runId;
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
            if (!this._resumeGuard.isMounted) return runId;
          }
          if (busEvents.length > 0) {
            const ms = await this.applyEventBatchAsync(busEvents, {
              replayOnly: true,
              isStale: () => !this._resumeGuard.isMounted || loadGen !== this._loadGen,
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
      if (!this._resumeGuard.isMounted) return null;
      this.error = String(e);
      this._setPhase("failed");
      dbgWarn("store", "resumeSession failed:", e);
      return null;
    } finally {
      this._resumeGuard.release();
    }
  }

  /** Step 1 of two-step fork: create forked run, replay parent events.
   *  Returns the new run ID. Called from resumeSession when mode === "fork".
   *  Step 2 (connectSession) is called by the frontend after dismissing the fork overlay. */
  private async _handleFork(runId: string): Promise<string> {
    dbg("store", "resumeSession: two-step fork", { runId });
    const loadGen = this._loadGen;

    // Clear both routing and this store's physical owner to prevent source
    // RunState(stopped) events from interfering with the fork replay.
    getEventMiddleware().subscribeCurrent("", this);
    this._connection.release();

    // Step 1: One-shot fork (backend does fork_oneshot, returns new run_id with new session_id)
    const newRunId = await api.forkSession(runId);
    if (!this._resumeGuard.isMounted) throw new Error("Unmounted during fork");

    const newRun = await api.getRun(newRunId);
    if (!this._resumeGuard.isMounted) throw new Error("Unmounted during fork");

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
    if (!this._resumeGuard.isMounted) throw new Error("Unmounted during fork");
    const newEvents = allForkEvents.filter((ev) => ev.run_id === newRunId);
    if (newEvents.length > 0) {
      dbg("store", "fork: replaying", newEvents.length, "parent events");
      const ms = await this.applyEventBatchAsync(newEvents, {
        replayOnly: true,
        isStale: () => !this._resumeGuard.isMounted || loadGen !== this._loadGen,
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
    this._resumeGuard.unmount();
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
    const tl = ctx ? ctx.tl : this.timeline;
    let cloned = !!ctx; // ctx.tl is already a mutable reference

    for (let i = 0; i < tl.length; i++) {
      const e = tl[i];
      if (e.kind !== "tool") continue;

      // Top-level tool
      let parentUpdated = e;
      if (predicate(e.tool)) {
        if (!cloned) {
          this.timeline = [...this.timeline];
          cloned = true;
        }
        parentUpdated = { ...e, tool: { ...e.tool, status: "error" as const } };
        const target = ctx ? ctx.tl : this.timeline;
        target[i] = parentUpdated;
        dbg("store", "resolved stale tool", { id: e.id, name: e.tool.tool_name });
        // Don't continue: even if top-level matched, still scan and converge subTimeline children
      }

      // subTimeline children
      const sub = parentUpdated.subTimeline;
      if (!sub) continue;
      let subChanged = false;
      let newSub = sub;
      for (let j = 0; j < newSub.length; j++) {
        const child = newSub[j];
        if (child.kind !== "tool" || !predicate(child.tool)) continue;
        if (!subChanged) {
          newSub = [...newSub];
          subChanged = true;
        }
        newSub[j] = { ...child, tool: { ...child.tool, status: "error" as const } };
        dbg("store", "resolved stale sub-tool", { id: child.id, name: child.tool.tool_name });
      }
      if (subChanged) {
        if (!cloned) {
          this.timeline = [...this.timeline];
          cloned = true;
        }
        const target = ctx ? ctx.tl : this.timeline;
        target[i] = { ...parentUpdated, subTimeline: newSub };
      }
    }
  }

  // ── Reducer helpers (extracted from _reduce for readability) ──

  /** Handle message/streaming events: message_delta, thinking_delta, tool_input_delta,
   *  message_complete, user_message. Returns true if the event was handled. */
  private _reduceMessage(
    ev: BusEvent,
    ctx: ReduceCtx | null,
    getTl: () => TimelineEntry[],
    getSeenMsg: () => Set<string>,
  ): boolean {
    switch (ev.type) {
      case "message_delta": {
        this._clearTimeoutError();
        if (ev.parent_tool_use_id) {
          this._appendSubTimelineStreamingDelta(ev.parent_tool_use_id, "content", ev.text, ctx);
          return true;
        }
        if (this.thinkingStartMs && !this.thinkingEndMs) {
          this.thinkingEndMs = eventTsMs(ev);
        }
        if (ctx) ctx.streamText += ev.text;
        else this.streamingText += ev.text;
        return true;
      }
      case "thinking_delta": {
        this._clearTimeoutError();
        if (ev.parent_tool_use_id) {
          this._appendSubTimelineStreamingDelta(
            ev.parent_tool_use_id,
            "thinkingText",
            ev.text,
            ctx,
          );
          return true;
        }
        if (!this.thinkingStartMs) this.thinkingStartMs = eventTsMs(ev);
        if (ctx) ctx.thinkingText += ev.text;
        else this.thinkingText += ev.text;
        return true;
      }
      case "tool_input_delta": {
        if (ev.parent_tool_use_id) {
          this._updateSubTimelineToolInput(
            ev.parent_tool_use_id,
            ev.tool_use_id,
            ev.partial_json,
            ctx,
          );
          return true;
        }
        const tl = getTl();
        const tIdx = this._findToolIdx(ctx, ev.tool_use_id);
        if (tIdx >= 0) {
          const old = tl[tIdx] as Extract<TimelineEntry, { kind: "tool" }>;
          const accum = SessionStore._accumulateJsonInput(
            old.tool as Record<string, unknown>,
            ev.partial_json,
          );
          const updated: TimelineEntry = {
            ...old,
            tool: { ...old.tool, ...accum } as typeof old.tool,
          };
          if (ctx) ctx.tl[tIdx] = updated;
          else {
            const u = [...this.timeline];
            u[tIdx] = updated;
            this.timeline = u;
          }
        }
        return true;
      }
      case "message_complete": {
        const savedStreaming = ctx ? ctx.streamText : this.streamingText;
        const finalText = ev.text && ev.text.length > 0 ? ev.text : savedStreaming;
        if (getSeenMsg().has(ev.message_id)) {
          this._patchAssistantContentIfEmpty(ctx, ev.message_id, finalText);
          if (ev.parent_tool_use_id)
            this._removeSubTimelineStreamingEntry(ev.parent_tool_use_id, ctx);
          return true;
        }
        const existingAssistant = getTl().find(
          (e) => e.kind === "assistant" && e.id === ev.message_id,
        );
        if (existingAssistant) {
          this._patchAssistantContentIfEmpty(ctx, ev.message_id, finalText);
          if (ev.parent_tool_use_id)
            this._removeSubTimelineStreamingEntry(ev.parent_tool_use_id, ctx);
          getSeenMsg().add(ev.message_id);
          return true;
        }
        getSeenMsg().add(ev.message_id);
        if (ev.parent_tool_use_id) {
          const subThinking = this._extractSubTimelineThinking(ev.parent_tool_use_id, ctx);
          const subStreaming = this._extractSubTimelineStreamingContent(ev.parent_tool_use_id, ctx);
          const subFinalText = finalText.trim() ? finalText : subStreaming;
          this._removeSubTimelineStreamingEntry(ev.parent_tool_use_id, ctx);
          const entry: TimelineEntry = {
            kind: "assistant",
            id: ev.message_id,
            anchorId: ev.message_id,
            content: subFinalText,
            ts: eventTs(ev),
            ...(ev.model ? { model: ev.model } : {}),
            ...(subThinking ? { thinkingText: subThinking } : {}),
          };
          const parentIdx = this._findParentToolIdx(ctx, ev.parent_tool_use_id);
          if (parentIdx >= 0) {
            this._appendToSubTimeline(getTl(), parentIdx, entry, ctx);
            return true;
          }
          this._pushTimeline(ctx, entry);
          return true;
        }
        const savedThinking = ctx ? ctx.thinkingText : this.thinkingText;
        if (ctx) {
          ctx.streamText = "";
          ctx.thinkingText = "";
        } else {
          this.streamingText = "";
          this.thinkingText = "";
        }
        this.thinkingStartMs = 0;
        this.thinkingEndMs = 0;
        const entry: TimelineEntry = {
          kind: "assistant",
          id: ev.message_id,
          anchorId: ev.message_id,
          content: finalText,
          ts: eventTs(ev),
          ...(ev.model ? { model: ev.model } : {}),
          ...(savedThinking ? { thinkingText: savedThinking } : {}),
        };
        this._pushTimeline(ctx, entry);
        return true;
      }
      default:
        return false;
    }
  }

  /** Handle tool lifecycle events: tool_start, tool_end. Returns true if handled. */
  private _reduceTool(
    ev: BusEvent,
    ctx: ReduceCtx | null,
    replayOnly: boolean,
    getTl: () => TimelineEntry[],
    getHe: () => HookEvent[],
    getSeenTool: () => Set<string>,
  ): boolean {
    switch (ev.type) {
      case "tool_start": {
        this._clearTimeoutError();
        if (getSeenTool().has(ev.tool_use_id)) return true;
        getSeenTool().add(ev.tool_use_id);
        if (ev.parent_tool_use_id) {
          const parentIdx = this._findParentToolIdx(ctx, ev.parent_tool_use_id);
          if (parentIdx >= 0) {
            const subEntry: TimelineEntry = {
              kind: "tool",
              id: ev.tool_use_id,
              anchorId: ev.tool_use_id,
              tool: {
                tool_use_id: ev.tool_use_id,
                tool_name: ev.tool_name,
                input: (ev.input as Record<string, unknown>) ?? {},
                status: "running",
              },
              ts: eventTs(ev),
            };
            this._appendToSubTimeline(getTl(), parentIdx, subEntry, ctx);
            return true;
          }
        }
        if (this._findToolIdx(ctx, ev.tool_use_id) >= 0) return true;
        const tlEntry: TimelineEntry = {
          kind: "tool",
          id: ev.tool_use_id,
          anchorId: ev.tool_use_id,
          tool: {
            tool_use_id: ev.tool_use_id,
            tool_name: ev.tool_name,
            input: (ev.input as Record<string, unknown>) ?? {},
            status: "running",
          },
          ts: eventTs(ev),
        };
        this._pushTimeline(ctx, tlEntry);
        if (!this._isStreamMode(ctx)) {
          const heEntry: HookEvent = {
            run_id: ev.run_id,
            hook_type: "PreToolUse",
            tool_name: ev.tool_name,
            tool_input: ev.input as Record<string, unknown>,
            status: "running",
            timestamp: new Date().toISOString(),
          };
          (heEntry as Record<string, unknown>).tool_use_id = ev.tool_use_id;
          this._pushHookEntry(ctx, heEntry);
        }
        return true;
      }
      case "tool_end": {
        if (!replayOnly) dispatchLiveBusSound(ev);
        const isAskUser = ev.tool_name === "AskUserQuestion";
        const resolvedStatus =
          isAskUser && ev.status === "error"
            ? ("ask_pending" as const)
            : ev.status === "error"
              ? ("error" as const)
              : ("success" as const);
        if (ev.parent_tool_use_id) {
          if (
            this._updateSubTimelineTool(
              ev.parent_tool_use_id,
              ev.tool_use_id,
              (t) => ({
                ...t,
                status: resolvedStatus,
                output: ev.output as Record<string, unknown>,
                duration_ms: ev.duration_ms,
                tool_name: ev.tool_name || t.tool_name,
                tool_use_result: ev.tool_use_result as Record<string, unknown> | undefined,
              }),
              ctx,
            )
          )
            return true;
        }
        const tl = getTl();
        const tIdx = this._findToolIdx(ctx, ev.tool_use_id);
        if (tIdx >= 0) {
          const old = tl[tIdx] as Extract<TimelineEntry, { kind: "tool" }>;
          const updated: TimelineEntry = {
            ...old,
            tool: {
              ...old.tool,
              status: resolvedStatus,
              output: ev.output as Record<string, unknown>,
              duration_ms: ev.duration_ms,
              tool_name: ev.tool_name || old.tool.tool_name,
              tool_use_result: ev.tool_use_result as Record<string, unknown> | undefined,
            },
          };
          if (ctx) ctx.tl[tIdx] = updated;
          else {
            const u = [...this.timeline];
            u[tIdx] = updated;
            this.timeline = u;
          }
        }
        if (!replayOnly && ev.status !== "error" && !ev.parent_tool_use_id) {
          if (ev.tool_name === "EnterPlanMode") {
            this.previousPermissionMode = this.permissionMode || "default";
            this.permissionMode = "plan";
          } else if (ev.tool_name === "ExitPlanMode" && this.previousPermissionMode) {
            if (this.pendingPermissionModeOverride) {
              this.permissionMode = this.pendingPermissionModeOverride;
              this.pendingPermissionModeOverride = null;
            } else {
              this.permissionMode = this.previousPermissionMode;
            }
            this.previousPermissionMode = "";
            if (this.pendingClearContextPlan === "__pending__") {
              const toolResult = ev.tool_use_result as Record<string, unknown> | undefined;
              const plan =
                (ev.output as Record<string, unknown> | undefined)?.plan || toolResult?.plan;
              if (plan && typeof plan === "string") this.pendingClearContextPlan = plan;
              else this.pendingClearContextPlan = null;
            }
          }
        }
        if (!isAskUser && !this._isStreamMode(ctx)) {
          const he = getHe();
          const hIdx = this._findHeIdxByStatus(ctx, ev.tool_use_id, "running");
          if (hIdx >= 0) {
            const updatedHe: HookEvent = {
              ...he[hIdx],
              status: "done",
              hook_type: "PostToolUse",
              tool_name: ev.tool_name || he[hIdx].tool_name,
              tool_output: ev.output as Record<string, unknown>,
            };
            if (ctx) ctx.he[hIdx] = updatedHe;
            else {
              const u = [...this.tools];
              u[hIdx] = updatedHe;
              this.tools = u;
            }
          }
        }
        return true;
      }
      default:
        return false;
    }
  }

  /** Dispatch to domain-specific reducers registered in REDUCERS table.
   *  Returns true if the event was handled by a registered reducer. */
  private _reduceFromRegistry(ev: BusEvent, ctx: ReduceCtx | null, replayOnly: boolean): boolean {
    const fn = REDUCERS[ev.type as keyof typeof REDUCERS];
    if (!fn) return false;
    // SessionStore is a structural superset of SessionStoreReducers (it owns
    // additional private fields and methods). The cast documents the
    // reducer contract: reducers see only the "reducer surface" of the store.
    fn(ev, ctx, this as unknown as Parameters<typeof fn>[2], replayOnly);
    return true;
  }

  /** Core reducer: apply a single bus event. When ctx is null, mutates $state directly.
   *  replayOnly=true skips phase and error assignments (used during resume replay). */
  private _reduce(ev: BusEvent, ctx: ReduceCtx | null, replayOnly = false): void {
    // Shorthand accessors — either batch ctx or this (reactive)
    const getTl = () => (ctx ? ctx.tl : this.timeline);
    const getHe = () => (ctx ? ctx.he : this.tools);
    const getSeenMsg = () => (ctx ? ctx.seenMessageIds : this._seenMessageIds);
    const getSeenTool = () => (ctx ? ctx.seenToolIds : this._seenToolIds);
    this._lastReduceEventType = ev.type;

    // Delegate to domain-specific reducers
    if (this._reduceMessage(ev, ctx, getTl, getSeenMsg)) return;
    if (this._reduceTool(ev, ctx, replayOnly, getTl, getHe, getSeenTool)) return;
    if (this._reduceFromRegistry(ev, ctx, replayOnly)) return;
    switch (ev.type) {
      case "session_init":
        if (ev.model) {
          if (ctx) {
            ctx.model = ev.model;
          } else if (!this.run?.model) {
            this.model = ev.model;
          }
        }
        // Persist the CLI's new session_id (important for fork — CLI generates a new ID)
        if (ev.session_id) {
          if (ctx) ctx.sessionId = ev.session_id;
          else if (this.run) {
            dbg("store", "session_init: updating session_id", {
              old: this.run.session_id,
              new: ev.session_id,
            });
            this.run = { ...this.run, session_id: ev.session_id };
          }
        }
        // Store CLI slash commands (session-specific, includes custom .claude/commands/)
        // CLI system/init returns slash_commands as string[] (just names) or CliCommand[]
        if (ev.slash_commands && ev.slash_commands.length > 0) {
          this.sessionCommands = ev.slash_commands.map((c: unknown) =>
            typeof c === "string" ? { name: c, description: "", aliases: [] } : (c as CliCommand),
          );
        }
        // Store MCP servers (per-session state, deduplicate by name)
        if (ev.mcp_servers && ev.mcp_servers.length > 0) {
          this.mcpServers = dedupeMcpServersByName(ev.mcp_servers);
        }
        // Store CLI verbose fields
        if (ev.claude_code_version) {
          this.cliVersion = ev.claude_code_version;
          // Only update global installed version from live sessions,
          // not from historical replay (which carries the old version).
          if (!replayOnly) {
            updateInstalledVersion(ev.claude_code_version);
            try {
              localStorage.setItem(LS_CLI_VERSION, ev.claude_code_version);
            } catch {
              /* ignore */
            }
          }
        }
        // eslint-disable-next-line no-case-declarations -- scoped to session_init block
        const normalizedPermMode = ev.permissionMode
          ? normalizePermissionMode(ev.permissionMode)
          : undefined;
        if (normalizedPermMode && !this.permissionModeSetByUser) {
          this.permissionMode = normalizedPermMode;
        } else if (normalizedPermMode && this.permissionModeSetByUser) {
          dbg("store", "session_init permissionMode skipped — user already set", {
            cliValue: normalizedPermMode,
            userValue: this.permissionMode,
          });
          // CLI may have reset permission mode after compaction — re-send to resync.
          // Only in live mode (not batch replay) and when the run has a valid id.
          if (!ctx && this.run?.id && normalizedPermMode !== this.permissionMode) {
            dbg("store", "resync permissionMode to CLI after compaction", {
              mode: this.permissionMode,
            });
            api.setPermissionMode(this.run.id, this.permissionMode).catch((e) => {
              dbgWarn("store", "permissionMode resync failed", e);
            });
          }
        }
        if (ev.fast_mode_state) this.fastModeState = ev.fast_mode_state;
        if (ev.apiKeySource) this.apiKeySource = ev.apiKeySource;
        if (ev.agents && ev.agents.length > 0) this.availableAgents = ev.agents;
        if (ev.skills && ev.skills.length > 0) this.availableSkills = ev.skills;
        if (ev.plugins) this.availablePlugins = ev.plugins;
        // Always assign (not truthy-guarded) so CLI returning empty values clears stale state
        this.sessionCwd = ev.cwd ?? "";
        this.sessionTools = ev.tools ?? [];
        this.outputStyle = ev.output_style ?? "";
        this.sessionInitReceived = true;
        dbg("store", "session_init: cli verbose fields", {
          cliVersion: this.cliVersion,
          permissionMode: this.permissionMode,
          fastModeState: this.fastModeState,
          apiKeySource: this.apiKeySource,
          agents: this.availableAgents.length,
          skills: this.availableSkills.length,
          plugins: this.availablePlugins.length,
          sessionCwd: this.sessionCwd,
          sessionTools: this.sessionTools.length,
          outputStyle: this.outputStyle,
        });
        break;

      case "run_state":
        if (!replayOnly) dispatchLiveBusSound(ev);
        if (!replayOnly) {
          if (ev.state === "running" || ev.state === "spawning") {
            const newPhase: SessionPhase = ev.state === "spawning" ? "spawning" : "running";
            if (ctx) ctx.phase = newPhase;
            else this._setPhase(newPhase);
            // Invalidate idle snapshot — session is now active
            if (!ctx && this.run) {
              snapshotCache
                .deleteSnapshot(this.run.id)
                .catch((e) => dbgWarn("snapshot", "delete failed", e));
            }
          } else if (ev.state === "idle") {
            if (ctx) ctx.phase = "idle";
            else this._setPhase("idle");
          } else {
            // completed / failed / stopped
            const termPhase = ev.state as SessionPhase;
            if (ctx) ctx.phase = termPhase;
            else {
              this._setPhase(termPhase);
              if (this.run) {
                const snapId = this.run.id;
                api
                  .getRun(snapId)
                  .then((r) => {
                    // Guard: only update if we're still viewing the same run
                    if (this.run?.id === snapId) this.run = r;
                    // Cache for notification title lookup
                    import("$lib/services/notification-listener")
                      .then((m) => m.cacheRun(r))
                      .catch((e) => dbgWarn("store", "cacheRun after terminal failed:", e));
                  })
                  .catch((e) => dbgWarn("store", "getRun after terminal state failed:", e));
              }
            }
          }
          // Sync run.status for non-terminal states so status bar reflects reality
          // (terminal states update run via api.getRun above)
          if (ev.state === "running" || ev.state === "idle") {
            if (ctx) ctx.runStatus = ev.state;
            else if (this.run) this.run = { ...this.run, status: ev.state };
          }
        }
        // Show error to user only for genuine failures, not user-initiated stops.
        // "stopped" = user clicked stop; "failed" after stop = CLI dying mid-request (expected).
        // _stopping flag: set by stop() before IPC call, covers the interrupt+kill window.
        if (!replayOnly && ev.error && ev.state !== "stopped" && !this._stopping) {
          if (ctx) ctx.error = ev.error;
          else this.error = ev.error;
        }
        // Resolve stale permission_prompt / optimistic-running tools on idle transition.
        // When CLI goes idle (turn complete), any remaining permission_prompt cards are stale
        // (e.g. user interrupted during a pending can_use_tool request).
        // Also resolve "optimistic running" tools (have permission_request_id) that never got a tool_end.
        // Covers both main timeline and subTimelines.
        if (ev.state === "idle") {
          this._resolveStaleTools(
            (t) =>
              t.status === "permission_prompt" ||
              (t.status === "running" && !!t.permission_request_id),
            ctx,
          );
          this._materializeOrphanStreamingOnIdle(ctx, ev, replayOnly, getTl);
          if (!replayOnly) this._needsIdleHealthCheck = true;
          dbg("store", "run_state idle", {
            runId: ev.run_id,
            streamingTextLen: ctx ? ctx.streamText.length : this.streamingText.length,
            timelineLen: getTl().length,
          });
          // Write idle snapshot (live mode only, throttled by _lastSnapshotSeq)
          if (!ctx && !replayOnly && this.run) {
            if (this._lastProcessedSeq > this._lastSnapshotSeq) {
              this._saveSnapshotToIdb(this.run.id);
              this._lastSnapshotSeq = this._lastProcessedSeq;
            }
          }
        }
        // Resolve permission_denied / permission_prompt tools on session restart (spawning).
        // After approval, the session restarts — those cards are no longer actionable.
        // Runs in both live and replay mode so replayed sessions show resolved state.
        // Covers both main timeline and subTimelines.
        if (ev.state === "spawning") {
          this._resolveStaleTools(
            (t) =>
              t.status === "permission_denied" ||
              t.status === "permission_prompt" ||
              (t.status === "running" && !!t.permission_request_id),
            ctx,
          );
        }
        // Clear stale elicitations on state transitions — CLI won't send control_cancelled
        // for these if the session ends abnormally or restarts.
        if (
          ev.state === "idle" ||
          ev.state === "spawning" ||
          ev.state === "completed" ||
          ev.state === "failed" ||
          ev.state === "stopped"
        ) {
          if (this.pendingElicitations.size > 0) {
            dbg("store", "run_state clearing stale elicitations", {
              state: ev.state,
              count: this.pendingElicitations.size,
            });
            this.pendingElicitations = new Map();
          }
        }
        break;

      case "permission_prompt": {
        if (!replayOnly) dispatchLiveBusSound(ev);
        dbg("store", "permission_prompt received", {
          tool_use_id: ev.tool_use_id,
          request_id: ev.request_id,
          tool_name: ev.tool_name,
          parent: ev.parent_tool_use_id,
          batch: !!ctx,
        });
        // Subagent routing: update child tool inside parent's subTimeline
        if (ev.parent_tool_use_id) {
          if (
            this._updateSubTimelineTool(
              ev.parent_tool_use_id,
              ev.tool_use_id,
              (t) => ({
                ...t,
                status: "permission_prompt" as const,
                permission_request_id: ev.request_id,
                ...(ev.suggestions && ev.suggestions.length > 0
                  ? { suggestions: ev.suggestions }
                  : {}),
              }),
              ctx,
            )
          ) {
            break;
          }
          dbgWarn(
            "store",
            "subagent permission_prompt: not found in subTimeline, fallback to main timeline",
            { parent: ev.parent_tool_use_id, tool: ev.tool_use_id },
          );
          // fall through to main timeline logic
        }
        // Inline permission prompt from --permission-prompt-tool stdio.
        // Find matching tool (should be "running") and update to "permission_prompt" with request_id.
        const tl = getTl();
        const tIdx = this._findToolIdx(ctx, ev.tool_use_id);
        if (tIdx >= 0) {
          const old = tl[tIdx] as Extract<TimelineEntry, { kind: "tool" }>;
          const updated: TimelineEntry = {
            ...old,
            tool: {
              ...old.tool,
              status: "permission_prompt",
              permission_request_id: ev.request_id,
              // Merge suggestions from permission_prompt event (CLI provides these)
              ...(ev.suggestions && ev.suggestions.length > 0
                ? { suggestions: ev.suggestions }
                : {}),
            },
          };
          if (ctx) {
            ctx.tl[tIdx] = updated;
          } else {
            const u = [...this.timeline];
            u[tIdx] = updated;
            this.timeline = u;
          }
          dbg("store", "permission_prompt: updated existing entry", {
            tIdx,
            tool_use_id: ev.tool_use_id,
            request_id: ev.request_id,
          });
        } else {
          // Tool not in main timeline — check ALL subTimelines (CLI sometimes omits parent_tool_use_id)
          const foundInSub = this._updateToolInAnySubTimeline(
            ev.tool_use_id,
            (t) => ({
              ...t,
              status: "permission_prompt" as const,
              permission_request_id: ev.request_id,
              ...(ev.suggestions && ev.suggestions.length > 0
                ? { suggestions: ev.suggestions }
                : {}),
            }),
            ctx,
          );
          if (!foundInSub) {
            // Truly new — create a synthetic tool entry in main timeline
            dbg("store", "permission_prompt: creating synthetic entry", {
              tool_use_id: ev.tool_use_id,
              request_id: ev.request_id,
              tool_name: ev.tool_name,
            });
            const tlEntry: TimelineEntry = {
              kind: "tool",
              id: ev.tool_use_id,
              anchorId: ev.tool_use_id,
              tool: {
                tool_use_id: ev.tool_use_id,
                tool_name: ev.tool_name,
                input: ev.tool_input as Record<string, unknown>,
                status: "permission_prompt",
                permission_request_id: ev.request_id,
                ...(ev.suggestions && ev.suggestions.length > 0
                  ? { suggestions: ev.suggestions }
                  : {}),
              },
              ts: eventTs(ev),
            };
            this._pushTimeline(ctx, tlEntry);
          } else {
            dbg("store", "permission_prompt: updated in subTimeline", {
              tool_use_id: ev.tool_use_id,
              request_id: ev.request_id,
            });
          }
        }
        break;
      }

      case "raw": {
        const rawText = typeof ev.data === "string" ? ev.data : JSON.stringify(ev.data);
        if (rawText && (ev.source === "claude_stdout_text" || ev.source === "claude_stderr")) {
          const rawId = uuid();
          const entry: TimelineEntry = {
            kind: "assistant",
            id: rawId,
            anchorId: rawId,
            content: `\`[${ev.source}]\` ${rawText}`,
            ts: new Date().toISOString(),
          };
          this._pushTimeline(ctx, entry);
        } else {
          this.rawFallbackCount++;
          dbgWarn("store", "raw fallback event:", ev.source, rawText?.slice(0, 100));
          if (this.strictMode) {
            throw new Error(`[STRICT] raw fallback event: source=${ev.source}`);
          }
        }
        break;
      }

      default:
        this.unknownEventCount++;
        dbgWarn("store", "unknown bus event type:", (ev as Record<string, unknown>).type);
        if (this.strictMode) {
          throw new Error(`[STRICT] unknown event type: ${(ev as Record<string, unknown>).type}`);
        }
    }
  }
}

// ── Singleton instance ──
// Module-level singleton so the store survives across SvelteKit page navigations.
// The store is a leaf in the component tree — no other stores reference it, so
// there is no risk of stale cross-session state leakage.
export const sessionStore = new SessionStore();
