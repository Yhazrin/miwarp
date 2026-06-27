/**
 * v1.1.0-rc.1 perf baseline snapshot — runs the 6 BUILT_IN_SCENARIOS
 * 30 times each and writes ~/.miwarp/perf-snapshot.json. Mirrors the
 * contract exposed via window.__mwPerf in the webview.
 *
 * Run with: pnpm test src/lib/perf/__tests__/rc-snapshot.test.ts
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createHarness, BUILT_IN_SCENARIOS } from "../harness";

describe("v1.1.0-rc.1 perf snapshot", () => {
  it("runs all 6 built-in scenarios 30 times and writes perf-snapshot.json", async () => {
    const h = createHarness({ build: "rc1", latencyMs: 5 });
    const summary = await h.runAll(30);

    expect(summary.contract.samples.length).toBe(BUILT_IN_SCENARIOS.length * 30);
    expect(summary.byScenario.length).toBe(BUILT_IN_SCENARIOS.length);

    const dest = join(homedir(), ".miwarp/perf-snapshot.json");
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, JSON.stringify(summary.contract, null, 2), "utf8");

    const lines: string[] = [];
    lines.push(`# v1.1.0-rc.1 perf snapshot — ${new Date().toISOString()}`);
    lines.push("");
    for (const sc of summary.byScenario) {
      lines.push(
        `- ${sc.scenario} (n=${sc.n}) — p50=${sc.p50.toFixed(2)}ms p95=${sc.p95.toFixed(2)}ms max=${sc.max.toFixed(2)}ms mean=${sc.mean.toFixed(2)}ms fail=${(sc.failureRate * 100).toFixed(1)}%`,
      );
    }

    console.log("\n" + lines.join("\n") + `\n\nWrote ${dest}`);

    expect(summary.byScenario.length).toBeGreaterThan(0);
  });
});
