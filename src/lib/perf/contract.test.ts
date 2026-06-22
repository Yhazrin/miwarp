import { describe, expect, it, vi } from "vitest";
import {
  aggregate,
  aggregateFailures,
  compareBaselines,
  createRecorder,
  createRecorderForced,
  DEFAULT_THRESHOLDS,
  isSafeMetaValue,
  PERF_CONTRACT_SCHEMA_VERSION,
  percentile,
  sanitizeMeta,
  trimSorted,
} from "./contract";
import type { FailureCode, InteractionMetric, PerfContract } from "./contract";

function metric(over: Partial<InteractionMetric> = {}): InteractionMetric {
  return {
    schemaVersion: PERF_CONTRACT_SCHEMA_VERSION,
    scenario: "settings.firstOpen",
    durationMs: 100,
    success: true,
    workloadKind: "real",
    cold: false,
    run: 1,
    ts: "2026-06-22T00:00:00.000Z",
    ...over,
  };
}

function failure(
  over: Partial<{ scenario: InteractionMetric["scenario"]; code: FailureCode; run: number }> = {},
) {
  return {
    schemaVersion: PERF_CONTRACT_SCHEMA_VERSION,
    failureId: "f1",
    scenario: "settings.firstOpen" as InteractionMetric["scenario"],
    code: "timeout" as FailureCode,
    messageKind: "ipc_timeout",
    run: 1,
    ts: "2026-06-22T00:00:00.000Z",
    ...over,
  };
}

