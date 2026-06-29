#!/usr/bin/env node
/**
 * perf-budget.mjs — performance fitness functions / hard gates.
 *
 * Enforces the v1.1.0 perf budget table. Each gate falls into one of two
 * categories:
 *
 *   STATIC — read straight from source. Cheap, no build needed, runs in
 *            CI on every PR. Detects "did the static import graph grow?"
 *            — a leading indicator of root-bundle regression.
 *
 *   RUNTIME — require a fresh `npm run build` (writes Vite's manifest
 *             into `.svelte-kit/output/client/`). Slower but reflects
 *             what the user actually downloads. Gated by a single
 *             `--runtime` flag so a pre-commit / pre-push run stays fast.
 *
 * Current targets (v1.1.0):
 *
 *   | Metric                                  | Budget    | Mode    |
 *   |-----------------------------------------|-----------|---------|
 *   | Root bundle (gzipped)                   | ≤ 220 KiB | runtime |
 *   | Personal route chunk (gzipped)          | ≤ 15  KiB | runtime |
 *   | Explorer route chunk (gzipped)          | ≤ 15  KiB | runtime |
 *   | Root eagerly imports SessionStore       | false     | static  |
 *   | Root eagerly imports i18n message JSON  | false     | static  |
 *   | FilePreviewPane defaults to editable    | false     | static  |
 *   | FilePreviewPane calls statTextFile      | 0         | static  |
 *   | FilePreviewPane calls readFileBase64    | 0         | static  |
 *   | Root layout calls loadTeams() eagerly   | false     | static  |
 *
 * Usage:
 *   node scripts/architecture/perf-budget.mjs           # static-only, fast
 *   node scripts/architecture/perf-budget.mjs --runtime # also read Vite manifest
 *
 * Exit codes:
 *   0 — all gates green
 *   1 — at least one gate violated
 *   2 — `--runtime` requested but Vite manifest not found (run `npm run build`)
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SRC = join(REPO_ROOT, "src");
const BUILD_DIR = join(REPO_ROOT, ".svelte-kit", "output", "client");

const ARGS = process.argv.slice(2);
const RUNTIME = ARGS.includes("--runtime");

const VIO = [];
const WARN = [];

function recordViolation(label, detail) {
  VIO.push(`${label}: ${detail}`);
}

function recordWarning(label, detail) {
  WARN.push(`${label}: ${detail}`);
}

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

function readText(p) {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

function relPath(p) {
  return relative(REPO_ROOT, p).split(sep).join("/");
}

function findFile(rootDir, baseNames) {
  if (!existsSync(rootDir)) return null;
  for (const name of readdirSync(rootDir)) {
    if (baseNames.includes(name)) return join(rootDir, name);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* STATIC gates                                                       */
/* ------------------------------------------------------------------ */

