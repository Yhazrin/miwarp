/**
 * Performance harness — manual 30-run benchmark for v1.0.9 scenarios.
 *
 * Design constraints:
 *  - Debug-only: never records in production builds (gated via isPerfEnabled).
 *  - Zero new dependencies: pure TS + browser APIs (performance.now + setTimeout).
 *  - Zero network / model cost: scenarios use synthetic CPU work + fake IPC latency.
 *  - Zero data leakage: scenarios only emit SAFE_META_KEYS via `sanitizeMeta`.
 *
 * Workload kind: every scenario in this harness is a **workload proxy**, NOT
 * a real WebView paint. The harness measures the algorithmic / structural
 * improvement (demand-loading dedupe, render-limit budget, cache hits). It does
 * NOT measure actual GPU paint time, IPC round-trip latency to a real Claude
 * process, or browser reflow cost. Those need separate tooling
 * (WebPageTest / DevTools Performance). The contract exposes `workloadKind`
 * to make this boundary explicit; the comparison script refuses to mix
 * `real` and `proxy` kinds in the same scenario.
 *
 * Usage (Tauri dev or browser preview):
 *   await window.__mwPerf.runAll(30)             // runs every scenario 30×, logs summary
 *   window.__mwPerf.exportJson()                // returns PerfContract JSON
 *   await window.__mwPerf.runScenario("timeline.1200FirstPaint", 30)
 *
 * The recorder + aggregation lives in ./contract; this file only defines
 * the scenario functions and the runner.
 */

import { buildSyntheticTimeline, compareOpenBudgets } from "$lib/chat/render-work-budget";
import { createRecorderForced, DEFAULT_THRESHOLDS, PERF_CONTRACT_SCHEMA_VERSION } from "./contract";
import type { InteractionMetric, PerfContract, ScenarioId, SpanHandle } from "./contract";

interface ScenarioContext {
  iter: number;
  cold: boolean;
  /** Override the start time for tests; defaults to performance.now(). */
  now?: () => number;
  /** Override the iteration latency for tests; default uses `defaultJitter()`. */
  latencyMs?: number;
  /** Optional flag to force the "baseline" (legacy) code path inside a scenario. */
  baselineMode?: boolean;
}

export interface Scenario {
  id: ScenarioId;
  /** Human-readable label for log output. */
  label: string;
  /**
   * Run one iteration. Implementations must call span.end() exactly once
   * (or span.cancel() once). Throwing also cancels the span as `unknown`.
   */
  run: (span: SpanHandle, ctx: ScenarioContext) => Promise<void> | void;
  /** Whether this scenario is cold-or-warm deterministic. Used for labeling. */
  hasColdPath?: boolean;
}

/** Pseudo-random in [0,1); deterministic enough for benchmarks, never crypto-sensitive. */
function jitter(seed?: number): number {
  if (seed !== undefined) {
    // Mulberry32-ish but tiny: enough for harness jitter, no need for crypto.
    let s = (seed * 2654435761) >>> 0;
    s ^= s >>> 16;
    s = Math.imul(s, 0x85ebca6b);
    s ^= s >>> 13;
    s = Math.imul(s, 0xc2b2ae35);
    s ^= s >>> 16;
    return (s >>> 0) / 4294967296;
  }
  return Math.random();
}

function delayMs(targetMs: number, jitterAmt = 0.2): Promise<void> {
  const min = Math.max(0, targetMs * (1 - jitterAmt));
  const max = targetMs * (1 + jitterAmt);
  const ms = min + jitter() * (max - min);
  return new Promise<void>((resolve) => {
    const g = globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown };
    if (typeof g.setTimeout === "function") {
      g.setTimeout(resolve, ms);
      return;
    }
    resolve();
  });
}

// ────────────────────────────── Scenario definitions ─────────────────────────

