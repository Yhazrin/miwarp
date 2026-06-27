/**
 * SplitPaneSessionAdapter — switchGeneration guard tests (P0-1).
 *
 * The adapter must discard post-await writes when the store-wide
 * `switchGeneration` has advanced. We mock `sessionStore.loadRun` and
 * `api.getRun` / `api.getBusEvents` to return controllable promises, then
 * bump switchGeneration mid-flight and assert the adapter does not write
 * to the pane.
 *
 * Note: this file tests the adapter's GENERATION GUARDS specifically. The
 * adapter is decoupled from `splitWorkspaceStore` (dependency injection), so
 * the tests construct a fake SessionStore / pane and pass an `AdapterCtx`
 * with the captured `switchGeneration` value directly.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { splitPaneSessionAdapter } from "./split-pane-session-adapter";
import type { PaneState } from "./split-workspace-store.svelte";
import type { SessionStore } from "$lib/stores/session-store.svelte";

vi.mock("$lib/api", () => ({
  getRun: vi.fn(),
  getBusEvents: vi.fn(),
}));

vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

import * as api from "$lib/api";

function makePane(overrides: Partial<PaneState> = {}): PaneState {
  return {
    paneId: "pane-test",
    runId: "run-test",
    loadState: "loading",
    runtimeState: "active",
    loadGeneration: 1,
    scrollState: { renderLimit: 200 },
    errorState: null,
    cachedSnapshot: null,
    ...overrides,
  };
}

interface Controllable<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function controllable<T>(): Controllable<T> {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeFakeSessionStore(
  opts: {
    loadRun?: Controllable<void>;
    buildSnapshot?: () => { timeline: never[]; tools: never[]; turnUsages: never[] };
  } = {},
): SessionStore {
  const ctl = opts.loadRun ?? controllable<void>();
  return {
    loadRun: vi.fn().mockReturnValue(ctl.promise),
    run: undefined,
    timeline: [],
    buildSnapshotFromEvents: vi
      .fn()
      .mockImplementation(
        opts.buildSnapshot ?? (() => ({ timeline: [], tools: [], turnUsages: [] })),
      ),
  } as unknown as SessionStore;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SplitPaneSessionAdapter — switchGeneration guards (P0-1)", () => {
  it("activate keeps pane ready when switchGeneration does NOT change", async () => {
    const pane = makePane();
    const ctl = controllable<void>();
    const store = makeFakeSessionStore({ loadRun: ctl });
    const ctx = { switchGeneration: 5 };

    const inflight = splitPaneSessionAdapter.activate(store, pane, ctx);
    ctl.resolve();
    await inflight;

    expect(pane.loadState).toBe("ready");
    expect(pane.errorState).toBeNull();
  });

  it("activate discards post-await write when switchGeneration advances", async () => {
    const pane = makePane();
    const ctl = controllable<void>();
    const store = makeFakeSessionStore({ loadRun: ctl });
    const ctx = { switchGeneration: 5 };

    const inflight = splitPaneSessionAdapter.activate(store, pane, ctx);
    // Simulate user switching panes while loadRun is in flight.
    ctx.switchGeneration = 6;
    ctl.resolve();
    await inflight;

    // Should NOT have flipped loadState to "ready" — the store's switchGen
    // already moved on, so the write is stale.
    expect(pane.loadState).toBe("loading");
    expect(pane.errorState).toBeNull();
  });

  it("activate still discards on error path when switchGeneration advances", async () => {
    const pane = makePane();
    const ctl = controllable<void>();
    const store = makeFakeSessionStore({ loadRun: ctl });
    const ctx = { switchGeneration: 5 };

    const inflight = splitPaneSessionAdapter.activate(store, pane, ctx);
    ctx.switchGeneration = 9;
    ctl.reject(new Error("network"));
    await inflight;

    expect(pane.loadState).toBe("loading");
    expect(pane.errorState).toBeNull();
  });

  it("fetchSnapshot discards when switchGeneration advances after getRun", async () => {
    const pane = makePane();
    const getRun = controllable<never>();
    const getEvents = controllable<never>();
    vi.mocked(api.getRun).mockReturnValue(getRun.promise as never);
    vi.mocked(api.getBusEvents).mockReturnValue(getEvents.promise as never);

    const ctx = { switchGeneration: 5 };
    const inflight = splitPaneSessionAdapter.fetchSnapshot(makeFakeSessionStore(), pane, ctx);
    ctx.switchGeneration = 7;
    getRun.resolve({} as never);
    getEvents.resolve([] as never);
    await inflight;

    expect(pane.cachedSnapshot).toBeNull();
    expect(pane.loadState).toBe("loading");
  });

  it("fetchSnapshot applies snapshot when both gen AND switchGeneration match", async () => {
    const pane = makePane();
    const fakeRun = { id: "run-test", status: "pending" } as never;
    const fakeEvents: never[] = [];
    vi.mocked(api.getRun).mockResolvedValue(fakeRun);
    vi.mocked(api.getBusEvents).mockResolvedValue(fakeEvents);

    const ctx = { switchGeneration: 5 };
    await splitPaneSessionAdapter.fetchSnapshot(makeFakeSessionStore(), pane, ctx);

    expect(pane.cachedSnapshot).not.toBeNull();
    expect(pane.loadState).toBe("ready");
  });
});
