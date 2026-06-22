# Runtime Real Smoke / E2E (v1.0.9 Phase 1)

Opt-in, environment-aware runtime verification for **installed and authenticated** local CLIs. Designed for developer machines — **not** CI by default (no model calls, no cost).

## Goals

1. **Capability probe** distinguishes `binary_missing`, `unauthenticated`, `unsupported`, `ready`.
2. Missing prerequisites emit `SKIPPED_ENVIRONMENT` (not failures).
3. **Smoke** runs in a **temporary empty directory** with a fixed non-sensitive prompt (`MIWARP_SMOKE_OK`).
4. Validates init/text events, exit code, timeout handling, cancel cleanup.
5. **Resume** only when a temporary session id is captured from the first smoke turn.
6. No production code changes — helpers live under `src-tauri/tests/support/runtime_e2e/` and `src/lib/testing/runtime-e2e/`.

## Enable

```bash
# Full harness (probe + smoke + cancel + optional resume)
MIWARP_RUNTIME_REAL_E2E=1 npm run test:runtime-e2e

# Probe only (no model spend)
MIWARP_RUNTIME_REAL_E2E=1 MIWARP_RUNTIME_E2E_PROBE_ONLY=1 \
  cargo test --manifest-path src-tauri/Cargo.toml --test runtime_real_e2e runtime_real_e2e_harness -- --nocapture

# Filter runtimes
MIWARP_RUNTIME_REAL_E2E=1 MIWARP_RUNTIME_REAL_E2E_RUNTIMES=claude,mimo npm run test:runtime-e2e
```

## Environment variables

| Variable                            | Default       | Purpose                                  |
| ----------------------------------- | ------------- | ---------------------------------------- |
| `MIWARP_RUNTIME_REAL_E2E`           | off           | Master switch (`1` / `true`)             |
| `MIWARP_RUNTIME_REAL_E2E_RUNTIMES`  | all startable | Comma list: `claude,codex,mimo,opencode` |
| `MIWARP_RUNTIME_E2E_PROBE_ONLY`     | off           | Skip smoke/cancel/resume                 |
| `MIWARP_RUNTIME_SMOKE_TIMEOUT_SECS` | `120`         | Per-runtime smoke budget                 |
| `MIWARP_RUNTIME_PROBE_TIMEOUT_SECS` | `30`          | Initialize/auth probe budget             |

## Probe matrix

| Runtime  | Binary check     | Auth check                                   |
| -------- | ---------------- | -------------------------------------------- |
| Claude   | `which claude`   | `claude auth status` → `loggedIn`            |
| Codex    | `which codex`    | `codex login status` (fallback: binary-only) |
| MiMo     | `mimo --version` | `mimo providers list` credentials            |
| OpenCode | `which opencode` | `opencode auth list` (fallback: binary-only) |

Non-startable registry entries (`gemini`, `cursor`, …) → `unsupported` → `SKIPPED_ENVIRONMENT`.

## Safety constraints

- Does **not** install CLIs, log in, or mutate user CLI config.
- Does **not** run from the MiWarp repo root as cwd — always uses `tempfile` workspace.
- Logs redact `$HOME`, smoke prompt text, API keys/tokens, and env-var values.
- Subprocesses use strict timeouts; children are killed on timeout/cancel.

## Layout

```text
src-tauri/tests/runtime_real_e2e.rs          # integration test entry
src-tauri/tests/support/runtime_e2e/         # Rust harness (probe/smoke/lifecycle)
src/lib/testing/runtime-e2e/                 # TS constants + redaction helpers
scripts/runtime-real-e2e.mjs                 # npm entrypoint
```

## Related unit tests

```bash
npm test -- --run src/lib/runtime/__tests__/availability.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --lib agent::pipe_parser::tests
cargo test --manifest-path src-tauri/Cargo.toml --lib agent::spawn::tests
```
