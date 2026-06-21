# MiWarp Communication Architecture Refactor

## Status

- Phase 1 — WebSocket transport kernel: implemented and verified on 2026-06-20.
- Phase 2 — Session run subscription ownership: implemented and verified on 2026-06-20.
- Phase 3 — Single-flight recovery and adapter-neutral connection health: implemented and verified on 2026-06-20.
- Phase 4 — Deterministic event projection, protocol desync contract and backend symmetry: planned.

## Scope

This document covers the communication path:

```text
SessionStore / UI orchestration
→ SessionRunConnection
→ Transport interface
→ WsTransport or TauriTransport
→ Axum WebSocket / Tauri IPC
→ Session Actor / event storage
```

Phase 1 changes `src/lib/transport/`. Phase 2 changes the logical ownership boundary in `src/lib/chat/`, `SessionStore` and `EventMiddleware`. Rust backend behavior and product UI remain unchanged so far.

## Drivers

The refactor addresses recurring classes of bugs rather than isolated symptoms:

- first connection attempts that could remain unresolved;
- duplicate reconnect timers and stale WebSocket callbacks;
- pending requests surviving disconnects or losing structured errors;
- duplicate or premature run unsubscribe operations;
- replay checkpoints regressing or becoming inconsistent after reload;
- unbounded/incomplete chunk buffers;
- SessionStore, EventMiddleware and Transport sharing ambiguous ownership.

Architecture definition used by this refactor:

```text
components + connectors + constraints + rationale + verification
```

## Quality Attribute Scenarios

| ID | Source / Stimulus | Required response | Measure |
|---|---|---|---|
| QA-1 | Browser opens a dead or unreachable WebSocket endpoint | Connection attempt fails explicitly and schedules one reconnect | No unresolved connect promise; one reconnect timer |
| QA-2 | Socket errors without a later close event | Reject the attempt and pending requests | Typed `ConnectionFailedError`; no hang |
| QA-3 | Socket closes while requests are pending | Reject all requests from that generation | Registry reaches zero; typed close error |
| QA-4 | Auth closes with code 4401 | Enter terminal auth failure | No automatic reconnect |
| QA-5 | An old socket callback arrives after a new attempt | Ignore stale callback | Generation mismatch causes no state mutation |
| QA-6 | Two logical consumers subscribe to one run | Preserve both owners | First release does not send `_unsubscribe`; last release does |
| QA-7 | SessionStore switches from run A to run B | Release A before B replay becomes visible | No A event may enter B replay window |
| QA-8 | `_full_reload` is received | Reset checkpoint while preserving owner identity, reload, then return live | No subscription leak or owner duplication |
| QA-9 | Chunk stream is incomplete, duplicated, oversized or malformed | Discard affected message without damaging connection | Bounded active buffers, bytes and lifetime |
| QA-10 | Transport or Store is disposed | Release timers, socket, pending requests, buffers, listeners and owner | No retained active lifecycle resources |

## Architecture Before

`WsTransport` combined connection state, reconnect scheduling, pending JSON-RPC requests, run subscription checkpoints and chunk assembly in one class. Logical subscription calls were also spread across SessionStore and EventMiddleware.

Consequences:

- lifecycle represented by unrelated booleans and nullable fields;
- no single owner for reconnect and request cleanup;
- EventMiddleware could remove a subscription it did not logically own;
- repeated load/resume/fork paths had no explicit run-owner transition;
- no bounded chunk protocol implementation;
- little direct failure-path test coverage.

## Architecture After Phase 1

```text
WsTransport — orchestration and message routing
├── ConnectionStateMachine
│   └── idle / connecting / open / reconnecting / auth_failed / closed / disposed
├── RequestRegistry
│   └── correlation, timeout, structured RPC errors, generation cleanup
├── RunSubscriptions
│   └── owner set, monotonic checkpoint, reconnect recovery
├── ChunkAssembler
│   └── chunk count, UTF-8 byte, active-message and lifetime bounds
└── TimerApi
    └── one injectable timer contract for connection, request and chunk lifecycles
```

### Phase 1 Decisions

