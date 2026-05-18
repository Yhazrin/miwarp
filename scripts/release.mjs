#!/usr/bin/env node
/**
 * Release script — bump version in package.json, sync to other files, commit, and tag.
 *
 * Usage:
 *   npm run release 0.2.0        # set explicit version
 *   npm run release patch         # 0.1.0 → 0.1.1
 *   npm run release minor         # 0.1.0 → 0.2.0
 *   npm run release major         # 0.1.0 → 1.0.0
 */

import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

// ── Read current version ─────────────────────────────────────────────
const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const current = pkg.version;

// ── Resolve next version ─────────────────────────────────────────────
const arg = process.argv[2];
if (!arg) {
  console.error("Usage: npm run release <version|patch|minor|major>");
  process.exit(1);
}

function bump(version, level) {
  const [major, minor, patch] = version.split(".").map(Number);
  switch (level) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "major":
      return `${major + 1}.0.0`;
    default:
      return null;
  }
}

const next = bump(current, arg) ?? arg;

// Validate semver format
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`Invalid version: "${next}". Expected format: x.y.z`);
  process.exit(1);
}

if (next === current) {
  console.error(`Version is already ${current}`);
  process.exit(1);
}

console.log(`  ${current} → ${next}\n`);

if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`Invalid version: "${next}". Expected format: x.y.z`);
  process.exit(1);
}

// ── Update package.json (single source of truth) ─────────────────────
pkg.version = next;
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
console.log(`  ✓ package.json`);

// ── Sync to tauri.conf.json + Cargo.toml ─────────────────────────────
execSync("node scripts/sync-version.mjs", { stdio: "inherit" });

// ── Git commit & tag ─────────────────────────────────────────────────
const tag = `v${next}`;

execSync(
  "git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock",
  { stdio: "inherit" },
);
execSync(`git commit -m "chore: release ${tag}"`, { stdio: "inherit" });
execSync(`git tag ${tag}`, { stdio: "inherit" });

console.log(`\n  ✓ Committed and tagged ${tag}`);

// Auto-push commit and tag to trigger Release workflow
console.log(`\n  Pushing to remote...`);
execSync("git push", { stdio: "inherit" });
execSync(`git push origin ${tag}`, { stdio: "inherit" });

console.log(`\n  ✓ Pushed ${tag} — Release workflow triggered`);
console.log(`  Monitor: https://github.com/Yhazrin/miwarp/actions`);
