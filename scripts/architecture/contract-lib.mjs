/**
 * Shared parsers for the cross-platform capability gate.
 *
 * The scripts in this directory (`tauri-contract.mjs`, `ios-ws-contract.mjs`)
 * are thin orchestration layers over the pure functions here. Keeping the
 * parsers in their own module lets Vitest exercise them directly without
 * spinning up a child process or touching the filesystem.
 *
 * What the parsers do:
 *   - `parseTauriCommandRegistry`  →  extract `CMD.<key> = "snake_case"` from
 *     src/lib/tauri-commands.ts. Returns `{key → value}` and a set of values.
 *   - `parseTauriGenerateHandler`   →  extract every handler expression
 *     registered inside `tauri::generate_handler![ ... ]` in
 *     src-tauri/src/lib.rs. Returns the function-name set. The mapping from
 *     the Rust function name to the wire command string is Tauri-default:
 *     by default a `#[tauri::command] fn foo` exposes the wire name `foo`
 *     (and we observe no `#[tauri::command(rename_all = ...)]` overrides
 *     in lib.rs), so the function name == the CMD value.
 *   - `parseIosWsMethods`           →  extract every `static let NAME = "..."`
 *     inside `enum WSMethod` in apps/ios/.../Core/WebSocketMessages.swift.
 *   - `parseDispatchMethods`        →  extract every `"name" => {` literal-arm
 *     in the `match method { ... }` body of web_server/dispatch.rs. The
 *     underscore-prefixed names (_subscribe, _unsubscribe, _full_reload) are
 *     internal protocol methods; explicit `Err("desktop only")` /
 *     `Err("unknown method")` arms also count as known outcomes. We also
 *     classify methods by `match-guard` outcomes:
 *       - "desktop only"      → method is intentionally blocked from WS
 *       - "ipc only"          → method has a dedicated "IPC-only" arm
 *       - "unknown method"    → method is explicitly listed as blocked
 *     Anything not in the match is the `_ => Err(...)` fallback (truly
 *     unknown) — those don't produce a violation, but they do feed the
 *     capability matrix so we can describe the closed-world assumption.
 */

/**
 * Parse the CMD registry from `src/lib/tauri-commands.ts`.
 *
 * Matches entries shaped like `key_name: "snake_case_value",`. Comments and
 * the `as const` tail are ignored. Order is preserved by key insertion.
 *
 * @param {string} source - raw file contents.
 * @returns {{ entries: Array<{key: string, value: string}>, values: Set<string> }}
 */
export function parseTauriCommandRegistry(source) {
  const entries = [];
  const values = new Set();
  // Match `<key>: "<value>",` inside the CMD block. Keys are valid TS
  // identifier-ish (alphanumeric + underscore), values are snake_case
  // strings. We deliberately don't try to parse the file as a real module —
  // the registry is the only thing that matters for this contract check.
  const re = /^\s*([a-z][a-z0-9_]*)\s*:\s*"([a-z][a-z0-9_]*)"\s*,?/gm;
  let m;
  while ((m = re.exec(source)) !== null) {
    const key = m[1];
    const value = m[2];
    // Filter to only entries that appear inside the CMD block. The script
    // source is small (~180 lines) so a simple heuristic is fine: the
    // registry is delimited by `export const CMD = {` and the closing `}`.
    // We accept any key/value pair matching the shape; out-of-block matches
    // are extremely unlikely given the registry's strict snake_case shape.
    entries.push({ key, value });
    values.add(value);
  }
  return { entries, values };
}

/**
 * Parse the list of handler expressions registered inside
 * `tauri::generate_handler![ ... ]` in `src-tauri/src/lib.rs`.
 *
 * Each line is `commands::module::function_name,`. We return the set of
 * function names; the matching to wire command strings is the identity map
 * (Tauri default behavior, observed in this codebase).
 *
 * @param {string} source - raw file contents of src-tauri/src/lib.rs.
 * @returns {{ functions: Set<string>, span: {start: number, end: number} | null }}
 */
