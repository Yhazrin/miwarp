import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BusEvent } from "$lib/types";
import { EventMiddleware } from "./event-middleware";
import type { SessionStore } from "./session-store.svelte";

vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

vi.mock("$lib/transport", () => ({
  getTransport: () => ({
    isDesktop: () => true,
    listen: vi.fn().mockResolvedValue(() => {}),
    unsubscribeRun: vi.fn(),
  }),
}));

describe("EventMiddleware batch recovery", () => {
  let middleware: EventMiddleware;

  beforeEach(() => {
    middleware = new EventMiddleware();
  });

  it("falls back to per-event apply when applyEventBatch throws", async () => {
    const applyEventBatch = vi.fn(() => {
      throw new Error("batch poison");
    });
    const applyEvent = vi.fn();
    const recoverFromEventLog = vi.fn().mockResolvedValue(undefined);
    const store = {
      applyEventBatch,
      applyEvent,
      recoverFromEventLog,
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
    const store = {
      applyEventBatch,
      applyEvent,
      recoverFromEventLog,
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
    expect(recoverFromEventLog).toHaveBeenCalledOnce();
  });
});
