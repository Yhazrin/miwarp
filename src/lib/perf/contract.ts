/**
 * Performance contract for v1.0.9.
 *
 * Single source of truth for measurement schema, span lifecycle, sample
 * aggregation, and threshold gating. Zero runtime dependencies. Designed
 * to be:
 *  - deterministic (testable in node + browser without flake)
 *  - safe (no prompt, no token, no env, no message body can land in a sample)
 *  - cheap in production (compile-time gated; no observable side effects when off)
 *
 * Layered:
 *  - types: InteractionMetric / FailureMetric / PerfContract / Thresholds
 *  - recorder: createRecorder() owns the in-memory sample buffer + span handles
 *  - aggregate: percentile / anomaly-trim / failure-rate math (pure functions)
 *  - gate: compareBaselines() applies the 70%/90% rule with rejection logic
 *
 * NO recording is performed by importing this module; measurement requires
 * calling `createRecorder()` and either wrapping the workload in `startSpan`
 * or pushing `samples.push(...)` directly. In production builds (`import.meta.env.PROD`)
 * the `createRecorder()` returns a no-op recorder (compile-time constant).
 */

import { isPerfEnabled } from "$lib/utils/perf";

export const PERF_CONTRACT_SCHEMA_VERSION = 1 as const;

export type ScenarioId =
  | "settings.firstOpen"
  | "settings.hotOpen"
  | "settings.closeToChat"
  | "session.switchToInteractive"
  | "page.reloadRestore"
  | "timeline.1200FirstPaint";

export const ALL_SCENARIOS: readonly ScenarioId[] = [
  "settings.firstOpen",
  "settings.hotOpen",
  "settings.closeToChat",
  "session.switchToInteractive",
  "page.reloadRestore",
  "timeline.1200FirstPaint",
] as const;

export type FailureCode = "cancelled" | "timeout" | "rejected" | "stale" | "unknown";

export type WorkloadKind = "proxy" | "real";

export interface InteractionMetric {
  schemaVersion: typeof PERF_CONTRACT_SCHEMA_VERSION;
  scenario: ScenarioId;
  durationMs: number;
  success: boolean;
  code?: FailureCode;
  workloadKind: WorkloadKind;
  workloadUnits?: number;
  cold: boolean;
  run: number;
  meta?: Record<string, string | number | boolean>;
  ts: string;
}

export interface FailureMetric {
  schemaVersion: typeof PERF_CONTRACT_SCHEMA_VERSION;
  failureId: string;
  scenario: ScenarioId;
  code: FailureCode;
  messageKind: string;
  run: number;
  ts: string;
}

export interface PerfContract {
  schemaVersion: typeof PERF_CONTRACT_SCHEMA_VERSION;
  capturedAt: string;
  build: string;
  platform: "darwin" | "linux" | "windows" | "unknown";
  transport: "tauri" | "browser" | "unknown";
  thresholds: Required<Thresholds>;
  samples: InteractionMetric[];
  failures: FailureMetric[];
}

export interface Thresholds {
  latencyImprovementPct: number;
  failureReductionPct: number;
  minSamples: number;
  anomalyTrimPct: number;
}

export const DEFAULT_THRESHOLDS: Required<Thresholds> = {
  latencyImprovementPct: 70,
  failureReductionPct: 90,
  minSamples: 30,
  anomalyTrimPct: 5,
};

/**
 * SAFE_META_KEYS is the explicit allow-list for `meta` fields. Anything not in
 * this set is dropped at the recorder boundary to prevent accidental leakage
 * of prompt, tokens, env vars, or message bodies. Values are also size-capped
 * (strings ≤ 64 chars, numbers finite).
 */
export const SAFE_META_KEYS: ReadonlySet<string> = new Set([
  "tab",
  "tabCount",
  "cachedTabs",
  "runId",
  "cold",
  "iter",
  "renderLimit",
  "mountedEntries",
  "legacyMounted",
  "optimizedMounted",
  "mountReductionPct",
  "cacheHit",
  "hitCachedRun",
  "switchedFrom",
  "switchedTo",
  "runKind",
  "strategy",
  "timelineLen",
  "tabId",
]);

