# Evidence Matrix

Guide for selecting commands, evidence types, and MiWarp-specific gates during architecture archaeology.

## Built-in Architecture Gates

| Gate | Command | What it checks | Exit code |
|------|---------|----------------|-----------|
| Direction | `npm run arch:direction` | Dependency direction rules from ADR-001 | 0 = pass |
| Layers | `npm run arch:layers` | Cross-layer imports (@tauri-apps/api, peer commands) | 0 = pass |
| Cycle | `npm run arch:cycle` | Tarjan SCC on import graph, reports size ≥ 2 | 0 = pass |
| Budget | `npm run arch:budget` | File-size budgets per language | 0 = pass (warns only) |
| Budget diff | `npm run arch:budget:diff` | New violations vs allow.json baseline | 0 = pass |
| Perf budget | `npm run arch:perf-budget` | Static bundle size budgets | 0 = pass |
| Tauri contract | `npm run arch:tauri-contract` | Frontend CMD ↔ backend handler alignment | 0 = pass |
| iOS WS contract | `npm run arch:ios-ws-contract` | iOS WebSocket method coverage | 0 = pass |
| Cross-platform bus | `npm run arch:cross-platform-bus` | BusEvent variant parity (frontend ↔ Rust) | 0 = pass |
| Mobile bus | `npm run arch:mobile-bus-contract` | BusEvent parity across desktop/iOS/Android | 0 = pass |
| Runtime contract | `npm run arch:runtime-contract` | Runtime protocol contract tests | 0 = pass |

## Quality Gates

| Gate | Command | What it checks |
|------|---------|----------------|
| Lint | `npm run lint` | ESLint rules |
| Format | `npm run format:check` | Prettier formatting |
| Type check | `npm run check` | svelte-check TS diagnostics |
| i18n | `npm run i18n:check` | Key alignment + placeholder validation |
| Tests | `npm test` | Vitest test suite |
| Rust fmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Rust formatting |
| Rust clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` | Rust lints |
| Version | `npm run version:check` | package.json / tauri / cargo version alignment |
| Full verify | `npm run verify` | All gates combined |

## Optional External Tools

| Tool | Purpose | Install |
|------|---------|---------|
| Knip | Unused exports, files, dependencies | `npx knip` |
| Madge | Circular dependency visualization | `npx madge --circular src/` |
| dependency-cruiser | Dependency rules and boundaries | `npx depcruise src/` |
| rg (ripgrep) | Fast text search | System package |
| Repomix | Repository context packing | `npx repomix` |

## Evidence Types

| Type | Strength | When to use |
|------|----------|-------------|
| Gate pass/fail | Strong (mechanical) | Always run first |
| File size metric | Medium (objective) | File budget violations |
| Import graph | Strong (structural) | Cycle/dependency analysis |
| Fan-in/fan-out count | Medium (statistical) | God module detection |
| Git churn (log --follow) | Medium (temporal) | Ownership concentration |
| ADR citation | Strong (governance) | Decision traceability |
| Runtime trace | Strong (behavioral) | Protocol/IPC claims |

## File Budget Thresholds

| Language | Warn | Fail |
|----------|------|------|
| `.svelte` | 500 lines | 1500 lines |
| `.ts` | 400 lines | 1200 lines |
| `.rs` | 600 lines | 1500 lines |

Exceptions tracked in `scripts/architecture/file-budget.allow.json`.

## MiWarp Target Boundaries

| Target | Path | Stack |
|--------|------|-------|
| Desktop | `src/`, `src-tauri/` | Tauri v2 + Svelte 5 + Rust |
| iOS | `apps/ios/MiWarpMobile/` | SwiftUI + Live Activity |
| Android | `apps/android/` | Native Android |
| Mobile docs | `docs/mobile/` | Architecture, protocol, security |
