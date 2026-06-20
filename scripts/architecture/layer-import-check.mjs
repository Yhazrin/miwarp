#!/usr/bin/env node
/**
 * Cross-layer import guard.
 *
 * Implements the rules in `docs/architecture/dependency-direction.md`:
 *   1. @tauri-apps/api/* must only be statically imported from src/lib/transport/**
 *      (dynamic `import()` is allowed everywhere — see ADR-001).
 *   2. src-tauri/src/commands/* must not import peer commands' internal impl
 *      (e.g. commands/chat may not `use crate::commands::session::start_session_impl`
 *      because that would couple two command domains. Use the agent/* layer instead.)
 *   3. src-tauri/src/agent/* must not import from commands/* (would invert the arrow).
 *   4. src-tauri/src/web_server/* and scheduler/* and hooks/* may import
 *      commands/* — they're "above" the command layer.
 *
 * Exits 0 when clean, 1 when at least one violation exists.
 *
 * Run from repo root:
 *   node scripts/architecture/layer-import-check.mjs
 */
import { join } from "node:path";
import {
  REPO_ROOT,
  cratePathToFile,
  extractCrateImports,
  extractStaticImports,
  readText,
  rel,
  report,
  walkFiles,
} from "./lib.mjs";

const violations = [];

// ── Rule 1: @tauri-apps/api/* static imports must live in src/lib/transport/** ──
const frontendFiles = walkFiles(
  join(REPO_ROOT, "src"),
  (f) => /\.(ts|svelte|js)$/.test(f) && !f.includes("__tests__"),
);
for (const file of frontendFiles) {
  const src = readText(file);
  if (!src) continue;
  const inTransport = file.includes(`${join("src", "lib", "transport")}${join("src", "lib", "transport").length === file.length ? "" : ""}`)
    || file.includes("/src/lib/transport/");
  if (inTransport) continue;
  for (const imp of extractStaticImports(src)) {
    if (imp.startsWith("@tauri-apps/api/") || imp === "@tauri-apps/api") {
      violations.push(`${rel(REPO_ROOT, file)}: static import of ${imp} (use lib/transport or dynamic import)`);
    }
  }
}

// ── Rules 2-4: Rust crate imports ──
const rustFiles = walkFiles(
  join(REPO_ROOT, "src-tauri", "src"),
  (f) => f.endsWith(".rs") && !f.includes("/tests/"),
);
for (const file of rustFiles) {
  const src = readText(file);
  if (!src) continue;
  const relPath = rel(REPO_ROOT, file);
  const imports = extractCrateImports(src);

  // Group imports by top-level module
  for (const cratePath of imports) {
    const [top] = cratePath.split("::");
    const targetFile = cratePathToFile(cratePath);

    // Rule 2: commands/* importing commands/* internals
    if (relPath.startsWith("src-tauri/src/commands/")) {
      if (top === "commands" && cratePath.split("::").length > 1) {
        const peer = cratePath.split("::")[1];
        // Same module self-imports (e.g. commands::session using its own sibling) are fine.
        // The check fires only when the path leaves the current file's parent module.
        const myMod = relPath.split("/")[3]?.replace(".rs", "");
        if (peer !== myMod) {
          violations.push(`${relPath}: command module imports peer command internals — crate::${cratePath} (route through agent/* or storage/* instead)`);
        }
      }
    }

    // Rule 3: agent/* must not import from commands/*
    if (relPath.startsWith("src-tauri/src/agent/") && top === "commands") {
      violations.push(`${relPath}: agent module imports from commands/* (inverts dependency arrow) — crate::${cratePath}`);
    }
  }
}

process.exit(report("layer-import-check", violations,
  "Fix: route the import through the appropriate service layer (agent/*, storage/*, or transport/*). See docs/architecture/dependency-direction.md."));
