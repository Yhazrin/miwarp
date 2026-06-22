/**
 * Failure-injection tests for SessionStore async load / resume / switch / unmount.
 * Verifies SessionAsyncLifecycleCoordinator guards prevent stale async writes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BusEvent } from "$lib/types";
import simpleChatEvents from "$lib/stores/__fixtures__/simple-chat.json";

vi.mock("$lib/api", () => ({
  getRun: vi.fn(),
  getBusEvents: vi.fn(),
  getRunEvents: vi.fn(),
  getSessionRuntimeStatus: vi.fn().mockResolvedValue({ actor_alive: true }),
  startRun: vi.fn(),
  startSession: vi.fn().mockResolvedValue(undefined),
  sendSessionMessage: vi.fn(),
  sendChatMessage: vi.fn(),
  stopSession: vi.fn(),
  stopRun: vi.fn(),
  sendSessionControl: vi.fn(),
  syncCliSession: vi.fn().mockResolvedValue({ newEvents: 0 }),
  forkSession: vi.fn(),
}));

vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

vi.mock("$lib/utils/snapshot-cache", () => ({
  readSnapshot: vi.fn().mockResolvedValue(null),
  writeSnapshot: vi.fn().mockResolvedValue(undefined),
  deleteSnapshot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("$lib/stores/cli-info.svelte", () => ({
  getCliCommands: vi.fn().mockReturnValue([]),
  updateInstalledVersion: vi.fn(),
}));

vi.mock("$lib/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/transport")>();
  return {
    ...actual,
    getTransport: vi.fn(() => ({
      invoke: vi.fn(),
      listen: vi.fn(),
      isDesktop: () => true,
      subscribeRun: vi.fn(),
      unsubscribeRun: vi.fn(),
      getConnectionState: vi.fn(() => "open"),
      onConnectionStateChange: vi.fn(() => () => {}),
      dispose: vi.fn(),
    })),
    _resetTransport: vi.fn(),
  };
});

import { SessionStore } from "$lib/stores/session-store.svelte";
import * as api from "$lib/api";

function makeRun(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    prompt: "test",
    cwd: "/",
    agent: "claude",
    auth_mode: "cli",
    status: "completed" as const,
    started_at: new Date().toISOString(),
    execution_path: "session_actor" as const,
    session_id: "sess-1",
    ...overrides,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("SessionStore async lifecycle (failure injection)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.getBusEvents).mockResolvedValue(simpleChatEvents as BusEvent[]);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("loadRun: later load wins when first getRun completes late (后发先至)", async () => {
    const runA = makeRun("run-a", { status: "completed" });
    const runB = makeRun("run-b", { status: "completed" });
    const runADeferred = deferred<ReturnType<typeof makeRun>>();

    vi.mocked(api.getRun).mockImplementation((id: string) => {
      if (id === "run-a") return runADeferred.promise;
      return Promise.resolve(runB);
    });

    const store = new SessionStore();
    const loadA = store.loadRun("run-a");
    const loadB = store.loadRun("run-b");
    await loadB;

    expect(store.run?.id).toBe("run-b");
    expect(store.timeline.length).toBeGreaterThan(0);

    runADeferred.resolve(runA);
    await loadA;

    expect(store.run?.id).toBe("run-b");
    expect(store.timeline.length).toBeGreaterThan(0);
    warnSpy.mockClear();
  });

  it("loadRun: stale replay from prior run does not overwrite after switch", async () => {
    const runA = makeRun("run-a", { status: "completed" });
    const runB = makeRun("run-b", { status: "completed" });
    const eventsDeferred = deferred<BusEvent[]>();

    vi.mocked(api.getRun).mockImplementation((id: string) => {
      if (id === "run-a") return Promise.resolve(runA);
      return Promise.resolve(runB);
    });
    vi.mocked(api.getBusEvents).mockImplementation((id: string) => {
      if (id === "run-a") return eventsDeferred.promise;
      return Promise.resolve(simpleChatEvents as BusEvent[]);
    });

    const store = new SessionStore();
    const loadA = store.loadRun("run-a");
    const loadB = store.loadRun("run-b");
    await loadB;
    const timelineAfterB = [...store.timeline];

    eventsDeferred.resolve(simpleChatEvents as BusEvent[]);
    await loadA;

    expect(store.run?.id).toBe("run-b");
    expect(store.timeline).toEqual(timelineAfterB);
    warnSpy.mockClear();
  });

  it("resumeSession vs loadRun: loadRun invalidates in-flight resume replay", async () => {
    const run = makeRun("run-resume", { status: "completed" });
    const getRunDeferred = deferred<ReturnType<typeof makeRun>>();

    vi.mocked(api.getRun).mockImplementation((id: string) => {
      if (id === "run-resume") return getRunDeferred.promise;
      return Promise.resolve(makeRun(id, { status: "completed" }));
    });

    const store = new SessionStore();
    const resumeP = store.resumeSession("run-resume", "resume");
    expect(store.resumeInFlight).toBe(true);

    const loadP = store.loadRun("run-other");
    getRunDeferred.resolve(run);
    await resumeP;
    await loadP;

    expect(store.run?.id).toBe("run-other");
    expect(store.resumeInFlight).toBe(false);
    warnSpy.mockClear();
  });

  it("unmountGuards: late loadRun does not mutate store after teardown", async () => {
    const run = makeRun("run-unmount", { status: "completed" });
    const getRunDeferred = deferred<ReturnType<typeof makeRun>>();

    vi.mocked(api.getRun).mockImplementation(() => getRunDeferred.promise);

    const store = new SessionStore();
    store.run = makeRun("run-initial", { status: "idle" });
    store.phase = "idle";
    const runIdBefore = store.run.id;

    const loadP = store.loadRun("run-unmount");
    store.unmountGuards();
    getRunDeferred.resolve(run);
    await loadP;

    expect(store.run?.id).toBe(runIdBefore);
    expect(store.phase).toBe("loading");
    warnSpy.mockClear();
  });

  it("unmountGuards rejects new loadRun operations without mutating state", async () => {
    const store = new SessionStore();
    store.run = makeRun("run-before-unmount", { status: "idle" });
    store.phase = "idle";
    store.unmountGuards();

    await store.loadRun("run-after-unmount");

    expect(api.getRun).not.toHaveBeenCalled();
    expect(store.run?.id).toBe("run-before-unmount");
    expect(store.phase).toBe("idle");
  });

  it("recoverFromEventLog after run switch does not reload superseded run", async () => {
    const runA = makeRun("run-rec-a", { status: "completed" });
    const runB = makeRun("run-rec-b", { status: "completed" });
    const deleteDeferred = deferred<void>();

    vi.mocked(api.getRun).mockImplementation((id: string) => {
      return Promise.resolve(id === "run-rec-a" ? runA : runB);
    });

    const snapshotCache = await import("$lib/utils/snapshot-cache");
    vi.mocked(snapshotCache.deleteSnapshot).mockImplementation(() => deleteDeferred.promise);

    const store = new SessionStore();
    await store.loadRun("run-rec-a");
    expect(store.run?.id).toBe("run-rec-a");

    const recoverP = store.recoverFromEventLog("test recovery");
    await store.loadRun("run-rec-b");
    expect(store.run?.id).toBe("run-rec-b");
    const timelineAfterB = [...store.timeline];

    deleteDeferred.resolve();
    await recoverP;

    expect(store.run?.id).toBe("run-rec-b");
    expect(store.timeline).toEqual(timelineAfterB);
    warnSpy.mockClear();
  });
});
