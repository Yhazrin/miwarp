# ADR 0005: Single-Flight Session Recovery and Transport Health Contract

## Status

Accepted — Phase 3 communication slice implemented and verified on 2026-06-20.

## Context

After ADR 0003 and ADR 0004, physical connection ownership and logical run ownership were explicit, but two architecture problems remained:

1. Recovery suppression existed in two layers:
   - `EventMiddleware` kept a per-run two-second debounce map.
   - `SessionStore` kept another two-second timestamp guard and a separate notice timer.

   A legitimate recovery request could pass the first layer and be silently discarded by the second. Concurrent poison-event and health-check recovery could also start overlapping `loadRun` operations.

2. Connection state was observable only through the concrete `WsTransport.connectionState` property. A Store or UI that wanted connection health would have to depend on the WebSocket implementation, breaking the Transport Adapter boundary. Tauri IPC had no equivalent semantic contract.

## Decision

### Recovery has one owner

Introduce one `SessionRecoveryController` per `SessionStore`.

It owns:

- a per-run in-flight Promise registry;
- coalescing of concurrent recovery requests for the same run;
- recovery-notice generation and cleanup;
- notice timers;
- reset and disposal.

It intentionally does **not** suppress a request merely because another recovery completed recently. A failure after completion is a new signal and must be handled.

`EventMiddleware` no longer keeps recovery timestamps or debounce policy. It identifies the affected Store and requests `store.recoverFromEventLog(...)`; the Store controller decides whether that request joins an in-flight recovery.

### Recovery remains run-safe

The recovery operation captures the current run id, deletes the corresponding snapshot, confirms that the Store still owns that run, then invokes `loadRun(runId)`. SessionStore generation checks continue to prevent stale asynchronous work from overwriting a later user-driven run switch.

### Transport exposes adapter-neutral health

Extend the `Transport` interface with:

```ts
getConnectionState(): ConnectionStateValue;
onConnectionStateChange(listener: ConnectionStateListener): () => void;
```

- `WsTransport` delegates to `ConnectionStateMachine`.
- `TauriTransport` reports `open`, because in-process Tauri IPC has no reconnect lifecycle owned by the frontend adapter.
- Consumers no longer need `instanceof WsTransport` or direct access to its state machine.

## Consequences

### Positive

- Concurrent poison-event, idle-health and protocol-recovery requests for one run share one recovery operation.
- A new failure after recovery completion is never hidden by an arbitrary cooldown.
- Recovery notice lifetime is deterministic and testable with injected timers.
- An older recovery cannot clear the notice of a newer recovery.
- EventMiddleware is further reduced to event routing/orchestration rather than lifecycle policy.
- Connection health can be consumed by domain/UI code without coupling to WebSocket implementation details.
- Desktop and remote transports now provide one semantic health contract.

### Negative

- SessionStore owns another small lifecycle controller.
- Tauri's `open` state means “frontend IPC adapter is available”, not “every backend child process is healthy”; session runtime health remains a separate domain concern.
- Multiple different runs may recover concurrently; generation and current-run guards are required to prevent stale visible mutation.

## Rejected Alternatives

### Keep both debounce layers

Rejected because timing composition is implicit and legitimate failures are dropped.

### Keep only EventMiddleware debounce

Rejected because recovery can also be initiated by SessionStore health checks and user actions; middleware is not the universal owner.

### Global recovery singleton

Rejected because recovery state and notices belong to a SessionStore/run lifecycle, not to the whole application.

### Expose WsTransport directly

Rejected because browser-specific implementation details would leak into domain and UI code.

## Verification

- `session-recovery-controller.test.ts`: concurrent coalescing, post-completion retry, independent runs, notice cleanup, generation safety, reset and disposal.
- `event-middleware.test.ts`: middleware delegates recovery and no longer maintains transport ownership policy.
- `websocket.test.ts`: Transport contract emits connection transitions and supports unsubscribe.
- `tauri.test.ts`: desktop adapter reports `open` and exposes a no-op connection listener.
- Focused Phase 3 run: 9 test files, 365 tests passed.
- `npm run check`: 0 errors, 0 warnings.
- `npm run format:check`: passed.

## Fitness Functions

- EventMiddleware must not own a recovery cooldown map.
- SessionStore must have exactly one recovery controller.
- Recovery requests for the same run must return the same in-flight Promise.
- Recovery after completion must execute again.
- Domain/UI code must use the Transport connection-health contract, not concrete adapter classes.
- Both Transport adapters must implement health contract tests.
