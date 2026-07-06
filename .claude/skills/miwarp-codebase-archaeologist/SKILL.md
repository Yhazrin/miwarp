---
name: miwarp-codebase-archaeologist
description: Evidence-backed architecture archaeology for the MiWarp repository. Invoke when reviewing MiWarp codebase health, hunting architecture rot, god files, circular dependencies, cross-layer leaks, dead exports, stale compatibility paths, ADR/fitness-function drift, or preparing an architecture audit using MiWarp's built-in `arch:*` gates, Repomix, Knip, Madge, dependency-cruiser, or multi-agent review (via the Task / Workflow tools).
---

# MiWarp Codebase Archaeologist

## Mission

Run architecture archaeology on MiWarp without guessing. Convert "this feels messy" into grounded findings with file paths, commands, metrics, violated rules, and a next migration slice.

This skill prepares review work; it does not require code changes unless the user explicitly asks for fixes.

## First Moves

1. Read repository instructions first: `AGENTS.md` / `CLAUDE.md`, package scripts, `.codex/skills/architecture-lifecycle/SKILL.md`, `docs/architecture/`, and `docs/adr/`.
2. Respect MiWarp target boundaries:
   - Desktop/Tauri/Svelte: `src/`, `src-tauri/`.
   - Native iOS: `apps/ios/MiWarpMobile/`.
   - Android: `apps/android/`.
   - Mobile docs and contracts: `docs/mobile/`.
3. If the request mentions iOS, iPad, iPhone, SwiftUI, Dynamic Island, Live Activity, or native mobile UI, inspect the native iOS package before touching desktop files.
4. Treat existing MiWarp architecture gates as first-class evidence before adding external tools.
5. Do not present broad taste judgments without proof from code, docs, or command output.

## Workflow

### 1. Establish The Architecture Baseline

Collect the implemented architecture, not just documented intent:

- Read `package.json` scripts, especially `arch:*`, `verify`, `check`, `rust:*`, and contract tests.
- Read the current ADRs under `docs/adr/`.
- Read architecture docs most relevant to the request:
  - `docs/architecture/dependency-direction.md`
  - `docs/architecture/quality-foundation.md`
  - `docs/architecture/architecture-lifecycle-standard.md`
  - `docs/architecture/cross-platform-capability-matrix.md`
  - `docs/architecture/v1.0.9-release-checklist.md`
  - `docs/mobile/mobile-architecture.md` for mobile work
- Trace at least one real runtime path through UI/store/transport/backend/persistence before making architectural claims.

### 2. Build A Repo Context Pack

Use Repomix if it is already available or the caller permits transient tool execution. Prefer a focused pack over a whole-repo dump.

Suggested pack scopes:

- Desktop session flow: `src/routes/chat`, `src/lib/stores`, `src/lib/transport`, `src-tauri/src/agent`, `src-tauri/src/commands/session*`, `src-tauri/src/storage`.
- Cross-platform protocol: `src-tauri/src/models.rs`, `src/lib/types`, `apps/ios/MiWarpMobile/MiWarpMobile/Core`, `apps/android`, `docs/architecture/cross-platform-capability-matrix.md`.
- Architecture governance: `scripts/architecture`, `docs/architecture`, `docs/adr`, `package.json`.

If Repomix is unavailable, make a manual context pack with `rg --files`, targeted `sed`, package manifests, and architecture docs. Record which path was used.

### 3. Run Mechanical Evidence Before Human Taste

Prefer existing project gates:

```bash
npm run arch:direction
npm run arch:layers
npm run arch:cycle
npm run arch:budget
npm run arch:check
```

Use `npm run arch:check:strict` when reviewing merge readiness or branch-level drift.

Add optional evidence when useful and allowed:

- Knip: unused exports, files, dependencies.
- Madge: cycles and dependency graph hotspots.
- dependency-cruiser: dependency direction, forbidden imports, architectural boundaries.
- `rg`, `wc -l`, `git ls-files`, and project-specific scripts for focused measurements.

Never require these optional tools to exist. If missing, say "not run" and rely on MiWarp's built-in architecture gates.

### 4. Use Multi-Agent Review Deliberately

If subagents are available (Task / Workflow tool with the `Explore` / `general-purpose` agent types, or background Bash), split review by evidence type:

- **Boundary agent**: dependency direction, cross-layer imports, command/transport ownership.
- **Hotspot agent**: god files, fan-in/fan-out, churn, ownership concentration.
- **Protocol agent**: Tauri IPC, WebSocket, BusEvent, runtime contracts, mobile parity.
- **Docs/ADR agent**: documented decisions vs implemented behavior, missing or stale fitness functions.

Give each subagent a bounded scope and require file/line evidence. Merge findings yourself; do not concatenate subagent reports. When the user signals ultracode mode, prefer the Workflow tool with explicit `phase()` boundaries so each agent's work is bounded and the merge step is yours.

### 5. Classify Findings

Use architecture-lifecycle categories:

- **Risk**: likely architecture decision or drift that threatens a quality attribute.
- **Non-risk**: accepted decision with evidence and rationale.
- **Sensitivity point**: parameter that strongly affects behavior, performance, or maintainability.
- **Tradeoff point**: improves one quality while reducing another.

For every risk, include:

- Evidence: command output, metric, file path, line, or trace.
- Violated boundary or invariant.
- Impacted quality attribute.
- Minimal next slice, not a broad rewrite.
- Fitness function or gate that would prevent regression.

### 6. Output Format

Lead with findings, not a narrative essay:

```text
Findings
- [P1] Title — file:line
  Evidence: command/metric/source.
  Why it matters: quality attribute + boundary.
  Next slice: concrete, incremental action.
  Fitness: command/test/gate to add or update.

Evidence Summary
- Commands run:
- Tools unavailable/skipped:
- Repo context pack:
- Relevant ADRs/docs:

Architecture Map
- Components:
- Connectors:
- Ownership boundaries:
- Hotspots:

Open Questions
- ...
```

Use priority labels:

- `P0`: correctness, data loss, security, or release-blocking architecture failure.
- `P1`: serious maintainability/reliability risk or architectural drift.
- `P2`: local complexity, weak boundary, missing evidence, or smaller refactor opportunity.
- `P3`: polish, naming, docs, or future improvement.

## Reference

Read `references/evidence-matrix.md` when selecting commands, evidence types, or MiWarp-specific gates.
