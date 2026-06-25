/**
 * Helper to summarize the perf-snapshot.json into a markdown table.
 * Pure data extraction, no test framework needed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const path = join(homedir(), ".miwarp/perf-snapshot.json");
const data = JSON.parse(readFileSync(path, "utf8"));

const byScenario = new Map();
for (const s of data.samples) {
  if (!byScenario.has(s.scenario)) byScenario.set(s.scenario, []);
  byScenario.get(s.scenario).push(s.durationMs);
}

const lines = [];
lines.push(`# v1.1.0-rc.1 perf baseline — ${data.capturedAt}`);
lines.push("");
lines.push(`build: ${data.build}, platform: ${data.platform}, transport: ${data.transport}`);
lines.push("");
lines.push("| scenario | n | p50 (ms) | p95 (ms) | max (ms) | mean (ms) | fail |");
lines.push("|---|---|---|---|---|---|---|");

for (const [scenario, durs] of [...byScenario.entries()].sort()) {
  const sorted = [...durs].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (q) => sorted[Math.min(n - 1, Math.floor((q / 100) * n))];
  const p50 = p(50);
  const p95 = p(95);
  const max = sorted[n - 1];
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const failures = data.samples.filter((s) => s.scenario === scenario && !s.success).length;
  const failPct = ((failures / n) * 100).toFixed(1);
  lines.push(
    `| ${scenario} | ${n} | ${p50.toFixed(2)} | ${p95.toFixed(2)} | ${max.toFixed(2)} | ${mean.toFixed(2)} | ${failPct}% |`,
  );
}
console.log(lines.join("\n"));
