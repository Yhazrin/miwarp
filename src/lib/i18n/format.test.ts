/**
 * Black-box tests for locale-aware formatters.
 *
 * These exercise the same public surface as the layout / sidebar renderers
 * use: invalid-date handling, numeric fallbacks, and the relative-time
 * bucketing. They intentionally do NOT mock Intl — we want to catch locale
 * regressions against the real Node ICU implementation.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { initLocale, switchLocale } from "./index.svelte";
import { fmtNumber, fmtTime, fmtDate, fmtDateTime, fmtFull, fmtRelative } from "./format";

beforeAll(() => {
  initLocale();
});

describe("fmtNumber", () => {
  it("formats integers with locale grouping", () => {
    switchLocale("en-US");
    expect(fmtNumber(1234567)).toBe("1,234,567");
  });

  it("returns '0' for NaN", () => {
    expect(fmtNumber(NaN)).toBe("0");
  });

  it("returns '0' for Infinity", () => {
    expect(fmtNumber(Infinity)).toBe("0");
  });
});

describe("fmtTime", () => {
  it("formats a Date object to HH:MM", () => {
    switchLocale("en-US");
    const d = new Date(2026, 1, 20, 14, 30);
    const out = fmtTime(d);
    expect(out).toMatch(/14:30|2:30/);
    expect(out).not.toBe("—");
  });

  it("accepts ISO strings", () => {
    switchLocale("en-US");
    const out = fmtTime("2026-02-20T14:30:00Z");
    expect(out).not.toBe("—");
  });

  it("returns em-dash for invalid date", () => {
    expect(fmtTime("not-a-date")).toBe("—");
  });
});

describe("fmtDate", () => {
  it("formats a short month-day string", () => {
    switchLocale("en-US");
    const out = fmtDate(new Date(2026, 1, 20));
    expect(out).toMatch(/Feb/);
    expect(out).toMatch(/20/);
  });

  it("returns em-dash for invalid date", () => {
    expect(fmtDate("garbage")).toBe("—");
  });
});

describe("fmtDateTime", () => {
  it("formats month + day + time", () => {
    switchLocale("en-US");
    const out = fmtDateTime(new Date(2026, 1, 20, 14, 30));
    expect(out).not.toBe("—");
    expect(out).toMatch(/20/);
  });
});

describe("fmtFull", () => {
  it("includes seconds", () => {
    switchLocale("en-US");
    const out = fmtFull(new Date(2026, 1, 20, 14, 30, 45));
    expect(out).toMatch(/45/);
    expect(out).toMatch(/2026/);
  });
});

describe("fmtRelative", () => {
  it("returns em-dash for invalid input", () => {
    expect(fmtRelative("xxx")).toBe("—");
  });

  it("buckets recent timestamps into seconds", () => {
    const now = new Date();
    const d = new Date(now.getTime() - 5_000); // 5 seconds ago
    const out = fmtRelative(d);
    expect(out).not.toBe("—");
  });

  it("buckets minute-scale deltas", () => {
    const now = new Date();
    const d = new Date(now.getTime() - 5 * 60_000); // 5 minutes ago
    const out = fmtRelative(d);
    expect(out).not.toBe("—");
  });

  it("falls back to fmtDate for dates older than 7 days", () => {
    const now = new Date();
    const d = new Date(now.getTime() - 30 * 86_400_000); // 30 days ago
    const out = fmtRelative(d);
    // Should NOT contain "ago" or "前" — it should be a date string instead
    expect(out).not.toBe("—");
    expect(out).not.toMatch(/ago|前/);
  });
});
