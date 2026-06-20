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

console.log(
  `  frontend CMD values: ${cmdValues.size}  |  backend handlers: ${handlerFns.size}`,
);
console.log(
  `  span: ${rel(REPO_ROOT, libRsFile)}:${span.start}:${span.end}`,
);

const violations = [];
for (const value of unregistered) {
  // Find the frontend key that produced this value (for a useful message).
  const key = cmdEntries.find((e) => e.value === value)?.key ?? "<unknown>";
  violations.push(
    `CMD.${key} → "${value}" is invoked from the frontend but is NOT registered in tauri::generate_handler! in ${rel(REPO_ROOT, libRsFile)}`,
  );
}

const hint =
  `Frontend CMD registry: ${rel(REPO_ROOT, commandsFile)} (${cmdEntries.length} entries)\n` +
  `Backend generate_handler: ${rel(REPO_ROOT, libRsFile)} (${handlerFns.size} handlers)\n` +
  `Either register the missing handler in src-tauri/src/lib.rs or remove the unused CMD entry.\n` +
  `Backend-only handlers (allowed): ${backendOnly.length}`;

process.exit(report("tauri-contract", violations, hint));