export function isSafeMetaValue(v: unknown): v is string | number | boolean {
  if (typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") return v.length <= 64;
  return false;
}

export function sanitizeMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!meta) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!SAFE_META_KEYS.has(k)) continue;
    if (!isSafeMetaValue(v)) continue;
    out[k] = v;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * Pure percentile. Input is a non-empty array of finite numbers. `p` in [0, 100].
 * Uses nearest-rank (matches what most monitoring systems emit, predictable in tests).
 */
export function percentile(values: readonly number[], p: number): number {
  if (!Number.isFinite(p) || p < 0 || p > 100) {
    throw new RangeError(`percentile: p must be in [0,100], got ${p}`);
  }
  if (values.length === 0) {
    throw new RangeError("percentile: empty values");
  }
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.some((v) => !Number.isFinite(v))) {
    throw new RangeError("percentile: non-finite value");
  }
  if (p === 0) return sorted[0]!;
  if (p === 100) return sorted[sorted.length - 1]!;
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(rank - 1, sorted.length - 1);
  return sorted[idx]!;
}

/**
 * Trim top + bottom `trimPct` (0–50) percent of an already-sorted numeric array.
 * Returns a new array; does not mutate.
 */
export function trimSorted(sorted: readonly number[], trimPct: number): number[] {
  if (trimPct < 0 || trimPct > 50) {
    throw new RangeError(`trimPct must be in [0,50], got ${trimPct}`);
  }
  if (sorted.length === 0) return [];
  const cut = Math.floor((sorted.length * trimPct) / 100);
  const start = Math.min(cut, sorted.length - 1);
  const end = Math.max(sorted.length - cut, start + 1);
  return sorted.slice(start, end);
}

export interface AggregateResult {
  /** Number of samples included after trim. */
  n: number;
  /** Number of samples dropped before aggregation. */
  dropped: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

/**
 * Aggregate a numeric series into p50/p95/max/mean. Trims top+bottom anomaly
 * windows per `thresholds.anomalyTrimPct`. Returns NaN fields when n=0; never
 * throws on empty input.
 */
export function aggregate(
  values: readonly number[],
  thresholds: Required<Thresholds>,
): AggregateResult {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) {
    return { n: 0, dropped: 0, p50: NaN, p95: NaN, max: NaN, mean: NaN };
  }
  const sorted = [...finite].sort((a, b) => a - b);
  const trimmed = trimSorted(sorted, thresholds.anomalyTrimPct);
  const sum = trimmed.reduce((acc, v) => acc + v, 0);
  return {
    n: trimmed.length,
    dropped: sorted.length - trimmed.length,
    p50: percentile(trimmed, 50),
    p95: percentile(trimmed, 95),
    max: trimmed[trimmed.length - 1]!,
    mean: sum / trimmed.length,
  };
}

export interface FailureAggregate {
  total: number;
  rate: number;
  byCode: Record<FailureCode, number>;
}

/** Failure rate over `samples` (success boolean). Code breakdown from `failures`. */
export function aggregateFailures(
  samples: readonly InteractionMetric[],
  failures: readonly FailureMetric[],
): FailureAggregate {
  const total = samples.length;
  const failureCount = samples.filter((s) => !s.success).length;
  const byCode: Record<FailureCode, number> = {
    cancelled: 0,
    timeout: 0,
    rejected: 0,
    stale: 0,
    unknown: 0,
  };
  for (const f of failures) byCode[f.code] += 1;
  return {
    total,
    rate: total === 0 ? 0 : failureCount / total,
    byCode,
  };
}

// ────────────────────────────── Span lifecycle ──────────────────────────────

export interface SpanHandle {
  readonly id: number;
  readonly scenario: ScenarioId;
  /** Mark this span as finished. Idempotent: subsequent calls are no-ops. */
  end(opts?: { success?: boolean; code?: FailureCode; meta?: Record<string, unknown> }): void;
  /** Cancel before end. Records as failure with the given code (default 'cancelled'). */
  cancel(reason?: FailureCode): void;
  /** True after end() or cancel() was called. */
  readonly closed: boolean;
}

