#!/usr/bin/env node
/**
 * Sync version from package.json → tauri.conf.json + Cargo.toml
 * Single source of truth: package.json
 */

import { readFileSync, writeFileSync } from "fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const version = pkg.version;

// tauri.conf.json
const tauriPath = "src-tauri/tauri.conf.json";
const tauri = JSON.parse(readFileSync(tauriPath, "utf-8"));
if (tauri.version !== version) {
  tauri.version = version;
  writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + "\n");
  console.log(`  ✓ ${tauriPath} → ${version}`);
}

// Cargo.toml
const cargoPath = "src-tauri/Cargo.toml";
let cargo = readFileSync(cargoPath, "utf-8");
const cargoVersionMatch = cargo.match(/^version = ".*"$/m);
if (cargoVersionMatch && cargoVersionMatch[0] !== `version = "${version}"`) {
  cargo = cargo.replace(/^version = ".*"$/m, `version = "${version}"`);
  writeFileSync(cargoPath, cargo);
  console.log(`  ✓ ${cargoPath} → ${version}`);
}

// Cargo.lock (under [[package]] name = "MiWarp")
const lockPath = "src-tauri/Cargo.lock";
let lock = readFileSync(lockPath, "utf-8");
const lockPattern = /(name = "MiWarp"\nversion = )"[^"]*"/;
if (lockPattern.test(lock)) {
  const updated = lock.replace(lockPattern, `$1"${version}"`);
  if (updated !== lock) {
    writeFileSync(lockPath, updated);
    console.log(`  ✓ ${lockPath} → ${version}`);
  }
}
