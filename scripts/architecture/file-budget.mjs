#!/usr/bin/env node
/**
 * File-size budget gate.
 *
 * Per-language thresholds (lines, including blanks/comments):
 *   .svelte: warn 500 / fail 1500
 *   .ts:     warn 400 / fail 1200  (excluding test files)
 *   .rs:     warn 600 / fail 1500  (excluding /tests/)
 *
 * Files in `file-budget.allow.json` are exempt — they are tracked
 * exceptions that we will refactor incrementally. New files that exceed
 * the fail threshold MUST NOT be added to the allow list; they should be
 * split instead.
 *
 * Exits:
 *   0 — within budget (warnings allowed)
 *   1 — at least one file exceeds the fail threshold
 */
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { REPO_ROOT, rel, report, walkFiles } from "./lib.mjs";

const BUDGETS = {
  ".svelte": { warn: 500, fail: 1500 },
  ".ts": { warn: 400, fail: 1200 },
  ".rs": { warn: 600, fail: 1500 },
};

function isExempt(file) {
  if (file.includes("/__tests__/") || file.includes("/tests/")) return true;
  if (file.includes("/.svelte-kit/") || file.includes("/node_modules/")) return true;
  if (file.includes("/apps/ios/") || file.includes("/apps/android/")) return true;
  return false;
}

const allowPath = join(import.meta.dirname, "file-budget.allow.json");
const allow = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, "utf-8")) : { exempt: [] };
const exemptSet = new Set((allow.exempt ?? []).map((e) => (typeof e === "string" ? e : e.path)));

const files = walkFiles(REPO_ROOT, (f) => /\.(svelte|ts|rs)$/.test(f));
const violations = [];
const warnings = [];

for (const file of files) {
  if (isExempt(file)) continue;
  const ext = extname(file);
  const budget = BUDGETS[ext];
  if (!budget) continue;
  const relPath = rel(REPO_ROOT, file);
  if (exemptSet.has(relPath)) continue;
  const lines = readFileSync(file, "utf-8").split("\n").length;
  if (lines >= budget.fail) {
    violations.push(`${relPath}: ${lines} lines ≥ fail ${budget.fail}`);
  } else if (lines >= budget.warn) {
    warnings.push(`${relPath}: ${lines} lines ≥ warn ${budget.warn}`);
  }
}

if (warnings.length > 0) {
  console.error(`⚠ ${warnings.length} file(s) over warn threshold (allowed, but please refactor):`);
  for (const w of warnings) console.error(`    ${w}`);
  console.error("");
}

process.exit(report("file-budget", violations,
  `Split the file. If it cannot be split safely yet, add it to scripts/architecture/file-budget.allow.json with a justification (rare — prefer splitting).`));
