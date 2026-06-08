#!/usr/bin/env node
/**
 * Check the repository root for pollution: one-off session reports,
 * snapshot HTMLs, and other "Claude/Codex/Cowork ran a session and
 * dumped output into the repo" leftovers that should never have been
 * committed.
 *
 * Run from repo root:
 *   node scripts/check-root-pollution.mjs
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one polluted file is tracked
 *
 * CI / pre-commit: add to package.json `verify` chain.
 */
import { execSync } from "node:child_process";

const ROOT = process.cwd();

// Patterns anchored to root only (e.g. `COWORK_*.md`, NOT `docs/COWORK_*.md`).
// Order matters: more specific patterns first so a single match wins.
const FORBIDDEN_ROOT = [
  // Cowork / Claude / Codex one-off session reports (5/16-5/23 vintage).
  // Case-insensitive on the version / final / v2 / date tail — the
  // uppercase convention drifted, so a strict [A-Z0-9_] misses files
  // like `COWORK_DESIGN_LEARNING_REPORT_20260520_v2.md`.
  /^COWORK_[A-Z0-9_]+\.md$/i,
  /^CODEX_[A-Z0-9_]+\.md$/i,
  /^CLAUDE[-_][A-Z0-9_-]*DESIGN[A-Z0-9_-]*\.md$/i,
  // Snapshot HTML reports
  /^summary-\d+\.html$/,
  // Misc session artifacts that have landed in root before
  /^codex-design-report.*\.md$/,
  /^codex_learning_report.*\.md$/,
  /^design-improvements-.*\.md$/,
  /^design-learnings-.*\.md$/,
  /^design-insights-from-codex\.md$/,
  /^learn-from-codex.*\.md$/,
  /^miwarp-improvement-report\.md$/,
];

// Files that match by name but are explicitly allowed (defense in depth —
// right now there are none; add to this list only with a comment).
const ALLOW = new Set([]);

function isTracked(path) {
  try {
    execSync(`git ls-files --error-unmatch -- "${path}"`, { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf-8" })
  .split("\n")
  .filter((line) => line && !line.includes("/")); // root-level only

const violations = [];
for (const file of tracked) {
  if (ALLOW.has(file)) continue;
  if (FORBIDDEN_ROOT.some((re) => re.test(file))) {
    violations.push(file);
  }
}

if (violations.length === 0) {
  console.log("✓ No root pollution (session reports / snapshots)");
  process.exit(0);
}

console.error("");
console.error(`✗ ${violations.length} polluted root file(s) tracked:`);
for (const f of violations) {
  console.error(`    ${f}`);
}
console.error("");
console.error("These look like one-off session outputs from Claude / Codex / Cowork.");
console.error("Remove with:");
console.error(`  git rm ${violations.join(" ")}`);
console.error("");
process.exit(1);
