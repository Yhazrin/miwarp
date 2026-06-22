# ADR-003: BusEvent Frontend/Backend Contract

- **Status**: Accepted
- **Date**: 2026-06-21
- **Context**: Branch `refactor/architecture-quality-foundation`

## Context

The Rust backend emits `BusEvent` enum variants via `EventBroadcaster` → `app.emit("bus-event", ...)` → frontend `WsTransport` / `TauriTransport`. The frontend's `BusEvent` union lives in `src/lib/types.ts` and is the source of truth for the UI. When a new variant is added on one side, the other side silently drifts:

- Rust adds `BusEvent::MyNewEvent` → frontend `event-middleware` has no `case "my_new_event"`, so the event is dropped.
- Frontend adds `type: "foo"` to its union → Rust's serde rejects the unknown variant; the parser logs an error and the user sees a stale UI.

The 30+ variants in `src-tauri/src/models.rs:1303` and the matching union in `src/lib/types.ts:1094` are the largest such surface in the codebase.

## Decision

Add a **bidirectional contract test** at `src/lib/bus/__tests__/bus-contract.test.ts` that:

1. Parses `src-tauri/src/models.rs` and extracts every `BusEvent::VariantName` declaration (regex over the `pub enum BusEvent { ... }` block, tolerant of `serde` attributes).
2. Parses `src/lib/types.ts` and extracts every `type: "snake_case"` literal inside the `BusEvent = ...` union.
3. Asserts that:
   - Every Rust variant has a corresponding frontend `type:` literal.
   - Every frontend `type:` literal has a corresponding Rust variant.
   - The snake_case mapping (`VariantName` → `variant_name`) is consistent.

A mismatch fails `npm test`. The test is text-only (no Rust or TS compilation), so it runs in milliseconds.

A companion gate `scripts/architecture/mobile-bus-contract.mjs` (also in `npm run arch:check`) keeps iOS `BusEventPayload.EventType` and Android `MiWarpRpcClient` when-branches aligned with the same Rust enum, with explicit payload-field checks for `session_recovering`, `session_recovered`, and `protocol_desync`.

## Consequences

- Adding a `BusEvent::X` in Rust without updating `src/lib/types.ts` is a CI failure.
- Removing a `type:` literal in `src/lib/types.ts` without removing the Rust variant is a CI failure.
- This test is the **only** check on the bus contract; the existing reducer tests cover handler behavior, but only for variants they exercise.

## Alternatives Considered

- **Generate the frontend union from Rust** via ts-rs or specta. Out of scope for a behavior-preserving refactor; would require a build-time step and we'd lose the hand-curated JSDoc comments.
- **Runtime warning** in `event-middleware` for unknown types. Already partially done; doesn't catch the reverse case (frontend-only variants).
