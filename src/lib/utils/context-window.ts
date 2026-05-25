/**
 * ContextWindowVisualizer — displays real-time token usage with progress bar,
 * category breakdown, and warnings when approaching context limits.
 *
 * Inspired by Claude Code's usage display, enhanced with:
 * - Visual progress bar with threshold indicators
 * - Category breakdown (input, output, cache)
 * - Context warning levels (moderate/high/critical)
 * - Compact mode for inline display
 * - Detailed tooltip on hover
 */

import { t } from "$lib/i18n/index.svelte";

/** Context window warning threshold levels */
export type WarningLevel = "none" | "moderate" | "high" | "critical";

/** Token breakdown by category */
export interface TokenBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Context utilization data */
export interface ContextData {
  utilization: number; // 0.0 - 1.0
  warningLevel: WarningLevel;
  usedTokens: number;
  totalTokens: number;
  breakdown: TokenBreakdown;
  model: string;
  cost: number;
}

/** Props for the ContextWindowVisualizer */
export interface ContextWindowVisualizerProps {
  utilization: number;
  warningLevel: WarningLevel;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
  cost: number;
  /** Compact mode for inline display (no breakdown, just progress) */
  compact?: boolean;
  /** Show cost in the display */
  showCost?: boolean;
  /** Custom class for styling */
  class?: string;
}

/** Calculate the total tokens from breakdown */
export function totalTokens(breakdown: TokenBreakdown): number {
  return (
    breakdown.inputTokens +
    breakdown.outputTokens +
    breakdown.cacheReadTokens +
    breakdown.cacheWriteTokens
  );
}

/** Format token count with abbreviation */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return (tokens / 1_000_000).toFixed(1) + "M";
  }
  if (tokens >= 1_000) {
    return (tokens / 1_000).toFixed(1) + "K";
  }
  return tokens.toString();
}

/** Format cost with currency symbol */
export function formatCost(cost: number): string {
  return "$" + cost.toFixed(4);
}

/** Get the progress bar color based on warning level */
export function getProgressColor(level: WarningLevel): string {
  switch (level) {
    case "none":
      return "bg-emerald-500";
    case "moderate":
      return "bg-amber-500";
    case "high":
      return "bg-orange-500";
    case "critical":
      return "bg-red-500";
  }
}

/** Get the background color for the container */
export function getContainerBg(level: WarningLevel): string {
  switch (level) {
    case "none":
      return "bg-emerald-500/10";
    case "moderate":
      return "bg-amber-500/10";
    case "high":
      return "bg-orange-500/10";
    case "critical":
      return "bg-red-500/10";
  }
}

/** Get the border color based on warning level */
export function getBorderColor(level: WarningLevel): string {
  switch (level) {
    case "none":
      return "border-emerald-500/30";
    case "moderate":
      return "border-amber-500/30";
    case "high":
      return "border-orange-500/30";
    case "critical":
      return "border-red-500/30";
  }
}

/** Get warning message based on level */
export function getWarningMessage(level: WarningLevel): string | null {
  switch (level) {
    case "none":
      return null;
    case "moderate":
      return t("context_moderateWarning");
    case "high":
      return t("context_highWarning");
    case "critical":
      return t("context_criticalWarning");
  }
}

/** Calculate percentage for progress bar */
export function getPercentage(utilization: number): number {
  return Math.min(Math.round(utilization * 100), 100);
}

/** Determine warning level from utilization */
export function calculateWarningLevel(utilization: number): WarningLevel {
  if (utilization >= 0.9) return "critical";
  if (utilization >= 0.75) return "high";
  if (utilization >= 0.5) return "moderate";
  return "none";
}

/** Calculate cost per million tokens */
export function costPerMillion(inputTokens: number, outputTokens: number, cost: number): number {
  const total = inputTokens + outputTokens;
  if (total === 0) return 0;
  return (cost / total) * 1_000_000;
}
