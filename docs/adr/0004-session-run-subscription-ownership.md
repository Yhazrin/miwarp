# ADR 0004: Session Run Subscription Ownership

## Status

Accepted — Phase 2 implemented and independently verified on 2026-06-20.

## Context

ADR 0003 introduced owner-aware physical WebSocket subscriptions, but logical ownership remained fragmented:

- `SessionStore` subscribed from load, resume, fork and start paths without one lifecycle owner.
- `EventMiddleware` routed events but also called `transport.unsubscribeRun`, allowing a routing layer to remove another consumer's physical subscription.
- Reset, run switching and `_full_reload` did not share one explicit replay/live lifecycle.
- A module-level controller would not be safe: creating a second `SessionStore` would overwrite the first store's owner and reintroduce cross-session interference.

MiWarp already supports fork, split workflows, background runs and future multi-session views, so ownership must be correct even when more than one store exists.

## Decision

### One controller per SessionStore

Each `SessionStore` directly owns one `SessionRunConnection` instance. There is no module-level mutable controller and no global active-store assumption.

The controller has a stable owner id and states:

```text
inactive → selected → replaying → live
                         ↑          ↓
                         └─ reloading
inactive → disposed
```

Responsibilities:

- select a logical run;
- release the previous run owner before a new replay becomes visible;
- establish fresh, sequence-based or replay-based live ownership;
- maintain a monotonic logical checkpoint during normal live operation;
- reset the logical checkpoint for a server-requested full reload;
- release or dispose the exact owner it created.

The physical `RunSubscriptions` registry remains inside `WsTransport`; the logical controller does not reimplement reconnect or server subscription recovery.

### SessionStore owns lifecycle transitions

`SessionStore` calls its controller directly:

- `loadRun(id)` enters replay before asynchronous loading and releases the previously selected run;
- `resumeSession` switches ownership before visible state is cleared;
- fork clears the source owner before creating/replaying the new run;
- new sessions and `connectSession` establish fresh live ownership;
- reset and lifecycle cleanup release the store's owner;
- `_full_reload` marks the controller reloading before `loadRun` starts.

### EventMiddleware is routing-only

`EventMiddleware` continues to own:

- listener registration;
- `run_id → SessionStore` routing;
- microbatching;
- reload/recovery orchestration;
- buffer cleanup.

It does not call `transport.unsubscribeRun`. During global middleware destruction it asks each routed store to release its own connection, preserving ownership direction.

### session-subscription.ts is pure

`session-subscription.ts` now contains only `replayCheckpoint(events)`. It has no module-level controller, no direct Transport calls and no mutable singleton state.

## Consequences

### Positive

- Multiple SessionStore instances cannot overwrite each other's owner.
- Switching, resume and fork close the old event window before replaying new state.
- Event routing cannot accidentally unsubscribe a different logical consumer.
- `_full_reload` preserves owner identity while resetting replay baseline.
- Ownership behavior is deterministic and testable through injected Transport implementations.
- The physical and logical layers have separate responsibilities:
  - SessionRunConnection: logical store/run lifecycle;
  - RunSubscriptions: physical WebSocket owner/checkpoint registry.

### Negative

- One additional lifecycle object exists per SessionStore.
- New SessionStore run-changing paths must use the controller instead of calling Transport directly.
- Middleware destruction must invoke store cleanup because it owns the page-level listener lifecycle.

## Rejected Alternatives

### Module-level current controller

Rejected. It assumes one active store and fails under split views, forks, background sessions or tests that construct multiple stores.

### EventMiddleware owns physical subscriptions

Rejected. Routing and batching do not provide enough context to know whether another consumer still needs a run.

### SessionStore calls Transport directly at every call site

Rejected. It lacks centralized switching, replay state, release and dispose semantics.

### Global subscription-manager singleton

Rejected for now. Physical cross-consumer coordination already exists in `RunSubscriptions`; adding another global registry would duplicate responsibility.

## Verification

- `session-run-connection.test.ts`: 15 tests covering owner uniqueness, replay selection, fresh/replay/sequence activation, idempotency, monotonic checkpoints, run switching, full reload, release, dispose and desktop behavior.
- `event-middleware.test.ts`: verifies routing changes and destruction never call `transport.unsubscribeRun`, and `_full_reload` marks the Store before `loadRun`.
- SessionStore + Transport focused run: 370 tests passed.
- Full suite: 73 test files, 1540 tests passed.
- `npm run check`: 0 errors, 0 warnings.
- targeted ESLint for changed chat/store/transport files: 0 errors and 0 warnings.
- `npm run format:check`: passed.

## Fitness Functions

- No module-level `SessionRunConnection` reference is allowed.
- No EventMiddleware method may call `transport.subscribeRun` or `transport.unsubscribeRun`.
- Every SessionStore run-switch path must pass through its `_connection` controller.
- Transport owner ids must remain stable for the lifetime of one SessionStore.
- Replay/live/full-reload lifecycle tests must remain in CI.
