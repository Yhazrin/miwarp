#!/usr/bin/env node
/**
 * Dependency direction matrix validator.
 *
 * Implements the highest-signal rules from `docs/architecture/dependency-direction.md`.
 * Each rule was chosen because a violation indicates a real coupling problem
 * (not stylistic preference) and the current codebase is clean against it.
 *
 *   R1. src-tauri/src/storage/* MUST NOT import from agent/*, commands/*,
 *       web_server/*, scheduler/*, hooks/*. Storage is a leaf; if storage
 *       needs to call into a runtime, the caller should pass the result in.
 *   R2. src-tauri/src/agent/* MUST NOT import from commands/* (inverts the
 *       dependency arrow — agent is the service layer below commands).
 *   R3. src/lib/types/* MUST NOT import from $lib/stores or $lib/api.
 *       Types are data; reaching into runtime state or IPC is a leak.
 *   R4. src/lib/api.ts MUST NOT import from $lib/stores, $lib/components,
 *       or $lib/routes. The API layer is the only thing that talks IPC.
 *   R5. src/lib/transport/* IS the sole owner of @tauri-apps/api/* imports
 *       (already enforced by ESLint no-restricted-imports; we re-check here
 *       so the rule survives a `lint:disable`).
 *
 * Sister to `layer-import-check.mjs` which validates the Tauri/transport
 * boundary for non-`@tauri-apps` cross-layer leakage.
 *
 * Run from repo root:
 *   node scripts/architecture/direction-check.mjs
 */
import { join } from "node:path";
import {
  REPO_ROOT,
  extractCrateImports,
  extractStaticImports,
  readText,
  rel,
  report,
  walkFiles,
} from "./lib.mjs";

const violations = [];

/**
 * Known pre-existing violations of the direction rules. Each entry must
 * include a `note` explaining why the violation exists and a tracking
 * reference (issue #, ADR, or PR). New violations MUST NOT be added here;
 * add a refactor entry in `docs/architecture/quality-foundation.md` instead.
 *
 * To remove an entry: refactor the offending file to comply with the
 * direction rule, then delete the entry from this list.
 */
const KNOWN_VIOLATIONS = new Map([
  [
    "src-tauri/src/storage/cli_sessions.rs",
    {
      rule: "R1",
      crate: "crate::agent::claude_protocol::{validate_bus_event, ProtocolState}",
      note: "Pre-existing: cli_sessions reuses Claude protocol types for transcript normalization. Refactor target: extract the types into models.rs or storage::shared so storage stops reaching into agent/. See docs/architecture/quality-foundation.md 'Known coupling to refactor'.",
    },
  ],
  [
    "src-tauri/src/storage/mcp_registry.rs",
    {
      rule: "R1",
      crate: "crate::agent::claude_stream::{augmented_path, resolve_claude_path}",
      note: "Pre-existing: mcp_registry uses the same Claude binary resolution as agent/claude_stream. Refactor target: move the helpers to a shared module (storage/shared or process_ext).",
    },
  ],
  [
    "src-tauri/src/storage/plugins.rs",
    {
      rule: "R1",
      crate: "crate::agent::claude_stream::{augmented_path, resolve_claude_path}",
      note: "Pre-existing: same root cause as mcp_registry. Refactor target: move the helpers to a shared module.",
    },
  ],
]);

// ── R1: storage/* is a leaf ──
const storageFiles = walkFiles(
  join(REPO_ROOT, "src-tauri", "src", "storage"),
  (f) => f.endsWith(".rs"),
);
const STORAGE_FORBIDDEN = new Set(["agent", "commands", "web_server", "scheduler", "hooks"]);
for (const file of storageFiles) {
  const src = readText(file);
  if (!src) continue;
  for (const cratePath of extractCrateImports(src)) {
    const [top] = cratePath.split("::");
    if (STORAGE_FORBIDDEN.has(top)) {
      const key = rel(REPO_ROOT, file);
      const known = KNOWN_VIOLATIONS.get(key);
      if (known) {
        // Allowed with explicit acknowledgement. Surfaced in `arch:direction --audit`.
        continue;
      }
      violations.push(`${key}: R1 storage/* is a leaf, must not import from ${top}/* — got crate::${cratePath}`);
    }
  }
}

// ── R2: agent/* must not import commands/* ──
const agentFiles = walkFiles(
  join(REPO_ROOT, "src-tauri", "src", "agent"),
  (f) => f.endsWith(".rs"),
);
for (const file of agentFiles) {
  const src = readText(file);
  if (!src) continue;
  for (const cratePath of extractCrateImports(src)) {
    const [top] = cratePath.split("::");
    if (top === "commands") {
      violations.push(`${rel(REPO_ROOT, file)}: R2 agent/* must not import from commands/* — got crate::${cratePath}`);
    }
  }
}

// ── R3: types/* must not import stores or api ──
const typeFiles = walkFiles(
  join(REPO_ROOT, "src", "lib", "types"),
  (f) => f.endsWith(".ts"),
);
for (const file of typeFiles) {
  const src = readText(file);
  if (!src) continue;
  for (const spec of extractStaticImports(src)) {
    if (spec === "$lib/stores" || spec.startsWith("$lib/stores/")) {
      violations.push(`${rel(REPO_ROOT, file)}: R3 types/* is pure data, must not import from $lib/stores — got ${spec}`);
    }
    if (spec === "$lib/api" || spec === "$lib/api.ts") {
      violations.push(`${rel(REPO_ROOT, file)}: R3 types/* is pure data, must not import from $lib/api — got ${spec}`);
    }
  }
}

// ── R4: api.ts must not import stores/components/routes ──
const apiFile = join(REPO_ROOT, "src", "lib", "api.ts");
const apiSrc = readText(apiFile);
if (apiSrc) {
  for (const spec of extractStaticImports(apiSrc)) {
    if (spec === "$lib/stores" || spec.startsWith("$lib/stores/")) {
      violations.push(`src/lib/api.ts: R4 api layer is IPC-only, must not import $lib/stores — got ${spec}`);
    }
    if (spec === "$lib/components" || spec.startsWith("$lib/components/")) {
      violations.push(`src/lib/api.ts: R4 api layer is IPC-only, must not import $lib/components — got ${spec}`);
    }
    if (spec === "$lib/routes" || spec.startsWith("$lib/routes/")) {
      violations.push(`src/lib/api.ts: R4 api layer is IPC-only, must not import $lib/routes — got ${spec}`);
    }
  }
}

// ── R5: @tauri-apps/* only inside lib/transport/** ──
const frontendFiles = walkFiles(
  join(REPO_ROOT, "src"),
  (f) => /\.(ts|svelte|js)$/.test(f) && !f.includes("__tests__"),
);
for (const file of frontendFiles) {
  if (file.includes("/src/lib/transport/")) continue;
  const src = readText(file);
  if (!src) continue;
  for (const spec of extractStaticImports(src)) {
    if (spec.startsWith("@tauri-apps/")) {
      violations.push(`${rel(REPO_ROOT, file)}: R5 only lib/transport/** may statically import ${spec} (use dynamic import or getTransport())`);
    }
  }
}

process.exit(report("direction-check", violations,
  "See docs/architecture/dependency-direction.md for the matrix. Each rule has a 2-character code (R1..R5) to disambiguate."));