1. **Connection lifecycle is a state machine.** State transitions and generation changes are centralized.
2. **Reconnect scheduling has one owner.** Repeated close/error callbacks cannot create parallel timers.
3. **Old callbacks are generation-scoped.** A callback from an obsolete socket cannot mutate the current connection.
4. **Request lifecycle is a registry.** Correlation, timeout, disconnect rejection and disposal are not spread through WebSocket handlers.
5. **Errors remain structured.** Connection, close, timeout, auth, disposal and RPC errors retain code/data/context.
6. **`onerror` is independently terminal for an attempt.** Correctness does not assume browsers always fire `onclose` afterward.
7. **Run subscriptions are owner-based.** The default `legacy` owner is idempotent; independent consumers use distinct ids.
8. **Checkpoint is monotonic during normal operation.** `_full_reload` is the only explicit reset path.
9. **Chunk assembly is bounded.** Limits cover active messages, chunks, actual UTF-8 bytes, declared bytes and timeout.
10. **Timers and clocks are injectable.** Tests verify real lifecycle behavior without global fake-timer coupling.

## Architecture After Phase 2

```text
SessionStore instance
└── SessionRunConnection (stable owner id)
    ├── beginReplay(run)
    ├── subscribeFromReplay/Seq/Fresh
    ├── markReloading(run)
    ├── release
    └── dispose
            │
            ▼
Transport owner-aware subscription API
            │
            ▼
RunSubscriptions physical registry

EventMiddleware
├── registers transport listeners
├── routes run_id → SessionStore
├── microbatches events
├── initiates reload recovery
└── never directly subscribes/unsubscribes a run
```

### Phase 2 Decisions

1. **One logical controller per SessionStore.** There is no mutable module-level controller and no single-active-store assumption.
2. **Run selection precedes visible replay mutation.** `loadRun`, resume and fork release/switch owner before new state is cleared and replayed.
3. **Logical and physical ownership are separate.** SessionRunConnection owns Store/run lifecycle; RunSubscriptions owns WebSocket owner/checkpoint recovery.
4. **Repeated live activation is idempotent.** Same owner/run/checkpoint does not produce another logical subscription.
5. **Reload preserves identity.** `_full_reload` marks the Store controller reloading, resets logical and physical replay baselines, reloads persisted events, then reasserts the same owner.
6. **EventMiddleware is routing-only.** It cannot accidentally remove another consumer's transport owner.
7. **Cleanup follows ownership direction.** Middleware destruction asks each Store to release itself; it does not call low-level unsubscribe directly.
8. **`session-subscription.ts` is pure.** It contains only replay checkpoint calculation and no mutable global state.

## Architecture After Phase 3

```text
EventMiddleware
└── identifies affected run/store and requests recovery
            │
            ▼
SessionStore
└── SessionRecoveryController
    ├── per-run in-flight Promise registry
    ├── recovery notice generation
    ├── notice timer ownership
    └── reset / dispose
            │
            ▼
loadRun generation guard + SessionRunConnection replay/live lifecycle

Transport
├── getConnectionState()
└── onConnectionStateChange(listener)
    ├── WsTransport → ConnectionStateMachine
    └── TauriTransport → stable open state
```

### Phase 3 Decisions

1. **Recovery has one lifecycle owner.** SessionRecoveryController coalesces concurrent recovery requests for the same run; EventMiddleware no longer owns a second cooldown map.
2. **No post-completion cooldown.** A failure that occurs after a completed recovery is a new signal and executes again instead of being silently discarded.
3. **Recovery notices are generation-safe.** An older recovery cannot clear the notice of a newer run recovery.
4. **Run safety remains explicit.** Recovery captures the run id, removes its snapshot, verifies the Store still owns that run, then enters the existing load/replay/live lifecycle.
5. **Connection health belongs to the Transport contract.** Consumers use adapter-neutral state access and subscription rather than concrete WebSocket classes.
6. **Tauri `open` means frontend IPC adapter availability.** Child-process/session health remains a separate domain signal.

## 4+1 View Summary

### Scenario View

Covered scenarios:

- initial browser connection;
- transient disconnect and reconnect;
- authentication failure;
- JSON-RPC timeout and disconnect;
- live run subscription;
- persisted replay followed by live events;
- route switch between runs;
- resume and fork;
- server-requested full reload;
- disposal.

### Logical View

- `ConnectionStateMachine`: socket lifecycle.
- `RequestRegistry`: request lifecycle.
- `RunSubscriptions`: physical run owners/checkpoints.
- `ChunkAssembler`: bounded stream reconstruction.
- `SessionRunConnection`: one Store's logical run lifecycle.
- `EventMiddleware`: event routing and batching.
- `SessionStore`: domain projection and user-facing session state.

### Process View

```text
load run B
→ SessionRunConnection.beginReplay(B)
→ release owner for A
→ fetch snapshot/events
→ deterministic replay into SessionStore
→ subscribe B from replay checkpoint
→ state live
```

