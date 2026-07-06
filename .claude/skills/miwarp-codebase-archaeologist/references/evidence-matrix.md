# Evidence Matrix

Use this file to choose objective evidence for MiWarp architecture archaeology.

## MiWarp Built-In Gates

Prefer these before adding external tools:

| Gate | What It Proves | Typical Use |
| --- | --- | --- |
| `npm run arch:direction` | dependency direction matrix | cross-layer and reverse-edge drift |
| `npm run arch:layers` | transport/Tauri/backend layer guardrails | direct Tauri imports, command peer coupling |
| `npm run arch:cycle` | circular imports via SCC detection | cycles in `src/lib/**` and `src-tauri/src/**` |
| `npm run arch:budget` | file-size budget | god files and oversized modules |
| `npm run arch:budget:diff` | per-branch file-size drift | merge readiness |
| `npm run arch:tauri-contract` | Tauri command ↔ handler parity | desktop IPC changes |
| `npm run arch:ios-ws-contract` | iOS WebSocket dispatch parity | mobile/native protocol changes |
| `npm run arch:cross-platform-bus` | runtime hub + diagnostics cross-platform parity | shared protocol evolution |
| `npm run arch:runtime-contract` | runtime contract spec shape | runtime_hub changes |
| `npm run arch:check` | bundled architecture gate | normal architecture audit |
| `npm run arch:check:strict` | architecture gate + diff budget | release or branch acceptance |

## Optional External Tools

Use only when installed, available through approved transient execution, or explicitly requested.

| Tool | Evidence | Notes |
| --- | --- | --- |
| Repomix | context pack of selected repository slices | Keep scoped; avoid dumping secrets or generated output. |
| Knip | unused exports, files, dependencies | Good for stale compatibility paths and dead public surface. |
| Madge | dependency cycles and graph hotspots | Pair with `arch:cycle`; explain cycles by ownership boundary. |
| dependency-cruiser | forbidden edges and dependency rules | Useful when a rule is not yet encoded in MiWarp gates. |

Record exact command, version when available, and whether the tool changed any files. Prefer read-only invocations.

## MiWarp Architecture Boundaries

Desktop:

- Components/pages: `src/routes/**`
- Reusable UI/components: `src/lib/components/**`
- State and orchestration: `src/lib/stores/**`, `src/lib/chat/**`
- Transport boundary: `src/lib/transport/**`
- API wrapper: `src/lib/api.ts`
- Rust commands: `src-tauri/src/commands/**`
- Agent/session runtime: `src-tauri/src/agent/**`
- Storage: `src-tauri/src/storage/**`
- Web server: `src-tauri/src/web_server/**`

Mobile:

- iOS native app: `apps/ios/MiWarpMobile/MiWarpMobile/**`
- iOS design system: `apps/ios/MiWarpMobile/MiWarpMobile/DesignSystem/**`
- Live Activity: `apps/ios/MiWarpMobile/MiWarpLiveActivityExtension/**`
- Android native app: `apps/android/**`
- Mobile docs: `docs/mobile/**`

## Smell-To-Evidence Mapping

| Smell | Evidence To Collect | Possible Fitness Function |
| --- | --- | --- |
| God file | line counts, responsibility list, fan-in/fan-out | `arch:budget` or stricter per-domain budget |
| Cross-layer leak | import edge, command call path, docs rule | `arch:layers` or dependency-cruiser rule |
| Circular dependency | SCC output with nodes and edge cause | `arch:cycle` or Madge report |
| Dead compatibility path | Knip output, no call sites, stale docs | Knip CI check or explicit allowlist |
| Protocol drift | Rust enum vs TS/iOS/Android handling | `arch:*contract` gate |
| Scattered lifecycle state | duplicated timers/maps/booleans, trace through code | focused unit/integration test for ownership |
| Missing ADR | significant decision with no `docs/adr` entry | ADR shape test or doc-check extension |
| Stale ADR/fitness rule | docs claim not enforced by scripts/tests | update `doc-check` or architecture test |

## MiWarp Acceptance Evidence

When reporting architecture work, include:

- which target was inspected: desktop, iOS, Android, mobile docs, backend, or cross-platform;
- relevant ADRs and architecture docs read;
- commands run and results;
- tools skipped and why;
- top risks with file/line evidence;
- proposed next migration slice;
- proposed or existing fitness function.

Avoid:

- broad "rewrite this subsystem" recommendations;
- advice unsupported by code or command output;
- mixing iOS/mobile work into desktop Svelte unless the request requires a shared protocol/backend change;
- changing runtime code during an audit unless explicitly asked.
