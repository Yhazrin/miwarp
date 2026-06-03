/**
 * Legacy entry: bus events are dispatched from session-store for ordered delivery.
 * This module only initializes settings on app start.
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import { initSoundFeedback } from "./sound-feedback-service";

let _started = false;

export async function startSoundFeedbackListener(): Promise<void> {
  if (_started) return;
  _started = true;
  try {
    await initSoundFeedback();
    dbg("sound", "sound feedback initialized");
  } catch (e) {
    dbgWarn("sound", "init failed", e);
  }
}

export function stopSoundFeedbackListener(): void {
  _started = false;
}
