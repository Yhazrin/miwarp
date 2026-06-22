#!/usr/bin/env node
/**
 * Opt-in real runtime smoke/E2E entrypoint for MiWarp v1.0.9 phase 1.
 *
 * Default (no env): runs disabled-by-default harness + TS helper unit tests only.
 * With MIWARP_RUNTIME_REAL_E2E=1: executes local CLI smoke against installed runtimes.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const enabled =
  process.env.MIWARP_RUNTIME_REAL_E2E === "1" ||
  process.env.MIWARP_RUNTIME_REAL_E2E?.toLowerCase() === "true";

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(
  enabled
    ? "[runtime-e2e] MIWARP_RUNTIME_REAL_E2E enabled — running real CLI smoke/E2E"
    : "[runtime-e2e] disabled — running helper unit tests + no-op harness only",
);

run("npm", [
  "test",
  "--",
  "--run",
  "src/lib/testing/runtime-e2e/constants.test.ts",
  "src/lib/testing/runtime-e2e/redaction.test.ts",
]);

const cargoArgs = [
  "test",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--test",
  "runtime_real_e2e",
  "--",
  "--nocapture",
];

if (enabled) {
  cargoArgs.splice(cargoArgs.length - 2, 0, "runtime_real_e2e_harness");
}

run("cargo", cargoArgs, enabled ? { MIWARP_RUNTIME_REAL_E2E: "1" } : {});

console.log("[runtime-e2e] completed");
