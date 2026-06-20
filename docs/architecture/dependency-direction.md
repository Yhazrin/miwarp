# ADR-001: Dependency Direction Rules

- **Status**: Accepted
- **Date**: 2026-06-21
- **Context**: Branch `refactor/architecture-quality-foundation`

## Context

The codebase has both a desktop target (`src/` + `src-tauri/`) and a mobile target (`apps/`). Within desktop, frontend code, Rust backend, and the Tauri IPC boundary are all independent layers that drift toward each other under pressure. We need a written, enforceable rule set that:

1. Stops frontend from reaching into Rust internals (i.e. no `import { invoke }` from components).
2. Stops one Tauri command module from importing another command module's internals.
3. Stops the broadcaster / agent modules from leaking runtime behavior into storage.

## Decision

We adopt the following **dependency direction** matrix. An edge `A → B` is allowed; an edge in the reverse direction is a violation.

### Frontend (`src/`)

| From                  | To (allowed)            |
|-----------------------|-------------------------|
| `routes/**`           | `lib/**`, `messages/**` |
| `lib/components/**`   | `lib/**`, `messages/**` |
| `lib/stores/**`       | `lib/api.ts`, `lib/transport/**`, `lib/types/**` |
| `lib/chat/**`         | `lib/stores/**`, `lib/transport/**`, `lib/api.ts` |
| `lib/transport/**`    | `@tauri-apps/api/*` (sole exemption) |
| `lib/utils/**`        | `lib/types/**` only     |
| `lib/api.ts`          | `lib/transport/**`, `lib/types/**` |

Reverse edges are violations. The Tauri-specific transport (`@tauri-apps/api/*`) is **only** imported from `lib/transport/**`. The ESLint `no-restricted-imports` rule enforces this for `@tauri-apps/api/*`. The new `scripts/architecture/layer-import-check.mjs` enforces the remaining edges.

### Backend (`src-tauri/src/`)

| From                    | To (allowed)            |
|-------------------------|-------------------------|
| `commands/*`            | `agent/*`, `storage/*`, `models.rs`, `web_server/*`, `scheduler/*`, `hooks/*` |
| `commands/*` (peer)     | ❌ — `commands/session` MUST NOT import from `commands/chat`'s internals; use `agent/*` or `storage/*` instead |
| `storage/*`             | `models.rs`, `shared.rs`, sibling `storage/*` |
| `agent/*`               | `models.rs`, `storage/*`, `web_server/*` (broadcaster), `scheduler/*` |
| `web_server/*`          | `models.rs`, `storage/*`, `commands/*` |
| `scheduler/*`           | `models.rs`, `storage/*`, `agent/*` |
| `hooks/*`               | `models.rs`, `storage/*`, `agent/*` |

`agent/runtime.rs` and `agent/session_actor.rs` MUST NOT import from `commands/*` (would invert the dependency arrow).

### Mobile (`apps/ios/MiWarpMobile/**`)

The mobile target is intentionally a separate target with its own design system. It does not import desktop Svelte, CSS, or Tauri code. See `apps/ios/MiWarpMobile/AGENTS.md` (if present) for mobile-specific rules.

## Consequences

- A new `npm run arch:direction` and `npm run arch:layers` enforces these rules in CI.
- Adding a new Tauri command? Add it to `src-tauri/src/commands/` and document the imports in this matrix.
- Reviewers MUST reject PRs that introduce a reverse edge unless the rule itself is amended via a new ADR.
