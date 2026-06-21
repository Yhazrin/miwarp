import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WsTransport } from "./websocket";
import { ConnectionState } from "./connection-state";

vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

// --- Fake WebSocket ---
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  private sent: string[] = [];

  constructor(url: string) {
    this.url = url;
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(_code?: number, _reason?: string) {
    this.readyState = FakeWebSocket.CLOSED;
  }

  simulateOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  simulateClose(code = 1000, reason = "") {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }

  simulateError() {
    this.onerror?.(new Event("error"));
  }

  simulateMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }

  getSent() {
    return [...this.sent];
  }

  clearSent() {
    this.sent = [];
  }

  lastSentParsed() {
    const s = this.sent[this.sent.length - 1];
    return s ? JSON.parse(s) : null;
  }
}

// --- Fake timers ---
function createFakeTimers() {
  const timers = new Map<number, { fn: () => void; ms: number; triggerAt: number }>();
  let nextId = 1;
  let currentTime = 0;

  const processDue = () => {
    let safety = 200;
    while (safety-- > 0) {
      const due = Array.from(timers.entries())
        .filter(([, t]) => t.triggerAt <= currentTime)
        .sort((a, b) => a[1].triggerAt - b[1].triggerAt);
      if (due.length === 0) break;
      for (const [id, t] of due) {
        timers.delete(id);
        t.fn();
      }
    }
  };

  return {
    timers: {
      setTimeout: (fn: () => void, ms: number) => {
        const id = nextId++;
        timers.set(id, { fn, ms, triggerAt: currentTime + ms });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: (id: ReturnType<typeof setTimeout>) => {
        timers.delete(id as unknown as number);
      },
      setInterval: (fn: () => void, ms: number) => {
        const id = nextId++;
        timers.set(id, { fn, ms, triggerAt: currentTime + ms });
        return id as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: (id: ReturnType<typeof setInterval>) => {
        timers.delete(id as unknown as number);
      },
    },
    advanceBy: (ms: number) => {
      currentTime += ms;
      processDue();
    },
    current: () => currentTime,
  };
}

/** Flush microtask queue so async invoke() can proceed past awaits */
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function makeTransport() {
  const ft = createFakeTimers();
  let currentWs: FakeWebSocket | null = null;
  const allWs: FakeWebSocket[] = [];

  const transport = new WsTransport({
    wsFactory: (url) => {
      const ws = new FakeWebSocket(url);
      currentWs = ws;
      allWs.push(ws);
      return ws as unknown as WebSocket;
    },
    timers: ft.timers,
  });

  return {
    transport,
    ft,
    get ws() {
      return currentWs!;
    },
    allWs,
  };
}

/**
 * Helper: connect and complete one round-trip so the transport is fully
 * established (state Open, ws open, no pending requests).
 */
async function boot(t: ReturnType<typeof makeTransport>) {
  const p = t.transport.invoke("boot");
  t.ws.simulateOpen();
  await flush();
  const sent = t.ws.lastSentParsed();
  expect(sent).not.toBeNull();
  t.ws.simulateMessage(JSON.stringify({ id: sent.id, result: "ok" }));
  await p;
  // Clear any resubscribe messages
  t.ws.clearSent();
}

describe("WsTransport", () => {
  let t: ReturnType<typeof makeTransport>;

  beforeEach(() => {
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "localhost:3000" },
    });
    t = makeTransport();
  });

  afterEach(() => {
    try {
      t.transport.dispose();
    } catch {
      /* already disposed */
    }
    vi.restoreAllMocks();
  });

  // --- Connection lifecycle ---

  it("successful connection: idle → connecting → open", async () => {
    const p = t.transport.invoke("ping");
    t.ws.simulateOpen();
    await flush();

    const sent = t.ws.lastSentParsed();
    expect(sent).not.toBeNull();
    expect(sent.method).toBe("ping");

    t.ws.simulateMessage(JSON.stringify({ id: sent.id, result: "pong" }));
    expect(await p).toBe("pong");
    expect(t.transport.connectionState).toBe(ConnectionState.Open);
  });

  it("exposes connection health through the Transport contract", async () => {
    const transitions: Array<[string, string]> = [];
    const unsubscribe = t.transport.onConnectionStateChange((state, previous) => {
      transitions.push([previous, state]);
    });

    const request = t.transport.invoke("ping");
    expect(t.transport.getConnectionState()).toBe(ConnectionState.Connecting);
    t.ws.simulateOpen();
    await flush();
    expect(t.transport.getConnectionState()).toBe(ConnectionState.Open);

    const sent = t.ws.lastSentParsed();
    t.ws.simulateMessage(JSON.stringify({ id: sent.id, result: "pong" }));
    await request;

    expect(transitions).toContainEqual([ConnectionState.Idle, ConnectionState.Connecting]);
    expect(transitions).toContainEqual([ConnectionState.Connecting, ConnectionState.Open]);

    unsubscribe();
    transitions.length = 0;
    t.ws.simulateClose(1006);
    expect(transitions).toEqual([]);
  });

  it("first connection close rejects the invoke promise", async () => {
    const p = t.transport.invoke("ping");
    t.ws.simulateClose(1006, "connection failed");
    await expect(p).rejects.toThrow(/closed/i);
  });

  it("connection timeout rejects", async () => {
    const p = t.transport.invoke("ping");
    t.ft.advanceBy(10001);
    await expect(p).rejects.toThrow(/timed out/);
  });

  it("connection error rejects even when no close event follows", async () => {
    const p = t.transport.invoke("ping");
    t.ws.simulateError();
    await expect(p).rejects.toThrow(/connection error/i);
    expect(t.transport.connectionState).toBe(ConnectionState.Reconnecting);
  });

  it("connect settles only once (close then timeout ignored)", async () => {
    const p = t.transport.invoke("ping");
    t.ws.simulateClose(1006);
    await expect(p).rejects.toThrow(/closed/i);
    // Timeout fires later — no double rejection
    t.ft.advanceBy(10001);
  });

  it("old generation callbacks ignored after reconnect", async () => {
    // First connection fails
    const p1 = t.transport.invoke("ping");
    t.ws.simulateClose(1006);
    try {
      await p1;
    } catch {
      /* expected */
    }

    // Reconnect timer fires (1s backoff)
    t.ft.advanceBy(1001);

    // New connection opens
    t.ws.simulateOpen();
    await flush();
    expect(t.transport.connectionState).toBe(ConnectionState.Open);

    // New invoke works
    const p2 = t.transport.invoke("hello");
    await flush();
    const sent = t.ws.lastSentParsed();
    t.ws.simulateMessage(JSON.stringify({ id: sent.id, result: "world" }));
    expect(await p2).toBe("world");
  });

  // --- Auth failure ---

  it("auth failure (4401) transitions to auth_failed, stops reconnecting", async () => {
    const p = t.transport.invoke("ping");
    t.ws.simulateClose(4401, "unauthorized");
    try {
      await p;
    } catch {
      /* expected */
    }

    expect(t.transport.connectionState).toBe(ConnectionState.AuthFailed);

    // No reconnect even after time passes
    t.ft.advanceBy(60000);
    expect(t.transport.connectionState).toBe(ConnectionState.AuthFailed);
  });

  // --- Pending requests ---

  it("pending requests rejected on disconnect", async () => {
    await boot(t);

    // Register two requests
    const p1 = t.transport.invoke("cmd1");
    await flush();
    const p2 = t.transport.invoke("cmd2");
    await flush();

    // Verify they're pending (sent messages)
    expect(t.ws.getSent().length).toBeGreaterThanOrEqual(2);

    // Close the connection
    t.ws.simulateClose(1006);

    // Both must reject with an error containing "closed"
    await expect(p1).rejects.toThrow(/closed/);
    await expect(p2).rejects.toThrow(/closed/);
  });

  it("request timeout fires independently", async () => {
    await boot(t);

    const p = t.transport.invoke("slow_cmd", {}, { timeoutMs: 5000 });
    await flush();

    // Advance past the timeout
    t.ft.advanceBy(5001);
    await expect(p).rejects.toThrow(/IPC_TIMEOUT/);
  });

  it("structured RPC error preserves message/code/data", async () => {
    await boot(t);

    const p = t.transport.invoke("bad_cmd");
    await flush();
    const sent = t.ws.lastSentParsed();
    t.ws.simulateMessage(
      JSON.stringify({
        id: sent.id,
        error: { message: "Method not found", code: -32601, data: { method: "bad_cmd" } },
      }),
    );

    try {
      await p;
      expect.fail("should have thrown");
    } catch (e: unknown) {
      const err = e as Error & { code?: number; data?: unknown };
      expect(err.message).toBe("Method not found");
      expect(err.code).toBe(-32601);
      expect(err.data).toEqual({ method: "bad_cmd" });
    }
  });

  it("simple string error is wrapped correctly", async () => {
    await boot(t);

    const p = t.transport.invoke("fail_cmd");
    await flush();
    const sent = t.ws.lastSentParsed();
    t.ws.simulateMessage(JSON.stringify({ id: sent.id, error: "something broke" }));

    try {
      await p;
      expect.fail("should have thrown");
    } catch (e: unknown) {
      expect((e as Error).message).toBe("something broke");
    }
  });

  // --- Run subscriptions ---

  it("subscribeRun sends _subscribe on open connection", async () => {
    await boot(t);

    t.transport.subscribeRun("run-1", 42);

    const sent = t.ws.lastSentParsed();
    expect(sent.method).toBe("_subscribe");
    expect(sent.params.run_id).toBe("run-1");
    expect(sent.params.last_seq).toBe(42);
  });

  it("unsubscribeRun sends _unsubscribe only when the last explicit owner leaves", async () => {
    await boot(t);

    t.transport.subscribeRun("run-1", 0, "timeline");
    t.transport.subscribeRun("run-1", 0, "notifications");

    t.ws.clearSent();
    t.transport.unsubscribeRun("run-1", "timeline");
    expect(t.ws.getSent()).toHaveLength(0);

    t.transport.unsubscribeRun("run-1", "notifications");
    expect(t.ws.getSent()).toHaveLength(1);
    expect(t.ws.lastSentParsed().method).toBe("_unsubscribe");
  });

  it("legacy duplicate subscribe is idempotent and lastSeq never regresses", async () => {
    await boot(t);

    t.transport.subscribeRun("run-1", 100);
    t.ws.clearSent();
    t.transport.subscribeRun("run-1", 50);

    expect(t.ws.getSent()).toHaveLength(0);
  });

  it("an advanced checkpoint refreshes the server subscription", async () => {
    await boot(t);

    t.transport.subscribeRun("run-1", 100);
    t.ws.clearSent();
    t.transport.subscribeRun("run-1", 150);

    expect(t.ws.lastSentParsed().params.last_seq).toBe(150);
  });

  it("resubscribes on reconnect", async () => {
    await boot(t);

    t.transport.subscribeRun("run-1", 42);
    t.transport.subscribeRun("run-2", 10);

    // Disconnect
    t.ws.simulateClose(1006);

    // Wait for reconnect timer
    t.ft.advanceBy(1001);

    // New connection opens
    t.ws.simulateOpen();
    await flush();

    // Should have re-subscribed both runs
    const sent = t.ws.getSent();
    const subscribeMsgs = sent
      .map((s) => JSON.parse(s))
      .filter((m: { method: string }) => m.method === "_subscribe");
    expect(subscribeMsgs).toHaveLength(2);
    const runIds = subscribeMsgs.map((m: { params: { run_id: string } }) => m.params.run_id);
    expect(runIds).toContain("run-1");
    expect(runIds).toContain("run-2");
  });

  // --- Push events ---

  it("dispatches push events to listeners with _seq injection", async () => {
    await boot(t);

    const handler = vi.fn();
    await t.transport.listen("bus-event", handler);

    t.ws.simulateMessage(
      JSON.stringify({
        event: "bus-event",
        payload: { type: "message_delta", text: "hello" },
        seq: 5,
        run_id: "run-1",
      }),
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: "message_delta", text: "hello", _seq: 5 }),
    );
  });

  it("seq checkpoint persists across reconnect", async () => {
    await boot(t);

    t.transport.subscribeRun("run-1", 0);

    // Receive event with seq=42
    t.ws.simulateMessage(
      JSON.stringify({
        event: "bus-event",
        payload: { type: "test" },
        seq: 42,
        run_id: "run-1",
      }),
    );

    // Disconnect and reconnect
    t.ws.simulateClose(1006);
    t.ft.advanceBy(1001);
    t.ws.simulateOpen();
    await flush();

    // Re-subscribe should use seq=42
    const sent = t.ws.getSent();
    const resub = sent
      .map((s) => JSON.parse(s))
      .find((m: { method: string }) => m.method === "_subscribe");
    expect(resub).toBeDefined();
    expect(resub.params.last_seq).toBe(42);
  });

  it("_full_reload resets the replay checkpoint without dropping subscription ownership", async () => {
    await boot(t);

    t.transport.subscribeRun("run-1", 42);
    const reloadHandler = vi.fn();
    await t.transport.listen("_full_reload", reloadHandler);

    t.ws.simulateMessage(
      JSON.stringify({
        event: "_full_reload",
        run_id: "run-1",
      }),
    );

    expect(reloadHandler).toHaveBeenCalledWith({ run_id: "run-1" });

    t.ws.simulateClose(1006);
    t.ft.advanceBy(1001);
    t.ws.simulateOpen();
    await flush();

    const resubscribe = t.ws
      .getSent()
      .map((message) => JSON.parse(message))
      .find(
        (message: { method?: string; params?: { run_id?: string } }) =>
          message.method === "_subscribe" && message.params?.run_id === "run-1",
      );
    expect(resubscribe.params.last_seq).toBe(0);
  });

  // --- Chunk assembly ---

  it("assembles chunked messages", async () => {
    await boot(t);

    const handler = vi.fn();
    await t.transport.listen("test-event", handler);

    t.ws.simulateMessage(JSON.stringify({ type: "chunk_begin", msg_id: "c1", total: 2 }));
    t.ws.simulateMessage(
      JSON.stringify({
        type: "chunk",
        msg_id: "c1",
        idx: 0,
        data: '{"event":"test-event","payload":{"v":"',
      }),
    );
    t.ws.simulateMessage(JSON.stringify({ type: "chunk", msg_id: "c1", idx: 1, data: '1"}}' }));

    expect(handler).toHaveBeenCalledWith({ v: "1" });
  });

  // --- Dispose ---

  it("dispose rejects pending and prevents new invocations", async () => {
    await boot(t);

    const p = t.transport.invoke("cmd");
    await flush();

    t.transport.dispose();

    expect(t.transport.connectionState).toBe(ConnectionState.Disposed);
    await expect(p).rejects.toThrow(/disposed/i);
    await expect(t.transport.invoke("x")).rejects.toThrow();
  });

  it("dispose cleans up socket", async () => {
    await boot(t);
    t.transport.dispose();
    expect(t.transport.connectionState).toBe(ConnectionState.Disposed);
  });

  // --- Reconnect dedup ---

  it("reconnect uses increasing backoff", async () => {
    // First connection fails
    const p1 = t.transport.invoke("ping");
    t.ws.simulateClose(1006);
    try {
      await p1;
    } catch {
      /* expected */
    }

    // First reconnect at 1s
    t.ft.advanceBy(1001);
    t.ws.simulateOpen();
    await flush();
    expect(t.transport.connectionState).toBe(ConnectionState.Open);

    // Boot the reconnected session
    const sent = t.ws.lastSentParsed();
    if (sent) {
      t.ws.simulateMessage(JSON.stringify({ id: sent.id, result: "ok" }));
      await flush();
    }
    t.ws.clearSent();

    // Second connection fails
    t.ws.simulateClose(1006);

    // Second reconnect at 2s (doubled backoff)
    t.ft.advanceBy(2001);
    expect(t.transport.connectionState).toBe(ConnectionState.Connecting);
  });

  // --- Listen triggers connect ---

  it("listen triggers connection if not connected", async () => {
    const handler = vi.fn();
    const unsubPromise = t.transport.listen("test", handler);

    // Connection should be in progress — open it
    t.ws.simulateOpen();

    const unsub = await unsubPromise;
    expect(typeof unsub).toBe("function");
    unsub();
  });
});
