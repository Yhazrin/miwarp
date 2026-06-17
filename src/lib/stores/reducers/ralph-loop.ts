/**
 * ralph-loop reducer — handles ralph_started / ralph_iteration / ralph_complete.
 *
 * The Ralph loop is a long-running task loop that the CLI manages:
 * - ralph_started: initialize loop state (active, max iterations, completion promise)
 * - ralph_iteration: advance iteration counter, push a separator
 * - ralph_complete: push completion separator with status icon, mark inactive
 *
 * All three touch only the store. The loop state (`ralphLoop`) has no
 * batch-replay semantics because it's a runtime construct.
 */
import type { BusEvent, TimelineEntry } from "$lib/types";
import { dbg } from "$lib/utils/debug";
import { eventTs } from "$lib/utils/event-ts";
import { uuid } from "$lib/utils/uuid";
import type { Reducer } from "./types";

const REASON_LABELS: Record<string, string> = {
  max_iterations: "max iterations reached",
  completion_promise: "completion promise matched",
  cancelled: "cancelled",
  fail_stopped: "stopped after consecutive failures",
};

export const reduceRalphStarted: Reducer = (ev, _ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "ralph_started" }>;
  store.ralphLoop = {
    active: true,
    prompt: e.prompt,
    iteration: 0,
    maxIterations: e.max_iterations,
    completionPromise: e.completion_promise,
    startedAt: e.started_at,
    reason: null,
  };
  dbg("store", "ralph_started", {
    maxIterations: e.max_iterations,
    promise: e.completion_promise,
  });
};

export const reduceRalphIteration: Reducer = (ev, ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "ralph_iteration" }>;
  if (store.ralphLoop) {
    store.ralphLoop = {
      ...store.ralphLoop,
      iteration: e.iteration,
      maxIterations: e.max_iterations,
    };
  }
  const iterLabel =
    e.max_iterations > 0
      ? `Ralph iteration ${e.iteration}/${e.max_iterations}`
      : `Ralph iteration ${e.iteration}`;
  const iterSepId = uuid();
  const entry: TimelineEntry = {
    kind: "separator",
    id: iterSepId,
    anchorId: iterSepId,
    content: `🔄 ${iterLabel}`,
    ts: eventTs(e),
  };
  store._pushTimeline(ctx, entry);
  dbg("store", "ralph_iteration", { iteration: e.iteration });
};

export const reduceRalphComplete: Reducer = (ev, ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "ralph_complete" }>;
  const reasonText = REASON_LABELS[e.reason] ?? e.reason;
  const completeIcon = e.reason === "cancelled" || e.reason === "fail_stopped" ? "❌" : "✅";
  const completeSepId = uuid();
  const entry: TimelineEntry = {
    kind: "separator",
    id: completeSepId,
    anchorId: completeSepId,
    content: `${completeIcon} Ralph Loop completed · ${e.iteration} iterations · ${reasonText}`,
    ts: eventTs(e),
  };
  store._pushTimeline(ctx, entry);
  if (store.ralphLoop) {
    store.ralphLoop = {
      ...store.ralphLoop,
      active: false,
      iteration: e.iteration,
      reason: e.reason,
    };
  }
  dbg("store", "ralph_complete", { reason: e.reason, iteration: e.iteration });
};