export function parseTauriGenerateHandler(source) {
  // Locate the macro invocation: `tauri::generate_handler![`. The macro
  // body is a comma-separated list of `path::to::fn` expressions, possibly
  // split across multiple lines with `///` doc comments interspersed.
  const startIdx = source.indexOf("tauri::generate_handler![");
  if (startIdx === -1) {
    return { functions: new Set(), span: null };
  }
  // Walk forward to the matching `]`. We track bracket depth — but since
  // the macro body contains no nested `[]` in this codebase, a simple scan
  // for the next `];` works. (We still scan char-by-char for safety.)
  let depth = 0;
  let endIdx = -1;
  for (let i = startIdx; i < source.length; i++) {
    const c = source[i];
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx === -1) {
    return { functions: new Set(), span: null };
  }
  const body = source.slice(startIdx, endIdx + 1);
  const functions = new Set();
  // Match `commands::<module>::<fn>` (the common shape) and `scheduler::<fn>`
  // for the top-level scheduler handlers. Doc comments (`/// ...`) are
  // stripped implicitly because they don't match the regex shape.
  const handlerRe = /(?:commands|scheduler)::([a-z][a-z0-9_]*(?:::[a-z][a-z0-9_]*)*)/g;
  let m;
  while ((m = handlerRe.exec(body)) !== null) {
    // The last segment is the function name.
    const parts = m[1].split("::");
    functions.add(parts[parts.length - 1]);
  }
  return { functions, span: { start: startIdx, end: endIdx } };
}

/**
 * Classify the union of frontend CMD values and backend handler function
 * names. Returns drift violations of three flavors:
 *
 *   - `unregistered`     frontend references a CMD value that the backend
 *                        never registers. This MUST fail the check — the
 *                        `invoke()` call would round-trip to "command not
 *                        found" at runtime.
 *   - `wireMismatch`     frontend CMD value and the matching Rust function
 *                        name diverge. Detected by keying CMD values that
 *                        exist in frontend by their *value* (wire string)
 *                        and checking the backend set contains the same
 *                        wire string. We treat absence as `unregistered`
 *                        above; this entry is reserved for future use if
 *                        the codebase ever introduces rename attributes.
 *
 * The backend is allowed to have handlers the frontend never uses (e.g.
 * desktop-only screens, future IPC commands). We surface them as
 * `backendOnly` for visibility but never fail.
 *
 * @param {Set<string>} cmdValues - wire command strings from the TS registry.
 * @param {Set<string>} handlerFns - function names from generate_handler!.
 * @returns {{
 *   unregistered: string[],
 *   backendOnly: string[],
 * }}
 */
export function classifyTauriDrift(cmdValues, handlerFns) {
  const unregistered = [];
  const backendOnly = [];
  for (const value of cmdValues) {
    if (!handlerFns.has(value)) unregistered.push(value);
  }
  for (const fn of handlerFns) {
    if (!cmdValues.has(fn)) backendOnly.push(fn);
  }
  unregistered.sort();
  backendOnly.sort();
  return { unregistered, backendOnly };
}

/**
 * Parse every `static let NAME = "value"` declared inside `enum WSMethod`
 * in the iOS WebSocketMessages.swift file. Order preserved.
 *
 * WebSocketMessages.swift groups constants under enums by domain
 * (WSEndpoint, WSHeader, WSEventName, WSField, WSMethod, ...). We isolate
 * just the WSMethod block so we don't pull in unrelated protocol strings
 * like `"Authorization"` (header name) or `"bus-event"` (event name).
 *
 * @param {string} source
 * @returns {{ entries: Array<{name: string, value: string}>, values: Set<string> }}
 */
export function parseIosWsMethods(source) {
  const entries = [];
  const values = new Set();
  // Locate the `enum WSMethod { ... }` block. We walk braces forward from
  // the declaration to find the closing `}`. (Swift enums don't nest
  // braces, so a depth counter is sufficient.)
  const declIdx = source.indexOf("enum WSMethod");
  if (declIdx === -1) {
    return { entries, values };
  }
  const openIdx = source.indexOf("{", declIdx);
  if (openIdx === -1) return { entries, values };
  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx === -1) return { entries, values };
  const block = source.slice(openIdx, closeIdx + 1);
  const re = /static\s+let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    entries.push({ name: m[1], value: m[2] });
    values.add(m[2]);
  }
  return { entries, values };
}

