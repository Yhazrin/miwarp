# ADR-002: Architecture Quality Foundation (this branch)

- **Status**: Accepted
- **Date**: 2026-06-21
- **Context**: Branch `refactor/architecture-quality-foundation`
- **Supersedes**: n/a

## Context

CLAUDE.md already codifies code quality ("high cohesion, low coupling"), file-size budgets ("Svelte > 500 行 → 拆"), and bus event handling. But these are written rules — nothing enforces them. A new contributor (or a tired one) can:

- Add a 1000-line Svelte file.
- Import `@tauri-apps/api` from a component, breaking browser mode.
- Add a Rust command handler that imports from another command handler's internals.
- Forget to extend the frontend `BusEvent` union when adding a new `BusEvent::X` variant on the backend.
- Use magic numbers (`1000`, `5000`, `300`) for timeouts.

## Decision

This branch introduces a **mechanical architecture gate** that catches each of these in CI, without changing runtime behavior. The 8 improvements:

1. **`docs/architecture/dependency-direction.md`** — ADR-001: codifies the dependency direction matrix.
2. **`scripts/architecture/direction-check.mjs`** — verifies the dependency direction rules from ADR-001 by parsing `import` statements under `src/` and `src-tauri/src/`. Exits non-zero on violation. Run via `npm run arch:direction`.
3. **`scripts/architecture/layer-import-check.mjs`** — cross-layer guard: no `@tauri-apps/api` outside `src/lib/transport/**`, no `src-tauri/src/commands/*` importing peer command internals, no `src-tauri/src/agent/*` importing `commands/*`. Run via `npm run arch:layers`.
4. **`scripts/architecture/cycle-check.mjs`** — Tarjan SCC on the import graph for `src/lib/**` and `src-tauri/src/**` separately. Reports any SCC of size ≥ 2 as a cycle. Run via `npm run arch:cycle`.
5. **`scripts/architecture/file-budget.mjs`** — file-size budget per language: `.svelte` ≤ 500 (warn) / 1500 (fail); `.ts` ≤ 400 (warn) / 1200 (fail); `.rs` ≤ 600 (warn) / 1500 (fail). Baseline exception list in `scripts/architecture/file-budget.allow.json` for known-too-large files that we will refactor incrementally. Run via `npm run arch:budget`.
6. **`src/lib/bus/__tests__/bus-contract.test.ts`** — Vitest test that asserts every variant of the Rust `BusEvent` enum (enumerated from `src-tauri/src/models.rs`) appears in the frontend `BusEvent` union, and vice versa. Catches drift when one side adds a variant without the other.
7. **`src-tauri/src/agent/constants.rs`** — new module holding the timing constants (USER_SOFT_TIMEOUT, etc.) previously defined in `turn_engine.rs`. `turn_engine.rs` re-exports them so existing call sites are unaffected.
8. **`src/lib/constants/timing.ts`** — frontend sibling: centralizes timeouts (TOAST_MS, AUTO_HIDE_MS, etc.) extracted from the most-edited UI files. Behavior unchanged.

Wiring:
- `package.json` adds `arch:check` (runs all four) + `arch:direction`, `arch:layers`, `arch:cycle`, `arch:budget`.
- Tests for the new scripts live in `scripts/architecture/__tests__/` and run as part of `npm test`.

## Consequences

- CI can now run `npm run arch:check` and fail on architecture violations.
- The script-based checks are text-only: no TypeScript compilation, no Rust compilation, no DB. They run in <1s on the current repo.
- Adding a new BusEvent variant requires adding it to both `src-tauri/src/models.rs` and `src/lib/types.ts`; the contract test enforces it.
- The new constants module is the entry point for future magic-number sweeps (e.g. web_server backoff delays).

## Alternatives Considered

- **dprint / cargo-deny / depcop** — heavier, require dependency manifests. We want pure source-tree rules.
- **ESLint plugin** for everything — would force Svelte/Espree parsing of Rust; not ergonomic.
- **Manual code review** — that's the status quo. We're automating what humans forget.
