import { describe, it, expect } from "vitest";
import { eventTs, eventTsMs } from "../event-ts";

describe("eventTs", () => {
  it("reads `ts` field as ISO string", () => {
    expect(
      eventTs({ type: "test", run_id: "r", _seq: 0, ts: "2026-01-01T00:00:00.000Z" } as never),
    ).toBe("2026-01-01T00:00:00.000Z");
  });

  it("falls back to `timestamp` field when `ts` is missing", () => {
    expect(
      eventTs({
        type: "test",
        run_id: "r",
        _seq: 0,
        timestamp: "2026-02-02T00:00:00.000Z",
      } as never),
    ).toBe("2026-02-02T00:00:00.000Z");
  });

  it("prefers `ts` over `timestamp` when both are present", () => {
    expect(
      eventTs({
        type: "test",
        run_id: "r",
        _seq: 0,
        ts: "2026-01-01T00:00:00.000Z",
        timestamp: "2026-02-02T00:00:00.000Z",
      } as never),
    ).toBe("2026-01-01T00:00:00.000Z");
  });

  it("falls back to current time when neither field is present", () => {
    const before = Date.now();
    const result = eventTs({ type: "test", run_id: "r", _seq: 0 } as never);
    const after = Date.now();
    const parsed = new Date(result).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});

describe("eventTsMs", () => {
  it("parses ISO string to epoch ms", () => {
    expect(
      eventTsMs({ type: "test", run_id: "r", _seq: 0, ts: "2026-01-01T00:00:00.000Z" } as never),
    ).toBe(new Date("2026-01-01T00:00:00.000Z").getTime());
  });

  it("falls back to Date.now() for unparseable strings", () => {
    const before = Date.now();
    const result = eventTsMs({ type: "test", run_id: "r", _seq: 0, ts: "garbage" } as never);
    expect(result).toBeGreaterThanOrEqual(before);
  });
});
