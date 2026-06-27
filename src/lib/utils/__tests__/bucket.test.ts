import { describe, expect, it } from "vitest";
import { bucketDaily, bucketHourly, uniqueBucketKeys } from "../bucket";

describe("bucketDaily", () => {
  it("returns local date for UTC timestamp", () => {
    // 2026-02-25T10:30:00Z
    expect(bucketDaily(Date.UTC(2026, 1, 25, 10, 30, 0), "UTC")).toBe("2026-02-25");
  });

  it("shifts date forward across timezone offset", () => {
    // 2026-02-25T00:30:00Z in Asia/Shanghai (+08:00) is 2026-02-25T08:30 local
    expect(bucketDaily(Date.UTC(2026, 1, 25, 0, 30, 0), "Asia/Shanghai")).toBe("2026-02-25");
  });

  it("shifts date backward across timezone offset (negative)", () => {
    // 2026-02-25T23:30:00Z in Pacific/Honolulu (-10:00) is 2026-02-25T13:30 local
    expect(bucketDaily(Date.UTC(2026, 1, 25, 23, 30, 0), "Pacific/Honolulu")).toBe("2026-02-25");
  });

  it("cross-midnight going westward returns previous local day", () => {
    // 2026-02-25T01:00:00Z is 2026-02-24T20:00 in America/Los_Angeles
    expect(bucketDaily(Date.UTC(2026, 1, 25, 1, 0, 0), "America/Los_Angeles")).toBe("2026-02-24");
  });

  it("boundary-exclusive: same day same bucket", () => {
    const t1 = Date.UTC(2026, 1, 25, 0, 0, 0);
    const t2 = Date.UTC(2026, 1, 25, 23, 59, 59);
    expect(bucketDaily(t1, "UTC")).toBe(bucketDaily(t2, "UTC"));
  });

  it("accepts seconds (small numbers)", () => {
    // 1740467400 = 2025-02-25T10:30:00Z in seconds
    expect(bucketDaily(1740467400, "UTC")).toBe("2025-02-25");
  });

  it("falls back to local tz when invalid tz provided", () => {
    const ts = Date.UTC(2026, 1, 25, 10, 30, 0);
    const key = bucketDaily(ts, "Not/A_Real_Zone");
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("bucketHourly", () => {
  it("returns hour bucket for timestamp", () => {
    expect(bucketHourly(Date.UTC(2026, 1, 25, 10, 30, 0), "UTC")).toBe("2026-02-25T10");
  });

  it("respects timezone offset", () => {
    // 2026-02-25T10:00:00Z in Asia/Shanghai is 2026-02-25T18 local
    expect(bucketHourly(Date.UTC(2026, 1, 25, 10, 0, 0), "Asia/Shanghai")).toBe("2026-02-25T18");
  });

  it("boundary-exclusive: same hour same bucket", () => {
    const t1 = Date.UTC(2026, 1, 25, 10, 0, 0);
    const t2 = Date.UTC(2026, 1, 25, 10, 59, 59);
    expect(bucketHourly(t1, "UTC")).toBe(bucketHourly(t2, "UTC"));
  });

  it("cross-midnight stays in previous day bucket for local tz", () => {
    // 2026-02-25T01:30:00Z → America/Los_Angeles = 2026-02-24T17
    expect(bucketHourly(Date.UTC(2026, 1, 25, 1, 30, 0), "America/Los_Angeles")).toBe(
      "2026-02-24T17",
    );
  });
});

describe("uniqueBucketKeys", () => {
  it("deduplicates and sorts", () => {
    const ts = [
      Date.UTC(2026, 1, 25, 10, 0, 0),
      Date.UTC(2026, 1, 25, 10, 30, 0),
      Date.UTC(2026, 1, 24, 0, 0, 0),
    ];
    expect(uniqueBucketKeys(ts, "day", "UTC")).toEqual(["2026-02-24", "2026-02-25"]);
  });
});