export interface RecorderOptions {
  build?: string;
  now?: () => number;
  iso?: () => string;
  thresholds?: Partial<Thresholds>;
  platform?: PerfContract["platform"];
  transport?: PerfContract["transport"];
  randomId?: () => string;
  /** Test-only: number of chars of workloadUnits emitted by `workloadUnits` aggregator. */
  failureIdFactory?: () => string;
}

export interface Recorder {
  readonly enabled: boolean;
  readonly count: number;
  readonly thresholds: Required<Thresholds>;
  startSpan(
    scenario: ScenarioId,
    opts?: { timeoutMs?: number; meta?: Record<string, unknown>; cold?: boolean; run?: number },
  ): SpanHandle;
  recordSample(metric: InteractionMetric): void;
  recordFailure(failure: FailureMetric): void;
  exportContract(): PerfContract;
  reset(): void;
}

class RealRecorder implements Recorder {
  readonly enabled: boolean;
  readonly thresholds: Required<Thresholds>;
  private samples: InteractionMetric[] = [];
  private failures: FailureMetric[] = [];
  private nextSpanId = 1;
  private readonly build: string;
  private readonly now: () => number;
  private readonly iso: () => string;
  private readonly randomId: () => string;
  private readonly platform: PerfContract["platform"];
  private readonly transport: PerfContract["transport"];

  constructor(opts: RecorderOptions = {}) {
    this.enabled = true;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds ?? {}) };
    this.build = opts.build ?? "unknown";
    this.now =
      opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this.iso = opts.iso ?? (() => new Date().toISOString());
    this.randomId = opts.randomId ?? (() => Math.random().toString(36).slice(2, 10));
    this.platform = opts.platform ?? "unknown";
    this.transport = opts.transport ?? "unknown";
  }

  get count(): number {
    return this.samples.length;
  }

  startSpan(
    scenario: ScenarioId,
    opts: { timeoutMs?: number; meta?: Record<string, unknown>; cold?: boolean; run?: number } = {},
  ): SpanHandle {
    const id = this.nextSpanId++;
    const t0 = this.now();
    let closed = false;
    const span: SpanHandle = {
      id,
      scenario,
      get closed() {
        return closed;
      },
      end: (endOpts = {}) => {
        if (closed) return;
        closed = true;
        const dt = this.now() - t0;
        const success = endOpts.success !== false && endOpts.code === undefined;
        const sample: InteractionMetric = {
          schemaVersion: PERF_CONTRACT_SCHEMA_VERSION,
          scenario,
          durationMs: +dt.toFixed(3),
          success,
          code: endOpts.code,
          workloadKind: "real",
          cold: opts.cold ?? false,
          run: opts.run ?? 0,
          meta: sanitizeMeta({ ...(opts.meta ?? {}), ...(endOpts.meta ?? {}) }),
          ts: this.iso(),
        };
        this.samples.push(sample);
      },
      cancel: (reason: FailureCode = "cancelled") => {
        if (closed) return;
        closed = true;
        const dt = this.now() - t0;
        const sample: InteractionMetric = {
          schemaVersion: PERF_CONTRACT_SCHEMA_VERSION,
          scenario,
          durationMs: +dt.toFixed(3),
          success: false,
          code: reason,
          workloadKind: "real",
          cold: opts.cold ?? false,
          run: opts.run ?? 0,
          meta: sanitizeMeta(opts.meta),
          ts: this.iso(),
        };
        this.samples.push(sample);
        this.failures.push({
          schemaVersion: PERF_CONTRACT_SCHEMA_VERSION,
          failureId: this.randomId(),
          scenario,
          code: reason,
          messageKind: "span_cancel",
          run: opts.run ?? 0,
          ts: this.iso(),
        });
      },
    };

    if (typeof opts.timeoutMs === "number" && opts.timeoutMs > 0) {
      setTimeoutSafe(() => {
        if (closed) return;
        span.cancel("timeout");
      }, opts.timeoutMs);
    }
    return span;
  }

  recordSample(metric: InteractionMetric): void {
    if (metric.schemaVersion !== PERF_CONTRACT_SCHEMA_VERSION) return;
    const safe: InteractionMetric = {
      ...metric,
      meta: sanitizeMeta(metric.meta),
    };
    this.samples.push(safe);
  }

  recordFailure(failure: FailureMetric): void {
    if (failure.schemaVersion !== PERF_CONTRACT_SCHEMA_VERSION) return;
    if (failure.messageKind.length > 64) return;
    this.failures.push(failure);
  }

  exportContract(): PerfContract {
    return {
      schemaVersion: PERF_CONTRACT_SCHEMA_VERSION,
      capturedAt: this.iso(),
      build: this.build,
      platform: this.platform,
      transport: this.transport,
      thresholds: this.thresholds,
      samples: [...this.samples],
      failures: [...this.failures],
    };
  }

  reset(): void {
    this.samples = [];
    this.failures = [];
  }
}

