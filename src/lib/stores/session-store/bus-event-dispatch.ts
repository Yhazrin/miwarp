/**
 * Bus event dispatch functions extracted from SessionStore.
 *
 * Contains applyEvent, _createReduceCtx, _commitReduceCtx,
 * applyEventBatch, applyEventBatchAsync, buildSnapshotFromEvents.
 *
 * @module bus-event-dispatch
 */
import type {
  BusEvent,
  HookEvent,
  TimelineEntry,
  RunStatus,
  TaskRun,
} from "$lib/types";
import { dbg } from "$lib/utils/debug";
import { yieldToMain } from "$lib/utils/yield";
import {
  type SessionPhase,
  type UsageState,
  type TurnUsage,
} from "../types";
import type { ReduceCtx } from "../reducers/types";
import { beginHistorySoundMute, endHistorySoundMute } from "$lib/services/sound-feedback-service";
import { finalizeSnapshotCtxTools, finalizeTimelineForDeadSession } from "./snapshot-manager";
import { runReduce, type ReduceStore } from "./event-handlers";

// ── Store interface ──

export interface BusEventDispatchAPI {
  // Fields
  run: TaskRun | null;
  timeline: TimelineEntry[];
  tools: HookEvent[];
  streamingText: string;
  thinkingText: string;
  model: string;
  usage: UsageState;
  turnUsages: TurnUsage[];
  phase: SessionPhase;
  error: string;
  ralphLoop: {
    active: boolean;
    prompt?: string;
    iteration: number;
    maxIterations?: number;
    completionPromise?: string | null;
    startedAt?: string;
    reason: string | null;
  } | null;
  _seenMessageIds: Set<string>;
  _seenToolIds: Set<string>;
  _lastProcessedSeq: number;
  _lastReduceEventType: string;
  _toolTlIndex: Map<string, number>;
  _toolHeIndex: Map<string, number>;
  _needsIdleHealthCheck: boolean;

  // Getters
  readonly useStreamSession: boolean;

  // Methods
  _setPhase(to: SessionPhase): void;
  _clearSpawnTimeout(): void;
  _clearResponseTimeout(): void;
  _runIdleHealthCheckIfNeeded(): void;
}

// ── applyEvent ──

export function applyEventImpl(
  store: BusEventDispatchAPI,
  ev: BusEvent,
): void {
  // `attention_changed` and `runtime_health_changed` are global snapshot signals
  if (ev.type === "attention_changed" || ev.type === "runtime_health_changed") {
    return;
  }
  // Guard: drop events for a run we're no longer viewing
  if (!store.run || ev.run_id !== store.run.id) {
    dbg("store", "drop stale event", ev.type, "run_id=", ev.run_id, "current=", store.run?.id);
    return;
  }
  // Track WS sequence checkpoint — skip already-processed events (dedup)
  const evSeq = ((ev as Record<string, unknown>)._seq as number) ?? 0;
  if (evSeq > 0) {
    if (evSeq <= store._lastProcessedSeq) {
      dbg(
        "store",
        "drop duplicate event",
        ev.type,
        "seq=",
        evSeq,
        "last=",
        store._lastProcessedSeq,
      );
      return;
    }
    store._lastProcessedSeq = evSeq;
  }
  store._lastReduceEventType = ev.type;
  runReduce(ev, null, store as unknown as ReduceStore, false);
  store._runIdleHealthCheckIfNeeded();
}

// ── _createReduceCtx ──

export function createReduceCtxImpl(
  store: BusEventDispatchAPI,
): ReduceCtx {
  const batchTlIndex = new Map<string, number>();
  for (let i = 0; i < store.timeline.length; i++) {
    const e = store.timeline[i];
    if (e.kind === "tool" && !batchTlIndex.has(e.id)) batchTlIndex.set(e.id, i);
  }
  const batchHeIndex = new Map<string, number>();
  for (let i = 0; i < store.tools.length; i++) {
    const tid = (store.tools[i] as Record<string, unknown>).tool_use_id as string | undefined;
    if (tid && !batchHeIndex.has(tid)) batchHeIndex.set(tid, i);
  }
  return {
    tl: [...store.timeline],
    he: [...store.tools],
    streamText: store.streamingText,
    thinkingText: store.thinkingText,
    model: store.model,
    phase: store.phase,
    usage: { ...store.usage },
    error: store.error,
    seenMessageIds: new Set(store._seenMessageIds),
    seenToolIds: new Set(store._seenToolIds),
    runStatus: null,
    sessionId: null,
    isStream: store.useStreamSession,
    turnUsages: [...store.turnUsages],
    toolTlIndex: batchTlIndex,
    toolHeIndex: batchHeIndex,
  };
}

// ── _commitReduceCtx ──

