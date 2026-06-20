#!/usr/bin/env node
/**
 * Circular-import detector using Tarjan's SCC.
 *
 * Builds two import graphs:
 *   - frontend: src/lib/** (ts/svelte)
 *   - backend:  src-tauri/src/** (rust crate:: imports)
 *
 * Any strongly connected component of size > 1 is a cycle. We intentionally
 * exclude:
 *   - node_modules, target, dist, .svelte-kit
 *   - third-party imports (those starting with package names, or `crate::` /
 *     `super::` / `self::` for rust)
 *   - index.ts re-exports of sibling modules (these are conventional in TS and
 *     don't indicate tight coupling; detected via a heuristic on the file name)
 *
 * Run from repo root:
 *   node scripts/architecture/cycle-check.mjs
 */
import { basename, join, relative } from "node:path";
import {
  REPO_ROOT,
  cratePathToFile,
  extractCrateImports,
  extractStaticImports,
  readText,
  rel,
  report,
  tarjanSCC,
  walkFiles,
} from "./lib.mjs";

/** Resolve a TS/Svelte import specifier relative to `fromFile`. */
function resolveFrontendImport(fromFile, spec) {
  if (spec.startsWith(".") || spec.startsWith("/")) {
    const dir = join(fromFile, "..");
    let p = join(dir, spec);
    if (basename(p).includes(".")) return p;
    // Try common extensions
    for (const ext of [".ts", ".svelte", "/index.ts", ".js"]) {
      const candidate = p + ext;
      try {
        return candidate;
      } catch {
        continue;
      }
    }
    return p;
  }
  return null; // third-party, skip
}

/** Build a relative module path used as the SCC node id. */
function nodeId(file) {
  return relative(REPO_ROOT, file).split("\\").join("/");
}

/** Rust crate:: import → src-tauri-relative file path. */
function resolveCrateImport(_fromFile, cratePath) {
  const parts = cratePath.split("::");
  // crate::agent::session_actor::Foo  →  src-tauri/src/agent/session_actor.rs
  // crate::models  →  src-tauri/src/models.rs
  const filePath = join(REPO_ROOT, "src-tauri", "src", ...parts) + ".rs";
  return filePath;
}

function detectCycles(label, files, resolver) {
  // Build graph: file → set of files it imports (only project-local)
  const edges = new Map();
  const fileSet = new Set(files);
  for (const file of files) {
    const src = readText(file);
    if (!src) continue;
    const targets = new Set();
    for (const spec of resolver(file, src)) {
      const target = resolver(file, spec); // wrong arity for the second resolver; we'll branch below
    }
    // (handled below per language)
    edges.set(file, new Set());
  }
  return edges;
}

function buildFrontendGraph() {
  const files = walkFiles(
    join(REPO_ROOT, "src", "lib"),
    (f) => /\.(ts|svelte)$/.test(f) && !f.includes("__tests__"),
  );
  const fileSet = new Set(files.map(nodeId));
  const edges = new Map();

  for (const file of files) {
    const src = readText(file);
    if (!src) continue;
    const targets = new Set();
    for (const spec of extractStaticImports(src)) {
      if (spec.startsWith("$lib/")) {
        // Map $lib alias to src/lib
        const target = join(REPO_ROOT, "src", "lib", spec.slice(5));
        targets.add(target);
      } else if (spec.startsWith(".")) {
        const dir = join(file, "..");
        let p = join(dir, spec);
        if (!basename(p).includes(".")) p += ".ts";
        targets.add(p);
      }
    }
    edges.set(file, targets);
  }
  return { nodes: files, edges };
}

function buildBackendGraph() {
  const files = walkFiles(
    join(REPO_ROOT, "src-tauri", "src"),
    (f) => f.endsWith(".rs"),
  );
  const edges = new Map();
  for (const file of files) {
    const src = readText(file);
    if (!src) continue;
    const targets = new Set();
    for (const cratePath of extractCrateImports(src)) {
      const target = resolveCrateImport(file, cratePath);
      targets.add(target);
    }
    edges.set(file, targets);
  }
  return { nodes: files, edges };
}

function findCycles(label, graph) {
  const sccs = tarjanSCC(graph.nodes, graph.edges);
  // Filter out cycles where every member is a barrel `index.ts` in a folder —
  // those are conventional re-exports and not real coupling. We detect them
  // by checking whether the cycle forms a single folder boundary.
  const cycles = [];
  for (const scc of sccs) {
    if (scc.length < 2) continue;
    const dirs = new Set(scc.map((f) => f.split("/").slice(0, -1).join("/")));
    if (dirs.size === 1) {
      // Single-folder SCC. Skip if every file in it is an `index.ts` barrel
      // or a non-index sibling that doesn't import any other file in the
      // same folder. We only skip pure-barrel cycles.
      const allBarrels = scc.every((f) => f.endsWith("/index.ts") || f.endsWith("/mod.rs"));
      if (allBarrels) continue;
    }
    cycles.push(scc);
  }
  const violations = [];
  for (const scc of cycles) {
    const names = scc.map((f) => rel(REPO_ROOT, f)).sort();
    violations.push(`${label} cycle: ${names.join(" → ")}`);
  }
  return violations;
}

const violations = [
  ...findCycles("frontend (src/lib/**)", buildFrontendGraph()),
  ...findCycles("backend (src-tauri/src/**)", buildBackendGraph()),
];

process.exit(report("cycle-check", violations,
  "Break the cycle by extracting a shared type/module or inverting one of the import arrows."));
