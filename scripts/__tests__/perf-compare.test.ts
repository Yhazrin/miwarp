/**
 * Vitest wrapper for scripts/perf-compare.mjs.
 *
 * Mirrors the node:test cases in scripts/__tests__/perf-compare.test.mjs so
 * the script is exercised both via `node --test` and `npm test` (vitest).
 * The .mjs source is the authoritative behavior; this file just spawns the
 * script and asserts on exit codes + stdout.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const SCRIPT = resolve(HERE, "../perf-compare.mjs");

function tmpJson(name: string, payload: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "perf-cmp-"));
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(payload));
  return path;
}

function metric(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
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

function contract(scenario: string, durations: number[], failures = 0, kind = "real") {
  const samples = durations.map((d, i) =>
    metric({
      scenario,
      durationMs: d,
      success: failures === 0 || i >= failures,
      code: failures > 0 && i < failures ? "timeout" : undefined,
      workloadKind: kind,
      run: i + 1,
    }),
  );
  const fs = Array.from({ length: failures }, (_, i) => ({
    schemaVersion: 1,
    failureId: `f-${i}`,
    scenario,
    code: "timeout",
    messageKind: "ipc_timeout",
    run: i + 1,
    ts: "2026-06-22T00:00:00.000Z",
  }));
  return {
    schemaVersion: 1,
    capturedAt: "2026-06-22T00:00:00.000Z",
    build: "x",
    platform: "darwin",
    transport: "tauri",
    thresholds: {
      latencyImprovementPct: 70,
      failureReductionPct: 90,
      minSamples: 30,
      anomalyTrimPct: 5,
    },
    samples,
    failures: fs,
  };
}

function run(args: string[]) {
  return spawnSync("node", [SCRIPT, ...args], { encoding: "utf8" });
}

describe("perf-compare.mjs (vitest wrapper)", () => {
  it("exits 0 when current is >=70% faster and >=90% fewer failures", () => {
    const base = tmpJson(
      "base.json",
      contract("settings.firstOpen", Array.from({ length: 30 }, () => 1000), 5),
    );
    const curr = tmpJson(
      "curr.json",
      contract("settings.firstOpen", Array.from({ length: 30 }, () => 200), 0),
    );
    const r = run([base, curr]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/OVERALL: PASS/);
  });

  it("exits 1 when latency threshold not met", () => {
    const base = tmpJson(
      "base.json",
      contract("settings.firstOpen", Array.from({ length: 30 }, () => 1000)),
    );
    const curr = tmpJson(
      "curr.json",
      contract("settings.firstOpen", Array.from({ length: 30 }, () => 500)),
    );
    const r = run([base, curr]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/OVERALL: FAIL/);
  });

  it("exits 1 when failure threshold not met", () => {
    const base = tmpJson(
      "base.json",
      contract("settings.firstOpen", Array.from({ length: 30 }, (_, i) => 100 + i), 10),
    );
    const curr = tmpJson(
      "curr.json",
      contract("settings.firstOpen", Array.from({ length: 30 }, (_, i) => 100 + i), 5),
    );
    const r = run([base, curr]);
    expect(r.status).toBe(1);
  });

  it("exits 3 when sample count below minSamples", () => {
    const base = tmpJson(
      "base.json",
      contract("settings.firstOpen", Array.from({ length: 30 }, () => 100)),
    );
    const curr = tmpJson(
      "curr.json",
      contract("settings.firstOpen", Array.from({ length: 5 }, () => 20)),
    );
    const r = run([base, curr]);
    expect(r.status).toBe(3);
    expect(r.stdout).toMatch(/REJECT/);
  });

  it("exits 3 when workloadKind mismatch", () => {
    const base = tmpJson(
      "base.json",
      contract("settings.firstOpen", Array.from({ length: 30 }, () => 100), 0, "real"),
    );
    const curr = tmpJson(
      "curr.json",
      contract("settings.firstOpen", Array.from({ length: 30 }, () => 20), 0, "proxy"),
    );
    const r = run([base, curr]);
    expect(r.status).toBe(3);
    expect(r.stdout).toMatch(/workloadKind mismatch/);
  });

  it("respects --latency override", () => {
    const base = tmpJson(
      "base.json",
      contract("settings.firstOpen", Array.from({ length: 30 }, () => 1000)),
    );
    const curr = tmpJson(
      "curr.json",
      contract("settings.firstOpen", Array.from({ length: 30 }, () => 400)),
    );
    const r = run(["--latency", "50", base, curr]);
    expect(r.status).toBe(0);
  });

  it("--json emits machine-readable JSON", () => {
    const base = tmpJson(
      "base.json",
      contract("settings.firstOpen", Array.from({ length: 30 }, () => 100)),
    );
    const curr = tmpJson(
      "curr.json",
      contract("settings.firstOpen", Array.from({ length: 5 }, () => 20)),
    );
    const r = run(["--json", base, curr]);
    expect(r.status).toBe(3);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.thresholds.latency).toBe(70);
    expect(Array.isArray(parsed.scenarios)).toBe(true);
    expect(Array.isArray(parsed.rejected)).toBe(true);
  });

  it("--dry-run returns 0 regardless of verdict", () => {
    const base = tmpJson(
      "base.json",
      contract("settings.firstOpen", Array.from({ length: 30 }, () => 1000)),
    );
    const curr = tmpJson(
      "curr.json",
      contract("settings.firstOpen", Array.from({ length: 30 }, () => 1000)),
    );
    const r = run(["--dry-run", base, curr]);
    expect(r.status).toBe(0);
  });

  it("exits 2 on bad JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "perf-cmp-bad-"));
    const base = join(dir, "base.json");
    const curr = join(dir, "curr.json");
    writeFileSync(base, "{ not json");
    writeFileSync(curr, "{}");
    const r = run([base, curr]);
    expect(r.status).toBe(2);
  });

  it("exits 2 on missing positional args", () => {
    const r = run([]);
    expect(r.status).toBe(2);
  });

  it("exits 2 on schemaVersion mismatch", () => {
    const base = tmpJson("base.json", {
      ...contract("settings.firstOpen", Array.from({ length: 30 }, () => 100)),
      schemaVersion: 99,
    });
    const curr = tmpJson(
      "curr.json",
      contract("settings.firstOpen", Array.from({ length: 30 }, () => 20)),
    );
    const r = run([base, curr]);
    expect(r.status).toBe(2);
  });
});