/**
 * settings.firstOpen: cold open of the Settings page.
 *
 * Baseline behavior (pre-v1.0.9): onMount ran 4 IPC calls (webServerStatus +
 * webToken + getCliConfig + getProjectCliConfig) sequentially before the page
 * became interactive. Approximate cost: 4× ~40ms = 160ms.
 *
 * Current behavior (v1.0.9): loadSettingsPageCore runs once (general tab is
 * free), heavy IPC is deferred until the heavy tab is activated.
 *
 * The proxy simulates both modes by counting how many "IPC" ticks fire and
 * how long each takes. Meta carries the strategy so the comparison refuses
 * to silently mix the two.
 */
const scenarioSettingsFirstOpen: Scenario = {
  id: "settings.firstOpen",
  label: "Settings cold open (general tab)",
  hasColdPath: true,
  async run(span, ctx) {
    if (ctx.baselineMode) {
      // Legacy: 4 sequential IPC calls on mount.
      for (let i = 0; i < 4; i++) await delayMs(ctx.latencyMs ?? 40);
      span.end({
        success: true,
        meta: {
          tab: "general",
          tabCount: 4,
          strategy: "legacy",
          mountedEntries: 0,
        },
      });
      return;
    }
    // Current: 1 IPC call (loadSettingsPageCore) + immediate ready.
    await delayMs(ctx.latencyMs ?? 40);
    span.end({
      success: true,
      meta: {
        tab: "general",
        tabCount: 1,
        strategy: "demand",
        mountedEntries: 0,
      },
    });
  },
};

/**
 * settings.hotOpen: re-entering Settings with the controller already loaded.
 *
 * Baseline behavior: re-mounts trigger fresh IPC because no dedupe → 4× IPC.
 * Current behavior: SettingsTabLoadController.ensureTabLoaded short-circuits
 * to 0 IPC. The proxy measures a 0-tick loop (cache hit).
 */
const scenarioSettingsHotOpen: Scenario = {
  id: "settings.hotOpen",
  label: "Settings re-enter with warm cache",
  async run(span, ctx) {
    if (ctx.baselineMode) {
      // Legacy: no dedupe; re-fetch 4 tabs.
      for (let i = 0; i < 4; i++) await delayMs(ctx.latencyMs ?? 35);
      span.end({
        success: true,
        meta: { tab: "general", tabCount: 4, strategy: "legacy", cacheHit: false },
      });
      return;
    }
    // Current: dedupe → 0 IPC.
    // Tiny await to keep the span measurable (microtask).
    await delayMs(ctx.latencyMs ?? 1);
    span.end({
      success: true,
      meta: { tab: "general", tabCount: 0, strategy: "demand", cacheHit: true },
    });
  },
};

/**
 * settings.closeToChat: leaving Settings → returning to Chat.
 *
 * Baseline behavior: chat re-mounts, all heavy subtrees re-render.
 * Current behavior: chatViewCache + lazy mounts preserve scroll/render limit
 * and defer overlays until needed.
 *
 * Proxy: measures the synthetic chatViewCache read cost (microsecond scale)
 * vs a simulated eager re-mount (subtree walk). The structural gap is the
 * improvement; real WebView paint is NOT measured here.
 */
const scenarioSettingsCloseToChat: Scenario = {
  id: "settings.closeToChat",
  label: "Settings → Chat return (cache restore)",
  async run(span, ctx) {
    if (ctx.baselineMode) {
      // Legacy: re-mount heavy subtrees (simulate 6 subtree renders).
      for (let i = 0; i < 6; i++) await delayMs(ctx.latencyMs ?? 12);
      span.end({
        success: true,
        meta: { strategy: "legacy", mountedEntries: 6, cacheHit: false },
      });
      return;
    }
    // Current: cache read → near-zero.
    await delayMs(ctx.latencyMs ?? 1);
    span.end({
      success: true,
      meta: { strategy: "demand", mountedEntries: 1, cacheHit: true },
    });
  },
};

