import { beforeEach, describe, expect, it, vi } from "vitest";

// jsdom-style window for subscribeToBusEvents(). Vitest is configured with
// the node environment; we provide a minimal shim that records listeners
// so we can verify both registrations.
type Listener = (event: Event) => void;
const windowListeners: Map<string, Set<Listener>> = new Map();
const windowStub = {
  addEventListener: (name: string, listener: Listener) => {
    if (!windowListeners.has(name)) windowListeners.set(name, new Set());
    windowListeners.get(name)!.add(listener);
  },
  removeEventListener: (name: string, listener: Listener) => {
    windowListeners.get(name)?.delete(listener);
  },
  dispatchEvent: () => true,
} as unknown as Window & typeof globalThis;

(globalThis as Record<string, unknown>).window = windowStub;

const { listRunsLiteMock, listRunsMock, getTransportListenMock } = vi.hoisted(() => ({
  listRunsLiteMock: vi.fn(),
  listRunsMock: vi.fn(),
  getTransportListenMock: vi.fn(),
}));

vi.mock("$lib/api", () => ({
  listRunsLite: listRunsLiteMock,
  listRuns: listRunsMock,
}));

vi.mock("$lib/transport", async () => {
  const actual = await vi.importActual<typeof import("$lib/transport")>("$lib/transport");
  return {
    ...actual,
    getTransport: () => ({ listen: getTransportListenMock }),
  };
});

vi.mock("./workbench-session-controller", async () => {
  const actual = await vi.importActual<typeof import("./workbench-session-controller")>(
    "./workbench-session-controller",
  );
  return {
    ...actual,
    workbenchSessionController: {
      generation: 0,
      lastResult: null,
      selectProject: vi.fn(async () => ({
        projectId: "cwd:/a",
        activeRunId: "run-desk-a",
        generation: 1,
        switchedSubscription: false,
        releasedOwner: false,
      })),
      releaseSessionOwnership: vi.fn(async () => true),
      swapSessionOwnership: vi.fn(async () => false),
    },
  };
});

const baseRun = (over: Partial<import("$lib/types").TaskRun> = {}) =>
  ({
    id: "run-1",
    prompt: "p",
    cwd: "/a",
    parent_cwd: "/a",
    agent: "claude",
    status: "running",
    started_at: "2024-01-01T00:00:00.000Z",
    last_activity_at: "2024-01-02T00:00:00.000Z",
    run_surface: "project_desk",
    ...over,
  }) as import("$lib/types").TaskRun;

describe("WorkbenchStore — Commit 1 (P0-3 + P0-5 + controller wiring)", () => {
  beforeEach(() => {
    listRunsLiteMock.mockReset();
    listRunsMock.mockReset();
    getTransportListenMock.mockReset();
  });

  it("P0-5: drops the result of a stale refresh() when a newer refresh starts", async () => {
    // Refresh now prefers listRuns(); mock both so the test stays stable
    // if the preference flips back during a future refactor.
    listRunsMock
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve([baseRun()]), 40)),
      )
      .mockImplementationOnce(() =>
        Promise.resolve([baseRun({ last_activity_at: "2024-02-01T00:00:00.000Z" })]),
      );
    listRunsLiteMock.mockResolvedValue([baseRun()]);

    const mod = await import("./workbench-store.svelte");
    const store = new mod.WorkbenchStoreClass();

    const first = store.refresh([], undefined);
    // Schedule a second refresh before the first resolves.
    const second = store.refresh([], undefined);
    await Promise.all([first, second]);

    // The second refresh wins → runs reflect the second IPC result.
    expect(store.allRuns).toHaveLength(1);
    expect(store.allRuns[0].last_activity_at).toBe("2024-02-01T00:00:00.000Z");
  });

  it("P0-3: subscribeToBusEvents registers both transport + window listeners exactly once", async () => {
    getTransportListenMock.mockResolvedValue(() => undefined);
    const mod = await import("./workbench-store.svelte");
    const store = new mod.WorkbenchStoreClass();

    windowListeners.clear();
    await store.subscribeToBusEvents();
    await store.subscribeToBusEvents(); // idempotent

    expect(getTransportListenMock).toHaveBeenCalledTimes(1);
    expect(windowListeners.get("ocv:runs-changed")?.size).toBe(1);
  });

  it("P0-3: unsubscribeFromBusEvents reverses both subscriptions", async () => {
    const unlisten = vi.fn();
    getTransportListenMock.mockResolvedValue(unlisten);
    const mod = await import("./workbench-store.svelte");
    const store = new mod.WorkbenchStoreClass();

    windowListeners.clear();
    await store.subscribeToBusEvents();
    store.unsubscribeFromBusEvents();

    expect(unlisten).toHaveBeenCalled();
    expect(windowListeners.get("ocv:runs-changed")?.size ?? 0).toBe(0);
  });

  it("P0-1: selectProject delegates to the shared controller", async () => {
    listRunsMock.mockResolvedValue([baseRun()]);
    listRunsLiteMock.mockResolvedValue([baseRun()]);
    const mod = await import("./workbench-store.svelte");
    const store = new mod.WorkbenchStoreClass();
    await store.refresh([], undefined);

    const ctrl = await import("./workbench-session-controller");
    await store.selectProject("cwd:/a");
    expect(ctrl.workbenchSessionController.selectProject).toHaveBeenCalled();
  });

  it("P1-11: refresh prefers listRuns() over listRunsLite() so message_count / last_activity_at are accurate", async () => {
    listRunsMock.mockResolvedValue([
      baseRun({
        last_activity_at: "2024-03-01T00:00:00.000Z",
        message_count: 42,
        last_message_preview: "hello world",
      }),
    ]);
    listRunsLiteMock.mockResolvedValue([baseRun()]); // would be missing fields
    const mod = await import("./workbench-store.svelte");
    const store = new mod.WorkbenchStoreClass();
    await store.refresh([], undefined);

    expect(listRunsMock).toHaveBeenCalledTimes(1);
    expect(listRunsLiteMock).not.toHaveBeenCalled();
    expect(store.allRuns[0].message_count).toBe(42);
    expect(store.allRuns[0].last_activity_at).toBe("2024-03-01T00:00:00.000Z");
    expect(store.allRuns[0].last_message_preview).toBe("hello world");
  });

  it("P1-11: falls back to listRunsLite() when listRuns() throws", async () => {
    listRunsMock.mockRejectedValue(new Error("boom"));
    listRunsLiteMock.mockResolvedValue([baseRun()]);
    const mod = await import("./workbench-store.svelte");
    const store = new mod.WorkbenchStoreClass();
    await store.refresh([], undefined);

    expect(listRunsMock).toHaveBeenCalledTimes(1);
    expect(listRunsLiteMock).toHaveBeenCalledTimes(1);
    expect(store.allRuns).toHaveLength(1);
    // Lite runs have None last_activity_at / message_count; we accept the
    // degraded shape rather than crashing the workbench.
    expect(store.allRuns[0].message_count).toBeUndefined();
  });
});
