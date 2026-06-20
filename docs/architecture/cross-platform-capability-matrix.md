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
| Frontend `CMD` registry entries                 | **156** |
| Backend handlers in `generate_handler!`         | **194** |
| Backend-only handlers (allowed)                 | **38** |
| Frontend references unregistered (must be 0)    | **0** |

**Backend-only handlers** (38) are exposed for desktop use but the frontend
never invokes them via `CMD`. Examples: scheduled-task handlers
(`scheduler::*`), IPC-only commands like `get_web_server_token`, and
worktree helpers. These are intentionally retained for plugin / CLI access.

**Known pre-existing drift** (allowlisted; tracked for refactor):

| Drift                              | Source                                                         | Status           |
|------------------------------------|----------------------------------------------------------------|------------------|
| `CMD.load_run_data` not registered | `src/lib/api.ts:776` defines `loadRunData()` but it's never called from any consumer; the WS dispatch explicitly blocks it as `"unknown method"` | Dead code — delete the CMD entry + `loadRunData()` export |

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
| Explicitly blocked                | **1**   | `load_run_data` — deprecated; falls back to `"unknown method"`       |
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
| iOS `BusEventPayload` cases                       | **32** |
| Variants both sides support                       | **30** |
| Rust-only (broadcast but iOS doesn't decode)      | **4** |

**Rust-only variants** (4) — broadcast by the session_actor but the iOS
client falls back to `.raw(RawPayload)` for them. They appear in
`WSResponse.event` as opaque JSON and the iOS UI ignores them:

| Rust variant        | Used by                       | iOS coverage           |
|---------------------|-------------------------------|------------------------|
| `SessionRecovering` | Recovery flow                 | Raw (decoded as `.raw`) |
| `SessionRecovered`  | Recovery flow                 | Raw                     |
| `ProtocolDesync`    | Diagnostic / crash detector   | Raw                     |
| `Raw`               | Forwarded stdio for tools     | N/A — iOS never sees    |

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

3. **`load_run_data` is dead-code**. Frontend declares it in `CMD`,
   `src/lib/api.ts` exports `loadRunData()`, but no consumer calls it. The
   backend never registered it in `generate_handler!`. Tracked for removal
   (see §1 known-drift table).

4. **`web_server::dispatch_command` is the single closed-world match**.
   Any method NOT in the match arms falls through to
   `_ => Err(format!("unknown method: {}", method))`. The contract gate
   enforces that every iOS-sent method lands in a known arm or the
   `ws.rs` pre-match handler.

5. **BusEvent asymmetry is intentional**. The Rust side produces more
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

Parser unit tests live in
`scripts/architecture/__tests__/contract-lib.test.ts` (23 tests) and run as
part of `npm test`.

To regenerate this document, run the two contract scripts and pipe their
output into a draft; the tables above were captured from the script
output on 2026-06-21.