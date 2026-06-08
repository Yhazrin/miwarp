#!/usr/bin/env node
/**
 * Verify version alignment across package.json, tauri.conf.json, Cargo.toml, Cargo.lock.
 * Exit 1 on mismatch. Run in CI via: npm run version:check
 */

import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const expected = pkg.version;

const errors = [];

const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf-8"));
if (tauri.version !== expected) {
  errors.push(`tauri.conf.json: ${tauri.version} (expected ${expected})`);
}

const cargo = readFileSync("src-tauri/Cargo.toml", "utf-8");
const cargoMatch = cargo.match(/^version = "(.*)"$/m);
if (!cargoMatch || cargoMatch[1] !== expected) {
  errors.push(
    `Cargo.toml: ${cargoMatch?.[1] ?? "missing"} (expected ${expected}) — run: npm run version:sync`,
  );
}

const lock = readFileSync("src-tauri/Cargo.lock", "utf-8");
const lockMatch = lock.match(/name = "MiWarp"\r?\nversion = "([^"]*)"/);
if (!lockMatch || lockMatch[1] !== expected) {
  errors.push(
    `Cargo.lock MiWarp: ${lockMatch?.[1] ?? "missing"} (expected ${expected}) — run: npm run version:sync`,
  );
}

if (errors.length > 0) {
  console.error("Version mismatch:\n");
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
}

console.log(`✓ All versions aligned at ${expected}`);
