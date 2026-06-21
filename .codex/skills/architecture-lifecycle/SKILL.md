---
name: architecture-lifecycle
description: Apply architecture-first lifecycle governance to software projects from discovery and quality-attribute design through implementation, verification, acceptance, optimization, and evolution. Use for new systems, architecture-affecting features, communication/state refactors, reliability work, large codebase audits, acceptance, and performance optimization.
---

# Architecture Lifecycle

## Purpose

Turn architecture theory into an executable engineering loop:

```text
business drivers
→ scenarios and measurable quality attributes
→ components + connectors + constraints + rationale
→ implementation boundaries
→ verification and fitness functions
→ acceptance evidence
→ evolution with synchronized code, tests, ADRs, and diagrams
```

Architecture is not a technology list or decorative UML. It is the set of structures and decisions that make required system qualities achievable and verifiable.

## Core definition

For every architecture-affecting task, identify:

1. **Components** — modules, services, actors, stores, clients, processes, databases.
2. **Connectors** — calls, events, queues, WebSocket, IPC, files, shared state, protocols.
3. **Constraints** — ordering, ownership, consistency, latency, security, deployment, compatibility.
4. **Rationale** — why this option was selected and which alternatives were rejected.

A change is incomplete when code changes but architecture boundaries, tests, documentation, or operational behavior remain inconsistent.

## Scale the ceremony

### Small patch

- Inspect the actual code path.
- State the affected boundary and invariant.
- Make the smallest deterministic change.
- Add or update a focused regression test.
- Update architecture documentation only when a decision or interface changes.

### Feature or subsystem change

- Define scenario and acceptance evidence.
- Write measurable quality-attribute scenarios.
- Identify affected 4+1 views.
- Record an ADR for significant decisions.
- Implement behind explicit interfaces.
- Add unit, integration, failure-path, and recovery tests.

### New system or major refactor

- Produce architecture brief, utility tree, C4 L1/L2/L3, runtime sequence/activity views, deployment view, ADRs, migration plan, rollback plan, and fitness functions.
- Use incremental strangler-style replacement rather than a flag-day rewrite.

## Lifecycle workflow

### Phase 0 — Inspect reality

Before proposing architecture:

- Read repository instructions, current diagrams, ADRs, package manifests, build/test scripts, and deployment config.
- Trace at least one real end-to-end scenario through UI, state, transport, backend, persistence, and external processes.
- Measure file sizes, dependency direction, test coverage, error handling, timeouts, retries, observability, and current failure modes.
- Distinguish documented architecture from implemented architecture.

Do not design from filenames alone.

### Phase 1 — Business and scenario framing

For each requested change, capture:

- actor and goal;
- trigger;
- happy path;
- failure and recovery paths;
- data and ownership boundaries;
- environment: desktop, browser, mobile, offline, degraded network, restart;
- acceptance evidence.

### Phase 2 — Quality-attribute scenarios

Use the six-part structure:

```text
Source → Stimulus → Artifact → Environment → Response → Response Measure
```

Required quality attributes for communication/state systems:

- Availability and recoverability
- Correctness and consistency
- Performance and resource usage
- Modifiability
- Security
- Observability and testability

Measures must be concrete: timeout, retry limit, ordering guarantee, duplicate tolerance, reconnect latency, memory bound, event-loss tolerance, startup latency, or recovery time.

### Phase 3 — Architecture selection

Choose architecture according to dominant forces, not trends.

Default heuristics:

- Start with a modular monolith unless independent deployment, scaling, ownership, or fault isolation requires distribution.
- Prefer explicit synchronous calls for request/response with strong ordering needs.
- Prefer events for fan-out, loose coupling, auditability, and asynchronous workflows.
- Use queues only when buffering, retry, backpressure, or independent availability is required.
- Use an actor/mailbox where one owner must serialize mutations to a resource.
- Use adapters at platform and protocol boundaries.
- Use event sourcing only when immutable history, replay, audit, or local projections justify its complexity.
- Add caches only with an ownership, invalidation, consistency, and observability strategy.
- Avoid speculative abstraction, premature microservices, and distributed-monolith coupling.

### Phase 4 — 4+1 and C4 views

Use diagrams only when they explain a decision or runtime behavior.