/**
 * Extract every RPC method name the iOS client actually sends to the server,
 * by scanning `sendRequest(method: "<name>", ...)` call sites across the
 * iOS source. WebSocketMessages.swift's `enum WSMethod` only declares two
 * constants (`_subscribe`, `_full_reload`); the rest of the protocol is
 * hand-written as string literals in MiWarpRPC.swift. This helper closes
 * that gap so the contract gate covers the real wire surface, not just the
 * constants registry.
 *
 * Comments (// line comments and slash-star ... slash-star block comments)
 * are stripped before matching — otherwise commented-out call sites would
 * falsely appear as wire methods. The Swift parser is line-based for
 * simplicity.
 *
 * @param {string} source
 * @returns {Set<string>}
 */
export function parseIosSentMethods(source) {
  const stripped = source
    // Strip /* ... */ block comments (non-greedy, may span lines).
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // Strip // ... line comments.
    .replace(/\/\/.*$/gm, "");
  const out = new Set();
  // `sendRequest(method: "<name>"` — the method is always the first label.
  // We allow whitespace and an optional `params:` argument after.
  const re = /sendRequest\s*\(\s*method\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    out.add(m[1]);
  }
  return out;
}

/**
 * Parse every method string the Rust WS dispatch supports, plus the set of
 * explicitly *blocked* methods (those that return "desktop only" /
 * "unknown method" errors before the catch-all).
 *
 * The dispatch in `web_server/dispatch.rs` is a giant `match method { ... }`.
 * Each top-level arm is `"<method>" => { ... }`. The match body also contains
 * many quoted strings — param names (`"id"`, `"cwd"`), error messages,
 * JSON keys — that are NOT method arms. We isolate only the top-level arm
 * pattern by anchoring on line indentation and the `=> {` separator.
 *
 * Underscore-prefixed methods (`_subscribe`, `_unsubscribe`) are special:
 * they're handled in `web_server/ws.rs` BEFORE the match. We treat them as
 * SUPPORTED so long as they appear in ws.rs's own pre-match handling.
 * (See parseWsInternalMethods.)
 *
 * @param {string} source - raw dispatch.rs file.
 * @returns {{
 *   supported: Set<string>,
 *   desktopOnly: Set<string>,
 *   unknown: Set<string>,
 *   ipcOnly: Set<string>,
 * }}
 */
