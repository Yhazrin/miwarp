import type { BusEvent } from "$lib/types";
import type { TurnUsage, UsageState } from "$lib/stores/types";
import { dbg } from "$lib/utils/debug";
import type { Reducer } from "./types";

/**
 * Apply aggregate and per-turn usage updates.
 *
 * Error results may carry cost/model/context metadata with zero token counts.
 * Those updates must not erase the last authoritative token snapshot.
 */
export const reduceUsageUpdate: Reducer = (ev, ctx, store) => {
  const e = ev as Extract<BusEvent, { type: "usage_update" }>;
  const usage: UsageState = {
    inputTokens: e.input_tokens,
    outputTokens: e.output_tokens,
    cacheReadTokens: e.cache_read_tokens ?? 0,
    cacheWriteTokens: e.cache_write_tokens ?? 0,
    cost: e.total_cost_usd,
    modelUsage: e.model_usage,
    contextWindowUsedPercentage: e.context_window_used_percentage,
    contextWindowRemainingPercentage: e.context_window_remaining_percentage,
    durationApiMs: e.duration_api_ms,
  };

  const previous = ctx ? ctx.usage : store.usage;
  const hasTokens =
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.cacheReadTokens > 0 ||
    usage.cacheWriteTokens > 0;
  const merged = hasTokens ? usage : { ...previous, cost: Math.max(previous.cost, usage.cost) };

  if (!hasTokens && usage.modelUsage) merged.modelUsage = usage.modelUsage;
  if (!hasTokens && usage.durationApiMs) merged.durationApiMs = usage.durationApiMs;
  if (!hasTokens && usage.contextWindowUsedPercentage != null) {
    merged.contextWindowUsedPercentage = usage.contextWindowUsedPercentage;
  }
  if (!hasTokens && usage.contextWindowRemainingPercentage != null) {
    merged.contextWindowRemainingPercentage = usage.contextWindowRemainingPercentage;
  }

  if (ctx) ctx.usage = merged;
  else store.usage = merged;

  if (e.duration_ms != null) store.durationMs = e.duration_ms;
  if (e.num_turns != null) store.numTurns = e.num_turns;

  const shouldRecordTurnUsage =
    hasTokens ||
    usage.cost > 0 ||
    usage.durationApiMs != null ||
    e.duration_ms != null ||
    e.num_turns != null ||
    e.model_usage != null;
  if (!shouldRecordTurnUsage) return;

  const timeline = ctx ? ctx.tl : store.timeline;
  const fallbackIndex = timeline.filter((entry) => entry.kind === "user").length;
  const turnIndex = e.turn_index ?? fallbackIndex;
  dbg("store", "usage_update turn_index", {
    backend: e.turn_index,
    fallback: fallbackIndex,
    used: turnIndex,
  });

  const turnSnapshot: TurnUsage = {
    turnIndex,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cost: usage.cost,
    durationApiMs: usage.durationApiMs,
    durationMs: e.duration_ms,
  };

  if (ctx) ctx.turnUsages.push(turnSnapshot);
  else store.turnUsages = [...store.turnUsages, turnSnapshot];
};
