/**
 * Shared helpers for the architecture-check scripts.
 *
 * All scripts are pure-Node, no transpilation. They parse import statements
 * with regex (not full AST) — fast, no deps, and good enough for the
 * dependency-direction rules we enforce.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Walk files matching a predicate. Skips node_modules, target, .git, dist. */
export function walkFiles(root, predicate) {
  const out = [];
  const skip = new Set(["node_modules", "target", ".git", "dist", "build", ".svelte-kit"]);
  const recurse = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        recurse(full);
      } else if (predicate(full)) {
        out.push(full);
      }
    }
  };
  recurse(root);
  return out;
}

/** Read text, return null if file missing. */
export function readText(path) {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Extract static import paths from a JS/TS/Svelte file.
 *
 *   import x from "foo"
 *   import x from 'foo'
 *   import { a } from "foo"
 *   import * as x from "foo"
 *   export ... from "foo"
 *
 * Dynamic `import("foo")` is intentionally skipped — the ESLint config and
 * ADR-001 allow dynamic imports for desktop-only features with graceful
 * fallback. We only flag static imports that break browser mode.
 */
const STATIC_IMPORT_RE =
  /(?:^|[\s;])import\s+(?:[\w*\s{},]+\s+from\s+)?['"]([^'"]+)['"]/gm;
const RE_EXPORT_RE = /(?:^|[\s;])export\s+(?:[\w*\s{},]+\s+from\s+)?['"]([^'"]+)['"]/gm;

export function extractStaticImports(source) {
  const out = new Set();
  let m;
  STATIC_IMPORT_RE.lastIndex = 0;
  while ((m = STATIC_IMPORT_RE.exec(source))) out.add(m[1]);
  RE_EXPORT_RE.lastIndex = 0;
  while ((m = RE_EXPORT_RE.exec(source))) out.add(m[1]);
  return [...out];
}

/** Extract `use crate::...::...` paths from a Rust file. */
const RUST_USE_RE = /use\s+crate::([a-zA-Z0-9_:]+)/g;
export function extractCrateImports(source) {
  const out = [];
  let m;
  RUST_USE_RE.lastIndex = 0;
  while ((m = RUST_USE_RE.exec(source))) out.push(m[1]);
  return out;
}

/** Convert `agent::session_actor` to a relative path under src-tauri/src/. */
export function cratePathToFile(cratePath) {
  return cratePath.replaceAll("::", "/") + ".rs";
}

/** Convert `agent::session_actor` to a module directory under src-tauri/src/. */
export function cratePathToDir(cratePath) {
  return cratePath.split("::")[0];
}

/** Build the import graph: file → set of files it imports. */
export function buildGraph(files, resolver) {
  const graph = new Map();
  for (const file of files) {
    const src = readText(file);
    if (src == null) continue;
    const targets = resolver(file, src);
    graph.set(file, targets);
  }
  return graph;
}

/** Tarjan's SCC. Returns array of arrays (each is one SCC). */
export function tarjanSCC(nodes, edges) {
  let index = 0;
  const indices = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];

  const strongconnect = (v) => {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
      }
    }
    if (lowlink.get(v) === indices.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  };

  for (const v of nodes) {
    if (!indices.has(v)) strongconnect(v);
  }
  return sccs;
}

/** Pretty-print relative path under repo root. */
export function rel(root, file) {
  return relative(root, file).split(sep).join("/");
}

/** Print violations and exit with the right code. */
export function report(label, violations, hint) {
  if (violations.length === 0) {
    console.log(`✓ ${label}: 0 violations`);
    return 0;
  }
  console.error("");
  console.error(`✗ ${label}: ${violations.length} violation(s)`);
  for (const v of violations) {
    console.error(`    ${v}`);
  }
  if (hint) console.error(`\n${hint}`);
  console.error("");
  return 1;
}

export const REPO_ROOT = join(import.meta.dirname, "..", "..");
