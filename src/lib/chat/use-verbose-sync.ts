import * as api from "$lib/api";
import { dbg } from "$lib/utils/debug";

const VERBOSE_MAX_RETRIES = 3;

export interface VerboseSyncState {
  verboseEnabled: boolean;
  verboseRetryTick: number;
}

export interface VerboseSyncContext {
  getVerboseEnabled: () => boolean;
  setVerboseEnabled: (v: boolean) => void;
  getVerboseRetryTick: () => number;
  setVerboseRetryTick: (v: number) => void;
}

export function createVerboseSync(ctx: VerboseSyncContext) {
  const { getVerboseEnabled, setVerboseEnabled, getVerboseRetryTick, setVerboseRetryTick } = ctx;

  let verboseSeq = 0;
  let lastSyncedRunId = "__unset__";
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
      setVerboseEnabled(cfg.verbose === true);
      dbg("chat", "verbose state synced", { verbose: getVerboseEnabled(), runId, seq });
    } catch {
      if (seq === verboseSeq && verboseRetryCount < VERBOSE_MAX_RETRIES) {
        verboseRetryCount++;
        verboseRetryTimer = setTimeout(() => {
          verboseRetryTimer = null;
          setVerboseRetryTick(getVerboseRetryTick() + 1);
        }, 3000);
      }
    }
  }

  function cleanup() {
    if (verboseRetryTimer) clearTimeout(verboseRetryTimer);
  }

  return { syncVerboseState, cleanup };
}