class NoopRecorder implements Recorder {
  readonly enabled = false;
  readonly count = 0;
  readonly thresholds: Required<Thresholds> = { ...DEFAULT_THRESHOLDS };
  startSpan(): SpanHandle {
    return {
      id: 0,
      scenario: "settings.firstOpen",
      get closed() {
        return true;
      },
      end: () => {},
      cancel: () => {},
    };
  }
  recordSample(): void {}
  recordFailure(): void {}
  exportContract(): PerfContract {
    return {
      schemaVersion: PERF_CONTRACT_SCHEMA_VERSION,
      capturedAt: new Date(0).toISOString(),
      build: "noop",
      platform: "unknown",
      transport: "unknown",
      thresholds: { ...DEFAULT_THRESHOLDS },
      samples: [],
      failures: [],
    };
  }
  reset(): void {}
}

/**
 * Wrap setTimeout/setImmediate to remain test-friendly. Tests inject
 * `setTimeoutSafe` via the recorder's `now()` plus synchronous timing; the
 * default uses globalThis.setTimeout when available, and `queueMicrotask`
 * fallback otherwise (defensive: never throws on import).
 */
function setTimeoutSafe(fn: () => void, ms: number): void {
  const g = globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown };
  if (typeof g.setTimeout === "function") {
    g.setTimeout(fn, ms);
    return;
  }
  // last-resort: schedule after the current microtask queue
  if (typeof queueMicrotask === "function") {
    queueMicrotask(fn);
    return;
  }
  fn();
}

/**
 * Production-gated factory. When the gating predicate (compile-time PROD
 * OR runtime perf-enabled) is false, returns a NoopRecorder. Otherwise returns
 * a RealRecorder. The dependency on `isPerfEnabled()` keeps the existing
 * `ocv:debug` / `?debug` contract.
 */
export function createRecorder(opts: RecorderOptions = {}): Recorder {
  if (!isPerfEnabled()) return new NoopRecorder();
  return new RealRecorder(opts);
}

/**
 * Hard-disable factory for tests that need a recording-capable recorder
 * regardless of `isPerfEnabled()`. Used by unit tests + the harness.
 */
export function createRecorderForced(opts: RecorderOptions = {}): Recorder {
  return new RealRecorder(opts);
}

// ────────────────────────────── Comparison gate ──────────────────────────────

export interface ScenarioComparison {
  scenario: ScenarioId;
  baselineN: number;
  currentN: number;
  baselineP95: number;
  currentP95: number;
  baselineP50: number;
  currentP50: number;
  /** Positive = improvement (current faster), negative = regression. */
  latencyImprovementPct: number;
  baselineFailureRate: number;
  currentFailureRate: number;
  /** Positive = improvement (current lower), negative = regression. */
  failureReductionPct: number;
  /** Did this scenario pass both thresholds? */
  passed: boolean;
  /** Rejection reason when neither passed nor failed. */
  rejectedReason?: string;
}

export interface ComparisonResult {
  passed: boolean;
  thresholds: Required<Thresholds>;
  scenarios: ScenarioComparison[];
  rejected: Array<{ scenario: ScenarioId; reason: string }>;
  summary: string;
}

function groupBy<T, K extends string>(items: readonly T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const arr = out.get(k);
    if (arr) arr.push(item);
    else out.set(k, [item]);
  }
  return out;
}

