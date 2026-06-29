/**
 * Perf baseline driver — runs every built-in scenario 30× via vitest and
 * writes a PerfContract JSON to artifacts/performance/. Mirrors what
 * scripts/perf-baseline.mjs does at runtime, but with TS resolution handled
 * by vitest's own pipeline (no tsx/esbuild-register required).
 *
 * Usage:
 *   pnpm exec vitest run scripts/perf-baseline.test.ts
 *   pnpm exec vitest run scripts/perf-baseline.test.ts -- --output artifacts/perf/baseline.json --iterations 30
 *
 * Exit codes (vitest convention):
 *   0 — completed
 *   non-zero — vitest failure path
 */
import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

function arg(name: string, fallback: string): string {
  // Prefer env vars (vitest workers forward env, but strip user argv).
  // Fall back to argv for direct `node ...` runs.
  const envKey = `MW_PERF_${name.toUpperCase()}`;
  if (process.env[envKey]) return process.env[envKey]!;
  const prefix = `--${name}=`;
  for (const a of process.argv) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === `--${name}`) return process.argv[i + 1]!;
  }
  return fallback;
}

describe("perf baseline", () => {
  it("writes a PerfContract JSON with N samples per scenario", async () => {
    const iterations = Number(arg("iterations", "30"));
    const outPath = resolve(arg("output", "artifacts/performance/baseline.json"));
    const baselineMode =
      process.env.MW_PERF_BASELINE === "1" || process.argv.includes("--baseline");

    const { createHarness, BUILT_IN_SCENARIOS } = await import("../../src/lib/perf/harness");
    const harness = createHarness({
      build: baselineMode ? "baseline-legacy" : "current",
      platform: process.platform === "darwin" ? "darwin" : "unknown",
      transport: "node",
    });

    const summary = await harness.runAll(iterations, {
      baselineMode,
      latencyMs: 40,
    });

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, harness.exportJson());

    // Surface the per-scenario rollup in the vitest log so it's visible
    // without opening the JSON.
    const lines = summary.byScenario.map(
      (s) =>
        `  ${s.scenario.padEnd(34)} p50=${s.p50.toFixed(2)}ms p95=${s.p95.toFixed(2)}ms ` +
        `max=${s.max.toFixed(2)}ms fail=${(s.failureRate * 100).toFixed(1)}% (n=${s.n})`,
    );
    process.stdout.write(
      `\nperf-baseline → ${outPath}\n` +
        `scenarios=${BUILT_IN_SCENARIOS.length} iterations=${iterations} mode=${baselineMode ? "baseline" : "current"}\n` +
        lines.join("\n") +
        "\n",
    );

    expect(summary.byScenario.length).toBe(BUILT_IN_SCENARIOS.length);
    for (const s of summary.byScenario) {
      expect(s.n).toBeGreaterThanOrEqual(iterations);
    }
    expect(existsSync(outPath)).toBe(true);
  }, 120_000);
});
