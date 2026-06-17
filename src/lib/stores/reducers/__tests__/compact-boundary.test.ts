import { describe, it, expect, vi } from "vitest";
import { reduceCompactBoundary } from "../compact-boundary";

vi.mock("$lib/utils/uuid", () => ({
  uuid: () => "sep-test-id",
}));

describe("reduceCompactBoundary", () => {
  const makeStore = () => {
    const pushed: unknown[] = [];
    return {
      microcompactCount: 0,
      compactCount: 0,
      lastCompactedAt: 0,
      usage: {
        inputTokens: 100,
        cacheReadTokens: 50,
        cacheWriteTokens: 10,
        contextWindowUsedPercentage: 0.85,
        contextWindowRemainingPercentage: 0.15,
      },
      _pushTimeline: (_ctx: unknown, entry: unknown) => {
        pushed.push(entry);
      },
      pushed,
    };
  };

  it("increments microcompactCount for micro triggers (no separator, no usage reset)", () => {
    const store = makeStore();
    reduceCompactBoundary(
      { type: "compact_boundary", run_id: "r", _seq: 1, trigger: "micro" } as never,
      null,
      store as never,
      false,
    );
    expect(store.microcompactCount).toBe(1);
    expect(store.compactCount).toBe(0);
    expect(store.pushed.length).toBe(0);
    expect(store.usage.inputTokens).toBe(100); // unchanged
  });

  it("full compaction: increments compactCount, pushes separator, resets usage", () => {
    const store = makeStore();
    reduceCompactBoundary(
      { type: "compact_boundary", run_id: "r", _seq: 1, pre_tokens: 85000 } as never,
      null,
      store as never,
      false,
    );
    expect(store.compactCount).toBe(1);
    expect(store.pushed.length).toBe(1);
    const sep = store.pushed[0] as { kind: string; content: string };
    expect(sep.kind).toBe("separator");
    expect(sep.content).toBe("Context compacted (85k tokens)");
    expect(store.usage.inputTokens).toBe(0);
    expect(store.usage.cacheReadTokens).toBe(0);
    expect(store.usage.cacheWriteTokens).toBe(0);
    expect(store.usage.contextWindowUsedPercentage).toBeUndefined();
  });

  it("skips pre_tokens label when missing", () => {
    const store = makeStore();
    reduceCompactBoundary(
      { type: "compact_boundary", run_id: "r", _seq: 1 } as never,
      null,
      store as never,
      false,
    );
    const sep = store.pushed[0] as { content: string };
    expect(sep.content).toBe("Context compacted");
  });

  it("writes to ctx (not store) when ctx is provided", () => {
    const store = makeStore();
    const ctx = {
      usage: { ...store.usage },
      tl: [] as unknown[],
      he: [] as unknown[],
    };
    reduceCompactBoundary(
      { type: "compact_boundary", run_id: "r", _seq: 1, trigger: "micro" } as never,
      ctx as never,
      store as never,
      false,
    );
    // store.microcompactCount incremented (store-only field)
    expect(store.microcompactCount).toBe(1);
    // store.usage NOT modified (ctx-managed field)
    expect(store.usage.inputTokens).toBe(100);
  });

  it("skips lastCompactedAt update during replay", () => {
    const store = makeStore();
    store.lastCompactedAt = 12345;
    reduceCompactBoundary(
      { type: "compact_boundary", run_id: "r", _seq: 1, trigger: "micro" } as never,
      null,
      store as never,
      true, // replayOnly
    );
    expect(store.lastCompactedAt).toBe(12345); // unchanged
  });

  it("updates lastCompactedAt during live mode", () => {
    const store = makeStore();
    const before = Date.now();
    reduceCompactBoundary(
      { type: "compact_boundary", run_id: "r", _seq: 1, trigger: "micro" } as never,
      null,
      store as never,
      false,
    );
    expect(store.lastCompactedAt).toBeGreaterThanOrEqual(before);
  });
});
