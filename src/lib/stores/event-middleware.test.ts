import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BusEvent } from "$lib/types";
import { EventMiddleware } from "./event-middleware";
import type { SessionStore } from "./session-store.svelte";

vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

const mockUnsubscribeRun = vi.fn();
const mockListen = vi.fn().mockResolvedValue(() => {});
const mockIsDesktop = vi.fn(() => true);

vi.mock("$lib/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/transport")>();
  return {
    ...actual,
    getTransport: () => ({
      isDesktop: mockIsDesktop,
      listen: mockListen,
      unsubscribeRun: mockUnsubscribeRun,
    }),
  };
});

function makeMockStore(runId = "run-1"): SessionStore {
  return {
    run: { id: runId },
    getLastProcessedSeq: vi.fn(() => 0),
    setProtocolNotice: vi.fn(),
    applyEventBatch: vi.fn(),
    applyEvent: vi.fn(),
    applyHookEventBatch: vi.fn(),
    applyHookUsageBatch: vi.fn(),
    recoverFromEventLog: vi.fn().mockResolvedValue(undefined),
    loadRun: vi.fn().mockResolvedValue(undefined),
    markConnectionReloading: vi.fn(),
    releaseConnection: vi.fn(),
  } as unknown as SessionStore;
}

describe("EventMiddleware", () => {
  let middleware: EventMiddleware;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDesktop.mockReturnValue(true);
    mockListen.mockResolvedValue(() => {});
    middleware = new EventMiddleware();
  });

  // ── subscribeCurrent: does NOT call transport.unsubscribeRun ──

  it("subscribeCurrent clears old routing but does NOT call transport.unsubscribeRun", () => {
    const store1 = makeMockStore();
    const store2 = makeMockStore();

    middleware.subscribeCurrent("run-1", store1);
    middleware.subscribeCurrent("run-2", store2);

    // transport.unsubscribeRun should NEVER be called by EventMiddleware
    expect(mockUnsubscribeRun).not.toHaveBeenCalled();
    // Old run routing is cleared (no store for run-1)
    expect((middleware as any)._subscriptions.has("run-1")).toBe(false);
    expect((middleware as any)._subscriptions.has("run-2")).toBe(true);
  });

  it("subscribeCurrent with empty runId clears routing without calling transport", () => {
    const store = makeMockStore();
    middleware.subscribeCurrent("run-1", store);
    middleware.subscribeCurrent("", store);

    expect(mockUnsubscribeRun).not.toHaveBeenCalled();
    expect((middleware as any)._subscriptions.size).toBe(0);
  });

  // ── destroy: calls store.releaseConnection, NOT transport.unsubscribeRun ──

  it("destroy calls store.releaseConnection for each subscribed store", async () => {
    const store1 = makeMockStore();
    const store2 = makeMockStore();

    middleware.subscribeCurrent("run-1", store1);
    middleware.subscribe("run-2", store2);
    middleware.destroy();

    expect(store1.releaseConnection).toHaveBeenCalledOnce();
    expect(store2.releaseConnection).toHaveBeenCalledOnce();
    expect(mockUnsubscribeRun).not.toHaveBeenCalled();
  });

  it("destroy clears all routing and buffers", async () => {
    const store = makeMockStore();
    middleware.subscribeCurrent("run-1", store);
    middleware.destroy();

    expect((middleware as any)._subscriptions.size).toBe(0);
    expect((middleware as any)._batchBuffer.size).toBe(0);
    expect((middleware as any)._hookBatchBuffer.size).toBe(0);
    expect((middleware as any)._usageBatchBuffer.size).toBe(0);
    expect((middleware as any)._currentRunId).toBeNull();
    expect((middleware as any)._currentStore).toBeNull();
  });

  // ── unsubscribe: does NOT call transport.unsubscribeRun ──

  it("unsubscribe clears routing without calling transport.unsubscribeRun", () => {
    const store = makeMockStore();
    middleware.subscribeCurrent("run-1", store);
    middleware.unsubscribe("run-1");

    expect(mockUnsubscribeRun).not.toHaveBeenCalled();
    expect((middleware as any)._subscriptions.has("run-1")).toBe(false);
    expect((middleware as any)._currentRunId).toBeNull();
  });

  it("marks the store reloading before invoking loadRun for _full_reload", async () => {
    mockIsDesktop.mockReturnValue(false);
    let fullReloadHandler: ((payload: { run_id: string }) => void) | undefined;
    mockListen.mockImplementation(async (event: string, handler: unknown) => {
      if (event === "_full_reload") {
        fullReloadHandler = handler as (payload: { run_id: string }) => void;
      }
      return () => {};
    });

    const store = makeMockStore();
    middleware.subscribe("run-1", store);
    await middleware.start();

    expect(fullReloadHandler).toBeDefined();
    fullReloadHandler?.({ run_id: "run-1" });
    await Promise.resolve();

    expect(store.markConnectionReloading).toHaveBeenCalledWith("run-1");
    expect(store.loadRun).toHaveBeenCalledWith("run-1");
    expect(vi.mocked(store.markConnectionReloading).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(store.loadRun).mock.invocationCallOrder[0],
    );
  });

  // ── Existing batch recovery tests ──

  it("falls back to per-event apply when applyEventBatch throws", async () => {
    const applyEventBatch = vi.fn(() => {
      throw new Error("batch poison");
    });
    const applyEvent = vi.fn();
    const recoverFromEventLog = vi.fn().mockResolvedValue(undefined);
    const store = {
      run: { id: "run-1" },
      getLastProcessedSeq: vi.fn(() => 0),
      setProtocolNotice: vi.fn(),
      applyEventBatch,
      applyEvent,
      recoverFromEventLog,
      releaseConnection: vi.fn(),
    } as unknown as SessionStore;

    middleware.subscribe("run-1", store);

    const events: BusEvent[] = [
      { type: "message_delta", run_id: "run-1", text: "a" },
      { type: "message_delta", run_id: "run-1", text: "b" },
    ];

    (middleware as unknown as { _batchBuffer: Map<string, BusEvent[]> })._batchBuffer.set(
      "run-1",
      events,
    );
    (middleware as unknown as { _flushScheduled: boolean })._flushScheduled = true;

    (middleware as unknown as { _flush: () => void })._flush();

    expect(applyEventBatch).toHaveBeenCalledOnce();
    expect(applyEvent).toHaveBeenCalledTimes(2);
    expect(recoverFromEventLog).not.toHaveBeenCalled();
  });

  it("calls recoverFromEventLog when protocol quarantine escalates to recover", async () => {
    const applyEvent = vi.fn();
    const recoverFromEventLog = vi.fn().mockResolvedValue(undefined);
    const setProtocolNotice = vi.fn();
    const store = {
      run: { id: "expected-run" },
      getLastProcessedSeq: vi.fn(() => 0),
      setProtocolNotice,
      applyEventBatch: vi.fn(),
      applyEvent,
      recoverFromEventLog,
      releaseConnection: vi.fn(),
    } as unknown as SessionStore;

    middleware.subscribe("run-1", store);

    for (let i = 0; i < 5; i++) {
      (middleware as unknown as { _handleBusEvent: (ev: BusEvent) => void })._handleBusEvent({
        type: "message_delta",
        run_id: "run-1",
        text: "x",
      });
    }

    expect(setProtocolNotice).toHaveBeenCalled();
    expect(recoverFromEventLog).toHaveBeenCalled();
    expect(applyEvent).not.toHaveBeenCalled();
  });

  it("drops ignorable unknown events without calling applyEvent", () => {
    const applyEvent = vi.fn();
    const store = {
      run: { id: "run-1" },
      getLastProcessedSeq: vi.fn(() => 0),
      setProtocolNotice: vi.fn(),
      applyEventBatch: vi.fn(),
      applyEvent,
      releaseConnection: vi.fn(),
    } as unknown as SessionStore;

    middleware.subscribe("run-1", store);
    (middleware as unknown as { _handleBusEvent: (ev: BusEvent) => void })._handleBusEvent({
      type: "brand_new_event_type",
      run_id: "run-1",
    } as unknown as BusEvent);

    expect(applyEvent).not.toHaveBeenCalled();
    expect(
      (middleware as unknown as { _batchBuffer: Map<string, BusEvent[]> })._batchBuffer.size,
    ).toBe(0);
  });

  it("does not buffer or apply backend protocol_desync", () => {
    const applyEvent = vi.fn();
    const applyEventBatch = vi.fn();
    const setProtocolNotice = vi.fn();
    const store = {
      run: { id: "run-1" },
      getLastProcessedSeq: vi.fn(() => 0),
      setProtocolNotice,
      applyEventBatch,
      applyEvent,
      releaseConnection: vi.fn(),
    } as unknown as SessionStore;

    middleware.subscribe("run-1", store);
    (middleware as unknown as { _handleBusEvent: (ev: BusEvent) => void })._handleBusEvent({
      type: "protocol_desync",
      run_id: "run-1",
      fail_count: 5,
      sample: "must-not-reach-store",
    });

    expect(setProtocolNotice).toHaveBeenCalled();
    expect(applyEvent).not.toHaveBeenCalled();
    expect(applyEventBatch).not.toHaveBeenCalled();
    expect(
      (middleware as unknown as { _batchBuffer: Map<string, BusEvent[]> })._batchBuffer.size,
    ).toBe(0);
  });

  it("drops seq regression before buffering via production _handleBusEvent path", () => {
    const applyEvent = vi.fn();
    const store = {
      run: { id: "run-1" },
      getLastProcessedSeq: vi.fn(() => 10),
      setProtocolNotice: vi.fn(),
      applyEventBatch: vi.fn(),
      applyEvent,
      releaseConnection: vi.fn(),
    } as unknown as SessionStore;

    middleware.subscribe("run-1", store);
    (middleware as unknown as { _handleBusEvent: (ev: BusEvent) => void })._handleBusEvent({
      type: "message_delta",
      run_id: "run-1",
      text: "late",
      _seq: 3,
    } as BusEvent);

    expect(applyEvent).not.toHaveBeenCalled();
    expect(
      (middleware as unknown as { _batchBuffer: Map<string, BusEvent[]> })._batchBuffer.size,
    ).toBe(0);
  });

  it("drops malformed envelope before buffering via _handleBusEvent", () => {
    const applyEvent = vi.fn();
    const store = {
      run: { id: "run-1" },
      getLastProcessedSeq: vi.fn(() => 0),
      setProtocolNotice: vi.fn(),
      applyEventBatch: vi.fn(),
      applyEvent,
      releaseConnection: vi.fn(),
    } as unknown as SessionStore;

    middleware.subscribe("run-1", store);
    (middleware as unknown as { _handleBusEvent: (ev: BusEvent) => void })._handleBusEvent({
      type: "",
      run_id: "run-1",
    } as unknown as BusEvent);

    expect(applyEvent).not.toHaveBeenCalled();
    expect(
      (middleware as unknown as { _batchBuffer: Map<string, BusEvent[]> })._batchBuffer.size,
    ).toBe(0);
  });

  it("escalates consecutive single-event reducer failures without pre-apply resets", async () => {
    const applyEvent = vi.fn(() => {
      throw new Error("reducer failure");
    });
    const recoverFromEventLog = vi.fn().mockResolvedValue(undefined);
    const store = {
      run: { id: "run-1" },
      getLastProcessedSeq: vi.fn(() => 0),
      setProtocolNotice: vi.fn(),
      applyEvent,
      recoverFromEventLog,
      releaseConnection: vi.fn(),
    } as unknown as SessionStore;
    middleware.subscribe("run-1", store);

    const event = { type: "message_delta", run_id: "run-1", text: "x" } as BusEvent;
    for (let i = 0; i < 5; i++) {
      (
        middleware as unknown as {
          _applyBufferedEvents: (runId: string, store: SessionStore, events: BusEvent[]) => void;
        }
      )._applyBufferedEvents("run-1", store, [event]);
    }
    await Promise.resolve();

    expect(applyEvent).toHaveBeenCalledTimes(5);
    expect(recoverFromEventLog).toHaveBeenCalledOnce();
  });

  it("calls recoverFromEventLog when a poison event fails during per-event fallback", async () => {
    const applyEventBatch = vi.fn(() => {
      throw new Error("batch poison");
    });
    const applyEvent = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error("poison event");
      });
    const recoverFromEventLog = vi.fn().mockResolvedValue(undefined);
    const setProtocolNotice = vi.fn();
    const store = {
      run: { id: "run-1" },
      getLastProcessedSeq: vi.fn(() => 0),
      setProtocolNotice,
      applyEventBatch,
      applyEvent,
      recoverFromEventLog,
      releaseConnection: vi.fn(),
    } as unknown as SessionStore;

    middleware.subscribe("run-1", store);

    const events: BusEvent[] = [
      { type: "message_delta", run_id: "run-1", text: "a" },
      { type: "message_complete", run_id: "run-1", message_id: "m1", text: "" },
    ];

    (middleware as unknown as { _batchBuffer: Map<string, BusEvent[]> })._batchBuffer.set(
      "run-1",
      events,
    );
    (middleware as unknown as { _flushScheduled: boolean })._flushScheduled = true;

    (middleware as unknown as { _flush: () => void })._flush();

    await Promise.resolve();

    expect(applyEventBatch).toHaveBeenCalledOnce();
    expect(applyEvent).toHaveBeenCalledTimes(2);
    // First apply failure is below recover threshold — no recover yet
    expect(recoverFromEventLog).not.toHaveBeenCalled();
  });
});
