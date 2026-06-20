/**
 * Shared types for session-store reducers.
 *
 * ReduceCtx is the batch context — fields are written in-place by reducers
 * and then committed to live store state by `_commitReduceCtx`.
 */
import type { TimelineEntry, HookEvent, BusEvent } from "$lib/types";
import type { SessionPhase, UsageState, TurnUsage } from "$lib/stores/types";

export interface ReduceCtx {
  tl: TimelineEntry[];
  he: HookEvent[];
  streamText: string;
  thinkingText: string;
  model: string;
  phase: SessionPhase;
  usage: UsageState;
  error: string;
  seenMessageIds: Set<string>;
  seenToolIds: Set<string>;
  /** Track run.status changes from non-terminal run_state events (running/idle). */
  runStatus: string | null;
  /** New session_id from session_init (e.g. fork generates a new CLI session). */
  sessionId: string | null;
  /** Whether this run uses stream-json mode (skip tools mirror writes). */
  isStream: boolean;
  /** Per-turn usage snapshots. */
  turnUsages: TurnUsage[];
  /** tool_use_id → tl[] index (only tool entries, first-match semantics). */
  toolTlIndex: Map<string, number>;
  /** tool_use_id → he[] index (only HookEvent entries with tool_use_id). */
  toolHeIndex: Map<string, number>;
}

/**
 * Reducer signature. Each event family exposes one or more functions of this shape.
 *
 * - `ev`: the bus event to apply (narrowed to the family's event type)
 * - `ctx`: when non-null, reducers write to ctx (batch replay mode). When null,
 *   reducers must mutate the store directly (live event mode).
 * - `store`: the SessionStore instance — exposes both store-only fields and
 *   helper methods (e.g. `_pushTimeline`) that the reducers need to call.
 * - `replayOnly`: true during batch replay (`loadRun` / resume / fork).
 *   Reducers use this to skip live-only side effects (sounds, snapshots,
 *   permission resync, localStorage writes).
 */
export type Reducer = (
  ev: BusEvent,
  ctx: ReduceCtx | null,
  store: SessionStoreReducers,
  replayOnly: boolean,
) => void;

/**
 * Minimal structural type for the store surface that reducers touch.
 * Defined here (not imported from session-store) to keep this file free of
 * any runtime circular imports — the SessionStore class satisfies this
 * structurally as long as the method signatures match.
 */
export interface SessionStoreReducers {
  // ── ctx-managed fields (write to ctx, never directly to store) ──
  // Marked readonly on the surface because, from a reducer's point of view,
  // these represent the "current snapshot" — reducers write to ctx (which is
  // then committed back via _commitReduceCtx), not to the live store. The
  // store itself owns mutable versions of the same names.
  // Writable: when ctx is null, reducers patch store.timeline / store.tools
  // directly via `[...arr, entry]` patterns. When ctx is non-null, reducers
  // write to ctx.tl / ctx.he and _commitReduceCtx publishes to store.
  timeline: TimelineEntry[];
  tools: HookEvent[];
  readonly streamingText: string;
  readonly thinkingText: string;
  readonly model: string;
  readonly phase: SessionPhase;
  usage: UsageState; // writable in store-direct mode (else write to ctx)
  turnUsages: TurnUsage[];
  readonly error: string;
  readonly _seenMessageIds: Set<string>;
  readonly _seenToolIds: Set<string>;
  readonly _toolTlIndex: Map<string, number>;
  readonly _toolHeIndex: Map<string, number>;

  // When ctx is null, reducers write directly to the store. These overrides
  // declare the writable versions for the "store-direct" code path.
  _setModel(v: string): void;

  // ── store-only fields (always write directly) ──
  rateLimitStatus: string;
  rateLimitType: string;
  rateLimitUtilization: number | null;
  rateLimitResetsAt: number | null;
  sessionCommands: Array<{ name: string; description: string; aliases: string[] }>;
  mcpServers: unknown[];
  cliVersion: string;
  fastModeState: unknown;
  apiKeySource: string;
  availableAgents: unknown[];
  availableSkills: unknown[];
  availablePlugins: unknown[];
  sessionCwd: string;
  sessionTools: unknown[];
  outputStyle: string;
  sessionInitReceived: boolean;
  permissionMode: string;
  permissionModeSetByUser: boolean;
  durationMs: number;
  numTurns: number;
  microcompactCount: number;
  compactCount: number;
  lastCompactedAt: number;
  run: { id: string; model?: string; session_id?: string; status?: string } | null;
  ralphLoop: {
    active: boolean;
    prompt?: string;
    iteration: number;
    maxIterations?: number;
    completionPromise?: string | null;
    startedAt?: string;
    reason: string | null;
  } | null;
  taskNotifications: Map<
    string,
    {
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
  >;
  pendingElicitations: Map<
    string,
    {
      requestId: string;
      mcpServerName: string;
      message: string;
      elicitationId: string;
      mode?: string;
      url?: string;
      requestedSchema: unknown;
    }
  >;
  persistedFiles: string[];
  systemStatus: { status: string } | null;
  authStatus: { is_authenticating: boolean; output: string[] } | null;
  // …extended as reducers are extracted; we keep the list focused on what
  // extracted reducers actually need so the contract grows incrementally.

  // ── helper methods (write to ctx if non-null, else to store) ──
  _pushTimeline(ctx: ReduceCtx | null, entry: TimelineEntry): void;
  _pushHookEntry(ctx: ReduceCtx | null, entry: HookEvent): void;
  _pushOptimisticUser(content: string, attachments?: unknown[]): void;
  _findToolIdx(ctx: ReduceCtx | null, toolUseId: string): number;
  _findHeIdx(ctx: ReduceCtx | null, toolUseId: string): number;
  _findHeIdxByStatus(ctx: ReduceCtx | null, toolUseId: string, status: string): number;
  _isStreamMode(ctx: ReduceCtx | null): boolean;
  _findParentToolIdx(ctx: ReduceCtx | null, parentToolUseId: string): number;
  _updateSubTimelineTool(
    parentToolUseId: string,
    childToolUseId: string,
    updater: (t: Record<string, unknown>) => Record<string, unknown>,
    ctx: ReduceCtx | null,
  ): void;
  _updateToolInAnySubTimeline(
    toolUseId: string,
    updater: (old: Record<string, unknown>) => Record<string, unknown>,
    ctx: ReduceCtx | null,
  ): boolean;
  _resolveStaleTools(
    predicate: (t: { status: string; permission_request_id?: string }) => boolean,
    ctx: ReduceCtx | null,
  ): void;
  _materializeOrphanStreamingOnIdle(
    ctx: ReduceCtx | null,
    ev: BusEvent,
    replayOnly: boolean,
    getTl: () => TimelineEntry[],
  ): void;
  _setPhase(to: SessionPhase): void;
  _saveSnapshotToIdb(runId: string): void;
  _needsIdleHealthCheck: boolean;
  _stopping: boolean;
  _lastProcessedSeq: number;
  _lastSnapshotSeq: number;
  _recoveryTimer: ReturnType<typeof setTimeout> | null;
  rawFallbackCount: number;
  unknownEventCount: number;
  strictMode: boolean;
  hookEvents: HookEvent[];
}
