#!/usr/bin/env node
/**
 * Tauri command contract gate.
 *
 * Cross-checks `src/lib/tauri-commands.ts` (the frontend's CMD registry, the
 * single source of truth for `invoke()` strings) against the `generate_handler!`
 * macro body in `src-tauri/src/lib.rs` (the backend's registered handler list).
 *
 * Rule:
 *   - Every CMD value referenced by the frontend MUST be registered as a
 *     handler in the backend. Otherwise `invoke(cmd, args)` round-trips to
 *     `command not found` at runtime.
 *   - The backend is allowed to register handlers the frontend never calls
 *     (future IPC, scheduled tasks, plugin-only commands). These surface as
 *     `backendOnly` in the report but do not fail the check.
 *
 * Sister to `ios-ws-contract.mjs` which performs the analogous check across
 * the WebSocket protocol boundary.
 *
 * Run from repo root:
 *   node scripts/architecture/tauri-contract.mjs
 */
import { join } from "node:path";
import {
  classifyTauriDrift,
  parseTauriCommandRegistry,
  parseTauriGenerateHandler,
} from "./contract-lib.mjs";
import { REPO_ROOT, readText, rel, report } from "./lib.mjs";

const commandsFile = join(REPO_ROOT, "src", "lib", "tauri-commands.ts");
const libRsFile = join(REPO_ROOT, "src-tauri", "src", "lib.rs");

const cmdSrc = readText(commandsFile);
const libRsSrc = readText(libRsFile);

const { entries: cmdEntries, values: cmdValues } =
  parseTauriCommandRegistry(cmdSrc);
const { functions: handlerFns, span } = parseTauriGenerateHandler(libRsSrc);

if (cmdValues.size === 0) {
  console.error("✗ tauri-contract: failed to parse any CMD entries from tauri-commands.ts");
  process.exit(1);
}
if (handlerFns.size === 0) {
  console.error("✗ tauri-contract: failed to parse any handlers from lib.rs");
  process.exit(1);
}

const { unregistered, backendOnly } = classifyTauriDrift(cmdValues, handlerFns);

/**
 * Pre-existing drift that needs follow-up refactoring. Each entry pairs a
 * wire command string with a tracking note explaining why the drift exists
 * and where to fix it. New drift MUST NOT be added here — add it to
 * `docs/architecture/cross-platform-capability-matrix.md` and ship a fix
 * in the same PR.
 */
const KNOWN_VIOLATIONS = new Map([
  [
    "load_run_data",
    {
      note: "Pre-existing dead code: CMD.load_run_data is declared in tauri-commands.ts and referenced by the never-called loadRunData() helper in src/lib/api.ts:776, but the backend never registered it in generate_handler!. The WS dispatcher explicitly blocks the method as 'unknown method'. Refactor target: delete the unused CMD entry + loadRunData() export.",
    },
  ],
]);

const realUnregistered = unregistered.filter((v) => !KNOWN_VIOLATIONS.has(v));
console.log(
  `  frontend CMD values: ${cmdValues.size}  |  backend handlers: ${handlerFns.size}`,
);
console.log(
  `  span: ${rel(REPO_ROOT, libRsFile)}:${span.start}:${span.end}`,
);
if (KNOWN_VIOLATIONS.size > 0) {
  console.log(
    `  known-violations allowlist: ${KNOWN_VIOLATIONS.size} (see docs/architecture/cross-platform-capability-matrix.md)`,
  );
}

const violations = [];
for (const value of realUnregistered) {
  // Find the frontend key that produced this value (for a useful message).
  const key = cmdEntries.find((e) => e.value === value)?.key ?? "<unknown>";
  violations.push(
    `CMD.${key} → "${value}" is invoked from the frontend but is NOT registered in tauri::generate_handler! in ${rel(REPO_ROOT, libRsFile)}`,
  );
}

// Surface known violations as audit hints so they're not invisible.
for (const [value, { note }] of KNOWN_VIOLATIONS) {
  if (cmdValues.has(value)) {
    console.log(`    [known] CMD.${value} → ${note}`);
  }
}

const hint =
  `Frontend CMD registry: ${rel(REPO_ROOT, commandsFile)} (${cmdEntries.length} entries)\n` +
  `Backend generate_handler: ${rel(REPO_ROOT, libRsFile)} (${handlerFns.size} handlers)\n` +
  `Either register the missing handler in src-tauri/src/lib.rs or remove the unused CMD entry.\n` +
  `Backend-only handlers (allowed): ${backendOnly.length}`;

process.exit(report("tauri-contract", violations, hint));