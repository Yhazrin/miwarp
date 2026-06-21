import { describe, it, expect, beforeEach } from "vitest";
import { PermissionCoordinator, PermissionError } from "./permission-coordinator";
import type { PermissionDecision, PermissionEvent } from "./permission-coordinator";

function makeTimers() {
  const timers = new Map<unknown, () => void>();
  return {
    setTimeout: (handler: () => void, _ms: number) => {
      const id = {};
      timers.set(id, handler);
      return id;
    },
    clearTimeout: (handle: unknown) => {
      timers.delete(handle);
    },
    fire(handle: unknown) {
      timers.get(handle)?.();
    },
    fireAll() {
      for (const handler of timers.values()) handler();
    },
    get size() {
      return timers.size;
    },
  };
}

function makeTransport(ok = true) {
  return () => (ok ? Promise.resolve() : Promise.reject(new Error("transport failed")));
}

const run1 = "run-aaa";
const run2 = "run-bbb";
const req1 = "req-001";
const req2 = "req-002";
const tool1 = "Bash";
const tool2 = "Write";

function register(
  coordinator: PermissionCoordinator,
  runId = run1,
  requestId = req1,
  toolName = tool1,
) {
  return coordinator.register({ runId, requestId, toolName, receivedAt: Date.now() });
}

function allowOnce(): PermissionDecision {
  return { kind: "allow-once" };
}

function deny(): PermissionDecision {
  return { kind: "deny" };
}