```text
_full_reload(B)
→ WsTransport resets physical checkpoint
→ EventMiddleware marks Store controller reloading
→ Store.loadRun(B)
→ controller enters replaying with logical checkpoint 0
→ replay persisted events
→ reassert same owner/checkpoint
→ live
```

### Development View

Dependency direction:

```text
SessionStore → SessionRunConnection → Transport interface
EventMiddleware → SessionStore routing API
WsTransport → focused lifecycle modules
```

Forbidden direction:

```text
EventMiddleware ✕→ transport.unsubscribeRun
session-subscription module ✕→ mutable global controller
UI component ✕→ WebSocket implementation
```

### Physical View

- Desktop uses TauriTransport and receives events through Tauri IPC.
- Browser/mobile remote access uses WsTransport and Axum WebSocket.
- Both expose the same semantic Transport contract; platform differences remain inside adapters.

## Verification Evidence

### Phase 1

- Transport test files: 5.
- Transport tests: 75 passed.
- Coverage includes connection success/failure/timeout, reconnect generation, auth failure, request timeout/cleanup, structured errors, owner subscriptions, checkpoint recovery, chunk bounds and disposal.

### Phase 2

- SessionRunConnection + EventMiddleware focused tests: 23 passed.
- SessionStore + Transport focused tests: 347 passed during migration; final combined focused run: 370 passed.
- The module-level controller generated during the first implementation was rejected during independent review and removed before final verification.

### Phase 3

- SessionRecoveryController covers concurrent coalescing, post-completion retry, independent runs, notice generation, reset and disposal.
- WebSocket Transport contract covers observable state transitions and listener cleanup.
- TauriTransport contract verifies its stable `open` adapter state.
- Focused recovery/store/transport run: 9 test files, 365 tests passed.

### Final frontend gates after Phases 1–3

- Full project suite: 75 test files, 1550 tests passed.
- `npm run check`: 0 errors, 0 warnings.
- targeted ESLint for changed chat/store/transport files: 0 errors, 0 warnings.
- `npm run format:check`: passed.
- `git diff --check`: required before handoff.

## Risks and Tradeoffs

### Remaining Risks

| Risk | Severity | Current mitigation |
|---|---|---|
| Event projection and side effects remain combined inside EventMiddleware/SessionStore | High | Phase 3 separates deterministic projection from recovery/orchestration |
| SessionStore remains very large | High | Incremental extraction only after ownership and tests are stable |
| Protocol desync/quarantine paths are not yet modeled as one recovery state machine | High | Phase 3 traces Rust parser → BusEvent → projection recovery |
| Browser connection state is not yet exposed as a domain-level observable | Medium | Phase 3 adds typed connection health without leaking WsTransport |
| Backoff has no jitter | Low for local-first use | Add only if remote multi-client contention becomes measurable |
| Rust WebSocket server and frontend constraints may drift | Medium | Phase 3 adds protocol contract tests and symmetric limits |

### Tradeoffs

- More focused lifecycle objects increase file count but reduce implicit temporal coupling.
- Store-owned logical subscriptions require explicit cleanup, but prevent cross-consumer unsubscribe bugs.
- Strict chunk limits can discard pathological payloads, trading permissiveness for bounded memory and recoverability.
- Retaining TauriTransport as a separate adapter avoids forcing WebSocket mechanics into desktop IPC.

## Fitness Functions

1. Transport tests for every connection/recovery failure path remain mandatory.
2. No EventMiddleware call to `subscribeRun` or `unsubscribeRun`.
3. No module-level `SessionRunConnection` reference.
4. All SessionStore run-changing paths use `_connection`.
5. No unbounded pending request, timer or chunk buffer.
6. Replay checkpoint tests remain monotonic except explicit full reload reset.
7. Non-transport UI code may not import Tauri APIs directly.
8. Full suite, check, targeted lint and formatting gates must pass.

## Phase 4 Plan

1. Separate deterministic event projection from recovery/orchestration side effects.
2. Model run projection lifecycle explicitly: replay → catch-up → live → recovering → failed.
3. Trace and test protocol desync/quarantine from Rust parser to frontend recovery.
4. Add frontend/backend protocol contract tests for chunk limits, replay checkpoints and error payloads.
5. Expose the new Transport health contract through a small domain store only where UI decisions require it.
6. Reduce SessionStore responsibility incrementally behind tested seams; do not perform a flag-day rewrite.
