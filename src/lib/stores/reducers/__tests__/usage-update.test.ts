import { describe, expect, it, vi } from "vitest";
import type { TimelineEntry } from "$lib/types";
import type { TurnUsage, UsageState } from "$lib/stores/types";
import { reduceUsageUpdate } from "../usage-update";

vi.mock("$lib/utils/debug", () => ({ dbg: vi.fn() }));

const emptyUsage = (): UsageState => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cost: 0,
});

function makeStore() {
  return {
    timeline: [] as TimelineEntry[],
    usage: emptyUsage(),
    turnUsages: [] as TurnUsage[],
    durationMs: 0,
    numTurns: 0,
  };
}

function usageEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "usage_update",
    run_id: "run-1",
    _seq: 20,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    total_cost_usd: 0,
    ...overrides,
  } as never;
}

describe("reduceUsageUpdate", () => {
  it("stores token usage and appends an authoritative per-turn snapshot", () => {
    const store = makeStore();

    reduceUsageUpdate(
      usageEvent({
        input_tokens: 120,
        output_tokens: 30,
        cache_read_tokens: 40,
        cache_write_tokens: 5,
        total_cost_usd: 0.25,
        duration_api_ms: 900,
        duration_ms: 1200,
        num_turns: 3,
        turn_index: 7,
      }),
      null,
      store as never,
      false,
    );

    expect(store.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 40,
      cacheWriteTokens: 5,
      cost: 0.25,
      modelUsage: undefined,
      contextWindowUsedPercentage: undefined,
      contextWindowRemainingPercentage: undefined,
      durationApiMs: 900,
    });
    expect(store.durationMs).toBe(1200);
    expect(store.numTurns).toBe(3);
    expect(store.turnUsages).toEqual([
      {
        turnIndex: 7,
        inputTokens: 120,
        outputTokens: 30,
        cacheReadTokens: 40,
        cacheWriteTokens: 5,
        cost: 0.25,
        durationApiMs: 900,
        durationMs: 1200,
      },
    ]);
  });

  it("preserves authoritative token counts on zero-token metadata updates", () => {
    const store = makeStore();
    store.usage = {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 10,
      cacheWriteTokens: 2,
      cost: 0.5,
    };

    reduceUsageUpdate(
      usageEvent({
        total_cost_usd: 0.8,
        duration_api_ms: 700,
        context_window_used_percentage: 64,
        context_window_remaining_percentage: 36,
        model_usage: { modelA: { inputTokens: 1 } },
      }),
      null,
      store as never,
      false,
    );

    expect(store.usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 10,
      cacheWriteTokens: 2,
      cost: 0.8,
      durationApiMs: 700,
      contextWindowUsedPercentage: 64,
      contextWindowRemainingPercentage: 36,
      modelUsage: { modelA: { inputTokens: 1 } },
    });
    expect(store.turnUsages).toHaveLength(1);
  });

  it("uses the number of user messages as a backwards-compatible turn index", () => {
    const store = makeStore();
    store.timeline = [
      {
        kind: "user",
        id: "u1",
        anchorId: "u1",
        content: "one",
        ts: "2026-06-21T00:00:00.000Z",
      },
      {
        kind: "assistant",
        id: "a1",
        anchorId: "a1",
        content: "answer",
        ts: "2026-06-21T00:00:01.000Z",
      },
      {
        kind: "user",
        id: "u2",
        anchorId: "u2",
        content: "two",
        ts: "2026-06-21T00:00:02.000Z",
      },
    ];

    reduceUsageUpdate(
      usageEvent({ input_tokens: 1, total_cost_usd: 0.01 }),
      null,
      store as never,
      false,
    );

    expect(store.turnUsages[0].turnIndex).toBe(2);
  });

  it("does not append an empty, metadata-free update", () => {
    const store = makeStore();

    reduceUsageUpdate(usageEvent(), null, store as never, false);

    expect(store.usage).toEqual(emptyUsage());
    expect(store.turnUsages).toEqual([]);
  });

  it("writes batch state to the reduce context while keeping run totals on the store", () => {
    const store = makeStore();
    const ctx = {
      tl: [] as TimelineEntry[],
      usage: emptyUsage(),
      turnUsages: [] as TurnUsage[],
    };

    reduceUsageUpdate(
      usageEvent({
        input_tokens: 9,
        output_tokens: 4,
        total_cost_usd: 0.03,
        duration_ms: 500,
        num_turns: 2,
      }),
      ctx as never,
      store as never,
      true,
    );

    expect(ctx.usage.inputTokens).toBe(9);
    expect(ctx.turnUsages).toHaveLength(1);
    expect(store.usage).toEqual(emptyUsage());
    expect(store.durationMs).toBe(500);
    expect(store.numTurns).toBe(2);
  });
});