describe("PermissionCoordinator", () => {
  let timers: ReturnType<typeof makeTimers>;
  let coordinator: PermissionCoordinator;

  beforeEach(() => {
    timers = makeTimers();
    coordinator = new PermissionCoordinator({
      timers,
      submitTimeoutMs: 5000,
      maxRetryable: 4,
    });
  });

  // ── register ──

  it("register returns pending snapshot", () => {
    const snap = register(coordinator);
    expect(snap.state).toBe("pending");
    expect(snap.runId).toBe(run1);
    expect(snap.requestId).toBe(req1);
  });

  it("register is idempotent on same (runId, requestId)", () => {
    register(coordinator);
    const snap2 = register(coordinator);
    expect(snap2.state).toBe("pending");
    expect(coordinator.snapshot()).toHaveLength(1);
  });

  it("register with different requestId creates separate record", () => {
    register(coordinator, run1, req1);
    register(coordinator, run1, req2);
    expect(coordinator.snapshot()).toHaveLength(2);
  });

  // ── respond success ──

  it("respond resolves on transport ack (allow)", async () => {
    register(coordinator);
    await coordinator.respond({
      runId: run1,
      requestId: req1,
      toolName: tool1,
      decision: allowOnce(),
      transport: makeTransport(true),
    });
    // Resolved records are removed from inFlight
    expect(coordinator.inspect(run1, req1)).toBeNull();
  });

  it("respond resolves on transport ack (deny)", async () => {
    register(coordinator);
    await coordinator.respond({
      runId: run1,
      requestId: req1,
      toolName: tool1,
      decision: deny(),
      transport: makeTransport(true),
    });
    expect(coordinator.inspect(run1, req1)).toBeNull();
  });

  // ── double-click dedupe (same Promise) ──

  it("concurrent respond returns the same Promise instance", () => {
    register(coordinator);
    const p1 = coordinator.respond({
      runId: run1,
      requestId: req1,
      toolName: tool1,
      decision: allowOnce(),
      transport: makeTransport(true),
    });
    const p2 = coordinator.respond({
      runId: run1,
      requestId: req1,
      toolName: tool1,
      decision: allowOnce(),
      transport: makeTransport(true),
    });
    expect(p1).toBe(p2);
  });

  // ── transport failure ──

  it("transport failure transitions to failed with typed error", async () => {
    register(coordinator);
    const events: PermissionEvent[] = [];
    coordinator.subscribe((e) => events.push(e));

    await expect(
      coordinator.respond({
        runId: run1,
        requestId: req1,
        toolName: tool1,
        decision: allowOnce(),
        transport: makeTransport(false),
      }),
    ).rejects.toThrow(PermissionError);

    // Failed records stay in inFlight for UI projection
    const snap = coordinator.inspect(run1, req1);
    expect(snap?.state).toBe("failed");
    expect(snap?.failure?.code).toBe("transport");
    expect(snap?.failure?.retryable).toBe(true);
    expect(events.some((e) => e.state === "failed")).toBe(true);
  });

  // ── run identity guard ──
  // With composite keys, respond(run2, req1) auto-registers a new record
  // under run2:req1, so the old run1:req1 is untouched. The stale path
  // fires when reconcileActiveRun clears the old record first, then a
  // late respond() tries to use the now-stale record. That path is
  // covered by the reconcileActiveRun tests above.

  // ── reconcileActiveRun ──

  it("reconcileActiveRun stale-ifies requests for other runs", () => {
    register(coordinator, run1, req1);
    register(coordinator, run2, req2);
    const events: PermissionEvent[] = [];
    coordinator.subscribe((e) => events.push(e));

    const cancelled = coordinator.reconcileActiveRun(run1);
    expect(cancelled).toBe(1);
    expect(coordinator.inspect(run1, req1)?.state).toBe("pending");
    expect(coordinator.inspect(run2, req2)?.state).toBe("stale");
    expect(events.filter((e) => e.state === "stale")).toHaveLength(1);
  });

  // ── cancelForRun ──

  it("cancelForRun cancels all in-flight for a run", () => {
    register(coordinator, run1, req1);
    register(coordinator, run1, req2);
    const events: PermissionEvent[] = [];
    coordinator.subscribe((e) => events.push(e));

    const cancelled = coordinator.cancelForRun(run1, "Run stopped");
    expect(cancelled).toBe(2);
    expect(coordinator.inspect(run1, req1)?.state).toBe("cancelled");
    expect(coordinator.inspect(run1, req2)?.state).toBe("cancelled");
    expect(events.filter((e) => e.state === "cancelled")).toHaveLength(2);
  });

  // ── markCancelled ──

  it("markCancelled transitions to cancelled", () => {
    register(coordinator, run1, req1);
    const events: PermissionEvent[] = [];
    coordinator.subscribe((e) => events.push(e));

    const result = coordinator.markCancelled(run1, req1, "User cancelled");
    expect(result).toBe(true);
    expect(coordinator.inspect(run1, req1)?.state).toBe("cancelled");
    expect(events).toHaveLength(1);
    expect(events[0].state).toBe("cancelled");
  });

  it("markCancelled is idempotent on already-settled", () => {
    register(coordinator, run1, req1);
    coordinator.markCancelled(run1, req1, "first");
    const result = coordinator.markCancelled(run1, req1, "second");
    expect(result).toBe(false);
  });

  // ── bumpGeneration ──

  it("bumpGeneration stale-ifies old-generation requests", () => {
    coordinator.bumpGeneration(0);
    register(coordinator, run1, req1);
    const events: PermissionEvent[] = [];
    coordinator.subscribe((e) => events.push(e));

    coordinator.bumpGeneration(1);
    expect(coordinator.inspect(run1, req1)?.state).toBe("stale");
    expect(events.some((e) => e.state === "stale")).toBe(true);
  });

  // ── dispose ──

  it("dispose cancels all in-flight and disables new operations", () => {
    register(coordinator, run1, req1);
    const events: PermissionEvent[] = [];
    coordinator.subscribe((e) => events.push(e));

    coordinator.dispose();
    expect(events.some((e) => e.state === "cancelled")).toBe(true);

    const snap = coordinator.register({
      runId: run2,
      requestId: req2,
      toolName: tool2,
      receivedAt: Date.now(),
    });
    expect(snap.state).toBe("cancelled");
  });

  // ── sweepTerminal ──

  it("sweepTerminal removes excess settled records", () => {
    for (let i = 0; i < 40; i++) {
      coordinator.register({
        runId: run1,
        requestId: `req-${i}`,
        toolName: tool1,
        receivedAt: Date.now(),
      });
      coordinator.markCancelled(run1, `req-${i}`, "test");
    }
    const swept = coordinator.sweepTerminal();
    expect(swept).toBeGreaterThan(0);
    expect(coordinator.snapshot().length).toBeLessThanOrEqual(32);
  });

  // ── snapshot ──

  it("snapshot returns all tracked records", () => {
    register(coordinator, run1, req1);
    register(coordinator, run1, req2);
    const snaps = coordinator.snapshot();
    expect(snaps).toHaveLength(2);
  });

  // ── hasPending ──

  it("hasPending returns true when unsettled records exist", () => {
    expect(coordinator.hasPending(run1)).toBe(false);
    register(coordinator, run1, req1);
    expect(coordinator.hasPending(run1)).toBe(true);
    expect(coordinator.hasPending(run2)).toBe(false);
  });

  // ── isSubmitting ──

  it("isSubmitting reflects submitting state", () => {
    register(coordinator, run1, req1);
    expect(coordinator.isSubmitting(run1, req1)).toBe(false);
    coordinator.respond({
      runId: run1,
      requestId: req1,
      toolName: tool1,
      decision: allowOnce(),
      transport: () => new Promise(() => {}),
    });
    expect(coordinator.isSubmitting(run1, req1)).toBe(true);
  });

  // ── subscribe / unsubscribe ──

  it("subscribe receives events; unsubscribe stops them", () => {
    const events: PermissionEvent[] = [];
    const unsub = coordinator.subscribe((e) => events.push(e));
    register(coordinator, run1, req1);
    coordinator.markCancelled(run1, req1, "test");
    expect(events).toHaveLength(1);
    unsub();
    register(coordinator, run1, req2);
    coordinator.markCancelled(run1, req2, "test");
    expect(events).toHaveLength(1);
  });

  // ── composite key isolation ──

  it("same requestId in different runs are independent", () => {
    register(coordinator, run1, req1);
    register(coordinator, run2, req1);
    expect(coordinator.snapshot()).toHaveLength(2);

    const events: PermissionEvent[] = [];
    coordinator.subscribe((e) => events.push(e));
    coordinator.markCancelled(run1, req1, "cancel run1");
    expect(coordinator.inspect(run1, req1)?.state).toBe("cancelled");
    expect(coordinator.inspect(run2, req1)?.state).toBe("pending");
    expect(events.filter((e) => e.state === "cancelled")).toHaveLength(1);
  });

  // ── auto-register on respond ──

  it("respond auto-registers if not previously registered", async () => {
    await coordinator.respond({
      runId: run1,
      requestId: req1,
      toolName: tool1,
      decision: allowOnce(),
      transport: makeTransport(true),
    });
    expect(coordinator.inspect(run1, req1)).toBeNull();
  });

  // ── timeout ──

  it("submit timeout transitions to failed", async () => {
    register(coordinator, run1, req1);
    const events: PermissionEvent[] = [];
    coordinator.subscribe((e) => events.push(e));

    const p = coordinator.respond({
      runId: run1,
      requestId: req1,
      toolName: tool1,
      decision: allowOnce(),
      transport: () => new Promise(() => {}),
    });
    timers.fireAll();
    await expect(p).rejects.toThrow("timed out");
    expect(coordinator.inspect(run1, req1)?.state).toBe("failed");
    expect(coordinator.inspect(run1, req1)?.failure?.code).toBe("timeout");
  });

  // ── replay ──

  it("replay re-emits current state to listeners", () => {
    register(coordinator, run1, req1);
    const events: PermissionEvent[] = [];
    coordinator.subscribe((e) => events.push(e));
    coordinator.replay(run1, req1);
    expect(events).toHaveLength(1);
    expect(events[0].state).toBe("pending");
  });

  // ── isTerminal ──

  it("isTerminal returns true for cancelled requests", () => {
    register(coordinator, run1, req1);
    expect(coordinator.isTerminal(run1, req1)).toBe(false);
    coordinator.markCancelled(run1, req1, "test");
    expect(coordinator.isTerminal(run1, req1)).toBe(true);
  });
});
