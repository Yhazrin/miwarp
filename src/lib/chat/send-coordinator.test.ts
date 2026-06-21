import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SendCoordinator,
  SendCoordinatorError,
  type SendDraft,
  type SendSubmitOptions,
  type SendStatusEvent,
  type TransportPhaseEvent,
} from "./send-coordinator";
import type { TimeoutApi } from "$lib/transport";

vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

const DRAFT: SendDraft = { text: "hello", attachments: [] };

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Injectable timers so TTL tests can advance the clock deterministically
 * without sleeping. Keeps the fault-injection surface narrow.
 */
function fakeTimers(): TimeoutApi & {
  flush(): void;
  size(): number;
} {
  const callbacks = new Map<number, () => void>();
  let nextId = 1;
  return {
    setTimeout(cb: () => void): ReturnType<typeof setTimeout> {
      const id = nextId++;
      callbacks.set(id, cb);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout(handle: ReturnType<typeof setTimeout>): void {
      callbacks.delete(handle as unknown as number);
    },
    flush(): void {
      const pending = Array.from(callbacks.values());
      callbacks.clear();
      pending.forEach((cb) => cb());
    },
    size(): number {
      return callbacks.size;
    },
  };
}

describe("SendCoordinator (Phase 1 surface)", () => {
  let coordinator: SendCoordinator;
  let events: SendStatusEvent[];

  beforeEach(() => {
    coordinator = new SendCoordinator();
    events = [];
    coordinator.subscribe((e) => events.push(e));
  });

  function submit(
    partial: Partial<SendSubmitOptions> & { transport?: (id: string) => Promise<void> } = {},
  ): { promise: Promise<{ clientMessageId: string }>; clientMessageId: string } {
    const id = partial.clientMessageId ?? `cmsg_${Math.random().toString(36).slice(2)}`;
    const options: SendSubmitOptions = {
      runId: partial.runId ?? "run-1",
      sessionId: partial.sessionId ?? "sess-1",
      draft: partial.draft ?? DRAFT,
      cause: partial.cause,
      clientMessageId: id,
      transport: partial.transport ?? (async () => undefined),
    };
    return { promise: coordinator.submit(options), clientMessageId: id };
  }

  it("transitions to accepted on transport resolution", async () => {
    const { promise, clientMessageId } = submit();
    await promise;
    const states = events.map((e) => e.state);
    expect(states).toEqual(["submitting", "accepted"]);
    expect(events.at(-1)?.clientMessageId).toBe(clientMessageId);
    expect(coordinator.busy).toBe(false);
  });

  it("transitions to failed on transport rejection", async () => {
    const transport = vi.fn().mockRejectedValue(new Error("NotConnected"));
    const { promise } = submit({ transport });
    await expect(promise).rejects.toBeInstanceOf(SendCoordinatorError);
    const last = events.at(-1);
    expect(last?.state).toBe("failed");
    expect(last?.error?.code).toBe("transport_unavailable");
    expect(coordinator.busy).toBe(false);
  });

  it("classifies timeout errors as retryable", async () => {
    const transport = vi.fn().mockRejectedValue(new Error("IPC_TIMEOUT: did not respond"));
    const { promise } = submit({ transport });
    await expect(promise).rejects.toBeInstanceOf(SendCoordinatorError);
    const last = events.at(-1);
    expect(last?.error?.code).toBe("timeout");
    expect(last?.error?.retryable).toBe(true);
  });

  it("classifies actor dead as rejected (not retryable)", async () => {
    const transport = vi.fn().mockRejectedValue(new Error("Actor dead"));
    const { promise } = submit({ transport });
    await expect(promise).rejects.toBeInstanceOf(SendCoordinatorError);
    const last = events.at(-1);
    expect(last?.error?.code).toBe("rejected");
    expect(last?.error?.retryable).toBe(false);
  });

  it("uses the supplied client message id verbatim", async () => {
    const { promise, clientMessageId } = submit({ clientMessageId: "fixed-id-1" });
    await promise;
    expect(clientMessageId).toBe("fixed-id-1");
    expect(events[0]?.clientMessageId).toBe("fixed-id-1");
  });

  it("prevents duplicate in-flight slots per client id", async () => {
    const d1 = deferred<void>();
    const d2 = deferred<void>();
    const { promise: p1 } = submit({ transport: () => d1.promise });
    const { promise: p2 } = submit({ transport: () => d2.promise });
    expect(coordinator.isSubmitting("run-1")).toBe(true);
    d1.resolve();
    await p1;
    d2.resolve();
    await p2;
    expect(coordinator.busy).toBe(false);
  });

  it("marks submit as cancelled when the run is cancelled mid-flight", async () => {
    const d = deferred<void>();
    const { promise } = submit({ transport: () => d.promise });
    coordinator.cancelForRun("run-1", "user switched session");
    const settled = promise.then(
      () => ({ ok: true as const, error: null }),
      (err: unknown) => ({ ok: false as const, error: err }),
    );
    d.resolve();
    const result = await settled;
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/switched/);
    const last = events.at(-1);
    expect(last?.state).toBe("cancelled");
    expect(last?.error?.code).toBe("stale_identity");
  });

  it("reconciles submits whose runId no longer matches the active run", async () => {
    const d1 = deferred<void>();
    const d2 = deferred<void>();
    const { promise: p1 } = submit({ runId: "run-A", transport: () => d1.promise });
    const { promise: p2 } = submit({ runId: "run-B", transport: () => d2.promise });
    const dropped = coordinator.reconcileActiveRun("run-B");
    expect(dropped).toBe(1);
    expect(events.some((e) => e.runId === "run-A" && e.state === "cancelled")).toBe(true);
    d1.resolve();
    d2.resolve();
    await Promise.allSettled([p1, p2]);
  });

  it("drops all pending submits when activeRunId is null", async () => {
    const d1 = deferred<void>();
    const { promise: p1 } = submit({ runId: "run-A", transport: () => d1.promise });
    const dropped = coordinator.reconcileActiveRun(null);
    expect(dropped).toBe(1);
    expect(coordinator.busy).toBe(false);
    d1.resolve();
    await Promise.allSettled([p1]);
  });

  it("transitions submitting → queued → cancelled on cancel()", () => {
    const { clientMessageId, promise } = submit({
      transport: () => new Promise(() => {}),
    });
    void promise.catch(() => undefined);
    expect(coordinator.markQueued("run-1")).toBe(true);
    expect(events.some((e) => e.state === "queued")).toBe(true);
    expect(coordinator.cancel(clientMessageId, "user closed the run")).toBe(true);
    const cancelled = events.find((e) => e.state === "cancelled");
    expect(cancelled?.error?.code).toBe("stale_identity");
    expect(cancelled?.error?.retryable).toBe(false);
  });

  it("markQueued is a no-op for unknown runs and after settle", async () => {
    expect(coordinator.markQueued("nope")).toBe(false);
    const { promise } = submit();
    await promise;
    expect(coordinator.markQueued("run-1")).toBe(false);
  });

  it("acknowledge removes the pending record by runId+clientMessageId", async () => {
    const { promise, clientMessageId } = submit();
    expect(coordinator.acknowledge("run-1", clientMessageId)).toBe(true);
    expect(coordinator.acknowledge("run-1", clientMessageId)).toBe(true);
    expect(coordinator.busy).toBe(false);
    await promise.catch(() => {});
  });

  it("acknowledge ignores mismatched client message id", async () => {
    submit();
    expect(coordinator.acknowledge("run-1", "wrong-id")).toBe(false);
    expect(coordinator.hasPending("run-1")).toBe(true);
  });

  it("fires onAccepted exactly once on accepted transition", async () => {
    const onAccepted = vi.fn();
    const c2 = new SendCoordinator({ onAccepted });
    c2.subscribe(() => {});
    await c2.submit({
      runId: "run-1",
      sessionId: "s1",
      draft: DRAFT,
      transport: async () => undefined,
    });
    expect(onAccepted).toHaveBeenCalledTimes(1);
    c2.dispose();
  });

  it("fires onFailure exactly once on failed transition", async () => {
    const onFailure = vi.fn();
    const c2 = new SendCoordinator({ onFailure });
    await expect(
      c2.submit({
        runId: "run-1",
        sessionId: "s1",
        draft: DRAFT,
        transport: async () => {
          throw new Error("NotConnected");
        },
      }),
    ).rejects.toBeInstanceOf(SendCoordinatorError);
    expect(onFailure).toHaveBeenCalledTimes(1);
    c2.dispose();
  });

  it("dispose clears listeners and pending state", () => {
    const { promise } = submit({ transport: () => new Promise(() => {}) });
    void promise.catch(() => undefined);
    coordinator.dispose();
    expect(coordinator.busy).toBe(false);
    expect(coordinator.pendingCount).toBe(0);
    const len = events.length;
    void coordinator
      .submit({
        runId: "run-1",
        draft: DRAFT,
        transport: async () => undefined,
      })
      .catch(() => {});
    expect(events.length).toBe(len);
  });

  it("isolates listener exceptions", async () => {
    coordinator.subscribe(() => {
      throw new Error("listener boom");
    });
    const { promise } = submit();
    await promise;
    expect(events.at(-1)?.state).toBe("accepted");
  });

  it("isSubmitting returns true during submit and false after accept", async () => {
    const d = deferred<void>();
    submit({ transport: () => d.promise });
    expect(coordinator.isSubmitting("run-1")).toBe(true);
    d.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(coordinator.isSubmitting("run-1")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase 2 fault-injection tests
// ─────────────────────────────────────────────────────────────────────

describe("SendCoordinator (Phase 2 reconnect queue)", () => {
  let timers: ReturnType<typeof fakeTimers>;
  let coordinator: SendCoordinator;
  let events: SendStatusEvent[];
  let transportEvents: TransportPhaseEvent[];

  beforeEach(() => {
    timers = fakeTimers();
    coordinator = new SendCoordinator({
      timers,
      queueTtlMs: 60_000,
      maxQueued: 3,
      initialPhase: "reconnecting",
      initialGeneration: 1,
    });
    events = [];
    transportEvents = [];
    coordinator.subscribe((e) => events.push(e));
    coordinator.subscribeTransport((e) => transportEvents.push(e));
  });

  function submitTo(
    partial: Partial<SendSubmitOptions> & { transport?: (id: string) => Promise<void> } = {},
  ): { promise: Promise<{ clientMessageId: string }>; clientMessageId: string } {
    const id = partial.clientMessageId ?? `cmsg_${Math.random().toString(36).slice(2)}`;
    const options: SendSubmitOptions = {
      runId: partial.runId ?? "run-1",
      sessionId: partial.sessionId ?? "sess-1",
      draft: partial.draft ?? DRAFT,
      cause: partial.cause,
      clientMessageId: id,
      transport: partial.transport ?? (async () => undefined),
    };
    return { promise: coordinator.submit(options), clientMessageId: id };
  }

  // ── Reconnect buffering ──

  it("queues submits while transport is reconnecting and drains on connect", async () => {
    const transportCalls: string[] = [];
    const { promise, clientMessageId } = submitTo({
      transport: async (id) => {
        transportCalls.push(id);
      },
    });
    expect(coordinator.queuedCount).toBe(1);
    expect(events.at(-1)?.state).toBe("queued");
    expect(events.at(-1)?.queueDepth).toBe(1);
    expect(coordinator.busy).toBe(false);

    coordinator.setTransportPhase("connected", { reconcile: true });
    await promise;
    expect(transportCalls).toEqual([clientMessageId]);
    expect(events.at(-1)?.state).toBe("accepted");
    expect(coordinator.queuedCount).toBe(0);
  });

  it("cancels queued entries when generation advances past their captured one", async () => {
    const promises: Promise<unknown>[] = [];
    for (const id of ["g1-a", "g1-b"]) {
      const { promise } = submitTo({
        clientMessageId: id,
        transport: () => new Promise(() => {}),
      });
      promises.push(promise.catch(() => undefined));
    }
    await Promise.resolve();
    expect(coordinator.queuedCount).toBe(2);

    coordinator.bumpGeneration(5);

    await Promise.allSettled(promises);
    expect(coordinator.queuedCount).toBe(0);
    const cancelled = events.filter((e) => e.state === "cancelled");
    expect(cancelled.map((e) => e.clientMessageId).sort()).toEqual(["g1-a", "g1-b"]);
    expect(cancelled.every((e) => e.error?.code === "stale_generation")).toBe(true);
    expect(cancelled.every((e) => e.error?.retryable === true)).toBe(true);
  });

  // ── Bounded queue / drop-oldest ──

  it("drops the oldest queued submit when maxQueued is exceeded", async () => {
    for (let i = 0; i < 4; i += 1) {
      const { promise } = submitTo({
        clientMessageId: `q-${i}`,
        transport: () => new Promise(() => {}),
      });
      void promise.catch(() => undefined);
    }
    await Promise.resolve();
    expect(coordinator.queuedCount).toBe(3);
    const eventsForQ0 = events.filter((e) => e.clientMessageId === "q-0");
    const dropEvent = eventsForQ0.at(-1);
    expect(dropEvent?.state).toBe("failed");
    expect(dropEvent?.error?.code).toBe("queue_full");
    expect(dropEvent?.error?.retryable).toBe(true);
  });

  // ── TTL expiry ──

  it("expires queued entries after queueTtlMs and retains draft as retryable", async () => {
    const transportCalls: string[] = [];
    const { promise } = submitTo({
      clientMessageId: "ttl-1",
      transport: async (id) => {
        transportCalls.push(id);
      },
    });

    timers.flush();
    await promise.catch((err) => {
      expect(err).toBeInstanceOf(SendCoordinatorError);
      expect((err as SendCoordinatorError).failure.code).toBe("queue_expired");
    });
    expect(transportCalls).toEqual([]);
    expect(coordinator.retryableCount).toBe(1);
  });

  // ── Generation isolation / reconnect-storm single-flush ──

  it("reconnect storm flushes the queue at most once per generation", async () => {
    const transportCalls: string[] = [];
    const items = ["a", "b", "c"].map((tag) => {
      const id = `g-${tag}`;
      const { promise } = submitTo({
        clientMessageId: id,
        transport: async (received) => {
          transportCalls.push(received);
        },
      });
      return { id, promise };
    });

    const drained1 = coordinator.reconcile({ generation: 1, healthy: true });
    expect(drained1).toBe(3);
    const drained2 = coordinator.reconcile({ generation: 1, healthy: true });
    expect(drained2).toBe(0);
    await Promise.allSettled(items.map((i) => i.promise));
    expect(transportCalls.sort()).toEqual(["g-a", "g-b", "g-c"]);
  });

  it("older-generation queued entries are cancelled, never dispatched", async () => {
    const calls: string[] = [];
    const { promise } = submitTo({
      clientMessageId: "old-1",
      transport: async (id) => {
        calls.push(id);
      },
    });

    coordinator.bumpGeneration(7);

    const drained = coordinator.reconcile({ generation: 7, healthy: true });
    expect(drained).toBe(0);
    await promise.catch((err) => {
      expect(err).toBeInstanceOf(SendCoordinatorError);
    });
    expect(calls).toEqual([]);
    const eventsForOld = events.filter((e) => e.clientMessageId === "old-1");
    const cancelEvent = eventsForOld.find((e) => e.state === "cancelled");
    expect(cancelEvent?.error?.code).toBe("stale_generation");
    expect(cancelEvent?.error?.retryable).toBe(true);
  });

  it("bumpGeneration cancels stale in-flight records", async () => {
    coordinator.setTransportPhase("connected", { generation: 0 });
    const d = deferred<void>();
    const { promise } = submitTo({ transport: () => d.promise });
    expect(coordinator.busy).toBe(true);

    coordinator.bumpGeneration(5);
    const settled = promise.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    d.resolve();
    const result = await settled;
    expect(result.ok).toBe(false);
    const last = events.at(-1);
    expect(last?.state).toBe("failed");
    expect(last?.error?.code).toBe("stale_generation");
  });

  // ── Idempotency: same clientMessageId, same promise ──

  it("returns the same promise for a duplicate in-flight submit", () => {
    coordinator.setTransportPhase("connected", { generation: 0 });
    const transport = vi.fn<() => Promise<void>>(() => new Promise(() => {}));
    const first = coordinator.submit({
      runId: "run-1",
      sessionId: "s1",
      draft: DRAFT,
      clientMessageId: "dup-1",
      transport,
    });
    const second = coordinator.submit({
      runId: "run-1",
      sessionId: "s1",
      draft: DRAFT,
      clientMessageId: "dup-1",
      transport,
    });
    expect(second).toBe(first);
    expect(transport).toHaveBeenCalledTimes(1);
    void first.catch(() => {});
    void second.catch(() => {});
  });

  it("returns immediately for a submit already accepted", async () => {
    coordinator.setTransportPhase("connected", { generation: 0 });
    const transport = vi.fn(async () => undefined);
    const { promise, clientMessageId } = submitTo({ transport });
    await promise;
    expect(transport).toHaveBeenCalledTimes(1);

    const second = await coordinator.submit({
      runId: "run-1",
      sessionId: "s1",
      draft: DRAFT,
      clientMessageId,
      transport: async () => {
        throw new Error("must not be called");
      },
    });
    expect(second).toEqual({ clientMessageId });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  // ── Retry / Cancel ──

  it("retry() reuses the same clientMessageId after a retryable failure", async () => {
    coordinator.setTransportPhase("connected", { generation: 0 });

    let attempt = 0;
    const transport = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("NotConnected");
    });
    const { promise, clientMessageId } = submitTo({ transport });
    await expect(promise).rejects.toBeInstanceOf(SendCoordinatorError);
    expect(coordinator.retryableCount).toBe(1);

    const retried = coordinator.retry(clientMessageId);
    expect(retried).not.toBeNull();
    if (!retried) throw new Error("expected retry promise");
    await expect(retried).resolves.toEqual({ clientMessageId });
    expect(attempt).toBe(2);
  });

  it("retry() returns null for unknown clientMessageId", () => {
    expect(coordinator.retry("never-seen")).toBeNull();
  });

  it("cancel() rejects an in-flight submit with stale_identity", async () => {
    coordinator.setTransportPhase("connected", { generation: 0 });
    const { promise, clientMessageId } = submitTo({
      transport: () => new Promise(() => {}),
    });
    expect(coordinator.cancel(clientMessageId, "user clicked Cancel")).toBe(true);
    await expect(promise).rejects.toBeInstanceOf(SendCoordinatorError);
    const last = events.at(-1);
    expect(last?.state).toBe("cancelled");
    expect(last?.error?.code).toBe("stale_identity");
  });

  it("cancel() rejects a queued submit and clears its TTL timer", async () => {
    const { promise, clientMessageId } = submitTo({
      transport: () => new Promise(() => {}),
    });
    expect(coordinator.cancel(clientMessageId, "user dismissed")).toBe(true);
    await expect(promise).rejects.toBeInstanceOf(SendCoordinatorError);
    expect(coordinator.queuedCount).toBe(0);
    // Flushing the timer must NOT resurrect the entry.
    timers.flush();
    expect(coordinator.queuedCount).toBe(0);
  });

  // ── cancelForRun / reconcileActiveRun coverage ──

  it("cancelForRun drains every queued entry for the run", async () => {
    const promises: Promise<unknown>[] = [];
    for (const id of ["r-1", "r-2", "r-3"]) {
      const { promise } = submitTo({
        clientMessageId: id,
        runId: id === "r-3" ? "run-Y" : "run-X",
        transport: () => new Promise(() => {}),
      });
      promises.push(promise.catch(() => undefined));
    }
    await Promise.resolve();
    coordinator.cancelForRun("run-X", "session closed");
    await Promise.resolve();
    expect(coordinator.queuedCount).toBe(1);
    expect(events.filter((e) => e.state === "cancelled").length).toBe(2);
    coordinator.dispose();
    await Promise.allSettled(promises);
  });

  // ── dispose coverage of queue + timers + listeners ──

  it("dispose cancels pending records and clears timers", async () => {
    const { promise } = submitTo({ transport: () => new Promise(() => {}) });
    coordinator.dispose();
    await expect(promise).rejects.toBeInstanceOf(SendCoordinatorError);
    expect(coordinator.queuedCount).toBe(0);
    expect(coordinator.busy).toBe(false);
    expect(timers.size()).toBe(0);
  });

  it("submit after dispose rejects immediately", async () => {
    coordinator.dispose();
    await expect(
      coordinator.submit({
        runId: "run-1",
        sessionId: "s1",
        draft: DRAFT,
        transport: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(SendCoordinatorError);
  });

  // ── Transport phase listener ──

  it("subscribeTransport fires on phase change and generation bump", () => {
    coordinator.setTransportPhase("recovering", { generation: 2 });
    coordinator.setTransportPhase("connected", { generation: 3 });
    expect(transportEvents.map((e) => e.phase)).toEqual(["recovering", "connected"]);
    expect(transportEvents.map((e) => e.generation)).toEqual([2, 3]);
  });

  // ── canSubmit / queuedCount integration ──

  it("canSubmit reports the live transport phase", () => {
    expect(coordinator.canSubmit).toBe(false); // initial: reconnecting
    coordinator.setTransportPhase("connected", { generation: 5 });
    expect(coordinator.canSubmit).toBe(true);
    coordinator.setTransportPhase("reconnecting", { generation: 6 });
    expect(coordinator.canSubmit).toBe(false);
  });

  // ── Total tracked records bounded ──

  it("bounds acknowledged set to maxAcknowledged", async () => {
    coordinator.setTransportPhase("connected", { generation: 0 });
    const c2 = new SendCoordinator({ timers, maxAcknowledged: 2 });
    try {
      for (let i = 0; i < 5; i += 1) {
        await c2.submit({
          runId: "run-1",
          sessionId: "s1",
          draft: DRAFT,
          clientMessageId: `ack-${i}`,
          transport: async () => undefined,
        });
      }
      let invoked = false;
      await c2.submit({
        runId: "run-1",
        sessionId: "s1",
        draft: DRAFT,
        clientMessageId: "ack-0",
        transport: async () => {
          invoked = true;
        },
      });
      expect(invoked).toBe(true);
    } finally {
      c2.dispose();
    }
  });

  it("dispose after dispose is idempotent and resets no state", () => {
    coordinator.dispose();
    expect(() => coordinator.dispose()).not.toThrow();
    expect(coordinator.transportPhase).toBe("disposed");
  });

  it("reconcile on disposed coordinator is a no-op", () => {
    coordinator.dispose();
    expect(coordinator.reconcile({ generation: 1, healthy: true })).toBe(0);
  });
});
