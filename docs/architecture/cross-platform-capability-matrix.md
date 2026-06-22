# Cross-Platform Capability Matrix

> Generated and validated by `npm run arch:check` (specifically `arch:tauri-contract`
> and `arch:ios-ws-contract`). Re-run after touching any of:
>
> - `src/lib/tauri-commands.ts`
> - `src-tauri/src/lib.rs` (`tauri::generate_handler!` body)
> - `apps/ios/.../Core/WebSocketMessages.swift` (`enum WSMethod`)
> - `apps/ios/.../Core/MiWarpRPC.swift` (`sendRequest(method:)` call sites)
> - `src-tauri/src/web_server/dispatch.rs` (`match method { ... }` body)
> - `src-tauri/src/web_server/ws.rs` (`match method { ... }` body)
>
> Numbers below were captured on 2026-06-21 against `integration/quality-foundation-20260621`.

This matrix is the single source of truth for "what works on which platform."
Three independent transport surfaces exist:

| Surface                       | Carrier                    | Audience                                  |
|-------------------------------|----------------------------|-------------------------------------------|
| **Desktop IPC**               | Tauri `invoke()`           | Tauri desktop frontend (`src/`)           |
| **Browser WS**                | `web_server::dispatch`     | Browser SPA talking to embedded Axum      |
| **iOS RPC**                   | `web_server::ws` (pre-match) + dispatch | iOS app via WebSocket     |

Each surface has its own contract check script. The four surfaces share the
**BusEvent** event stream (broadcast to any subscribed run over WS), so
client compatibility there is tracked separately.

---

## 1. Desktop IPC (Tauri)

**Wire**: `src/lib/tauri-commands.ts` ↔ `src-tauri/src/lib.rs#generate_handler!`

| Metric                                          | Count |
|-------------------------------------------------|------:|
| Frontend `CMD` registry entries                 | **155** |
| Backend handlers in `generate_handler!`         | **194** |
| Backend-only handlers (allowed)                 | **38** |
| Frontend references unregistered (must be 0)    | **0** |

**Backend-only handlers** (38) are exposed for desktop use but the frontend
never invokes them via `CMD`. Examples: scheduled-task handlers
(`scheduler::*`), IPC-only commands like `get_web_server_token`, and
worktree helpers. These are intentionally retained for plugin / CLI access.

---

## 2. Browser WS (web_server dispatch)

**Wire**: Browser SPA → `POST /ws` upgrade → JSON-RPC over WebSocket.
**Server**: `src-tauri/src/web_server/dispatch.rs#dispatch_command`

The dispatcher supports **130 methods** explicitly and classifies **6** as
intentionally non-WS. Methods fall into one of four categories:

| Category                          | Count | Behavior                                                              |
|-----------------------------------|------:|-----------------------------------------------------------------------|
| Supported                         | **130** | Returns JSON-RPC `result` (or `error` for app-level failures)       |
| Desktop-only                      | **5**   | Returns `Err("desktop only")` — these depend on tray, hotkeys, login |
| IPC-only (not exposed over WS)    | **1**   | `get_web_server_token` — secret rotation, never sent over the wire   |
| Explicitly blocked                | **0**   | —                                                               |
| Internal WS (handled in `ws.rs`)  | **3**   | `_subscribe`, `_unsubscribe`, `_full_reload` — protocol-internal    |

**Desktop-only methods** (5):

| Method                          | Reason                                            |
|---------------------------------|---------------------------------------------------|
| `capture_screenshot`            | Uses native hotkey + tray                         |
| `update_screenshot_hotkey`      | Native global shortcut plugin                     |
| `get_clipboard_files`           | Native clipboard plugin                           |
| `run_claude_login`              | OAuth loopback on desktop                         |
| `send_chat_message`             | Long-lived pipeline; WS uses `start_session` + `send_session_message` instead |
| `check_for_updates`             | Tauri updater plugin (desktop only)               |

