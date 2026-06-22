/**
 * session_lifecycle reducer — v1.0.9 runtime recovery projection.
 *
 * Projects typed phase/recovery_state tags only (no prompt text).
 * Drops events whose connection_generation is older than the store watermark.
 */
import type { BusEvent } from "$lib/types";
import { t } from "$lib/i18n/index.svelte";
import type { Reducer } from "./types";

const RECOVERING_STATES = new Set(["reconnecting", "recovering"]);

function noticeForLifecycle(recoveryState: string, crashReason?: string): string | null {
  if (recoveryState === "unrecoverable") {
    return t("recovery_unrecoverable");
  }
  if (RECOVERING_STATES.has(recoveryState)) {
    if (crashReason === "stdin_write_failed") {
      return t("recovery_stdin_broken");
    }
    if (crashReason === "stdout_eof") {
      return t("recovery_stdout_eof");
    }
    if (crashReason === "protocol_desynced") {
      return t("recovery_protocol_desync");
    }
    return t("recovery_in_progress");
  }
  return null;
}

export const reduceSessionLifecycle: Reducer = (ev, _ctx, store, replayOnly) => {
  if (ev.type !== "session_lifecycle") return;
  const e = ev as Extract<BusEvent, { type: "session_lifecycle" }>;

  const gen = e.connection_generation ?? 0;
  if (gen < store.recoveryConnectionGeneration) {
    return;
  }
  store.recoveryConnectionGeneration = gen;
  store.recoveryPhase = e.phase;
  store.recoveryState = e.recovery_state;
  store.recoveryCrashReason = e.crash_reason ?? null;
  store.recoveryUnrecoverable = e.recovery_state === "unrecoverable";

  if (replayOnly) return;

  const notice = noticeForLifecycle(e.recovery_state, e.crash_reason);
  if (notice) {
    store.recoveryNotice = notice;
  } else if (e.recovery_state === "recovered" || e.recovery_state === "healthy") {
    store.recoveryNotice = null;
  }

  store.recoveryLifecycleListener?.(e.recovery_state, gen);
};
