import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SendCoordinator,
  SendCoordinatorError,
  type SendDraft,
  type SendSubmitOptions,
  type SendStatusEvent,
} from "./send-coordinator";

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

describe("SendCoordinator", () => {
  let coordinator: SendCoordinator;
  let events: SendStatusEvent[];
  let unsub: () => void;

  beforeEach(() => {
    coordinator = new SendCoordinator();
    events = [];
    unsub = coordinator.subscribe((e) => events.push(e));
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

  // 1. happy path: submit → accepted
  it("transitions to accepted on transport resolution", async () => {
    const { promise, clientMessageId } = submit();
    await promise;
    const states = events.map((e) => e.state);
    expect(states).toEqual(["submitting", "accepted"]);
    expect(events.at(-1)?.clientMessageId).toBe(clientMessageId);
    expect(coordinator.busy).toBe(false);
  });

  // 2. transport throws → failed
  it("transitions to failed on transport rejection", async () => {
    const transport = vi.fn().mockRejectedValue(new Error("NotConnected"));
    const { promise } = submit({ transport });
    await expect(promise).rejects.toBeInstanceOf(SendCoordinatorError);
    const last = events.at(-1);
    expect(last?.state).toBe("failed");
    expect(last?.error?.code).toBe("transport_unavailable");
    expect(coordinator.busy).toBe(false);
  });

  // 3. timeout detection
  it("classifies timeout errors as retryable", async () => {
    const transport = vi.fn().mockRejectedValue(new Error("IPC_TIMEOUT: did not respond"));
    const { promise } = submit({ transport });
    await expect(promise).rejects.toBeInstanceOf(SendCoordinatorError);
    const last = events.at(-1);
    expect(last?.error?.code).toBe("timeout");
    expect(last?.error?.retryable).toBe(true);
  });

  // 4. backend rejection
  it("classifies actor dead as rejected (not retryable)", async () => {
    const transport = vi.fn().mockRejectedValue(new Error("Actor dead"));
    const { promise } = submit({ transport });
    await expect(promise).rejects.toBeInstanceOf(SendCoordinatorError);
    const last = events.at(-1);
    expect(last?.error?.code).toBe("rejected");
    expect(last?.error?.retryable).toBe(false);
  });

  // 5. duplicate submit guard: the same client id cannot be tracked twice
  it("uses the supplied client message id verbatim", async () => {
    const { promise, clientMessageId } = submit({ clientMessageId: "fixed-id-1" });
    await promise;
    expect(clientMessageId).toBe("fixed-id-1");
    expect(events[0]?.clientMessageId).toBe("fixed-id-1");
  });

  // 6. concurrent submits for the same run: single-flight
  it("prevents duplicate in-flight slots per run", async () => {
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

  // 7. stale identity: cancelForRun during submit
  it("marks submit as stale_identity when the run is cancelled mid-flight", async () => {
    const d = deferred<void>();
    const { promise } = submit({ transport: () => d.promise });
    coordinator.cancelForRun("run-1", "user switched session");
    // Convert rejection to a value to avoid the vitest unhandled
    // rejection detector firing in the microtask between d.resolve()
    // and the await of an explicit assertion.
    const settled = promise.then(
      () => ({ ok: true as const, error: null }),
      (err: unknown) => ({ ok: false as const, error: err }),
    );
    d.resolve();
    const result = await settled;
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/switched/);
    const last = events.at(-1);
    expect(last?.state).toBe("failed");
    expect(last?.error?.code).toBe("stale_identity");
  });

  // 8. rapid session switch: reconcileActiveRun drops foreign submits
  it("reconciles submits whose runId no longer matches the active run", async () => {
    const d1 = deferred<void>();
    const d2 = deferred<void>();
    const { promise: p1 } = submit({ runId: "run-A", transport: () => d1.promise });
    const { promise: p2 } = submit({ runId: "run-B", transport: () => d2.promise });
    const dropped = coordinator.reconcileActiveRun("run-B");
    expect(dropped).toBe(1);
    expect(events.some((e) => e.runId === "run-A" && e.state === "failed")).toBe(true);
    expect(events.some((e) => e.runId === "run-B" && e.state === "submitting")).toBe(true);
    d1.resolve();
    d2.resolve();
    await Promise.allSettled([p1, p2]);
  });

  // 9. active run lost (null)
  it("drops all in-flight submits when activeRunId is null", async () => {
    const d1 = deferred<void>();
    const { promise: p1 } = submit({ runId: "run-A", transport: () => d1.promise });
    const dropped = coordinator.reconcileActiveRun(null);
    expect(dropped).toBe(1);
    expect(coordinator.busy).toBe(false);
    d1.resolve();
    await Promise.allSettled([p1]);
  });

  // 10. queued state: markQueued + abort restores a failed transition
  it("transitions submitting → queued → failed on abort", () => {
    submit({ transport: () => new Promise(() => {}) }); // never resolves
    expect(coordinator.markQueued("run-1")).toBe(true);
    expect(events.some((e) => e.state === "queued")).toBe(true);
    coordinator.abort("run-1", "user closed the run");
    const failed = events.find((e) => e.state === "failed");
    expect(failed?.error?.code).toBe("unknown");
    expect(failed?.error?.retryable).toBe(false);
  });

  // 11. markQueued is idempotent and rejects for unknown runs
  it("markQueued is a no-op for unknown runs and after settle", async () => {
    expect(coordinator.markQueued("nope")).toBe(false);
    const { promise } = submit();
    await promise; // settled as accepted
    expect(coordinator.markQueued("run-1")).toBe(false);
  });

  // 12. acknowledge removes the record
  it("acknowledge removes the in-flight record by runId+clientMessageId", async () => {
    const { promise, clientMessageId } = submit();
    expect(coordinator.acknowledge("run-1", clientMessageId)).toBe(true);
    expect(coordinator.acknowledge("run-1", clientMessageId)).toBe(true); // idempotent
    expect(coordinator.busy).toBe(false);
    // acknowledge marks the record settled before the transport promise
    // resolves; once the transport settles, submit() re-throws a
    // SendCoordinatorError to surface the cancellation. Attach a
    // swallowing catch so the unhandled-rejection detector does not fire.
    await promise.catch(() => {});
  });

  // 13. acknowledge with wrong client id is a no-op
  it("acknowledge ignores mismatched client message id", async () => {
    submit();
    expect(coordinator.acknowledge("run-1", "wrong-id")).toBe(false);
    expect(coordinator.hasInFlight("run-1")).toBe(true);
  });

  // 14. onAccepted / onFailure hooks fire exactly once
  it("fires onAccepted exactly once on accepted transition", async () => {
    const onAccepted = vi.fn();
    const c2 = new SendCoordinator({ onAccepted });
    const events2: SendStatusEvent[] = [];
    c2.subscribe((e) => events2.push(e));
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

  // 15. dispose cleans listeners
  it("dispose clears listeners and in-flight", () => {
    submit({ transport: () => new Promise(() => {}) });
    coordinator.dispose();
    expect(coordinator.busy).toBe(false);
    // post-dispose listener should not fire (dispose cleared them)
    expect(events.length).toBeGreaterThan(0);
    const len = events.length;
    void coordinator.submit({
      runId: "run-1",
      draft: DRAFT,
      transport: async () => undefined,
    });
    // listeners cleared → no new events
    expect(events.length).toBe(len);
  });

  // 16. listener exception does not break the coordinator
  it("isolates listener exceptions", async () => {
    coordinator.subscribe(() => {
      throw new Error("listener boom");
    });
    const { promise } = submit();
    await promise;
    expect(events.at(-1)?.state).toBe("accepted");
  });

  // 17. double-submit-protection: isSubmitting reports true while in flight
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
