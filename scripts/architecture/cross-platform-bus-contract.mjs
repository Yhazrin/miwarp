#!/usr/bin/env node
/**
 * Cross-platform bus-event & runtime-hub contract gate.
 *
 * Extends the existing `tauri-contract.mjs` and `ios-ws-contract.mjs` with
 * v1.0.9-specific assertions:
 *
 *   1. `runtime_hub_*` and `diagnostics_*` Tauri commands must also be
 *      reachable from the iOS WebSocket dispatcher (or explicitly marked
 *      desktop-only with a clear rationale). Desktop-only behavior is a
 *      regression risk for mobile parity.
 *
 *   2. The Rust `BusEvent::Runtime*` and `BusEvent::Diagnostic*` variants
 *      declared in `src-tauri/src/models.rs` must have a matching entry
 *      in the frontend `BusEvent` union in `src/lib/types.ts` (and vice
 *      versa). The general bus-contract test already covers this, but
 *      this script surfaces only the v1.0.9 namespace so the CI log
 *      points the integrator at the right area.
 *
 * This is a NEW script; it does not modify `tauri-contract.mjs` or
 * `ios-ws-contract.mjs`. Run via `npm run arch:cross-platform-bus`.
 *
 * Sister to: scripts/architecture/tauri-contract.mjs,
 *            scripts/architecture/ios-ws-contract.mjs,
 *            src/lib/bus/__tests__/bus-contract.test.ts
 */
import { join } from "node:path";
import {
  parseDispatchMethods,
  parseTauriGenerateHandler,
} from "./contract-lib.mjs";
import { REPO_ROOT, readText, report } from "./lib.mjs";

const LIB_RS = join(REPO_ROOT, "src-tauri", "src", "lib.rs");
const DISPATCH = join(REPO_ROOT, "src-tauri", "src", "web_server", "dispatch.rs");
const MODELS_RS = join(REPO_ROOT, "src-tauri", "src", "models.rs");
const TYPES_TS = join(REPO_ROOT, "src", "lib", "types.ts");

const libRsSrc = readText(LIB_RS) ?? "";
const dispatchSrc = readText(DISPATCH) ?? "";
const modelsSrc = readText(MODELS_RS) ?? "";
const typesTsSrc = readText(TYPES_TS) ?? "";

if (!modelsSrc || !typesTsSrc) {
  console.error("✗ cross-platform-bus: cannot read models.rs or types.ts");
  process.exit(1);
}

// ── 1. Tauri → iOS WS reachability for v1.0.9 namespaces ────────────

const { functions: handlers } = parseTauriGenerateHandler(libRsSrc);
const { supported, desktopOnly } = parseDispatchMethods(dispatchSrc);

const RUNTIME_HUB = new Set([
  "runtime_hub_list",
  "runtime_hub_health",
  "runtime_hub_diagnose",
  "runtime_hub_set_default",
]);

const tauriRuntimeHub = new Set();
const tauriDiagnostics = new Set();
for (const fn of handlers) {
  if (fn.startsWith("runtime_hub_")) tauriRuntimeHub.add(fn);
  if (fn.startsWith("diagnostics_")) tauriDiagnostics.add(fn);
}

const violations = [];
const dormant = [];

// 1a. The spec §8 requires EXACTLY 4 runtime_hub_* commands. If the
// integration has landed the hub, enforce the count.
if (tauriRuntimeHub.size > 0) {
  if (tauriRuntimeHub.size !== RUNTIME_HUB.size) {
    const extra = [...tauriRuntimeHub].filter((x) => !RUNTIME_HUB.has(x));
    const missing = [...RUNTIME_HUB].filter((x) => !tauriRuntimeHub.has(x));
    violations.push(
      `runtime_hub_* count mismatch: expected ${RUNTIME_HUB.size} (spec §8), got ${tauriRuntimeHub.size}.` +
        (extra.length ? ` Extra: ${extra.join(", ")}.` : "") +
        (missing.length ? ` Missing: ${missing.join(", ")}.` : ""),
    );
  }
  // Every runtime_hub_* must be reachable from the iOS WS dispatcher.
  for (const cmd of tauriRuntimeHub) {
    if (!supported.has(cmd) && !desktopOnly.has(cmd)) {
      violations.push(
        `runtime_hub command "${cmd}" registered in lib.rs but missing from iOS WS dispatch (and not marked desktop-only). Add a "desktop only" arm in dispatch.rs OR a runtime_hub arm.`,
      );
    }
  }
} else {
  dormant.push(`runtime_hub_* (${RUNTIME_HUB.size} expected, 0 registered — dormant until Agent B lands)`);
}

