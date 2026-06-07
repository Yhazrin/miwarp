/**
 * Tests for the idle-aware stream flusher.
 * Uses fake timers so the 100ms idle window is deterministic.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createIdleAwareFlusher, _IDLE_GAP_MS } from "./stream-flush";

describe("idle-aware-flusher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires after the idle gap", () => {
    const onFlush = vi.fn();
    const f = createIdleAwareFlusher({ onFlush });
    expect(f.pending).toBe(false);
    f.tick();
    expect(f.pending).toBe(true);
    vi.advanceTimersByTime(_IDLE_GAP_MS);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(f.pending).toBe(false);
  });

  it("resets the timer on rapid ticks", () => {
    const onFlush = vi.fn();
    const f = createIdleAwareFlusher({ onFlush });
    f.tick();
    vi.advanceTimersByTime(50);
    f.tick();
    vi.advanceTimersByTime(50);
    // Total 100ms but second tick reset → not yet
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(_IDLE_GAP_MS);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("flush() commits immediately and cancels timer", () => {
    const onFlush = vi.fn();
    const f = createIdleAwareFlusher({ onFlush });
    f.tick();
    f.flush();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(f.pending).toBe(false);
    vi.advanceTimersByTime(_IDLE_GAP_MS);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("cancel() drops the pending flush", () => {
    const onFlush = vi.fn();
    const f = createIdleAwareFlusher({ onFlush });
    f.tick();
    f.cancel();
    vi.advanceTimersByTime(_IDLE_GAP_MS * 2);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("flush() is a no-op when nothing is pending", () => {
    const onFlush = vi.fn();
    const f = createIdleAwareFlusher({ onFlush });
    f.flush();
    expect(onFlush).not.toHaveBeenCalled();
  });
});
