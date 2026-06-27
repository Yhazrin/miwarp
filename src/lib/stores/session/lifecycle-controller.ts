/**
 * LifecycleController — facade over the existing async lifecycle
 * coordinator and run-connection controller.
 *
 * This module does not replace the upstream controllers — they already
 * own generation-tracking, resume single-flight, and run-subscription
 * lifecycle. The worker-4 refactor keeps them as the source of truth and
 * re-exports them from a single import path so the SessionStore can wire
 * them in one place.
 *
 * If new lifecycle concerns are added later (e.g. spawn retry policy,
 * resume backoff) they should land here as a thin wrapper.
 */

export { SessionAsyncLifecycleCoordinator } from "$lib/chat/session-async-lifecycle";
export { SessionRunConnection } from "$lib/chat/session-run-connection";
export type {
  SessionRunConnectionOptions,
  SessionRunConnectionState,
} from "$lib/chat/session-run-connection";