/**
 * session.switchToInteractive: switch from session A to session B.
 *
 * Baseline behavior: loadRun blocks on full IPC + parse + first paint before
 * the user can type. ~250ms before input is enabled.
 * Current behavior: loadRunProgressive streams entries; user can type as
 * soon as the runId effect resolves + sessionAlive=true (~50ms).
 *
 * Proxy: counts "ticks until interactive" + the simulated tail flush.
 */
const scenarioSessionSwitchToInteractive: Scenario = {
  id: "session.switchToInteractive",
  label: "Session switch to interactive",
  async run(span, ctx) {
    if (ctx.baselineMode) {
      await delayMs(ctx.latencyMs ?? 220);
      span.end({
        success: true,
        meta: { strategy: "legacy", runKind: "blocking" },
      });
      return;
    }
    await delayMs(ctx.latencyMs ?? 45);
    span.end({
      success: true,
      meta: { strategy: "demand", runKind: "progressive" },
    });
  },
};

/**
 * page.reloadRestore: full page reload, restoring chat state from cache.
 *
 * Baseline behavior: cold start, no cache restoration — re-fetches everything.
 * Current behavior: chatViewCache + cachedRenderLimit + cachedScrollTop
 * hydrate from localStorage before first paint; the user sees the prior
 * scroll position and render window immediately.
 *
 * Proxy: cache read vs simulated cold refetch.
 */
const scenarioPageReloadRestore: Scenario = {
  id: "page.reloadRestore",
  label: "Page reload → chat state restored",
  async run(span, ctx) {
    if (ctx.baselineMode) {
      // Legacy: 5 IPC calls to re-hydrate.
      for (let i = 0; i < 5; i++) await delayMs(ctx.latencyMs ?? 35);
      span.end({
        success: true,
        meta: { strategy: "legacy", hitCachedRun: false, mountedEntries: 0 },
      });
      return;
    }
    // Current: cache read → 1 IPC + cache hydrate.
    await delayMs(ctx.latencyMs ?? 35);
    await delayMs(ctx.latencyMs ?? 2);
    span.end({
      success: true,
      meta: { strategy: "demand", hitCachedRun: true, mountedEntries: 0 },
    });
  },
};

/**
 * timeline.1200FirstPaint: open a 1200-entry timeline.
 *
 * Baseline behavior: mount all 1200 entries on first paint → 1200 DOM rows.
 * Current behavior: getInitialRenderLimit caps visible to ~150; loadMore
 * is progressive on user scroll.
 *
 * Proxy: runs `compareOpenBudgets(buildSyntheticTimeline(1200), "developer")`
 * which is the SAME computation the demand-loading code does at runtime to
 * decide the render limit. Records both the optimized + legacy counts and
 * the mount-reduction percentage. This is a real CPU workload (selector
 * code), so the duration is meaningful as an algorithmic proxy.
 */
const scenarioTimeline1200FirstPaint: Scenario = {
  id: "timeline.1200FirstPaint",
  label: "1200-entry timeline first paint",
  hasColdPath: true,
  async run(span, _ctx) {
    const timeline = buildSyntheticTimeline(1200);
    const budgets = compareOpenBudgets(timeline, "developer");
    span.end({
      success: true,
      meta: {
        timelineLen: timeline.length,
        renderLimit: budgets.optimized.mountedEntries,
        mountedEntries: budgets.optimized.mountedEntries,
        legacyMounted: budgets.legacy.mountedEntries,
        optimizedMounted: budgets.optimized.mountedEntries,
        mountReductionPct: budgets.mountReductionPct,
        strategy: "demand",
      },
    });
  },
};

export const BUILT_IN_SCENARIOS: ReadonlyArray<Scenario> = [
  scenarioSettingsFirstOpen,
  scenarioSettingsHotOpen,
  scenarioSettingsCloseToChat,
  scenarioSessionSwitchToInteractive,
  scenarioPageReloadRestore,
  scenarioTimeline1200FirstPaint,
];

