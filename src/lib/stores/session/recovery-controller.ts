/**
 * RecoveryController — facade over the existing recovery controller plus
 * the store's local recovery state projections.
 *
 * The upstream `SessionRecoveryController` already coalesces concurrent
 * recovery requests, manages the notice lifetime, and is well-tested.
 * The SessionStore keeps a local `recoveryNotice / recoveryState /
 * recoveryPhase / recoveryCrashReason / recoveryUnrecoverable /
 * recoveryConnectionGeneration / recoveryLifecycleListener` set of
 * reactive fields; this module re-exports the controller and provides a
 * small `RecoveryStateView` helper that callers can use to mirror the
 * controller's "is recovering" boolean onto a typed record.
 *
 * If new recovery concerns are added later (e.g. crash reason derivation,
 * protocol desync handling) they should land here as a thin wrapper.
 */

import type { SessionRecoveryController } from "$lib/chat/session-recovery-controller";

export { SessionRecoveryController } from "$lib/chat/session-recovery-controller";
export type { SessionRecoveryControllerOptions } from "$lib/chat/session-recovery-controller";

export type RecoveryState = "healthy" | "recovering" | "unrecoverable";

export interface RecoveryStateView {
  state: RecoveryState;
  phase: string;
  crashReason: string | null;
  connectionGeneration: number;
  notice: string | null;
  unrecoverable: boolean;
}

export function readRecoveryState(opts: {
  controller: SessionRecoveryController;
  runId: string | null | undefined;
  state: string;
  phase: string;
  crashReason: string | null;
  connectionGeneration: number;
  notice: string | null;
  unrecoverable: boolean;
}): RecoveryStateView {
  const isRecovering = opts.controller.isRecovering(opts.runId ?? undefined);
  const state: RecoveryState = opts.unrecoverable
    ? "unrecoverable"
    : isRecovering
      ? "recovering"
      : "healthy";
  return {
    state,
    phase: opts.phase,
    crashReason: opts.crashReason,
    connectionGeneration: opts.connectionGeneration,
    notice: opts.notice,
    unrecoverable: opts.unrecoverable,
  };
}
