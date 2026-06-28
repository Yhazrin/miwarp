/** Default number of sessions shown per workspace / logical folder before "Show more". */
export const DEFAULT_SESSION_PAGE_SIZE = 5;

/** How many additional sessions each "Show more" click reveals. */
export const SESSION_PAGE_INCREMENT = 5;

export function getSessionVisibleCount(counts: Record<string, number>, key: string): number {
  return counts[key] ?? DEFAULT_SESSION_PAGE_SIZE;
}

export function sliceVisibleSessions<T>(items: readonly T[], visibleCount: number): T[] {
  return items.slice(0, visibleCount);
}

export function hiddenSessionCount(total: number, visibleCount: number): number {
  return Math.max(0, total - visibleCount);
}

export function hasMoreSessions(total: number, visibleCount: number): boolean {
  return hiddenSessionCount(total, visibleCount) > 0;
}

export function nextVisibleSessionCount(current: number, total: number): number {
  return Math.min(current + SESSION_PAGE_INCREMENT, total);
}

export function showMoreSessionIncrement(hidden: number): number {
  return Math.min(SESSION_PAGE_INCREMENT, hidden);
}

/** Expand pagination so a selected session beyond the current page becomes visible. */
export function visibleCountForSelectedIndex(
  selectedIndex: number,
  currentVisible: number,
): number {
  if (selectedIndex < 0) return currentVisible;
  return selectedIndex >= currentVisible ? selectedIndex + 1 : currentVisible;
}
