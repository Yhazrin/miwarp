#!/usr/bin/env node
/**
 * iOS WebSocket RPC contract gate.
 *
 * Cross-checks every RPC method the iOS client sends against the methods
 * the Rust web_server dispatcher actually serves. Two iOS sources feed the
 * contract:
 *   1. `apps/ios/.../Core/WebSocketMessages.swift` → `enum WSMethod` — the
 *      named-constants registry (currently `_subscribe`, `_full_reload`).
 *   2. `apps/ios/.../Core/MiWarpRPC.swift` — every `sendRequest(method:
 *      "<name>", ...)` call site captures the literal wire string used.
 *
 * The union of those is compared against:
 *   - `src-tauri/src/web_server/dispatch.rs` `match method { ... }` arms
 *     (the wire surface for RPC requests)
 *   - `src-tauri/src/web_server/ws.rs` underscore-prefixed methods
 *     (`_subscribe`, `_unsubscribe`, `_full_reload` — the protocol-internal
 *     handlers that run BEFORE the dispatch match)
 *
 * Rules:
 *   - Every iOS-sent method MUST be either:
 *       (a) handled by a `dispatch_command` `match method` arm, or
 *       (b) handled by the WS internal layer in `ws.rs`.
 *     Otherwise the request hits the `unknown method: <name>` fallback
 *     at runtime — fail the check.
 *   - Methods the dispatcher explicitly classifies as "desktop only",
 *     "IPC-only", or "explicitly blocked" are surfaced as categorised drift
 *     (allows accidental re-use of these names to be caught early).
 *
 * Sister to `tauri-contract.mjs` which performs the analogous check across
 * the Tauri IPC boundary.
 *
 * Run from repo root:
 *   node scripts/architecture/ios-ws-contract.mjs
 */
import { join } from "node:path";
import {
  classifyIosWsDrift,
  parseDispatchMethods,
  parseIosSentMethods,
  parseIosWsMethods,
  parseWsInternalMethods,
} from "./contract-lib.mjs";
import { REPO_ROOT, readText, rel, report } from "./lib.mjs";

const wsMessagesFile = join(
  REPO_ROOT,
  "apps",
  "ios",
  "MiWarpMobile",
  "MiWarpMobile",
  "Core",
  "WebSocketMessages.swift",
);
const iosRpcFile = join(
  REPO_ROOT,
  "apps",
  "ios",
  "MiWarpMobile",
  "MiWarpMobile",
  "Core",
  "MiWarpRPC.swift",
);
const dispatchFile = join(
  REPO_ROOT,
  "src-tauri",
  "src",
  "web_server",
  "dispatch",
  "mod.rs",
);
const wsFile = join(REPO_ROOT, "src-tauri", "src", "web_server", "ws.rs");

const wsSrc = readText(wsMessagesFile);
const iosRpcSrc = readText(iosRpcFile);
const dispatchSrc = readText(dispatchFile);
const wsInternalSrc = readText(wsFile);

if (!wsSrc) {
  console.error(`✗ ios-ws-contract: cannot read ${rel(REPO_ROOT, wsMessagesFile)}`);
  process.exit(1);
}
if (!iosRpcSrc) {
  console.error(`✗ ios-ws-contract: cannot read ${rel(REPO_ROOT, iosRpcFile)}`);
  process.exit(1);
}
if (!dispatchSrc) {
  console.error(`✗ ios-ws-contract: cannot read ${rel(REPO_ROOT, dispatchFile)}`);
  process.exit(1);
}
if (!wsInternalSrc) {
  console.error(`✗ ios-ws-contract: cannot read ${rel(REPO_ROOT, wsFile)}`);
  process.exit(1);
}

const { entries: wsMethodEntries } = parseIosWsMethods(wsSrc);
const sentMethods = parseIosSentMethods(iosRpcSrc);
const dispatch = parseDispatchMethods(dispatchSrc);
const wsInternal = parseWsInternalMethods(wsInternalSrc);

// Union of named-constant methods + literal wire strings. Both must be
// supported by the backend.
const iosValues = new Set([
  ...wsMethodEntries.map((e) => e.value),
  ...sentMethods,
]);