function checkStaticGates() {
  const layoutFile = join(SRC, "routes", "+layout.svelte");
  const layoutSrc = readText(layoutFile);
  if (layoutSrc == null) {
    recordViolation("static:layout", `cannot read ${relPath(layoutFile)}`);
    return;
  }

  // Gate: root layout must not eagerly import sessionStore.
  // Acceptable: a comment that references it, or `from "$lib/stores"`
  // that re-exports it transitively. We only flag the *direct* import
  // because that's the part tree-shaking can't undo.
  if (/^\s*import\s+\{[^}]*\bsessionStore\b[^}]*\}\s+from\s+["']\$lib\/stores["']/m.test(layoutSrc)) {
    recordViolation(
      "static:root-imports-session-store",
      "src/routes/+layout.svelte still has `import { sessionStore } from \"$lib/stores\"`. " +
        "Use getActiveSessionIdentity() from $lib/utils/active-session instead.",
    );
  }

  // Gate: root layout must not eagerly import i18n message JSON.
  // The i18n module legitimately imports the active locale after
  // detection; what's banned is `import en from "$messages/en.json"`
  // in the layout itself.
  if (/import\s+\w+\s+from\s+["']\$messages\/[^"']+["']/.test(layoutSrc)) {
    recordViolation(
      "static:root-imports-messages",
      "src/routes/+layout.svelte still imports a message JSON directly. " +
        "Use dynamic import via $lib/i18n/loader.ts loaders instead.",
    );
  }

  // Gate: root layout must not call loadTeams()/runs unconditionally.
  // Allowed only inside a derived `() => isTeamsPage(...)` gate.
  // We can't fully parse Svelte; instead we look for the banned
  // unconditional patterns.
  if (/createTeamSubscription\s*\(\s*teamStore\s*,\s*\(\s*\)\s*=>\s*true\s*\)/.test(layoutSrc)) {
    recordViolation(
      "static:teams-eager-load",
      "createTeamSubscription(teamStore, () => true) is unconditional. " +
        "Gate on `() => $page.url.pathname.startsWith(\"/teams\")` or similar.",
    );
  }
  if (/runsSidebarStore\.loadRuns\s*\(\s*\)\s*;[\s\S]{0,40}?runsSidebarStore\.startPoll\s*\(\s*\)/.test(layoutSrc)) {
    recordViolation(
      "static:runs-eager-poll",
      "runsSidebarStore.loadRuns() + startPoll() run unconditionally in root. " +
        "Gate on chat/history/workbench routes with a grace period.",
    );
  }

  // Gate: FilePreviewPane defaults must be read-only.
  const previewFile = findFile(join(SRC, "lib", "components"), ["FilePreviewPane.svelte"]);
  if (previewFile) {
    const src = readText(previewFile);
    if (src == null) {
      recordViolation("static:preview-default", `cannot read ${relPath(previewFile)}`);
    } else {
      // `editable` is a $props() default. Banned: `editable: true` / `editable = true` at top-level
      if (/^\s*(?:let|const|var)\s+editable\s*[:=]\s*true\b/m.test(src)) {
        recordViolation(
          "static:preview-editable-default",
          `${relPath(previewFile)} defaults editable: true. ` +
            "CodeMirror (~540 KiB gzip) ships on first click. Default to editable: false " +
            "and expose an Edit button that toggles into editor mode.",
        );
      }
      // The pane must NOT call the legacy two-call preview path.
      if (/\bstatTextFile\s*\(/.test(src)) {
        recordViolation(
          "static:preview-stat-text-file",
          `${relPath(previewFile)} still calls statTextFile. ` +
            "Use the unified readFilePreview(FilePreviewDescriptor) IPC instead.",
        );
      }
      if (/\breadFileBase64\s*\(/.test(src)) {
        recordViolation(
          "static:preview-base64-ipc",
          `${relPath(previewFile)} still calls readFileBase64. ` +
            "Use the backend's assetUrl (Tauri asset protocol) — base64 over IPC is the " +
            "single biggest image-preview perf cost.",
        );
      }
    }
  } else {
    recordWarning("static:preview-default", "FilePreviewPane.svelte not found — skipping");
  }
}

/* ------------------------------------------------------------------ */
/* RUNTIME gates (require fresh `npm run build`)                     */
/* ------------------------------------------------------------------ */

function gzipSize(buf) {
  return gzipSync(buf, { level: 9 }).length;
}

function findViteManifest() {
  if (!existsSync(BUILD_DIR)) return null;
  const _manifest = join(BUILD_DIR, ".vite", "manifest.json");
  if (existsSync(_manifest)) return _manifest;
  // SvelteKit may put the manifest at the client root.
  const root = join(BUILD_DIR, ".vite");
  if (!existsSync(root)) return null;
  for (const name of readdirSync(root)) {
    if (name === "manifest.json" || name === "manifest-assets.json") {
      return join(root, name);
    }
  }
  return null;
}

function pickChunkForRoute(manifest, hint) {
  // Vite manifest shape: { "src/routes/<route>+page.svelte": { file, imports, ... }, ... }
  // We pick the entry whose `file` contains `route` and is a leaf (no other entry imports it).
  const keys = Object.keys(manifest);
  for (const key of keys) {
    if (key.includes(hint) && key.endsWith("+page.svelte")) {
      return manifest[key];
    }
  }
  return null;
}

function totalGzipForEntry(manifest, entry) {
  // Recursively sum the gzipped file size of `entry` plus its static imports.
  const seen = new Set();
  const stack = [entry.file];
  let total = 0;
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const full = join(BUILD_DIR, file);
    if (!existsSync(full)) continue;
    const buf = readFileSync(full);
    total += gzipSize(buf);
    const meta = Object.values(manifest).find((m) => m.file === file);
    if (meta && Array.isArray(meta.imports)) {
      for (const imp of meta.imports) stack.push(imp);
    }
  }
  return total;
}

