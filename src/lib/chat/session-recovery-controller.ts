import { systemTimers, type TimeoutApi } from "$lib/transport";

export interface SessionRecoveryControllerOptions {
  setNotice: (notice: string | null) => void;
  timers?: TimeoutApi;
  noticeDurationMs?: number;
}

/**
 * Coalesces concurrent recovery requests for the same run and owns the recovery
 * notice lifetime. It intentionally has no time-based suppression: a new
 * failure after a completed recovery is a new signal and must be handled.
 */
export class SessionRecoveryController {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly timers: TimeoutApi;
  private readonly noticeDurationMs: number;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private noticeGeneration = 0;
  private disposed = false;

  constructor(private readonly options: SessionRecoveryControllerOptions) {
    this.timers = options.timers ?? systemTimers;
    this.noticeDurationMs = options.noticeDurationMs ?? 5000;
  }

  request(runId: string, notice: string, execute: () => Promise<void>): Promise<void> {
    if (!runId || this.disposed) return Promise.resolve();

    const existing = this.inFlight.get(runId);
    if (existing) return existing;

    const generation = ++this.noticeGeneration;
    this.clearNoticeTimer();
    this.options.setNotice(notice);

    const recovery = Promise.resolve()
      .then(execute)
      .finally(() => {
        this.inFlight.delete(runId);
        if (this.disposed || generation !== this.noticeGeneration) return;
        this.noticeTimer = this.timers.setTimeout(() => {
          if (!this.disposed && generation === this.noticeGeneration) {
            this.options.setNotice(null);
          }
          this.noticeTimer = null;
        }, this.noticeDurationMs);
      });

    this.inFlight.set(runId, recovery);
    return recovery;
  }

  isRecovering(runId?: string): boolean {
    return runId ? this.inFlight.has(runId) : this.inFlight.size > 0;
  }

  resetNotice(): void {
    this.noticeGeneration += 1;
    this.clearNoticeTimer();
    this.options.setNotice(null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.inFlight.clear();
    this.resetNotice();
  }

  private clearNoticeTimer(): void {
    if (this.noticeTimer === null) return;
    this.timers.clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
  }
}
