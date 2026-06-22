#!/usr/bin/env node
/**
 * File-size budget — per-commit diff mode.
 *
 * `file-budget.mjs` enforces a budget on the FINAL state of the
 * working tree. For waves that introduce many new files, a single
 * oversized new file is hard to spot after the merge. This script
 * is the per-commit guardrail:
 *
 *   - Reads `git diff --name-status <base>..HEAD` (or accepts a
 *     custom diff range via argv).
 *   - For each ADDED or MODIFIED file, runs the same per-language
 *     thresholds as `file-budget.mjs`.
 *   - ADDED files that exceed the FAIL threshold are reported as
 *     violations (new files should never be added as monoliths).
 *   - MODIFIED files that exceed the FAIL threshold are reported
 *     (modifications that bloat past the threshold need a refactor).
 *   - Files in `file-budget.allow.json` remain exempt.
 *
 * Usage:
 *   node scripts/architecture/file-budget-diff.mjs [BASE_REF]
 *
 *   BASE_REF defaults to `integration/v1.0.9-runtime-hub` (the
 *   integration branch this wave is based on). Pass any ref to
 *   diff against it.
 *
 * The script is independent of `file-budget.mjs` — it does not
 * import it (since `file-budget.mjs` is a CLI without exports).
 * If the threshold rules change, update both files.
 *
 * Run via `npm run arch:budget:diff`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { REPO_ROOT, rel, report } from "./lib.mjs";

const BUDGETS = {
  ".svelte": { warn: 500, fail: 1500 },
  ".ts": { warn: 400, fail: 1200 },
  ".rs": { warn: 600, fail: 1500 },
};

function isExempt(file) {
  if (file.includes("/__tests__/") || file.includes("/tests/")) return true;
  if (file.includes("/.svelte-kit/") || file.includes("/node_modules/")) return true;
  if (file.includes("/apps/ios/") || file.includes("/apps/android/")) return true;
  if (file.includes("/apps/ios/MiWarpMobile/build-")) return true;
  if (file.includes("/target/") || file.includes("/build/")) return true;
  return false;
}

const allowPath = join(import.meta.dirname, "file-budget.allow.json");
const allow = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, "utf-8")) : { exempt: [] };
const exemptSet = new Set((allow.exempt ?? []).map((e) => (typeof e === "string" ? e : e.path)));

const BASE = process.argv[2] ?? "integration/v1.0.9-runtime-hub";

let diffOut = "";
try {
  diffOut = execFileSync("git", ["diff", "--name-status", "--diff-filter=AM", `${BASE}..HEAD`], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
} catch (err) {
  console.error(`✗ file-budget-diff: failed to read diff against ${BASE}`);
  console.error(`  ${err.message ?? err}`);
  console.error("  Pass BASE_REF as argv, e.g. `node file-budget-diff.mjs HEAD~1`");
  process.exit(1);
}

const lines = diffOut.split("\n").filter(Boolean);
if (lines.length === 0) {
  console.log(`  (no changes vs ${BASE})`);
  process.exit(report("file-budget-diff", [], `Diff base: ${BASE}`));
}

const violations = [];
const warnings = [];
const checked = [];

for (const line of lines) {
  // Format: "A\tpath/to/file" or "M\tpath/to/file" or "A\told\tnew" (rename)
  const parts = line.split("\t");
  if (parts.length < 2) continue;
  const status = parts[0];
  const file = parts[parts.length - 1];
  if (isExempt(file)) continue;
  if (exemptSet.has(file)) continue;

  const ext = extname(file);
  const budget = BUDGETS[ext];
  if (!budget) continue;

  const abs = join(REPO_ROOT, file);
  if (!existsSync(abs)) continue; // file may have been deleted
  const lines2 = readFileSync(abs, "utf-8").split("\n").length;
  const relPath = rel(REPO_ROOT, abs);
  const op = status === "A" ? "added" : "modified";

  if (lines2 >= budget.fail) {
    violations.push(
      `${relPath}: ${op} file is ${lines2} lines ≥ fail ${budget.fail} (split before commit)`,
    );
  } else if (lines2 >= budget.warn) {
    warnings.push(
      `${relPath}: ${op} file is ${lines2} lines ≥ warn ${budget.warn} (consider splitting)`,
    );
  }
  checked.push({ file: relPath, status: op, lines: lines2 });
}

if (warnings.length > 0) {
  console.error(
    `⚠ ${warnings.length} added/modified file(s) over warn threshold:`,
  );
  for (const w of warnings) console.error(`    ${w}`);
  console.error("");
}

console.log(`  diff base: ${BASE}`);
console.log(`  checked: ${checked.length} files (${checked.filter((c) => c.status === "added").length} added, ${checked.filter((c) => c.status === "modified").length} modified)`);

process.exit(
  report(
    "file-budget-diff",
    violations,
    `Split the file before committing. If it cannot be split safely yet, add it to scripts/architecture/file-budget.allow.json with a justification (rare — prefer splitting).`,
  ),
);
