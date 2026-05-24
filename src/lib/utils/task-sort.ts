/**
 * Shared utilities for background task sorting and elapsed time display.
 */

const TERMINAL_STATUSES = new Set(["completed", "failed", "error"]);

/** Check if a task is still active (not in a terminal state). */
export function isTaskActive(status: string): boolean {
  return !TERMINAL_STATUSES.has(status);
}

/** Sort tasks: active first, then by most recent. */
export function sortTasksByPriority<T extends { status: string; startedAt: number }>(
  items: T[],
): T[] {
  return items.sort((a, b) => {
    const aActive = isTaskActive(a.status) ? 0 : 1;
    const bActive = isTaskActive(b.status) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return b.startedAt - a.startedAt;
  });
}

/** Format elapsed time from a start timestamp. */
export function formatElapsed(startedAt: number): string {
  const ms = Date.now() - startedAt;
  if (ms < 1000) return "<1s";
  return `${Math.floor(ms / 1000)}s`;
}
