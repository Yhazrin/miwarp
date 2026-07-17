/**
 * UsageProjection — pure derivations over the store's usage state
 * (item #2 Usage Projection).
 *
 * Extracted from session-store (Worker-4 P0/P1/P2 refactor). Every export
 * here is a pure function. The store's getters become thin delegations to
 * these.
 *
 * The store hands us a read view of `usage` + `turnUsages` so the
 * projection remains testable in isolation. Per-turn delta logic lives
 * here because it is purely arithmetic on the projection's inputs.
 */

import type { UsageState, TurnUsage } from "$lib/stores/types";

/** Total token count across input/output/cache. */
export function totalTokens(usage: UsageState): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

export interface ModelUsageEntryLike {
  context_window?: number;
}

/** Largest context window across all models that have reported usage. */
export function contextWindow(usage: UsageState): number {
  if (!usage.modelUsage) return 0;
  const entries = Object.values(usage.modelUsage) as ModelUsageEntryLike[];
  let max = 0;
  for (const e of entries) {
    if (e.context_window && e.context_window > max) max = e.context_window;
  }
  return max;
}

/**
 * Context utilization as a 0..1 fraction. Prefers the backend-supplied
 * `contextWindowUsedPercentage` when present; otherwise approximates from
 * the latest-turn token usage with a per-turn delta fallback for
 * cumulative reports that exceed the window.
 */
export function contextUtilization(usage: UsageState, turnUsages: TurnUsage[]): number {
  if (usage.contextWindowUsedPercentage != null) {
    const pct = usage.contextWindowUsedPercentage;
    const normalized = pct > 1 ? pct / 100 : pct;
    if (Number.isFinite(normalized)) return Math.min(Math.max(normalized, 0), 1);
  }

  const cw = contextWindow(usage);
  if (cw <= 0) return 0;
  const rawUsed = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  let used = rawUsed;

  if (rawUsed > cw && turnUsages.length >= 2) {
    const last = turnUsages[turnUsages.length - 1];
    const prev = turnUsages[turnUsages.length - 2];
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

export type ContextWarningLevel = "none" | "moderate" | "high" | "critical";

export function contextWarningLevel(utilization: number): ContextWarningLevel {
  if (utilization >= 0.9) return "critical";
  if (utilization >= 0.75) return "high";
  if (utilization >= 0.5) return "moderate";
  return "none";
}

/** Duration of extended thinking in seconds (0 if no thinking happened). */
export function thinkingDurationSec(
  thinkingStartMs: number,
  thinkingEndMs: number,
  now: number = Date.now(),
): number {
  if (!thinkingStartMs) return 0;
  const end = thinkingEndMs || now;
  return Math.floor((end - thinkingStartMs) / 1000);
}
