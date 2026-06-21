import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SendCoordinator,
  SendCoordinatorError,
  type SendDraft,
  type SendSubmitOptions,
  type SendStatusEvent,
} from "./send-coordinator";

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
