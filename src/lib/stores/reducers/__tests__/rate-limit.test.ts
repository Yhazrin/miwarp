import { describe, it, expect, vi } from "vitest";
import { reduceRateLimit } from "../rate-limit";
import { dbg } from "$lib/utils/debug";

vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
}));

describe("reduceRateLimit", () => {
  const makeStore = () => ({
    rateLimitStatus: "",
    rateLimitType: "",
    rateLimitUtilization: null as number | null,
    rateLimitResetsAt: null as number | null,
  });

  it("writes all four rate-limit fields to the store", () => {
    const store = makeStore();
    reduceRateLimit(
      {
        type: "rate_limit_event",
        run_id: "r1",
        status: "approaching_limit",
        rate_limit_type: "tokens",
        utilization: 0.85,
        resets_at: 1_700_000_000,
        _seq: 1,
      } as never,
      null,
      store as never,
      false,
    );
    expect(store.rateLimitStatus).toBe("approaching_limit");
    expect(store.rateLimitType).toBe("tokens");
    expect(store.rateLimitUtilization).toBe(0.85);
    expect(store.rateLimitResetsAt).toBe(1_700_000_000);
  });

  it("uses defaults when optional fields are missing", () => {
    const store = makeStore();
    reduceRateLimit(
      {
        type: "rate_limit_event",
        run_id: "r1",
        status: "ok",
        _seq: 2,
      } as never,
      null,
      store as never,
      false,
    );
    expect(store.rateLimitStatus).toBe("ok");
    expect(store.rateLimitType).toBe("");
    expect(store.rateLimitUtilization).toBeNull();
    expect(store.rateLimitResetsAt).toBeNull();
  });

  it("writes to store directly even in batch ctx mode (no ReduceCtx equivalent)", () => {
    // rateLimitStatus is not in ReduceCtx. Even when ctx is non-null, the
    // reducer writes to store directly. This is by design — the field has
    // no batch/replay semantics.
    const store = makeStore();
    reduceRateLimit(
      {
        type: "rate_limit_event",
        run_id: "r1",
        status: "limited",
        _seq: 3,
      } as never,
      {} as never,
      store as never,
      true,
    );
    expect(store.rateLimitStatus).toBe("limited");
  });

  it("emits a debug log keyed by event type", () => {
    const store = makeStore();
    reduceRateLimit(
      {
        type: "rate_limit_event",
        run_id: "r1",
        status: "ok",
        _seq: 4,
      } as never,
      null,
      store as never,
      false,
    );
    expect(dbg).toHaveBeenCalledWith(
      "store",
      "rate_limit_event",
      expect.objectContaining({ status: "ok" }),
    );
  });
});
