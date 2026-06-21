/**
 * Defaults and bounded map helpers for {@link PermissionCoordinator}.
 *
 * Keeps the coordinator honest about how many records it remembers.
 * Permanent allow is explicitly NOT modeled — the backend already
 * rejects it for plan-mode tools (see NEVER_ALLOW_TOOLS).
 */
export const DEFAULT_SUBMIT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_RETRYABLE = 16;

/**
 * Tools whose permanent allow would defeat the inline approval gate.
 * Mirrors `storage::shared::NEVER_ALLOW_TOOLS` on the Rust side. The
 * frontend only has to remember this for breadcrumb purposes; backend
 * remains the authority.
 */
export const NEVER_ALLOW_TOOLS_FRONTEND: ReadonlyArray<string> = ["ExitPlanMode", "EnterPlanMode"];

/**
 * Compute the effective timeout (ms) honoring caller override.
 */
export function resolveSubmitTimeout(provided: number | undefined, fallback: number): number {
  return Math.max(0, provided ?? fallback);
}

export function resolveMaxRetryable(provided: number | undefined, fallback: number): number {
  return Math.max(1, provided ?? fallback);
}

/**
 * Insert into a bounded Map, evicting the oldest key when full. FIFO
 * order respects Map insertion order in JS.
 */
export function boundedSet<K, V>(map: Map<K, V>, key: K, value: V, capacity: number): void {
  if (capacity <= 0) return;
  if (map.has(key)) {
    map.set(key, value);
    return;
  }
  while (map.size >= capacity) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  map.set(key, value);
}
