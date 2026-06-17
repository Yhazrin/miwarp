/**
 * Bus-event → reducer registry.
 *
 * Each entry maps a BusEvent.type to the reducer that handles it. The store's
 * `_reduce(ev, ctx, replayOnly)` calls `REDUCERS[ev.type]` and no-ops on a
 * miss (with unknownEventCount++ for diagnostics).
 *
 * The registry is intentionally typed loosely here — each reducer narrows the
 * event type internally. This keeps the table flat and the dispatch site dumb.
 *
 * Adding a new event family:
 *   1. Create `reducers/<family>.ts` exporting one or more `Reducer` functions.
 *   2. Add the entry below.
 *   3. Delete the corresponding `case` from session-store._reduce.
 */
import type { Reducer } from "./types";
import { reduceRateLimit } from "./rate-limit";
import { reduceCompactBoundary } from "./compact-boundary";
import { reduceCommandOutput } from "./command-output";
import { reduceFilesPersisted } from "./files-persisted";

export const REDUCERS: Record<string, Reducer> = {
  rate_limit_event: reduceRateLimit,
  compact_boundary: reduceCompactBoundary,
  command_output: reduceCommandOutput,
  files_persisted: reduceFilesPersisted,
};