if (iosValues.size === 0) {
  console.error(
    "✗ ios-ws-contract: failed to parse any iOS WS methods (neither WSMethod enum nor sendRequest literals)",
  );
  process.exit(1);
}

const { unsupported, categorised, serverOnly } = classifyIosWsDrift(
  iosValues,
  dispatch,
  wsInternal,
);

console.log(
  `  iOS methods (named + literal): ${iosValues.size}  |  dispatch supported: ${dispatch.supported.size}  |  internal WS: ${wsInternal.size}`,
);
console.log(
  `    · WSMethod enum entries: ${wsMethodEntries.length}`,
);
console.log(
  `    · sendRequest literals: ${sentMethods.size}`,
);
console.log(
  `  dispatch categorised (desktop-only/ipc-only/blocked): ${dispatch.desktopOnly.size + dispatch.ipcOnly.size + dispatch.unknown.size}`,
);

/**
 * Methods the dispatcher classifies as desktop-only / IPC-only / blocked
 * are NOT sent by iOS in production. If iOS accidentally re-uses one of
 * these names, it surfaces as drift — but only when iOS genuinely uses
 * the name. The current iOS WSMethod enum + sendRequest literals declare:
 *   - `_subscribe`    → handled by ws.rs internal handler (supported)
 *   - `_unsubscribe`  → handled by ws.rs internal handler (supported)
 *   - `_full_reload`  → server-pushed event name (not a request method).
 *                       Declared in WSMethod for parser symmetry, but iOS
 *                       only reads it off WSResponse.event. No request arm.
 */
const KNOWN_CATEGORISATION = new Map([
  [
    "_full_reload",
    {
      note:
        "Server-pushed event name (not a request method). Declared in WSMethod for parser symmetry, but the iOS client only reads it off WSResponse.event. Sending _full_reload as a request would hit the dispatch catch-all (unknown method) at runtime. Acceptable to keep as documentation.",
    },
  ],
]);

const violations = [];
for (const { method, reason } of unsupported) {
  // Skip categorised-but-not-rejected drift that we explicitly acknowledge.
  const ack = KNOWN_CATEGORISATION.get(method);
  if (ack) continue;
  const sourceLabel = wsMethodEntries.some((e) => e.value === method)
    ? "WSMethod enum"
    : "sendRequest literal";
  violations.push(
    `iOS ${sourceLabel} "${method}" has no Rust handler (${reason}). Either implement the dispatch arm in ${rel(REPO_ROOT, dispatchFile)} or remove the iOS call site.`,
  );
}

// Surface categorised drift as audit hints — never blocks the build, but
// makes accidental re-use of these names visible in CI logs.
for (const { method, reason } of categorised) {
  const ack = KNOWN_CATEGORISATION.get(method);
  if (ack) continue;
  console.log(
    `    [categorised] "${method}" → ${reason} (would be a graceful runtime error, not a crash)`,
  );
}

const serverOnlyFiltered = serverOnly.filter(
  (m) => !KNOWN_CATEGORISATION.has(m),
);
if (serverOnlyFiltered.length > 0) {
  console.log(
    `  server-only methods (allowed): ${serverOnlyFiltered.length}`,
  );
}
if (KNOWN_CATEGORISATION.size > 0) {
  console.log(
    `  known-categorisation allowlist: ${KNOWN_CATEGORISATION.size} (see docs/architecture/cross-platform-capability-matrix.md)`,
  );
}

const hint =
  `iOS sources:\n` +
  `  · ${rel(REPO_ROOT, wsMessagesFile)} (${wsMethodEntries.length} WSMethod entries)\n` +
  `  · ${rel(REPO_ROOT, iosRpcFile)} (${sentMethods.size} sendRequest literals)\n` +
  `Rust sources:\n` +
  `  · ${rel(REPO_ROOT, dispatchFile)} (${dispatch.supported.size} supported, ${dispatch.desktopOnly.size} desktop-only, ${dispatch.ipcOnly.size} ipc-only, ${dispatch.unknown.size} explicitly blocked)\n` +
  `  · ${rel(REPO_ROOT, wsFile)} (${wsInternal.size} pre-match handlers)\n` +
  `Underscore-prefixed methods (_subscribe, _unsubscribe) are protocol-internal — handled in ws.rs, not in dispatch.`;

process.exit(report("ios-ws-contract", violations, hint));