export function compareBaselines(
  baseline: PerfContract,
  current: PerfContract,
  thresholds: Required<Thresholds> = { ...DEFAULT_THRESHOLDS },
): ComparisonResult {
  const baseBy = groupBy(baseline.samples, (s) => s.scenario);
  const currBy = groupBy(current.samples, (s) => s.scenario);
  const scenarios: ScenarioComparison[] = [];
  const rejected: Array<{ scenario: ScenarioId; reason: string }> = [];
  const union: Set<ScenarioId> = new Set([...baseBy.keys(), ...currBy.keys()]);

  for (const scenario of union) {
    const bs = baseBy.get(scenario) ?? [];
    const cs = currBy.get(scenario) ?? [];
    if (bs.length < thresholds.minSamples) {
      rejected.push({
        scenario,
        reason: `baseline samples ${bs.length} < minSamples ${thresholds.minSamples}`,
      });
      continue;
    }
    if (cs.length < thresholds.minSamples) {
      rejected.push({
        scenario,
        reason: `current samples ${cs.length} < minSamples ${thresholds.minSamples}`,
      });
      continue;
    }
    if (bs.some((s) => s.workloadKind !== cs[0]!.workloadKind)) {
      rejected.push({
        scenario,
        reason: "baseline / current workloadKind mismatch — refusing to compare",
      });
      continue;
    }
    const baseDurs = bs.map((s) => s.durationMs);
    const currDurs = cs.map((s) => s.durationMs);
    const baseAgg = aggregate(baseDurs, thresholds);
    const currAgg = aggregate(currDurs, thresholds);
    const baseFails = aggregateFailures(
      bs,
      baseline.failures.filter((f) => f.scenario === scenario),
    );
    const currFails = aggregateFailures(
      cs,
      current.failures.filter((f) => f.scenario === scenario),
    );

    const baseRef = baseAgg.p95 || baseAgg.p50;
    const latencyImprovementPct =
      baseRef === 0 ? 0 : Math.round(((baseRef - currAgg.p95) / baseRef) * 100);
    const failureReductionPct =
      baseFails.rate === 0
        ? currFails.rate === 0
          ? 0
          : -100
        : Math.round(((baseFails.rate - currFails.rate) / baseFails.rate) * 100);

    const latencyOk = latencyImprovementPct >= thresholds.latencyImprovementPct;
    const failureOk =
      baseFails.rate === 0
        ? currFails.rate === 0
        : failureReductionPct >= thresholds.failureReductionPct;
    scenarios.push({
      scenario,
      baselineN: bs.length,
      currentN: cs.length,
      baselineP95: baseAgg.p95,
      currentP95: currAgg.p95,
      baselineP50: baseAgg.p50,
      currentP50: currAgg.p50,
      latencyImprovementPct,
      baselineFailureRate: baseFails.rate,
      currentFailureRate: currFails.rate,
      failureReductionPct,
      passed: latencyOk && failureOk,
    });
  }

  const passed = scenarios.every((s) => s.passed) && rejected.length === 0;
  const lines: string[] = [];
  lines.push(
    `latencyImprovementPct>=${thresholds.latencyImprovementPct} failureReductionPct>=${thresholds.failureReductionPct} minSamples=${thresholds.minSamples}`,
  );
  for (const s of scenarios) {
    lines.push(
      `  ${s.passed ? "PASS" : "FAIL"} ${s.scenario.padEnd(34)} ` +
        `p95 ${s.baselineP95.toFixed(1)}→${s.currentP95.toFixed(1)}ms (${s.latencyImprovementPct}%) ` +
        `failRate ${(s.baselineFailureRate * 100).toFixed(1)}→${(s.currentFailureRate * 100).toFixed(1)}% (${s.failureReductionPct}%)`,
    );
  }
  for (const r of rejected) {
    lines.push(`  REJECT ${r.scenario.padEnd(34)} ${r.reason}`);
  }
  lines.push(passed ? "OVERALL: PASS" : "OVERALL: FAIL");
  return { passed, thresholds, scenarios, rejected, summary: lines.join("\n") };
}
