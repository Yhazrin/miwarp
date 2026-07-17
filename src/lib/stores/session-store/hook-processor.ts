/**
 * Hook event processing helpers extracted from SessionStore.
 *
 * Pure functions for applying hook events and usage data.
 * Returns new arrays/values — callers handle reactivity assignment.
 *
 * @module hook-processor
 */
import type { HookEvent } from "$lib/types";
import type { UsageState } from "../types";
import { dbg } from "$lib/utils/debug";

/** Apply a single hook event to a tools array. Returns the new array (or null if skipped). */
export function applyHookEvent(
  tools: HookEvent[],
  event: HookEvent,
  runId: string,
  isStreamOrAlive: boolean,
): HookEvent[] | null {
  if (event.run_id !== runId) return null;

  // In stream session mode, bus events already handle tool tracking
  if (
    isStreamOrAlive &&
    (event.hook_type === "PreToolUse" || event.hook_type === "PostToolUse")
  ) {
    dbg("store", "skip hook tool event (stream mode):", event.hook_type, event.tool_name);
    return null;
  }

  // PostToolUse should update matching PreToolUse entry
  if (event.hook_type === "PostToolUse" && event.tool_name) {
    const idx = tools.findLastIndex(
      (e) =>
        e.tool_name === event.tool_name &&
        e.hook_type === "PreToolUse" &&
        e.status === "running",
    );
    if (idx >= 0) {
      const updated = [...tools];
      updated[idx] = {
        ...updated[idx],
        status: "done",
        hook_type: "PostToolUse",
        tool_output: event.tool_output,
      };
      return updated;
    }
  }

  return [...tools, event];
}

/** Apply hook usage (cumulative += not overwrite). Returns new usage or null if skipped. */
export function applyHookUsage(
  current: UsageState,
  usage: { run_id: string; input_tokens: number; output_tokens: number; cost: number },
  runId: string,
): UsageState | null {
  if (usage.run_id !== runId) return null;
  return {
    ...current,
    inputTokens: current.inputTokens + usage.input_tokens,
    outputTokens: current.outputTokens + usage.output_tokens,
    cost: current.cost + usage.cost,
  };
}

/** Apply a batch of hook events (returns a single new array or null). */
export function applyHookEventBatch(
  tools: HookEvent[],
  events: HookEvent[],
  runId: string,
  isStreamOrAlive: boolean,
): HookEvent[] | null {
  let result = tools;
  let mutated = false;
  for (const event of events) {
    if (event.run_id !== runId) continue;
    if (
      isStreamOrAlive &&
      (event.hook_type === "PreToolUse" || event.hook_type === "PostToolUse")
    ) {
      continue;
    }
    if (event.hook_type === "PostToolUse" && event.tool_name) {
      const idx = result.findLastIndex(
        (e) =>
          e.tool_name === event.tool_name &&
          e.hook_type === "PreToolUse" &&
          e.status === "running",
      );
      if (idx >= 0) {
        if (!mutated) {
          result = [...result];
          mutated = true;
        }
        result[idx] = {
          ...result[idx],
          status: "done",
          hook_type: "PostToolUse",
          tool_output: event.tool_output,
        };
        continue;
      }
    }
    if (!mutated) {
      result = [...result];
      mutated = true;
    }
    result.push(event);
  }
  return mutated ? result : null;
}

/** Apply a batch of hook usage (returns cumulative delta or null if all skipped). */
export function applyHookUsageBatch(
  current: UsageState,
  usages: Array<{ run_id: string; input_tokens: number; output_tokens: number; cost: number }>,
  runId: string,
): UsageState | null {
  let dInput = 0,
    dOutput = 0,
    dCost = 0;
  for (const u of usages) {
    if (u.run_id !== runId) continue;
    dInput += u.input_tokens;
    dOutput += u.output_tokens;
    dCost += u.cost;
  }
  if (dInput === 0 && dOutput === 0 && dCost === 0) return null;
  return {
    ...current,
    inputTokens: current.inputTokens + dInput,
    outputTokens: current.outputTokens + dOutput,
    cost: current.cost + dCost,
  };
}