export function parseDispatchMethods(source) {
  // Locate the `let result = match method {` block. The block ends at the
  // first `};` after the opening brace at the function's call site. Because
  // the match body contains arbitrary expressions (including other `match`
  // expressions in helpers), we use a depth counter starting from the
  // `match` keyword rather than the `{` of the `match`.
  const matchStart = source.indexOf("match method {");
  if (matchStart === -1) {
    return {
      supported: new Set(),
      desktopOnly: new Set(),
      unknown: new Set(),
      ipcOnly: new Set(),
    };
  }
  const openIdx = source.indexOf("{", matchStart);
  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx === -1) {
    return {
      supported: new Set(),
      desktopOnly: new Set(),
      unknown: new Set(),
      ipcOnly: new Set(),
    };
  }
  const block = source.slice(openIdx, closeIdx + 1);

  const supported = new Set();
  const desktopOnly = new Set();
  const unknown = new Set();
  const ipcOnly = new Set();

  // Match a top-level arm. Lines look like:
  //     "method_name" => {
  //     "method_name"
  //         | "other_method" => {        (multi-pattern arm continuation)
  //
  // We use two separate passes because the regex engine advances past
  // each match — once a continuation `|` is consumed, the next iteration
  // starts AFTER it, so `^\s*` can't anchor to line start for the
  // joined-pattern arms. Splitting into "start-of-line" + "continuation"
  // regexes keeps each match addressable.
  //
  // In both cases the literal must be followed by either `=>` or another
  // `|` continuation. This rules out param-name literals like `"id"`,
  // `"cwd"` that appear inside arm bodies.
  const armRegexes = [
    /^\s*"([a-zA-Z_][a-zA-Z0-9_]*)"(?:\s*=>|\s*\|)/gm,
    /^\s*\|\s*"([a-zA-Z_][a-zA-Z0-9_]*)"(?:\s*=>|\s*\|)/gm,
  ];
  for (const armRe of armRegexes) {
    let m;
    while ((m = armRe.exec(block)) !== null) {
      const methodName = m[1];
      // Bound the inspection window to THIS arm only. Without a boundary,
      // a 320-char tail would bleed into the next arm and pick up its
      // error string (e.g. "unknown method"), falsely classifying the
      // current arm. The next arm begins after the closing `,` of this
      // arm — we look for a newline + indentation + a top-level match
      // start (`"name"` or `_`). Importantly, the `|` continuation inside
      // a multi-pattern arm does NOT count as a boundary — it's part of
      // the same arm.
      const armRemainder = block.slice(m.index);
      const nextArm = armRemainder.match(/\n\s+(?:"[a-zA-Z_]|_\s*=>)/);
      const armBody = nextArm
        ? armRemainder.slice(0, nextArm.index)
        : armRemainder;
      const tail = armBody.slice(0, 320);
      if (tail.includes('"desktop only"')) {
        desktopOnly.add(methodName);
      } else if (tail.includes('"unknown method"')) {
        unknown.add(methodName);
      } else if (tail.includes('"IPC-only')) {
        ipcOnly.add(methodName);
      } else {
        supported.add(methodName);
      }
    }
  }
  return { supported, desktopOnly, unknown, ipcOnly };
}

/**
 * Internal WS-only methods handled in web_server/ws.rs before the dispatch
 * match. These are underscore-prefixed by convention (`_subscribe`,
 * `_unsubscribe`, `_full_reload`) and never appear in the dispatch match.
 *
 * @param {string} source - raw ws.rs file.
 * @returns {Set<string>}
 */
export function parseWsInternalMethods(source) {
  const out = new Set();
  // Match `match method {` arms inside ws.rs's cmd_loop task. Same shape as
  // dispatch but only underscore-prefixed values matter.
  const re = /"(_[a-zA-Z][a-zA-Z0-9_]*)"\s*=>\s*\{/g;
  let m;
  while ((m = re.exec(source)) !== null) out.add(m[1]);
  // Also pull names referenced in full_reload envelopes (server-pushed,
  // not request methods, but documented in the matrix).
  const evRe = /"(_[a-zA-Z][a-zA-Z0-9_]*)"\s*,/g;
  while ((m = evRe.exec(source)) !== null) out.add(m[1]);
  return out;
}

/**
 * Classify the union of iOS-declared WS methods vs. what the Rust side
 * actually serves. Returns drift violations of two flavors:
 *
 *   - `unsupported`  iOS sends a method that is neither supported by the
 *                    dispatch match nor handled by the WS internal layer.
 *                    These would hit the `unknown method: <name>` fallback
 *                    at runtime — fail the check.
 *   - `categorised`  iOS sends a method that the dispatcher explicitly
 *                    classifies as `desktopOnly`, `ipcOnly`, or `unknown`.
 *                    These would produce a graceful error rather than a
 *                    crash, so we surface them as drift with the reason
 *                    (allows catching accidental re-use of these names).
 *
 * The server may support methods iOS never sends — that's allowed and
 * surfaced as `serverOnly` for visibility.
 *
 * @param {Set<string>} iosValues
 * @param {{
 *   supported: Set<string>,
 *   desktopOnly: Set<string>,
 *   unknown: Set<string>,
 *   ipcOnly: Set<string>,
 * }} dispatch
 * @param {Set<string>} wsInternal
 * @returns {{
 *   unsupported: Array<{method: string, reason: string}>,
 *   categorised: Array<{method: string, reason: string}>,
 *   serverOnly: string[],
 * }}
 */
export function classifyIosWsDrift(iosValues, dispatch, wsInternal) {
  const unsupported = [];
  const categorised = [];
  const serverOnly = [];
  for (const method of iosValues) {
    if (dispatch.supported.has(method)) continue;
    if (wsInternal.has(method)) continue;
    if (dispatch.desktopOnly.has(method)) {
      categorised.push({ method, reason: "desktop only" });
    } else if (dispatch.ipcOnly.has(method)) {
      categorised.push({ method, reason: "ipc only" });
    } else if (dispatch.unknown.has(method)) {
      categorised.push({ method, reason: "explicitly blocked" });
    } else {
      unsupported.push({
        method,
        reason: "no handler in dispatch_command and no internal WS handler",
      });
    }
  }
  const allServer = new Set([
    ...dispatch.supported,
    ...dispatch.desktopOnly,
    ...dispatch.unknown,
    ...dispatch.ipcOnly,
    ...wsInternal,
  ]);
  for (const method of allServer) {
    if (!iosValues.has(method)) serverOnly.push(method);
  }
  unsupported.sort((a, b) => a.method.localeCompare(b.method));
  categorised.sort((a, b) => a.method.localeCompare(b.method));
  serverOnly.sort();
  return { unsupported, categorised, serverOnly };
}

/** Convert Rust VariantName → snake_case wire type literal. */
export function rustBusVariantToType(variant) {
  return variant.replace(/([A-Z])/g, (_, c, idx) =>
    idx === 0 ? c.toLowerCase() : `_${c.toLowerCase()}`,
  );
}

/**
 * Parse Rust `pub enum BusEvent { ... }` variant names from models.rs.
 *
 * @param {string} source
 * @returns {string[]} PascalCase variant names
 */
export function parseRustBusEventVariants(source) {
  const enumStart = source.indexOf("pub enum BusEvent");
  if (enumStart < 0) return [];
  const afterEnum = source.indexOf("{", enumStart);
  if (afterEnum < 0) return [];
  let depth = 1;
  let i = afterEnum + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  const body = source.slice(afterEnum, i);
  const re = /^\s*([A-Z][A-Za-z0-9]*)\s*(?:\{|\(|$)/gm;
  const out = [];
  let m;
  while ((m = re.exec(body))) out.push(m[1]);
  return out;
}

/**
 * Parse iOS `EventType` wire literals from BusEventPayload.swift.
 *
 * @param {string} source
 * @returns {Set<string>}
 */
export function parseIosBusEventTypes(source) {
  const declIdx = source.indexOf("private enum EventType");
  if (declIdx < 0) return new Set();
  const openIdx = source.indexOf("{", declIdx);
  if (openIdx < 0) return new Set();
  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx < 0) return new Set();
  const block = source.slice(openIdx, closeIdx + 1);
  const values = new Set();
  const re = /case\s+([a-z][a-z0-9_]*)/g;
  let m;
  while ((m = re.exec(block))) values.add(m[1]);
  return values;
}

/**
 * Parse Android `parseBusEventFromEnvelope` when-branch wire literals.
 *
 * @param {string} source
 * @returns {Set<string>}
 */
export function parseAndroidBusEventTypes(source) {
  const fnIdx = source.indexOf("parseBusEventFromEnvelope");
  if (fnIdx < 0) return new Set();
  const whenIdx = source.indexOf("when (event)", fnIdx);
  if (whenIdx < 0) return new Set();
  const openIdx = source.indexOf("{", whenIdx);
  if (openIdx < 0) return new Set();
  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx < 0) return new Set();
  const block = source.slice(openIdx, closeIdx + 1);
  const values = new Set();
  const re = /"([a-z][a-z0-9_]*)"\s*->/g;
  let m;
  while ((m = re.exec(block))) values.add(m[1]);
  return values;
}

/**
 * Compare Rust BusEvent variants against mobile decoders.
 *
 * @param {string[]} rustVariants
 * @param {Set<string>} iosTypes
 * @param {Set<string>} androidTypes
 * @param {{ iosAllowMissing?: Set<string>, androidAllowMissing?: Set<string> }} opts
 */
export function classifyMobileBusDrift(rustVariants, iosTypes, androidTypes, opts = {}) {
  const iosAllow = opts.iosAllowMissing ?? new Set(["raw"]);
  const androidAllow = opts.androidAllowMissing ?? new Set(["raw"]);
  const iosMissing = [];
  const androidMissing = [];
  for (const variant of rustVariants) {
    const wire = rustBusVariantToType(variant);
    if (!iosTypes.has(wire) && !iosAllow.has(wire)) {
      iosMissing.push(`${variant} → "${wire}"`);
    }
    if (!androidTypes.has(wire) && !androidAllow.has(wire)) {
      androidMissing.push(`${variant} → "${wire}"`);
    }
  }
  iosMissing.sort();
  androidMissing.sort();
  return { iosMissing, androidMissing };
}

/** Recovery events that must stay payload-aligned across platforms. */
export const RECOVERY_BUS_EVENT_TYPES = [
  "session_recovering",
  "session_recovered",
  "protocol_desync",
];

/** Required payload keys per recovery event (snake_case). */
export const RECOVERY_PAYLOAD_FIELDS = {
  session_recovering: ["reason", "deadline_ms", "from_internal"],
  session_recovered: ["ok"],
  protocol_desync: ["fail_count", "sample"],
};