**Browser-side reality**: the frontend SPA (`src/lib/transport/ws.ts`) and
the iOS client (`apps/ios/.../Core/MiWarpRPC.swift`) both call into the
dispatcher. Of the 130 supported methods, the SPA uses a subset (driven by
`src/lib/api.ts`'s `transport` selection) and the iOS client uses another
subset (see §3). 123 methods are "server-only" from any single client's
viewpoint — they're available for whichever client happens to need them.

---

## 3. iOS RPC (WebSocket)

**Wire**: iOS client → `WS upgrade /ws` → JSON-RPC
**Sources scanned**:

- `apps/ios/MiWarpMobile/MiWarpMobile/Core/WebSocketMessages.swift`
  → `enum WSMethod` named-constant registry
- `apps/ios/MiWarpMobile/MiWarpMobile/Core/MiWarpRPC.swift`
  → `sendRequest(method: "<literal>", ...)` call sites

| Metric                                                                  | Count |
|-------------------------------------------------------------------------|------:|
| iOS methods (named + literal, deduplicated)                             | **16** |
| &nbsp;&nbsp;· `WSMethod` enum entries                                   | 2     |
| &nbsp;&nbsp;· `sendRequest(method:)` literals                           | 15    |
| iOS methods supported by Rust dispatch                                  | **16** |
| iOS methods without a Rust handler (must be 0)                          | **0** |

**iOS method taxonomy**:

| Method                | Source          | Rust handler location                              |
|-----------------------|-----------------|----------------------------------------------------|
| `_subscribe`          | `WSMethod` enum | `src-tauri/src/web_server/ws.rs` (pre-match)       |
| `_full_reload`        | `WSMethod` enum | `src-tauri/src/web_server/ws.rs` (server-pushed event, not a request) |
| `list_runs`           | `sendRequest`   | `dispatch.rs` `match method`                       |
| `get_run`             | `sendRequest`   | `dispatch.rs` `match method`                       |
| `get_bus_events`      | `sendRequest`   | `dispatch.rs` `match method`                       |
| `_unsubscribe`        | `sendRequest`   | `src-tauri/src/web_server/ws.rs` (pre-match)       |
| `send_session_message`| `sendRequest`   | `dispatch.rs` `match method`                       |
| `start_session`       | `sendRequest`   | `dispatch.rs` `match method`                       |
| `stop_session`        | `sendRequest`   | `dispatch.rs` `match method`                       |
| `fork_session`        | `sendRequest`   | `dispatch.rs` `match method`                       |
| `respond_permission`  | `sendRequest`   | `dispatch.rs` `match method`                       |
| `approve_session_tool`| `sendRequest`   | `dispatch.rs` `match method`                       |
| `get_run_artifacts`   | `sendRequest`   | `dispatch.rs` `match method`                       |
| `get_git_status`      | `sendRequest`   | `dispatch.rs` `match method`                       |
| `get_git_diff`        | `sendRequest`   | `dispatch.rs` `match method`                       |
| `get_web_server_status` | `sendRequest` | `dispatch.rs` `match method`                       |

**Known categorisation drift** (allowlisted; tracked for documentation):

| Method          | Category         | Why allowlisted                                                 |
|-----------------|------------------|-----------------------------------------------------------------|
| `_full_reload`   | Server-pushed event | Declared in `WSMethod` for parser symmetry, but iOS only reads it off `WSResponse.event`. Not a request method. |

**Internal methods (underscore-prefixed)** are protocol-layer — handled in
`ws.rs` BEFORE the dispatch match. They are NEVER sent to `dispatch_command`:

- `_subscribe`     → registers a run subscription + replays from `last_seq`
- `_unsubscribe`   → drops a subscription
- `_full_reload`   → server → client envelope (clear state + re-fetch)

If you add a new underscore-prefixed method, declare its handler in
`ws.rs#cmd_loop` (the second `match method` block) AND add it to the
allowlist above with a tracking note.

---

## 4. BusEvent coverage

**Wire**: server → any subscribed WS client (iOS + browser).
**Sources**: `src-tauri/src/models.rs#BusEvent` ↔
`apps/ios/.../Core/BusEventPayload.swift`.

| Metric                                            | Count |
|---------------------------------------------------|------:|
| Rust `BusEvent` variants                          | **34** |
| iOS `BusEventPayload` cases                       | **35** |
| Variants both sides support                       | **33** |
| Rust-only (broadcast but iOS doesn't decode)      | **1** |

**Rust-only variants** (1) — broadcast by the session_actor but the iOS
client falls back to `.raw(RawPayload)` only for truly unknown wire types:

| Rust variant        | Used by                       | iOS coverage           |
|---------------------|-------------------------------|------------------------|
| `SessionRecovering` | Recovery flow                 | Typed (`sessionRecovering`) |
| `SessionRecovered`  | Recovery flow                 | Typed (`sessionRecovered`)  |
| `ProtocolDesync`    | Diagnostic / crash detector   | Typed (`protocolDesync`)    |
| `Raw`               | Forwarded stdio for tools     | N/A — iOS never sees        |

**Known mismatches on the Rust-only side**: iOS's `BusEventPayload` includes
`.fullReload` (a control event sent by the WS layer when the replay buffer
overflows). On the Rust side this is encoded as `bus-event` envelope with
`event: "_full_reload"`, NOT as a `BusEvent` variant. The dispatch sends it
from `ws.rs#send_full_reload`, not from `broadcaster`.

---

## 5. Cross-cutting limitations

These are deliberate — they describe what does NOT work cross-platform and
why. Each is enforced (or surfaced) by the contract scripts.

1. **Desktop-only commands cannot be invoked from the browser or iOS**.
   The dispatcher returns `Err("desktop only")` rather than crashing.
   Surfaced by `arch:ios-ws-contract` as "categorised drift" if iOS
   accidentally tries to call one.

2. **Tokens and secrets never leave the IPC channel**. `get_web_server_token`
   is explicitly marked IPC-only (`Err("desktop only")`) and stripped from
   `get_user_settings` results when served over WS. Browser/iOS clients see
   the token only via the WebSocket handshake URL or HTTP login cookie.

3. **`web_server::dispatch_command` is the single closed-world match**.
   Any method NOT in the match arms falls through to
   `_ => Err(format!("unknown method: {}", method))`. The contract gate
   enforces that every iOS-sent method lands in a known arm or the
   `ws.rs` pre-match handler.

4. **BusEvent asymmetry is intentional**. The Rust side produces more
   variants than the iOS side decodes — adding a new Rust variant does NOT
   require an iOS change (the iOS client gracefully degrades to `.raw`).
   The reverse is NOT true: adding a new iOS `BusEventPayload` case
   without a matching Rust variant will surface as a runtime decode
   warning (caught by `WSResponse.init(from:)`).

---

## 6. CI gate

All numbers above are verified at PR time by:

```bash
npm run arch:check
```

This runs in order:
1. `arch:direction` — dependency direction matrix (R1–R5)
2. `arch:layers` — Tauri/transport cross-layer leakage
3. `arch:cycle` — circular import detection (Tarjan SCC)
4. `arch:budget` — file size budget
5. `arch:tauri-contract` — **this document's §1**
6. `arch:ios-ws-contract` — **this document's §3**
7. `arch:mobile-bus-contract` — **this document's §4** (Rust ↔ iOS/Android BusEvent)

Parser unit tests live in
`scripts/architecture/__tests__/contract-lib.test.ts` (23 tests) and run as
part of `npm test`.

To regenerate this document, run the two contract scripts and pipe their
output into a draft; the tables above were captured from the script
output on 2026-06-21.

---

## 7. v1.0.9 Migration Compatibility Matrix

> **Date**: 2026-06-22
> **Branch**: integration/v1.0.9-runtime-hub
> **Source contract**: v1.0.9-runtime-contract.md, v1.0.9-transaction-contracts.md

The table below shows the platform-by-platform state of the v1.0.9
features. The "Status" column uses the following vocabulary:

- **Supported**: the feature is wired through the platform's full
  stack (Tauri IPC, WS, or native API) and tested in the e2e
  golden-path spec.
- **Dormant**: the platform's wire surface accepts the feature but
  the UI / native code is not yet implemented. The contract is
  in place; the implementation is the next agent's work.
- **Desktop-only**: the feature is intentionally limited to the
  desktop (e.g. it depends on a tray icon, global hotkey, or
  native plugin).
- **N/A**: the feature is not applicable to this platform (e.g.
  Tauri IPC does not apply to iOS).

The matrix is enforced by:

- `arch:cross-platform-bus` — runtime_hub_* and diagnostics_* must
  be cross-platform (Tauri + iOS WS).
- `arch:runtime-contract` — 4 runtime_hub commands, 12 capability
  flags, full §3/§9/§4 spec coverage.
- `arch:tauri-contract` and `arch:ios-ws-contract` — the baseline
  cross-platform wire-surface parity.

| Feature / Capability | Desktop (Tauri) | Browser WS | iOS | Android |
|---|---|---|---|---|
| **Runtime Hub — list** (`runtime_hub_list`) | Dormant (Agent B) | Dormant (Agent B) | Dormant (Agent B) | Dormant (Agent B) |
| **Runtime Hub — health** (`runtime_hub_health`) | Dormant (Agent B) | Dormant (Agent B) | Dormant (Agent B) | Dormant (Agent B) |
| **Runtime Hub — diagnose** (`runtime_hub_diagnose`) | Dormant (Agent B) | Dormant (Agent B) | Dormant (Agent B) | Dormant (Agent B) |
| **Runtime Hub — set default** (`runtime_hub_set_default`) | Dormant (Agent B) | Dormant (Agent B) | Dormant (Agent B) | Dormant (Agent B) |
| **RuntimeCapabilities** (12 flags in §3) | Dormant (Agent C) | N/A | Dormant (Agent C) | Dormant (Agent C) |
| **Capability → UI degradation** (§9 map) | Dormant (Agent C/E) | N/A | Dormant (Agent C/E) | Dormant (Agent C/E) |
| **SendTransaction** (typed, 6 states) | Supported (Agent A landed Phase 1/2) | Dormant (browser SPA uses HTTP polling) | Dormant (iOS uses send_session_message) | Dormant |
| **PermissionTransaction** (typed errors, NEVER_ALLOW_TOOLS) | Supported (Agent A) | Dormant | Dormant (iOS uses respond_permission) | Dormant |
| **RecoveryState machine** (5 states, 30s window) | Supported (Agent A) | Dormant | Dormant | Dormant |
| **ActorLifecycle** (6 states incl. CrashReason) | Supported (Agent A) | N/A (no actor model in browser) | Dormant (iOS consumes as BusEvent) | Dormant |
| **accepted_client_message_ids** (FIFO ledger) | Supported (Agent A) | N/A | N/A | N/A |
| **DiagnosticEvent** (BusEvent::Diagnostic*) | Dormant (Agent D) | Dormant (Agent D) | Dormant (Agent D) | Dormant (Agent D) |
| **RuntimeReady** (BusEvent::Runtime*) | Dormant (Agent B) | Dormant (Agent B) | Dormant (Agent B) | Dormant (Agent B) |
| **RuntimeHealthChanged** (BusEvent::Runtime*) | Dormant (Agent B) | Dormant (Agent B) | Dormant (Agent B) | Dormant (Agent B) |
| **Diagnostics page** (UI route `/diagnostics`) | Supported (Agent D, src/routes/diagnostics) | N/A (browser SPA does not have a /diagnostics page) | N/A | N/A |
| **Diagnostics export** (zip with redacted manifest) | Dormant (Agent D) | N/A | N/A | N/A |
| **iOS reconnect storm handling** (10 in 5s) | N/A | N/A | Dormant (Agent G) | N/A |
| **Android reconnect storm handling** | N/A | N/A | N/A | Dormant (Agent G) |

### 7.1. Known cross-platform gaps for v1.0.9

These gaps are documented for the release notes — they are NOT
contract violations. Each row points to the agent that owns the
follow-up.

| Gap | Affected platforms | Owner | Workaround |
|---|---|---|---|
| Runtime Hub is not yet wired through the UI | All | Agent C (composable) | UI falls back to the v1.0.8 single-runtime model |
| Diagnostics page is a stub on the SPA | Browser WS | Agent D | SPA shows "diagnostics not available in browser mode" |
| iOS app consumes `RuntimeReady` / `RuntimeHealthChanged` as `.raw` | iOS | Agent G | iOS UI ignores; falls back to v1.0.8 polling |
| Android parity is forward-looking; not all v1.0.9 contracts apply | Android | Agent G | Android continues on v1.0.8 surface; tracked for v1.0.10 |

### 7.2. Cross-platform parity verification (CI gate)

The matrix is enforced at PR time by:

```bash
npm run arch:check
```

This runs in order:

1. `arch:direction` — dependency direction matrix
2. `arch:layers` — Tauri/transport cross-layer leakage
3. `arch:cycle` — circular import detection
4. `arch:budget` — file size budget
5. `arch:tauri-contract` — Desktop IPC CMD ↔ handler parity
6. `arch:ios-ws-contract` — iOS WS method ↔ dispatch parity
7. `arch:cross-platform-bus` — runtime_hub + diagnostics cross-platform
8. `arch:runtime-contract` — v1.0.9 spec shape (4 commands, 12 capabilities)

For release tags, run `npm run arch:check:strict` which adds the
per-commit file-budget diff gate.

A red cell in the matrix above is NOT a release blocker per se — it
is a documented gap. A red gate (e.g. a Rust variant that the
frontend does not know about) IS a release blocker; the contract
test will fail and the integrator will reject the commit.