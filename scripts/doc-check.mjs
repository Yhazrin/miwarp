#!/usr/bin/env node
/**
 * v1.0.9 documentation quality gate.
 *
 * Deterministic checks for the release-quality doc surface:
 *   1. Required v1.0.9 architecture docs exist and are non-empty.
 *   2. ADR-007 contract-test artifacts referenced in docs exist on disk.
 *   3. Relative markdown links in the v1.0.9 doc set resolve to files.
 *   4. Release-checklist appendix npm scripts that are marked as CI gates
 *      exist in package.json (opt-in scripts such as e2e are excluded).
 *
 * Run from repo root:
 *   node scripts/doc-check.mjs
 *   npm run doc:check
 *
 * Exit code: 1 on any error, 0 when clean.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");

/** v1.0.9 architecture docs that must be present before release. */
const REQUIRED_DOCS = [
  "docs/architecture/v1.0.9-release-checklist.md",
  "docs/architecture/v1.0.9-rollback-checklist.md",
  "docs/architecture/v1.0.9-runtime-contract.md",
  "docs/architecture/v1.0.9-transaction-contracts.md",
  "docs/architecture/v1.0.9-shared-file-ownership.md",
  "docs/architecture/v1.0.9-wave0-baseline.md",
  "docs/architecture/v1.0.9-integration-runbook.md",
  "docs/architecture/cross-platform-capability-matrix.md",
  "docs/adr/0007-v1.0.9-contract-test-architecture.md",
];

/** Files pinned by ADR-007 — the contract-test surface must exist. */
const ADR007_ARTIFACTS = [
  "scripts/architecture/cross-platform-bus-contract.mjs",
  "scripts/architecture/file-budget-diff.mjs",
  "scripts/architecture/__tests__/runtime-contract.test.ts",
  "src-tauri/tests/send_fault_injection.rs",
  "src-tauri/tests/permission_fault_injection.rs",
  "src-tauri/tests/runtime_contract_types.rs",
  "e2e/golden-path.spec.ts",
  ".github/workflows/contract-tests.yml",
  "src/lib/runtime/__tests__/runtime-capabilities-contract.test.ts",
  "e2e/__tests__/redaction-manifest-contract.test.ts",
];

/** npm scripts referenced as CI gates in the release checklist appendix. */
const REQUIRED_NPM_SCRIPTS = [
  "arch:check",
  "arch:check:strict",
  "arch:direction",
  "arch:layers",
  "arch:cycle",
  "arch:budget",
  "arch:budget:diff",
  "arch:tauri-contract",
  "arch:ios-ws-contract",
  "arch:cross-platform-bus",
  "arch:runtime-contract",
  "check:root",
  "lint",
  "format:check",
  "check",
  "i18n:check",
  "rust:check",
  "verify",
  "version:check",
  "release:notes",
  "doc:check",
];

/** Markdown link target, excluding http(s) and mailto anchors. */
const MARKDOWN_LINK_RE = /\[[^\]]+\]\(([^)]+)\)/g;

let errors = 0;

function fail(message) {
  console.error(`ERROR ${message}`);
  errors++;
}

function assertNonEmptyFile(relPath) {
  const absPath = join(REPO_ROOT, relPath);
  if (!existsSync(absPath)) {
    fail(`Missing file: ${relPath}`);
    return;
  }
  const size = statSync(absPath).size;
  if (size === 0) {
    fail(`Empty file: ${relPath}`);
  }
}

function resolveMarkdownTarget(fromFile, rawTarget) {
  const target = rawTarget.trim();
  if (!target || target.startsWith("#")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;

  const withoutAnchor = target.split("#")[0];
  if (!withoutAnchor) return null;

  return resolve(dirname(fromFile), withoutAnchor);
}

function checkMarkdownLinks(relPath) {
  const absPath = join(REPO_ROOT, relPath);
  const src = readFileSync(absPath, "utf-8");
  for (const match of src.matchAll(MARKDOWN_LINK_RE)) {
    const resolved = resolveMarkdownTarget(absPath, match[1]);
    if (!resolved) continue;
    if (!existsSync(resolved)) {
      fail(`Broken link in ${relPath}: "${match[1]}" → missing ${resolved.slice(REPO_ROOT.length + 1)}`);
    }
  }
}

console.log("doc-check: validating v1.0.9 documentation surface\n");

for (const relPath of REQUIRED_DOCS) {
  assertNonEmptyFile(relPath);
}

for (const relPath of ADR007_ARTIFACTS) {
  assertNonEmptyFile(relPath);
}

for (const relPath of REQUIRED_DOCS) {
  checkMarkdownLinks(relPath);
}

const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8"));
const scripts = packageJson.scripts ?? {};
for (const scriptName of REQUIRED_NPM_SCRIPTS) {
  if (!scripts[scriptName]) {
    fail(`package.json missing script referenced by release checklist: "${scriptName}"`);
  }
}

if (errors > 0) {
  console.error(`\ndoc-check: ${errors} error(s)`);
  process.exit(1);
}

console.log(`✓ doc-check: ${REQUIRED_DOCS.length} docs, ${ADR007_ARTIFACTS.length} ADR artifacts, npm scripts OK`);