describe("percentile", () => {
  it("returns nearest-rank percentile for valid inputs", () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
    expect(percentile([10, 20, 30, 40, 50], 95)).toBe(50);
    expect(percentile([10, 20, 30, 40, 50], 0)).toBe(10);
    expect(percentile([10, 20, 30, 40, 50], 100)).toBe(50);
  });

  it("throws on empty input", () => {
    expect(() => percentile([], 50)).toThrow();
  });

  it("throws on out-of-range p", () => {
    expect(() => percentile([1, 2, 3], -1)).toThrow();
    expect(() => percentile([1, 2, 3], 101)).toThrow();
    expect(() => percentile([1, 2, 3], NaN)).toThrow();
  });

  it("throws on non-finite value", () => {
    expect(() => percentile([1, NaN, 3], 50)).toThrow();
  });

  it("does not mutate input", () => {
    const xs = [3, 1, 2];
    percentile(xs, 50);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("trimSorted", () => {
  it("trims top and bottom by percent", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(trimSorted(sorted, 10)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(trimSorted(sorted, 50)).toEqual([6]);
  });

  it("returns empty for empty input", () => {
    expect(trimSorted([], 10)).toEqual([]);
  });

  it("rejects out-of-range trimPct", () => {
    expect(() => trimSorted([1, 2, 3], -1)).toThrow();
    expect(() => trimSorted([1, 2, 3], 51)).toThrow();
  });
});

describe("aggregate", () => {
  it("returns zeros for empty input", () => {
    const r = aggregate([], DEFAULT_THRESHOLDS);
    expect(r.n).toBe(0);
    expect(r.dropped).toBe(0);
    expect(Number.isNaN(r.p50)).toBe(true);
  });

  it("computes p50/p95/max/mean with trim", () => {
    // 30 values, 5% trim drops 1 from each tail -> 28 used
    const vals = Array.from({ length: 30 }, (_, i) => i + 1);
    const r = aggregate(vals, { ...DEFAULT_THRESHOLDS, anomalyTrimPct: 5 });
    expect(r.n).toBe(28);
    expect(r.dropped).toBe(2);
    expect(r.max).toBe(29);
    expect(r.p50).toBe(15);
    expect(r.p95).toBe(28);
    // sum(2..29) = 434, n = 28, mean = 15.5
    expect(r.mean).toBeCloseTo(15.5, 5);
  });
});

describe("aggregateFailures", () => {
  it("returns 0 rate for all-success", () => {
    const r = aggregateFailures([metric({ success: true }), metric({ success: true })], []);
    expect(r.total).toBe(2);
    expect(r.rate).toBe(0);
  });

  it("returns 0.5 rate for mixed", () => {
    const r = aggregateFailures(
      [metric({ success: true }), metric({ success: false, code: "timeout" })],
      [failure({ code: "timeout" })],
    );
    expect(r.rate).toBe(0.5);
    expect(r.byCode.timeout).toBe(1);
  });
});

describe("sanitizeMeta + isSafeMetaValue", () => {
  it("drops unsafe keys", () => {
    const out = sanitizeMeta({
      prompt: "secret prompt", // not in SAFE_META_KEYS
      token: "tk_xxx",
      ANTHROPIC_API_KEY: "leak",
      tab: "general",
      runId: "r-1",
      mountedEntries: 150,
    });
    expect(out).toEqual({ tab: "general", runId: "r-1", mountedEntries: 150 });
  });

  it("rejects long strings and non-finite numbers", () => {
    expect(isSafeMetaValue("a".repeat(64))).toBe(true);
    expect(isSafeMetaValue("a".repeat(65))).toBe(false);
    expect(isSafeMetaValue(Infinity)).toBe(false);
    expect(isSafeMetaValue(NaN)).toBe(false);
    expect(isSafeMetaValue({})).toBe(false);
    expect(isSafeMetaValue(null)).toBe(false);
  });

  it("returns undefined when all keys dropped", () => {
    expect(sanitizeMeta({ prompt: "secret" })).toBeUndefined();
    expect(sanitizeMeta(undefined)).toBeUndefined();
  });
});

describe("createRecorder (production-gated)", () => {
  it("returns a noop recorder when perf is disabled", () => {
    const r = createRecorder();
    expect(r.enabled).toBe(false);
    expect(r.count).toBe(0);
    const span = r.startSpan("settings.firstOpen");
    span.end({ success: true });
    expect(r.count).toBe(0); // noop does not record
  });
});

describe("createRecorderForced (recording)", () => {
  it("records a successful span end with sanitized meta", () => {
    let now = 1000;
    const r = createRecorderForced({
      now: () => now,
      iso: () => "2026-06-22T00:00:00.000Z",
      build: "test-build",
      platform: "darwin",
      transport: "tauri",
    });
    const span = r.startSpan("settings.firstOpen", {
      cold: true,
      run: 7,
      meta: { tab: "general", prompt: "must be dropped" },
    });
    now = 1250;
    span.end({ success: true });
    const c = r.exportContract();
    expect(c.schemaVersion).toBe(1);
    expect(c.build).toBe("test-build");
    expect(c.platform).toBe("darwin");
    expect(c.transport).toBe("tauri");
    expect(c.samples).toHaveLength(1);
    expect(c.samples[0]!.durationMs).toBe(250);
    expect(c.samples[0]!.cold).toBe(true);
    expect(c.samples[0]!.run).toBe(7);
    expect(c.samples[0]!.meta).toEqual({ tab: "general" });
    expect(c.failures).toHaveLength(0);
  });

  it("cancel() records a failure with the given code", () => {
    let now = 0;
    const r = createRecorderForced({
      now: () => now,
      iso: () => "2026-06-22T00:00:00.000Z",
    });
    const span = r.startSpan("session.switchToInteractive", { run: 3 });
    now = 75;
    span.cancel("timeout");
    const c = r.exportContract();
    expect(c.samples).toHaveLength(1);
    expect(c.samples[0]!.success).toBe(false);
    expect(c.samples[0]!.code).toBe("timeout");
    expect(c.failures).toHaveLength(1);
    expect(c.failures[0]!.code).toBe("timeout");
  });

  it("end() is idempotent — second call is a no-op", () => {
    let now = 0;
    const r = createRecorderForced({ now: () => now, iso: () => "x" });
    const span = r.startSpan("settings.firstOpen", { run: 1 });
    now = 10;
    span.end({ success: true });
    now = 99;
    span.end({ success: true });
    const c = r.exportContract();
    expect(c.samples).toHaveLength(1);
    expect(c.samples[0]!.durationMs).toBe(10);
  });

  it("end() after cancel() is a no-op", () => {
    const r = createRecorderForced({ now: () => 0, iso: () => "x" });
    const span = r.startSpan("settings.firstOpen", { run: 1 });
    span.cancel("cancelled");
    span.end({ success: true });
    expect(r.exportContract().samples).toHaveLength(1);
    expect(r.exportContract().samples[0]!.code).toBe("cancelled");
  });

  it("timeout via setTimeout auto-cancels the span", () => {
    vi.useFakeTimers();
    const r = createRecorderForced({ now: () => 0, iso: () => "x" });
    const span = r.startSpan("settings.firstOpen", { run: 1, timeoutMs: 1000 });
    vi.advanceTimersByTime(1500);
    const c = r.exportContract();
    expect(c.samples).toHaveLength(1);
    expect(c.samples[0]!.success).toBe(false);
    expect(c.samples[0]!.code).toBe("timeout");
    expect(span.closed).toBe(true);
    vi.useRealTimers();
  });

  it("dedups re-entrant spans of the same scenario+run via ownership, not collapse", () => {
    // The contract intentionally does NOT collapse duplicate spans because
    // they represent distinct user actions; reentrancy is enforced at the
    // caller (SettingsTabLoadController.ensureTabLoaded). Recorder records
    // each span independently. This test documents the contract.
    const r = createRecorderForced({ now: () => 0, iso: () => "x" });
    const a = r.startSpan("settings.firstOpen", { run: 1 });
    const b = r.startSpan("settings.firstOpen", { run: 1 });
    a.end({ success: true });
    b.end({ success: true });
    expect(r.exportContract().samples).toHaveLength(2);
  });

  it("recordSample drops wrong schemaVersion", () => {
    const r = createRecorderForced({ iso: () => "x" });
    r.recordSample({ ...metric(), schemaVersion: 99 as never });
    expect(r.exportContract().samples).toHaveLength(0);
  });

  it("recordFailure rejects messageKind longer than 64 chars", () => {
    const r = createRecorderForced({ iso: () => "x" });
    r.recordFailure({
      schemaVersion: 1,
      failureId: "f1",
      scenario: "settings.firstOpen",
      code: "timeout",
      messageKind: "x".repeat(65),
      run: 1,
      ts: "x",
    });
    expect(r.exportContract().failures).toHaveLength(0);
  });

  it("reset() empties samples and failures", () => {
    const r = createRecorderForced({ now: () => 0, iso: () => "x" });
    r.startSpan("settings.firstOpen", { run: 1 }).end({ success: true });
    r.recordFailure(failure());
    expect(r.count).toBe(1);
    r.reset();
    expect(r.count).toBe(0);
    expect(r.exportContract().failures).toHaveLength(0);
  });
});

describe("compareBaselines — gate logic", () => {
  function contract(
    scenario: InteractionMetric["scenario"],
    durations: number[],
    failures = 0,
  ): PerfContract {
    const samples: InteractionMetric[] = durations.map((d, i) =>
      metric({
        scenario,
        durationMs: d,
        success: failures === 0 || i >= failures,
        code: failures > 0 && i < failures ? "timeout" : undefined,
        run: i + 1,
      }),
    );
    const fs = Array.from({ length: failures }, (_, i) =>
      failure({ scenario, code: "timeout", run: i + 1 }),
    );
    return {
      schemaVersion: 1,
      capturedAt: "2026-06-22T00:00:00.000Z",
      build: "x",
      platform: "darwin",
      transport: "tauri",
      thresholds: { ...DEFAULT_THRESHOLDS },
      samples,
      failures: fs,
    };
  }

  it("rejects when sample count below minSamples", () => {
    const base = contract(
      "settings.firstOpen",
      Array.from({ length: 30 }, () => 100),
    );
    const cur = contract(
      "settings.firstOpen",
      Array.from({ length: 5 }, () => 20),
    );
    const r = compareBaselines(base, cur);
    expect(r.passed).toBe(false);
    expect(r.rejected.some((x) => x.reason.includes("current samples"))).toBe(true);
  });

  it("rejects workloadKind mismatch between baseline and current", () => {
    const base = contract(
      "settings.firstOpen",
      Array.from({ length: 30 }, () => 100),
    );
    const cur = contract(
      "settings.firstOpen",
      Array.from({ length: 30 }, () => 20),
    );
    // Mutate current samples to "proxy" kind
    cur.samples = cur.samples.map((s) => ({ ...s, workloadKind: "proxy" }));
    const r = compareBaselines(base, cur);
    expect(r.passed).toBe(false);
    expect(r.rejected.some((x) => x.reason.includes("workloadKind"))).toBe(true);
  });

  it("passes when current is >= 70% faster and 90% fewer failures", () => {
    const base = contract(
      "settings.firstOpen",
      Array.from({ length: 30 }, () => 1000),
      5,
    );
    const cur = contract(
      "settings.firstOpen",
      Array.from({ length: 30 }, () => 200),
      0,
    );
    const r = compareBaselines(base, cur);
    expect(r.passed).toBe(true);
    expect(r.scenarios).toHaveLength(1);
    expect(r.scenarios[0]!.latencyImprovementPct).toBeGreaterThanOrEqual(70);
    expect(r.scenarios[0]!.failureReductionPct).toBeGreaterThanOrEqual(90);
  });

  it("fails when latency threshold not met", () => {
    const base = contract(
      "settings.firstOpen",
      Array.from({ length: 30 }, () => 1000),
    );
    const cur = contract(
      "settings.firstOpen",
      Array.from({ length: 30 }, () => 500),
    );
    const r = compareBaselines(base, cur);
    expect(r.passed).toBe(false);
    expect(r.scenarios[0]!.latencyImprovementPct).toBeLessThan(70);
  });

  it("fails when failure threshold not met", () => {
    const base = contract(
      "settings.firstOpen",
      Array.from({ length: 30 }, (_, i) => 100 + i),
      10,
    );
    const cur = contract(
      "settings.firstOpen",
      Array.from({ length: 30 }, (_, i) => 100 + i),
      5,
    );
    const r = compareBaselines(base, cur);
    expect(r.passed).toBe(false);
    expect(r.scenarios[0]!.failureReductionPct).toBeLessThan(90);
  });

  it("treats baseline 0 failures + current 0 failures as pass for failure rate", () => {
    const base = contract(
      "settings.firstOpen",
      Array.from({ length: 30 }, () => 1000),
      0,
    );
    const cur = contract(
      "settings.firstOpen",
      Array.from({ length: 30 }, () => 200),
      0,
    );
    const r = compareBaselines(base, cur);
    expect(r.scenarios[0]!.passed).toBe(true);
  });

  it("treats baseline 0 failures + current >0 failures as regression", () => {
    const base = contract(
      "settings.firstOpen",
      Array.from({ length: 30 }, () => 1000),
      0,
    );
    const cur = contract(
      "settings.firstOpen",
      Array.from({ length: 30 }, (_, i) => (i < 5 ? 200 : 300)),
      5,
    );
    const r = compareBaselines(base, cur);
    expect(r.scenarios[0]!.passed).toBe(false);
    expect(r.scenarios[0]!.failureReductionPct).toBeLessThan(0);
  });

  it("respects custom thresholds", () => {
    const base = contract(
      "settings.firstOpen",
      Array.from({ length: 30 }, () => 1000),
    );
    const cur = contract(
      "settings.firstOpen",
      Array.from({ length: 30 }, () => 400),
    );
    const r = compareBaselines(base, cur, { ...DEFAULT_THRESHOLDS, latencyImprovementPct: 50 });
    expect(r.passed).toBe(true);
  });
});

describe("contract meta safety", () => {
  it("does not leak prompt/token keys through end({meta})", () => {
    const r = createRecorderForced({ now: () => 0, iso: () => "x" });
    const span = r.startSpan("settings.firstOpen", { run: 1 });
    span.end({
      success: true,
      meta: {
        prompt: "secret prompt text",
        token: "tk_secret",
        env: { ANTHROPIC_API_KEY: "leak" },
        tab: "general",
        runId: "r-1",
      },
    });
    const sample = r.exportContract().samples[0]!;
    expect(sample.meta).toEqual({ tab: "general", runId: "r-1" });
  });
});
