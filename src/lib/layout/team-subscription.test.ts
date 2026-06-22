/**
 * Black-box tests for `createTeamSubscription` — verifies the single-flight
 * contract that the layout depends on:
 *
 *   1. Constructing a subscription wires up the team/task listeners + the
 *      fallback poll.
 *   2. `dispose()` is idempotent and tears down every registration it made
 *      (listeners, poll, in-flight retry timers, pending resync debounce).
 *   3. Two concurrent subscriptions each get their own listeners — no global
 *      counter that would cause one dispose() to nuke both.
 *   4. The poll respects `shouldPoll` so a route-conditional caller can
 *      keep the timer alive but suppress IPC until the relevant page is
 *      active.
 *   5. Listener handlers route payloads into the right store callbacks
 *      (handleTeamUpdate vs handleTaskUpdate), so a misrouted payload can't
 *      silently corrupt UI state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listenMock, getTransportMock } = vi.hoisted(() => ({
  listenMock: vi.fn(),
  getTransportMock: vi.fn(() => ({ listen: listenMock })),
}));

vi.mock("$lib/transport", () => ({
  getTransport: getTransportMock,
}));

vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

// Imports come after vi.mock so the mock factory is hoisted first.
import { createTeamSubscription } from "./team-subscription.svelte";

type ListenCall = {
  name: string;
  handler: (payload: unknown) => void;
  resolve: (fn: () => void) => void;
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeStore() {
  return {
    loadTeams: vi.fn().mockResolvedValue(undefined),
    forceRefresh: vi.fn().mockResolvedValue(undefined),
    handleTeamUpdate: vi.fn(),
    handleTaskUpdate: vi.fn(),
  };
}

function primeListenListener(): {
  calls: ListenCall[];
  resolveAll: () => void;
  rejectAll: (err: unknown) => void;
} {
  const calls: ListenCall[] = [];
  const pending: Array<ReturnType<typeof deferred<() => void>>> = [];
  listenMock.mockImplementation((name: string, handler: (payload: unknown) => void) => {
    const d = deferred<() => void>();
    calls.push({ name, handler, resolve: d.resolve });
    pending.push(d);
    return d.promise;
  });
  return {
    calls,
    resolveAll: () => pending.forEach((p) => p.resolve(() => {})),
    rejectAll: (err: unknown) => pending.forEach((p) => p.reject(err)),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  listenMock.mockReset();
  getTransportMock.mockClear();
  // The subscription guards on `typeof document !== "undefined"`, so we
  // install a minimal stub for the visibilityState read.
  (globalThis as { document?: unknown }).document = { visibilityState: "visible" };
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { document?: unknown }).document;
});

describe("createTeamSubscription", () => {
  it("wires up the team-update, task-update, and initial loadTeams call on construct", () => {
    primeListenListener();
    const store = makeStore();

    createTeamSubscription(store, () => true);

    expect(store.loadTeams).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledTimes(2);
    expect(listenMock.mock.calls[0][0]).toBe("team-update");
    expect(listenMock.mock.calls[1][0]).toBe("task-update");
  });

  it("routes a team-update payload to handleTeamUpdate (not handleTaskUpdate)", () => {
    const primed = primeListenListener();
    const store = makeStore();

    createTeamSubscription(store, () => true);
    primed.resolveAll();
    const teamHandler = primed.calls.find((c) => c.name === "team-update")!.handler;
    const taskHandler = primed.calls.find((c) => c.name === "task-update")!.handler;

    teamHandler({ team_name: "alpha", change: "task_added" });
    taskHandler({ team_name: "alpha", task_id: "t1", change: "completed" });

    expect(store.handleTeamUpdate).toHaveBeenCalledWith({
      team_name: "alpha",
      change: "task_added",
    });
    expect(store.handleTaskUpdate).toHaveBeenCalledWith({
      team_name: "alpha",
      task_id: "t1",
      change: "completed",
    });
    expect(store.handleTeamUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ task_id: expect.anything() }),
    );
    expect(store.handleTaskUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ change: "task_added" }),
    );
  });

  it("poll callback is a no-op while shouldPoll() returns false", () => {
    primeListenListener();
    const store = makeStore();
    let polled = false;
    createTeamSubscription(store, () => polled);
    const callsAfterConstruct = store.loadTeams.mock.calls.length;

    vi.advanceTimersByTime(60_000);
    expect(store.loadTeams).toHaveBeenCalledTimes(callsAfterConstruct);

    polled = true;
    vi.advanceTimersByTime(60_000);
    expect(store.loadTeams).toHaveBeenCalledTimes(callsAfterConstruct + 1);
  });

  it("dispose() tears down listeners, poll, and any pending retry timers", async () => {
    const registered: Array<() => void> = [];
    listenMock.mockImplementation(() => {
      const unlisten = vi.fn();
      registered.push(unlisten);
      return Promise.resolve(unlisten);
    });
    const store = makeStore();
    const sub = createTeamSubscription(store, () => true);
    // Drain microtasks so the listen .then callback runs while the
    // subscription is still alive — the unlisten fn must be stored on the
    // subscription, not invoked immediately (that's what we want to test).
    await Promise.resolve();
    await Promise.resolve();
    expect(registered).toHaveLength(2);

    sub.dispose();
    registered.forEach((u) => expect(u).toHaveBeenCalledTimes(1));

    // The poll must be cleared — advancing the clock must not re-fire loadTeams.
    const callsAfterDispose = store.loadTeams.mock.calls.length;
    vi.advanceTimersByTime(120_000);
    expect(store.loadTeams).toHaveBeenCalledTimes(callsAfterDispose);
  });

  it("dispose() is idempotent and never throws when called twice", () => {
    primeListenListener();
    const store = makeStore();
    const sub = createTeamSubscription(store, () => true);

    expect(() => {
      sub.dispose();
      sub.dispose();
    }).not.toThrow();
  });

  it("concurrent subscriptions each get their own listener unlistens", async () => {
    const unlistenA1 = vi.fn();
    const unlistenA2 = vi.fn();
    const unlistenB1 = vi.fn();
    const unlistenB2 = vi.fn();
    // Order matches the factory: each subscription registers team-update
    // first, then task-update.
    const calls: Array<() => void> = [unlistenA1, unlistenA2, unlistenB1, unlistenB2];
    let i = 0;
    listenMock.mockImplementation(() => Promise.resolve(calls[i++]));

    const subA = createTeamSubscription(makeStore(), () => true);
    const subB = createTeamSubscription(makeStore(), () => true);
    // Let the listen .then callbacks assign the unlistens to their owning
    // subscription before we dispose.
    await Promise.resolve();
    await Promise.resolve();

    subA.dispose();
    expect(unlistenA1).toHaveBeenCalledTimes(1);
    expect(unlistenA2).toHaveBeenCalledTimes(1);
    expect(unlistenB1).not.toHaveBeenCalled();
    expect(unlistenB2).not.toHaveBeenCalled();

    subB.dispose();
    expect(unlistenB1).toHaveBeenCalledTimes(1);
    expect(unlistenB2).toHaveBeenCalledTimes(1);
  });

  it("listen failure after max attempts does not throw — falls back to poll", async () => {
    const err = new Error("ws closed");
    listenMock.mockImplementation(() => Promise.reject(err));
    const store = makeStore();
    expect(() => {
      createTeamSubscription(store, () => true);
    }).not.toThrow();

    // Drain the microtask queue so the listen rejections flush and the
    // retry timers get scheduled. Then advance time past the retry budget
    // (2s + 4s = 6s) so all retry attempts are exhausted.
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(10_000);
    await Promise.resolve();
    await Promise.resolve();

    // The poll is the safety net — it must still fire on schedule.
    const before = store.loadTeams.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    expect(store.loadTeams.mock.calls.length).toBeGreaterThan(before);
  });

  it("does not double-register listeners when reused after dispose()", async () => {
    const unlisten = vi.fn();
    listenMock.mockImplementation(() => Promise.resolve(unlisten));
    const store = makeStore();

    const sub1 = createTeamSubscription(store, () => true);
    expect(listenMock).toHaveBeenCalledTimes(2);
    sub1.dispose();
    // Drain the microtask queue so the listen .then callbacks run; the
    // factory will call the unlisten immediately because destroyed is now
    // true.
    await Promise.resolve();
    await Promise.resolve();

    const sub2 = createTeamSubscription(store, () => true);
    expect(listenMock).toHaveBeenCalledTimes(4);
    sub2.dispose();
    await Promise.resolve();
    await Promise.resolve();
    // Each subscription's dispose() invokes the unlisten twice (once per
    // listener) — total of 4 across both subscriptions.
    expect(unlisten).toHaveBeenCalledTimes(4);
  });
});