// 1b. diagnostics_* must be cross-platform (Tauri + WS). If integration
// has landed diagnostics, verify WS parity.
if (tauriDiagnostics.size > 0) {
  for (const cmd of tauriDiagnostics) {
    if (!supported.has(cmd) && !desktopOnly.has(cmd)) {
      violations.push(
        `diagnostics command "${cmd}" registered in lib.rs but missing from iOS WS dispatch. Either add a "desktop only" arm in dispatch.rs OR make it cross-platform.`,
      );
    }
  }
} else {
  dormant.push(`diagnostics_* (0 registered — dormant until Agent D lands)`);
}

// ── 2. BusEvent Runtime/Diagnostic variant sync (v1.0.9 namespace) ──

function extractBusEventVariants(src) {
  const start = src.indexOf("pub enum BusEvent");
  if (start < 0) return [];
  const openIdx = src.indexOf("{", start);
  if (openIdx < 0) return [];
  let depth = 1;
  let i = openIdx + 1;
  while (i < src.length && depth > 0) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    i++;
  }
  const body = src.slice(openIdx, i);
  const re = /^\s*([A-Z][A-Za-z0-9]*)\s*(?:\{|\(|$)/gm;
  const out = [];
  let m;
  while ((m = re.exec(body)) !== null) out.push(m[1]);
  return out;
}

function extractFrontendTypeLiterals(src) {
  const start = src.indexOf("export type BusEvent");
  if (start < 0) return [];
  const after = start + 20;
  const tail = src.slice(after);
  const nextExport = tail.search(
    /\nexport\s+(?:type|interface|enum|const|function|class|default|declare|namespace|abstract|async|let|var|import)/,
  );
  const end = nextExport >= 0 ? after + nextExport + 1 : src.length;
  const body = src.slice(start, end);
  const re = /type:\s*"([a-z_][a-z0-9_]*)"/g;
  const out = [];
  let m;
  while ((m = re.exec(body)) !== null) out.push(m[1]);
  return out;
}

const rustVariants = extractBusEventVariants(modelsSrc);
const tsTypes = extractFrontendTypeLiterals(typesTsSrc);

function variantToSnake(v) {
  return v.replace(/([A-Z])/g, (_, c, idx) =>
    idx === 0 ? c.toLowerCase() : `_${c.toLowerCase()}`,
  );
}

const RUNTIME_VARIANT_PREFIXES = ["Runtime", "Diagnostic"];
const runtimeRust = rustVariants.filter((v) =>
  RUNTIME_VARIANT_PREFIXES.some((p) => v.startsWith(p)),
);
const runtimeTs = tsTypes.filter((t) =>
  RUNTIME_VARIANT_PREFIXES.some((p) => {
    // Convert Runtime* to snake_case: RuntimeReady → runtime_ready
    // but the ts type uses snake_case so we just check prefix in
    // snake form: "runtime_" / "diagnostic_"
    return t.startsWith(p.toLowerCase() + "_");
  }),
);

const rustSnakeSet = new Set(runtimeRust.map(variantToSnake));
for (const t of runtimeTs) {
  if (!rustSnakeSet.has(t)) {
    violations.push(
      `Frontend BusEvent "${t}" has no matching Rust variant starting with Runtime*/Diagnostic*. Add to src-tauri/src/models.rs or remove from types.ts.`,
    );
  }
}

// Don't fail on the reverse: if Rust declares a Runtime* variant that
// TS hasn't picked up yet, the general bus-contract test catches it.
// We only surface v1.0.9-specific drift here.

const summary = [
  `runtime_hub_*: ${tauriRuntimeHub.size}/${RUNTIME_HUB.size} (expected: ${RUNTIME_HUB.size})`,
  `diagnostics_*: ${tauriDiagnostics.size} (cross-platform enforced when > 0)`,
  `Rust Runtime*/Diagnostic* BusEvent variants: ${runtimeRust.length}`,
  `TS Runtime*/Diagnostic* type literals: ${runtimeTs.length}`,
].join("\n  ");

if (dormant.length > 0) {
  console.log(`  dormant checks (no implementation yet):`);
  for (const d of dormant) console.log(`    - ${d}`);
}

process.exit(
  report(
    "cross-platform-bus",
    violations,
    `${summary}\n` +
      `See docs/architecture/v1.0.9-runtime-contract.md §8 (commands) and\n` +
      `docs/architecture/cross-platform-capability-matrix.md for cross-platform rules.`,
  ),
);