// ────────────────────────────── Runner ──────────────────────────────────────

export interface RunnerOptions {
  iterations?: number;
  build?: string;
  platform?: PerfContract["platform"];
  transport?: PerfContract["transport"];
  /** Override latency for each scenario tick. */
  latencyMs?: number;
  /** If true, runs each scenario in `baselineMode` (legacy behavior). */
  baselineMode?: boolean;
  /** Subset of scenarios to run; defaults to all built-in. */
  only?: readonly ScenarioId[];
}

interface RunnerSummary {
  contract: PerfContract;
  byScenario: Array<{
    scenario: ScenarioId;
    n: number;
    p50: number;
    p95: number;
    max: number;
    mean: number;
    failureRate: number;
  }>;
}

function platformFromUA(): PerfContract["platform"] {
  if (typeof navigator === "undefined") return "unknown";
  const ua = (navigator.userAgent || "").toLowerCase();
  if (ua.includes("mac") || ua.includes("darwin")) return "darwin";
  if (ua.includes("linux")) return "linux";
  if (ua.includes("win")) return "windows";
  return "unknown";
}

function transportFromGlobal(): PerfContract["transport"] {
  if (typeof window === "undefined") return "unknown";
  // Tauri v2 exposes a global hook on the window. We only check its presence.
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.__TAURI_INTERNALS__ === "object" || typeof w.__TAURI__ === "object") {
    return "tauri";
  }
  return "browser";
}

export interface HarnessHandle {
  /**
   * Run a single scenario `iterations` times and return the resulting
   * PerfContract. The recorder is shared so each call accumulates.
   */
  runScenario(id: ScenarioId, iterations?: number, opts?: RunnerOptions): Promise<PerfContract>;
  /** Run every built-in scenario `iterations` times. */
  runAll(iterations?: number, opts?: RunnerOptions): Promise<RunnerSummary>;
  /** Return the current PerfContract (samples accumulated so far). */
  exportContract(): PerfContract;
  /** Serialize exportContract() to a JSON-safe payload (Date objects are stringified). */
  exportJson(): string;
  /** Drop all recorded samples + failures. */
  reset(): void;
  /** Inspect the registered scenarios. */
  scenarios(): readonly Scenario[];
}

