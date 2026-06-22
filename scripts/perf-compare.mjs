#!/usr/bin/env node
/**
 * perf-compare.mjs — Node comparison script for v1.0.9 perf contracts.
 *
 * Reads two PerfContract JSON files (baseline + current) and applies the
 * 70% latency / 90% failure-rate gates. Exits non-zero if any scenario
 * fails or is rejected for insufficient samples.
 *
 * Usage:
 *   node scripts/perf-compare.mjs <baseline.json> <current.json>
 *   node scripts/perf-compare.mjs --latency 80 --failure 95 <baseline> <current>
 *   node scripts/perf-compare.mjs --json <baseline> <current>   # machine-readable
 *
 * Inputs:
 *   - JSON file matching the PerfContract schema (see src/lib/perf/contract.ts)
 *
 * Output:
 *   - Human-readable summary on stdout by default
 *   - JSON on stdout with --json (--quiet suppresses the summary)
 *
 * Exit codes:
 *   0 — passed (or --dry-run)
 *   1 — at least one scenario failed the gate
 *   2 — input missing or invalid
 *   3 — sample rejection (one side below minSamples)
 *
 * Zero npm deps. Pure Node 20+ stdlib.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCHEMA_VERSION = 1;

function parseArgs(argv) {
  const args = { latency: 70, failure: 90, minSamples: 30, anomalyTrim: 5 };
  const positional = [];
  let json = false;
  let quiet = false;
  let dryRun = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--latency") args.latency = Number(argv[++i]);
    else if (a === "--failure") args.failure = Number(argv[++i]);
    else if (a === "--min-samples") args.minSamples = Number(argv[++i]);
    else if (a === "--anomaly-trim") args.anomalyTrim = Number(argv[++i]);
    else if (a === "--json") json = true;
    else if (a === "--quiet") quiet = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else if (a.startsWith("--")) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 2) {
    throw new Error("expected exactly two positional args: <baseline.json> <current.json>");
  }
  return { ...args, baseline: positional[0], current: positional[1], json, quiet, dryRun };
}

function printHelp() {
  process.stdout.write(
    [
      "perf-compare.mjs — compare two PerfContract JSON files",
      "",
      "Usage:",
      "  node scripts/perf-compare.mjs [flags] <baseline.json> <current.json>",
      "",
      "Flags:",
      "  --latency <pct>       latency improvement threshold (default 70)",
      "  --failure <pct>       failure reduction threshold (default 90)",
      "  --min-samples <n>     minimum samples per side (default 30)",
      "  --anomaly-trim <pct>  trim top/bottom anomaly pct (default 5)",
      "  --json                emit JSON only (no human summary)",
      "  --quiet               suppress human summary even without --json",
      "  --dry-run             exit 0 unconditionally; print verdict",
      "",
      "Exit codes:",
      "  0  passed",
      "  1  failed (scenario(s) below threshold)",
      "  2  bad input",
      "  3  sample rejection (one side below minSamples)",
      "",
    ].join("\n"),
  );
}

function loadJson(path) {
  const abs = resolve(path);
  let raw;
  try {
    raw = readFileSync(abs, "utf8");
  } catch (e) {
    throw new Error(`cannot read ${abs}: ${e.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`invalid JSON in ${abs}: ${e.message}`);
  }
  if (parsed?.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `${abs}: schemaVersion mismatch (expected ${SCHEMA_VERSION}, got ${parsed?.schemaVersion})`,
    );
  }
  if (!Array.isArray(parsed.samples)) {
    throw new Error(`${abs}: missing samples[]`);
  }
  if (!Array.isArray(parsed.failures)) {
    throw new Error(`${abs}: missing failures[]`);
  }
  return parsed;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  if (p === 0) return sorted[0];
  if (p === 100) return sorted[sorted.length - 1];
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(rank - 1, sorted.length - 1);
  return sorted[idx];
}

function trimSorted(sorted, trimPct) {
  if (sorted.length === 0) return [];
  const cut = Math.floor((sorted.length * trimPct) / 100);
  const start = Math.min(cut, sorted.length - 1);
  const end = Math.max(sorted.length - cut, start + 1);
  return sorted.slice(start, end);
}

function aggregate(values, anomalyTrimPct) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) {
    return { n: 0, dropped: 0, p50: NaN, p95: NaN, max: NaN, mean: NaN };
  }
  const sorted = [...finite].sort((a, b) => a - b);
  const trimmed = trimSorted(sorted, anomalyTrimPct);
  const sum = trimmed.reduce((a, b) => a + b, 0);
  return {
    n: trimmed.length,
    dropped: sorted.length - trimmed.length,
    p50: percentile(trimmed, 50),
    p95: percentile(trimmed, 95),
    max: trimmed[trimmed.length - 1],
    mean: sum / trimmed.length,
  };
}

function aggregateFailures(samples, failures) {
  const total = samples.length;
  const failureCount = samples.filter((s) => !s.success).length;
  const byCode = { cancelled: 0, timeout: 0, rejected: 0, stale: 0, unknown: 0 };
  for (const f of failures) {
    if (byCode[f.code] !== undefined) byCode[f.code] += 1;
  }
  return { total, rate: total === 0 ? 0 : failureCount / total, byCode };
}

function groupBy(items, keyFn) {
  const out = new Map();
  for (const item of items) {
    const k = keyFn(item);
    const arr = out.get(k);
    if (arr) arr.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function compare(baseline, current, opts) {
  const baseBy = groupBy(baseline.samples, (s) => s.scenario);
  const currBy = groupBy(current.samples, (s) => s.scenario);
  const scenarios = [];
  const rejected = [];
  const union = new Set([...baseBy.keys(), ...currBy.keys()]);

  for (const scenario of union) {
    const bs = baseBy.get(scenario) ?? [];
    const cs = currBy.get(scenario) ?? [];
    if (bs.length < opts.minSamples) {
      rejected.push({
        scenario,
        reason: `baseline samples ${bs.length} < minSamples ${opts.minSamples}`,
      });
      continue;
    }
    if (cs.length < opts.minSamples) {
      rejected.push({
        scenario,
        reason: `current samples ${cs.length} < minSamples ${opts.minSamples}`,
      });
      continue;
    }
    if (bs.some((s) => s.workloadKind !== cs[0].workloadKind)) {
      rejected.push({
        scenario,
        reason: `baseline/current workloadKind mismatch (${bs[0].workloadKind} vs ${cs[0].workloadKind})`,
      });
      continue;
    }
    const baseDurs = bs.map((s) => s.durationMs);
    const currDurs = cs.map((s) => s.durationMs);
    const baseAgg = aggregate(baseDurs, opts.anomalyTrim);
    const currAgg = aggregate(currDurs, opts.anomalyTrim);
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

    const latencyOk = latencyImprovementPct >= opts.latency;
    const failureOk =
      baseFails.rate === 0
        ? currFails.rate === 0
        : failureReductionPct >= opts.failure;
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
      workloadKind: cs[0].workloadKind,
    });
  }

  const allPassed = scenarios.every((s) => s.passed) && rejected.length === 0;
  return { passed: allPassed, scenarios, rejected };
}

function printHuman(result, opts) {
  const lines = [];
  lines.push(
    `thresholds: latency>=${opts.latency}% failure>=${opts.failure}% minSamples=${opts.minSamples}`,
  );
  for (const s of result.scenarios) {
    lines.push(
      `  ${s.passed ? "PASS" : "FAIL"} ${s.scenario.padEnd(34)} kind=${s.workloadKind.padEnd(5)} ` +
        `p95 ${s.baselineP95.toFixed(1)}→${s.currentP95.toFixed(1)}ms (${s.latencyImprovementPct}%) ` +
        `failRate ${(s.baselineFailureRate * 100).toFixed(1)}→${(s.currentFailureRate * 100).toFixed(1)}% (${s.failureReductionPct}%)`,
    );
  }
  for (const r of result.rejected) {
    lines.push(`  REJECT ${r.scenario.padEnd(34)} ${r.reason}`);
  }
  lines.push(result.passed ? "OVERALL: PASS" : "OVERALL: FAIL");
  process.stdout.write(lines.join("\n") + "\n");
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(2);
  }

  let baseline, current;
  try {
    baseline = loadJson(opts.baseline);
    current = loadJson(opts.current);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(2);
  }

  const result = compare(baseline, current, opts);

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({ thresholds: opts, ...result }, null, 2) + "\n",
    );
  } else if (!opts.quiet) {
    printHuman(result, opts);
  }

  if (opts.dryRun) process.exit(0);
  if (!result.passed) {
    const hasRejection = result.rejected.length > 0;
    process.exit(hasRejection ? 3 : 1);
  }
  process.exit(0);
}

main();
