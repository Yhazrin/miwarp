import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChunkAssembler } from "./chunk-assembler";

vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

function fakeTimers() {
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  let intervalId = 0;
  let currentTime = 0;
  const intervals = new Map<number, { fn: () => void; ms: number }>();

  return {
    timers: {
      setTimeout: (fn: () => void, _ms: number) => {
        const id = {} as ReturnType<typeof setTimeout>;
        timers.set(id, fn);
        return id;
      },
      clearTimeout: (id: ReturnType<typeof setTimeout>) => {
        timers.delete(id);
      },
      setInterval: (fn: () => void, ms: number) => {
        intervalId++;
        intervals.set(intervalId, { fn, ms });
        return intervalId as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: (id: ReturnType<typeof setInterval>) => {
        intervals.delete(id as unknown as number);
      },
    },
    flushTimers: () => {
      for (const fn of timers.values()) fn();
      timers.clear();
    },
    runIntervals: () => {
      for (const { fn } of intervals.values()) fn();
    },
    advanceBy: (ms: number) => {
      currentTime += ms;
    },
    now: () => currentTime,
  };
}

describe("ChunkAssembler", () => {
  let ft: ReturnType<typeof fakeTimers>;
  let assembler: ChunkAssembler;
  let completed: string[];

  beforeEach(() => {
    ft = fakeTimers();
    assembler = new ChunkAssembler({ timers: ft.timers });
    completed = [];
    assembler.onComplete = (msg) => completed.push(msg);
  });

  afterEach(() => {
    assembler.dispose();
  });

  it("assembles a complete 2-chunk message", () => {
    assembler.handleMessage({ type: "chunk_begin", msg_id: "m1", total: 2 });
    assembler.handleMessage({ type: "chunk", msg_id: "m1", idx: 0, data: '{"hello":' });
    assembler.handleMessage({ type: "chunk", msg_id: "m1", idx: 1, data: '"world"}' });

    expect(completed).toEqual(['{"hello":"world"}']);
    expect(assembler.activeCount).toBe(0);
  });

  it("handles out-of-order chunks", () => {
    assembler.handleMessage({ type: "chunk_begin", msg_id: "m1", total: 3 });
    assembler.handleMessage({ type: "chunk", msg_id: "m1", idx: 2, data: "c" });
    assembler.handleMessage({ type: "chunk", msg_id: "m1", idx: 0, data: "a" });
    assembler.handleMessage({ type: "chunk", msg_id: "m1", idx: 1, data: "b" });

    expect(completed).toEqual(["abc"]);
  });

  it("ignores duplicate chunk indices", () => {
    assembler.handleMessage({ type: "chunk_begin", msg_id: "m1", total: 2 });
    assembler.handleMessage({ type: "chunk", msg_id: "m1", idx: 0, data: "a" });
    assembler.handleMessage({ type: "chunk", msg_id: "m1", idx: 0, data: "A" }); // duplicate
    assembler.handleMessage({ type: "chunk", msg_id: "m1", idx: 1, data: "b" });

    expect(completed).toEqual(["ab"]); // not "Ab"
  });

  it("ignores out-of-range chunk index", () => {
    assembler.handleMessage({ type: "chunk_begin", msg_id: "m1", total: 2 });
    assembler.handleMessage({ type: "chunk", msg_id: "m1", idx: 5, data: "x" });
    assembler.handleMessage({ type: "chunk", msg_id: "m1", idx: 0, data: "a" });
    assembler.handleMessage({ type: "chunk", msg_id: "m1", idx: 1, data: "b" });

    expect(completed).toEqual(["ab"]);
  });

  it("ignores orphan chunk (no matching begin)", () => {
    assembler.handleMessage({ type: "chunk", msg_id: "unknown", idx: 0, data: "x" });
    expect(completed).toEqual([]);
  });

  it("chunk_end with all parts delivers, chunk_end incomplete discards", () => {
    assembler.handleMessage({ type: "chunk_begin", msg_id: "m1", total: 2 });
    assembler.handleMessage({ type: "chunk", msg_id: "m1", idx: 0, data: "a" });
    assembler.handleMessage({ type: "chunk_end", msg_id: "m1" });
    // Incomplete — discarded
    expect(completed).toEqual([]);

    // Complete message via chunk_end
    assembler.handleMessage({ type: "chunk_begin", msg_id: "m2", total: 1 });
    assembler.handleMessage({ type: "chunk", msg_id: "m2", idx: 0, data: "x" });
    assembler.handleMessage({ type: "chunk_end", msg_id: "m2" });
    expect(completed).toEqual(["x"]);
  });

  it("max active messages drops oldest", () => {
    const smallAssembler = new ChunkAssembler({ maxActiveMessages: 2, timers: ft.timers });
    const msgs: string[] = [];
    smallAssembler.onComplete = (m) => msgs.push(m);

    smallAssembler.handleMessage({ type: "chunk_begin", msg_id: "m1", total: 1 });
    smallAssembler.handleMessage({ type: "chunk_begin", msg_id: "m2", total: 1 });
    smallAssembler.handleMessage({ type: "chunk_begin", msg_id: "m3", total: 1 }); // drops m1

    expect(smallAssembler.activeCount).toBe(2);
    smallAssembler.dispose();
  });

  it("max chunks per message rejects", () => {
    const smallAssembler = new ChunkAssembler({ maxChunksPerMessage: 2, timers: ft.timers });
    const msgs: string[] = [];
    smallAssembler.onComplete = (m) => msgs.push(m);

    smallAssembler.handleMessage({ type: "chunk_begin", msg_id: "m1", total: 5 }); // exceeds
    expect(smallAssembler.activeCount).toBe(0); // not added
    smallAssembler.dispose();
  });

  it("max bytes per message drops buffer", () => {
    const smallAssembler = new ChunkAssembler({ maxBytesPerMessage: 10, timers: ft.timers });
    const msgs: string[] = [];
    smallAssembler.onComplete = (m) => msgs.push(m);

    smallAssembler.handleMessage({ type: "chunk_begin", msg_id: "m1", total: 2 });
    smallAssembler.handleMessage({ type: "chunk", msg_id: "m1", idx: 0, data: "1234567890" }); // 10 bytes
    smallAssembler.handleMessage({ type: "chunk", msg_id: "m1", idx: 1, data: "x" }); // 11 bytes total, exceeds

    expect(smallAssembler.activeCount).toBe(0);
    expect(msgs).toEqual([]);
    smallAssembler.dispose();
  });

  it("counts UTF-8 bytes rather than JavaScript code units", () => {
    const smallAssembler = new ChunkAssembler({ maxBytesPerMessage: 5, timers: ft.timers });
    const msgs: string[] = [];
    smallAssembler.onComplete = (m) => msgs.push(m);

    smallAssembler.handleMessage({ type: "chunk_begin", msg_id: "utf8", total: 1 });
    smallAssembler.handleMessage({ type: "chunk", msg_id: "utf8", idx: 0, data: "你好" });

    expect(msgs).toEqual([]);
    expect(smallAssembler.activeCount).toBe(0);
    smallAssembler.dispose();
  });

  it("rejects an oversized declared payload before buffering", () => {
    const smallAssembler = new ChunkAssembler({ maxBytesPerMessage: 10, timers: ft.timers });
    smallAssembler.handleMessage({
      type: "chunk_begin",
      msg_id: "large",
      total: 1,
      size: 11,
    });
    expect(smallAssembler.activeCount).toBe(0);
    smallAssembler.dispose();
  });

  it("discards a completed payload whose declared size does not match", () => {
    assembler.handleMessage({ type: "chunk_begin", msg_id: "mismatch", total: 1, size: 4 });
    assembler.handleMessage({ type: "chunk", msg_id: "mismatch", idx: 0, data: "abc" });
    expect(completed).toEqual([]);
  });

  it("duplicate begin does not reset an in-flight message", () => {
    assembler.handleMessage({ type: "chunk_begin", msg_id: "dup", total: 2 });
    assembler.handleMessage({ type: "chunk", msg_id: "dup", idx: 0, data: "a" });
    assembler.handleMessage({ type: "chunk_begin", msg_id: "dup", total: 1 });
    assembler.handleMessage({ type: "chunk", msg_id: "dup", idx: 1, data: "b" });
    expect(completed).toEqual(["ab"]);
  });

  it("timeout cleanup removes stale buffers", () => {
    const smallAssembler = new ChunkAssembler({
      messageTimeoutMs: 5000,
      timers: ft.timers,
      now: ft.now,
    });
    smallAssembler.handleMessage({ type: "chunk_begin", msg_id: "m1", total: 2 });
    expect(smallAssembler.activeCount).toBe(1);

    ft.advanceBy(5001);
    ft.runIntervals();
    expect(smallAssembler.activeCount).toBe(0);

    smallAssembler.dispose();
  });

  it("non-chunk messages pass through (returns false)", () => {
    expect(assembler.handleMessage({ event: "bus-event", payload: {} })).toBe(false);
    expect(assembler.handleMessage({ id: "req_1", result: "ok" })).toBe(false);
  });

  it("dispose clears everything", () => {
    assembler.handleMessage({ type: "chunk_begin", msg_id: "m1", total: 2 });
    assembler.dispose();
    expect(assembler.activeCount).toBe(0);
    expect(assembler.onComplete).toBeNull();
  });
});
