# ADR 0003: WebSocket Connection Lifecycle Management

## Status

Accepted — Phase 1 implemented, pending final gate (2026-06-20)

## Context

The browser-side `WsTransport` class grew to ~370 lines managing connection lifecycle, pending requests, run subscriptions, and chunk assembly through scattered booleans and inline Maps. This created several bugs:

1. **Hanging connect Promise**: When the first WebSocket connection received an error/close, the connect Promise might not reject, leaving callers suspended indefinitely.
2. **Duplicate reconnect timers**: After a connection timeout, both `onclose` and the timeout handler could schedule reconnects, creating concurrent connection attempts.
3. **Subscription ownership leak**: Two consumers subscribing to the same run caused the first `unsubscribeRun` to cancel the server-side subscription for both.
4. **Unbounded chunk buffers**: A malformed or malicious chunk stream could grow unbounded in memory.
5. **Lost pending requests**: On disconnect, pending requests were rejected with `[object Object]` because the error serialization lost the RPC error structure.

## Decision

Refactor `WsTransport` into five focused modules:

1. **`ConnectionStateMachine`** — explicit state transitions with generation tracking. Replaces scattered booleans (`shouldReconnect`, `connectPromise`, `timedOut`).
2. **`RequestRegistry`** — manages pending JSON-RPC requests with per-request timeouts and generation-based stale cleanup.
3. **`RunSubscriptions`** — owner-based subscription tracking with monotonic sequence checkpoints. Default owner (`"legacy"`) is idempotent; distinct owner ids required for independent consumers.
4. **`ChunkAssembler`** — bounded chunk assembly with configurable limits (max messages, max chunks, max bytes, timeout). Uses `TextEncoder` for UTF-8 byte measurement and validates declared `size` from `chunk_begin`. Injected `now` clock for testability.
5. **`TimerApi`** — injectable timer interface for deterministic testing without global `vi.useFakeTimers()`.

The `WsTransport` class becomes a thin orchestrator (~380 lines) that delegates to these modules.

Key design patterns:
- **Generation-based invalidation**: Each connection attempt increments a generation counter. Callbacks from old generations are silently ignored.
- **settle-once**: The connect Promise uses a boolean guard to ensure single resolution.
- **Owner-based subscriptions**: `RunSubscriptions` tracks a `Set<string>` of owner ids per run. Default owner is idempotent; only the last owner removal triggers server `_unsubscribe`.
- **onerror without onclose**: `ws.onerror` independently transitions to `Closed`, rejects pending, and schedules reconnect.
- **`_full_reload` resets checkpoint**: `resetSeq` sets `lastSeq` to 0, forcing full server replay.
- **Typed lifecycle errors**: `TransportError` hierarchy and `RequestTimeoutError`/`RpcError` preserve structured `code`/`data`.

## Consequences

### Positive
- Each module is independently testable with fake dependencies
- Connection state is observable via `connectionState` getter
- Pending request timeouts use injected timers (deterministic tests without global `vi.useFakeTimers()`)
- Chunk assembly has explicit bounds preventing memory leaks, with UTF-8 byte validation
- Owner-based subscriptions prevent cross-consumer interference
- Typed lifecycle errors eliminate `[object Object]` in error paths

### Negative
- More files to navigate (5 new modules + test files)
- The `TimerApi` abstraction adds a small layer of indirection
- `window.location` dependency in `buildWsUrl` is still untestable (acceptable: desktop uses TauriTransport)

### Neutral
- `TauriTransport` is unchanged — no-op `subscribeRun`/`unsubscribeRun`/`dispose`
- `Transport` interface gains optional `dispose()` method — backward compatible

## Rejected Alternatives

1. **Global `vi.useFakeTimers()`**: Works for isolated tests but conflicts with other test modules that use real timers. Injected `TimerApi` is more precise.
2. **RxJS/Observable for connection state**: Overkill for a state machine with 7 states. Plain enum + transition method is simpler.
3. **Event emitter for state changes**: Subscribing to state changes via callback is sufficient; no need for a full event emitter.
4. **Single-file refactor**: Keeping everything in `WsTransport` would not address the testability or cohesion issues.

## Verification

- 75 transport tests (5 test files) covering connection lifecycle, request management, owner-based subscriptions, chunk bounds, and dispose (verified 2026-06-20)
- Full suite results deferred to independent verification
- `npm run check` — 0 errors
- `npm run lint` — 0 errors (pre-existing warnings only)