function checkRuntimeGates() {
  const manifestPath = findViteManifest();
  if (!manifestPath) {
    console.error(
      "✗ perf-budget: Vite manifest not found at .svelte-kit/output/client/.vite/manifest.json\n" +
        "    Re-run with `npm run build` first, or omit --runtime for the static-only gates.",
    );
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

  // Gate: root entry gzipped.
  const rootEntry = pickChunkForRoute(manifest, "src/routes/+layout.svelte")
    || pickChunkForRoute(manifest, "src/routes/+page.svelte")
    || null;
  if (!rootEntry) {
    recordWarning("runtime:root-bundle", "could not locate root entry in Vite manifest");
  } else {
    const gz = totalGzipForEntry(manifest, rootEntry);
    const kib = (gz / 1024).toFixed(1);
    if (gz > 220 * 1024) {
      recordViolation("runtime:root-bundle", `${kib} KiB > 220 KiB budget`);
    } else {
      console.log(`  root-bundle: ${kib} KiB ≤ 220 KiB ✓`);
    }
  }

  // Gate: personal route chunk.
  const personalEntry = pickChunkForRoute(manifest, "src/routes/personal/+page.svelte");
  if (personalEntry) {
    const gz = totalGzipForEntry(manifest, personalEntry);
    const kib = (gz / 1024).toFixed(1);
    if (gz > 15 * 1024) {
      recordViolation("runtime:personal-bundle", `${kib} KiB > 15 KiB budget`);
    } else {
      console.log(`  personal-bundle: ${kib} KiB ≤ 15 KiB ✓`);
    }
  } else {
    recordWarning("runtime:personal-bundle", "personal route not found in manifest");
  }

  // Gate: explorer route chunk.
  const explorerEntry = pickChunkForRoute(manifest, "src/routes/explorer/+page.svelte");
  if (explorerEntry) {
    const gz = totalGzipForEntry(manifest, explorerEntry);
    const kib = (gz / 1024).toFixed(1);
    if (gz > 15 * 1024) {
      recordViolation("runtime:explorer-bundle", `${kib} KiB > 15 KiB budget`);
    } else {
      console.log(`  explorer-bundle: ${kib} KiB ≤ 15 KiB ✓`);
    }
  } else {
    recordWarning("runtime:explorer-bundle", "explorer route not found in manifest");
  }
}

/* ------------------------------------------------------------------ */
/* main                                                               */
/* ------------------------------------------------------------------ */

console.log("perf-budget: checking perf fitness functions");
checkStaticGates();

if (RUNTIME) {
  console.log("  (--runtime: also reading Vite manifest for bundle gates)");
  checkRuntimeGates();
} else {
  console.log(
    "  (static-only; pass --runtime to also check root/personal/explorer gzip budgets)",
  );
}

if (WARN.length > 0) {
  console.error("");
  console.error(`⚠ ${WARN.length} warning(s):`);
  for (const w of WARN) console.error(`    ${w}`);
}

if (VIO.length > 0) {
  console.error("");
  console.error(`✗ perf-budget: ${VIO.length} violation(s)`);
  for (const v of VIO) console.error(`    ${v}`);
  console.error(
    "\nFix the regression (lazy-load / split / drop the heavy import) and re-run. " +
      "If a target needs to be revised, update the BUDGETS table in this script " +
      "and add a note in the PR description explaining the new ceiling.",
  );
  process.exit(1);
}

console.log("✓ perf-budget: 0 violations");
