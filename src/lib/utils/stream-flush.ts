/**
 * v1.0.6 / 4.5 CLI idle-aware flush.
 *
 * Many code agents emit the first token ~16ms (one animation frame) after
 * the user hits send. We previously scheduled streaming flushes via rAF
 * which adds 0~16ms of jitter. The CLI idle-aware flush observes a 100ms
 * quiet window (no further deltas) and immediately commits via
 * `queueMicrotask` (~0.1ms), shaving off the rAF wait when the stream
 * has clearly stalled.
 *
 * Usage:
 *   const flush = createIdleAwareFlusher({ onFlush: () => doFlush() });
 *   flush(delta); // schedule flush
 *   flush(delta); // reschedule
 *   // onFlush is called after 100ms with no new deltas.
 */

const DEFAULT_IDLE_GAP_MS = 100;

export interface IdleAwareFlusherOptions {
  /** Quiescent window before commit. Default 100ms. */
  idleGapMs?: number;
  onFlush: () => void;
}

export interface IdleAwareFlusher {
  /** Schedule or reschedule a flush. Idempotent within one idle window. */
  tick: () => void;
  /** Force-flush immediately and cancel any pending timer. */
  flush: () => void;
  /** Cancel any pending timer. */
  cancel: () => void;
  /** True when a flush is scheduled but not yet executed. */
  get pending(): boolean;
}

export function createIdleAwareFlusher(opts: IdleAwareFlusherOptions): IdleAwareFlusher {
  const gap = opts.idleGapMs ?? DEFAULT_IDLE_GAP_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let _pending = false;

  const fire = () => {
    timer = null;
    _pending = false;
    opts.onFlush();
  };

  return {
    tick(): void {
      if (timer) clearTimeout(timer);
      _pending = true;
      timer = setTimeout(fire, gap);
    },
    flush(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (_pending) fire();
    },
    cancel(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      _pending = false;
    },
    get pending(): boolean {
      return _pending;
    },
  };
}

export const _IDLE_GAP_MS = DEFAULT_IDLE_GAP_MS;