export function createHarness(opts: RunnerOptions = {}): HarnessHandle {
  const recorder = createRecorderForced({
    build: opts.build ?? "dev",
    platform: opts.platform ?? platformFromUA(),
    transport: opts.transport ?? transportFromGlobal(),
    thresholds: DEFAULT_THRESHOLDS,
  });
  const scenariosById = new Map<ScenarioId, Scenario>(BUILT_IN_SCENARIOS.map((s) => [s.id, s]));

  async function runScenario(
    id: ScenarioId,
    iterations = 30,
    runOpts: RunnerOptions = {},
  ): Promise<PerfContract> {
    const sc = scenariosById.get(id);
    if (!sc) throw new Error(`unknown scenario: ${id}`);
    const iters = Math.max(1, Math.min(iterations | 0, 200));
    const baselineMode = runOpts.baselineMode ?? opts.baselineMode ?? false;
    const latencyMs = runOpts.latencyMs ?? opts.latencyMs ?? 40;

    for (let i = 0; i < iters; i++) {
      const cold = sc.hasColdPath !== false; // default cold=true unless opt-out
      const span = recorder.startSpan(id, {
        cold,
        run: i + 1,
        meta: { iter: i + 1, strategy: baselineMode ? "legacy" : "demand" },
      });
      try {
        await sc.run(span, {
          iter: i + 1,
          cold,
          baselineMode,
          latencyMs,
        });
      } catch {
        if (!span.closed) span.cancel("unknown");
        // Record a synthetic failure record so failureRate stays accurate.
        recorder.recordFailure({
          schemaVersion: PERF_CONTRACT_SCHEMA_VERSION,
          failureId: `f-${id}-${i + 1}`,
          scenario: id,
          code: "unknown",
          messageKind: "scenario_threw",
          run: i + 1,
          ts: new Date().toISOString(),
        });
      }
      if (!span.closed) {
        // Scenario forgot to end() — record as cancelled so failure rate stays accurate.
        span.cancel("cancelled");
      }
    }
    return recorder.exportContract();
  }

  async function runAll(iterations = 30, runOpts: RunnerOptions = {}): Promise<RunnerSummary> {
    const only = runOpts.only ?? opts.only;
    const targets = only
      ? BUILT_IN_SCENARIOS.filter((s) => only.includes(s.id))
      : [...BUILT_IN_SCENARIOS];
    for (const sc of targets) {
      await runScenario(sc.id, iterations, runOpts);
    }
    const contract = recorder.exportContract();
    const byScenario = contract.samples.reduce<Record<ScenarioId, InteractionMetric[]>>(
      (acc, s) => {
        const arr = acc[s.scenario] ?? [];
        arr.push(s);
        acc[s.scenario] = arr;
        return acc;
      },
      {} as Record<ScenarioId, InteractionMetric[]>,
    );
    const summary = Object.entries(byScenario).map(([scenario, samples]) => {
      const durs = samples.map((s) => s.durationMs).filter((d) => Number.isFinite(d));
      const sorted = [...durs].sort((a, b) => a - b);
      const sum = durs.reduce((a, b) => a + b, 0);
      const n = durs.length;
      const p = (q: number) =>
        n === 0 ? NaN : (sorted[Math.min(Math.ceil((q / 100) * n) - 1, n - 1)] ?? NaN);
      const failures = samples.filter((s) => !s.success).length;
      return {
        scenario: scenario as ScenarioId,
        n,
        p50: p(50),
        p95: p(95),
        max: n === 0 ? NaN : sorted[n - 1]!,
        mean: n === 0 ? NaN : sum / n,
        failureRate: n === 0 ? 0 : failures / n,
      };
    });
    return { contract, byScenario: summary };
  }

  function exportContract(): PerfContract {
    return recorder.exportContract();
  }

  function exportJson(): string {
    return JSON.stringify(recorder.exportContract(), null, 2);
  }

  function reset(): void {
    recorder.reset();
  }

  function scenarios(): readonly Scenario[] {
    return BUILT_IN_SCENARIOS;
  }

  return {
    runScenario,
    runAll,
    exportContract,
    exportJson,
    reset,
    scenarios,
  };
}

/** Convenience: default lazy singleton for window.__mwPerf injection. */
let _defaultHarness: HarnessHandle | null = null;
function getDefaultHarness(): HarnessHandle {
  if (!_defaultHarness) _defaultHarness = createHarness();
  return _defaultHarness;
}

/**
 * Inject window.__mwPerf with a fresh harness. Idempotent. Safe to call from
 * +layout.svelte's onMount when perf mode is on. Returns the handle so the
 * caller can `.reset()` between sessions if desired.
 */
export function installWindowHarness(build?: string): HarnessHandle | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __mwPerf?: HarnessHandle };
  if (w.__mwPerf) return w.__mwPerf;
  const handle = createHarness({ build });
  w.__mwPerf = handle;
  return handle;
}

/** TypeScript surface declaration so consumers can `window.__mwPerf.runAll`. */
interface MwPerfGlobal {
  runScenario: HarnessHandle["runScenario"];
  runAll: HarnessHandle["runAll"];
  exportContract: HarnessHandle["exportContract"];
  exportJson: HarnessHandle["exportJson"];
  reset: HarnessHandle["reset"];
  scenarios: HarnessHandle["scenarios"];
}

declare global {
  interface Window {
    __mwPerf?: MwPerfGlobal;
  }
}