- **Scenario view**: what the system does and which actors drive it.
- **Logical view**: components, classes, state machines, responsibilities.
- **Process view**: concurrency, ordering, retries, timeouts, recovery, activity/sequence diagrams.
- **Development view**: packages, components, dependency direction, ownership.
- **Physical view**: processes, devices, deployment nodes, storage, network links.

C4 zoom levels:

- L1 System Context
- L2 Containers / independently running technical units
- L3 Components
- L4 Code only when necessary

Every diagram must have a title, scope, view label, legend when needed, and relationships consistent with code.

### Phase 5 — Decision recording

Use one ADR per significant decision:

```text
Status
Context
Decision
Consequences
Rejected alternatives
Verification / fitness function
```

Record positive and negative consequences. Do not rewrite history; supersede old ADRs.

### Phase 6 — Implementation boundaries

Apply:

- high cohesion and low coupling;
- single ownership of mutable state;
- explicit interfaces at transport, protocol, persistence, and platform boundaries;
- API-first contracts and typed boundary DTOs;
- dependency direction toward domain abstractions;
- KISS and YAGNI;
- no hidden global mutation;
- no cross-layer leakage;
- no duplicated lifecycle logic across clients.

Communication architecture rules:

1. Connection lifecycle is a state machine, not scattered booleans.
2. Request lifecycle has one registry responsible for correlation, timeout, cancellation, and cleanup.
3. Subscription lifecycle has explicit ownership or reference counting.
4. Reconnect scheduling is single-owner and deduplicated.
5. Sequence checkpoints are monotonic and persisted or replayable where required.
6. Failure paths produce typed errors and observable state transitions.
7. Chunk/stream assembly is bounded by size and time.
8. Events are idempotent or deduplicated at the correct boundary.
9. Recovery behavior is tested, not inferred.
10. Desktop IPC and remote WebSocket share semantic contracts even when transport differs.

State architecture rules:

- Separate domain state, transport state, projection/reducer logic, orchestration, and UI state.
- Stores should not simultaneously own protocol parsing, persistence, timers, API orchestration, and presentation policy.
- Reducers must be deterministic and replay-safe.
- Side effects belong in controllers/services, not reducers.
- Loading/replay/live transitions must be explicit states.

### Phase 7 — Verification

Verify behavior, not claims.

Minimum evidence for communication changes:

- successful connection;
- initial connection failure;
- connection timeout;
- reconnect with backoff;
- authentication failure;
- pending request timeout and cleanup;
- disconnect while requests are pending;
- duplicate subscribe/unsubscribe ownership;
- checkpoint replay after reconnect;
- out-of-order or duplicate event handling;
- incomplete and oversized chunks;
- explicit cancellation/disposal;
- no unbounded timers, maps, or buffers.

Run project gates relevant to the change: lint, formatting, typecheck, unit tests, integration tests, build, Rust fmt/clippy/tests, and manual golden-path checks.

### Phase 8 — ATAM-style evaluation

Maintain a utility tree ranked by business importance and technical difficulty.

Classify findings as:

- **Risk** — potentially problematic architecture decision.
- **Non-risk** — accepted decision with evidence.
- **Sensitivity point** — parameter strongly affecting a quality attribute.
- **Tradeoff point** — decision improving one quality while reducing another.

Do not stop at identifying risks. Close the loop with owner, implementation, verification, and acceptance evidence.

### Phase 9 — Evolution

Use strangler-style migration:

1. establish tests and observability;
2. create a stable seam/interface;
3. move one responsibility at a time;
4. preserve behavior;
5. remove the old path after evidence proves replacement;
6. update ADRs, diagrams, documentation, and fitness functions.

Never combine a broad behavior-preserving refactor with unrelated feature work in the same commit.

## Repository hygiene

- No duplicate implementations or abandoned compatibility paths.
- No generated artifacts or secrets committed accidentally.
- Dependencies require a concrete use and ownership plan.
- Naming expresses responsibility and lifecycle.
- Functions, modules, and files are split by responsibility, not arbitrary line count alone.
- Public APIs are documented; internal helpers stay private.
- Migrations and protocol changes have compatibility and rollback plans.

## Completion report

For architecture work, report:

1. Scenarios and quality attributes addressed
2. Architecture decisions and tradeoffs
3. Components/connectors changed
4. Files changed
5. Tests and commands run with results
6. Remaining risks and next migration slice
7. Updated ADRs/diagrams/fitness functions

Do not call a refactor complete when only file movement occurred or tests cover only the happy path.
