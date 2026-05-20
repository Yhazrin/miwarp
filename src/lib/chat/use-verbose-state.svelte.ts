import * as api from "$lib/api";
import { dbg } from "$lib/utils/debug";

const VERBOSE_MAX_RETRIES = 3;

export interface VerboseStateHandle {
  verboseEnabled: boolean;
  verboseRetryTick: number;
  syncVerboseState(runId: string | undefined): void;
  cleanupVerbose(): void;
}

export function createVerboseState(): VerboseStateHandle {
  let verboseEnabled = $state(false);
  let verboseSeq = 0;
  let lastSyncedRunId = "__unset__";
  let verboseRetryTick = $state(0);
  let verboseRetryCount = 0;
  let verboseRetryTimer: ReturnType<typeof setTimeout> | null = null;

  async function syncVerboseState(runId: string | undefined) {
    const key = runId ?? "__no_run__";
    if (key === lastSyncedRunId) return;
    const seq = ++verboseSeq;
    verboseRetryCount = 0;
    try {
      const cfg = await api.getCliConfig();
      if (seq !== verboseSeq) return;
      lastSyncedRunId = key;
      verboseEnabled = cfg.verbose === true;
      dbg("chat", "verbose state synced", { verbose: verboseEnabled, runId, seq });
    } catch {
      if (seq === verboseSeq && verboseRetryCount < VERBOSE_MAX_RETRIES) {
        verboseRetryCount++;
        verboseRetryTimer = setTimeout(() => {
          verboseRetryTimer = null;
          verboseRetryTick++;
        }, 3000);
      }
    }
  }

  function cleanupVerbose() {
    if (verboseRetryTimer) clearTimeout(verboseRetryTimer);
  }

  return {
    get verboseEnabled() {
      return verboseEnabled;
    },
    set verboseEnabled(v: boolean) {
      verboseEnabled = v;
    },
    get verboseRetryTick() {
      return verboseRetryTick;
    },
    syncVerboseState,
    cleanupVerbose,
  };
}