export function commitReduceCtxImpl(
  store: BusEventDispatchAPI,
  ctx: ReduceCtx,
  replayOnly: boolean,
): void {
  // If the session ended, resolve any leftover incomplete tools
  const runStatus = store.run?.status;
  const sessionDead =
    runStatus === "stopped" || runStatus === "completed" || runStatus === "failed";
  if (sessionDead) {
    const finalized = finalizeTimelineForDeadSession(ctx.tl);
    if (finalized) ctx.tl = finalized;
  }

  store.timeline = ctx.tl;
  store.tools = ctx.he;
  store.streamingText = ctx.streamText;
  store.thinkingText = ctx.thinkingText;
  store.model = ctx.model;
  store.usage = ctx.usage;
  store.turnUsages = ctx.turnUsages;
  store._seenMessageIds = ctx.seenMessageIds;
  store._seenToolIds = ctx.seenToolIds;
  store._toolTlIndex = ctx.toolTlIndex;
  store._toolHeIndex = ctx.toolHeIndex;
  // Always clear timeouts on batch commit — even replayOnly batches can carry
  // terminal run_state events that should cancel pending spawn/response timers.
  store._clearSpawnTimeout();
  store._clearResponseTimeout();
  if (!replayOnly) {
    store._setPhase(ctx.phase);
    store.error = ctx.error;
    if ((ctx.runStatus || ctx.sessionId) && store.run) {
      const updates: Partial<TaskRun> = {};
      if (ctx.runStatus) updates.status = ctx.runStatus as RunStatus;
      if (ctx.sessionId) {
        dbg("store", "batch: updating session_id", {
          old: store.run.session_id,
          new: ctx.sessionId,
        });
        updates.session_id = ctx.sessionId;
      }
      store.run = { ...store.run, ...updates };
    }
  }

  if (store.ralphLoop?.active && replayOnly) {
    store.ralphLoop = { ...store.ralphLoop, active: false, reason: "interrupted" };
    dbg("store", "ralph loop marked interrupted after replay");
  }
}

// ── applyEventBatch ──

export function applyEventBatchImpl(
  store: BusEventDispatchAPI,
  events: BusEvent[],
  opts?: { replayOnly?: boolean },
): number {
  const t0 = performance.now();
  const replayOnly = opts?.replayOnly ?? false;
  const ctx = createReduceCtxImpl(store);
  let localSeq = store._lastProcessedSeq;
  for (const ev of events) {
    const evSeq = ((ev as Record<string, unknown>)._seq as number) ?? 0;
    if (evSeq > 0) localSeq = Math.max(localSeq, evSeq);
    store._lastReduceEventType = ev.type;
    runReduce(ev, ctx, store as unknown as ReduceStore, replayOnly);
  }
  commitReduceCtxImpl(store, ctx, replayOnly);
  store._lastProcessedSeq = localSeq;
  const cpuMs = performance.now() - t0;
  dbg(
    "store",
    `applyEventBatch:sync: ${events.length} events in ${cpuMs.toFixed(1)}ms cpu, timeline=${ctx.tl.length}`,
  );
  store._runIdleHealthCheckIfNeeded();
  return cpuMs;
}

// ── applyEventBatchAsync ──

export async function applyEventBatchAsyncImpl(
  store: BusEventDispatchAPI,
  events: BusEvent[],
  opts: { replayOnly?: boolean; isStale?: () => boolean } = {},
): Promise<number | null> {
  if (opts.isStale?.()) return null;
  beginHistorySoundMute();
  try {
    const t0 = performance.now();
    const isStale = opts.isStale ?? (() => false);
    const replayOnly = opts.replayOnly ?? false;
    const ctx = createReduceCtxImpl(store);
    let localSeq = store._lastProcessedSeq;
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
        store._lastReduceEventType = ev.type;
        runReduce(ev, ctx, store as unknown as ReduceStore, replayOnly);
      }
      if (shouldYield) await yieldToMain();
    }
    if (isStale()) return null;
    // Atomic commit: seq + timeline + tools + phase land together.
    store._lastProcessedSeq = localSeq;
    commitReduceCtxImpl(store, ctx, replayOnly);
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

// ── buildSnapshotFromEvents ──

export function buildSnapshotFromEventsImpl(
  store: BusEventDispatchAPI,
  run: TaskRun,
  events: BusEvent[],
): {
  timeline: TimelineEntry[];
  tools: HookEvent[];
  turnUsages: TurnUsage[];
} {
  const prevRun = store.run;
  store.run = run;
  try {
    const ctx = createReduceCtxImpl(store);
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
      store._lastReduceEventType = ev.type;
      runReduce(ev, ctx, store as unknown as ReduceStore, true);
    }

    finalizeSnapshotCtxTools(ctx, run.status);
    return {
      timeline: ctx.tl,
      tools: ctx.he,
      turnUsages: ctx.turnUsages,
    };
  } finally {
    store.run = prevRun;
  }
}
