# Scheduled Archaeology Run — Operating Procedure

## Dual-track cadence

The codebase archaeology runs on two tracks; they are not interchangeable.

| Track | What it does | Where it runs | Schedule |
| --- | --- | --- | --- |
| **Mechanical** | Re-runs every `arch:*` gate + vitest + Rust unit tests. Catches drift between two consecutive LLM sessions automatically. | GitHub Action `.github/workflows/archaeology-scheduled-audit.yml` | Weekly, Mondays 09:00 UTC |
| **Reasoning** | 4-agent parallel review + synthesis with evidence-grounded P0/P1/P2/P3 findings. Cannot run in CI — requires LLM judgement to classify drift, attribute it to a quality attribute, and draft a next-slice migration. | Claude Code session via `/miwarp-codebase-archaeologist` | After every minor release, or when the mechanical report shows ≥ 1 new violation |

The two are independent: weekly CI is a tripwire for *mechanical* drift (a gate flipping from 0 to 1 violation, a god file crossing a new warn threshold, a test suite dropping below 100%). The Claude session classifies and proposes fixes when the tripwire fires.

## Mechanical run

Triggered automatically. To force one before the next Monday:

```bash
gh workflow run archaeology-scheduled-audit.yml
gh workflow run archaeology-scheduled-audit.yml -f ref=fix/some-branch
```

The run produces an artifact `archaeology-report.md` with three sections:

1. `arch:check (9 gates)` — current pass/fail per gate
2. `vitest` — frontend test summary
3. `cargo test --lib` — Rust unit test summary

The action fails the run if **any** of those three regress. The artifact is retained for 90 days so two consecutive runs can be diffed.

## Reasoning run

Triggered by typing `/miwarp-codebase-archaeologist` in a Claude Code session. The skill body is the canonical workflow — see `../SKILL.md`. Typical flow:

1. Pull the most recent `archaeology-report.md` artifact (if within the last 7 days — otherwise the gates have drifted past the report).
2. Confirm the working copy is clean (`git status --short`).
3. Run the skill. The skill will:
   - Re-run baseline commands (the same 11 the artifact summarises).
   - Spawn 4 agents in parallel via the Workflow tool when the user signals ultracode mode, or run them inline otherwise.
   - Synthesise into the standard Findings / Evidence Summary / Architecture Map / Open Questions output (see SKILL.md §6).
4. Compare the new findings to the previous synthesis. Items that flipped from "fixed" to "open" are the highest-priority work; items that appeared for the first time are the next quarter's candidate list.
5. Open fix branches per `fix/xxx` or `feat/xxx` convention (see repo `CLAUDE.md`).

## Cadence tuning

The weekly schedule is a default. Adjust in `.github/workflows/archaeology-scheduled-audit.yml` if the team changes tempo:

- **Pre-release window (1-2 weeks before a tagged release):** schedule daily. Drift in a release branch is more expensive to fix post-tag.
- **Quiet branch (long-lived feature work, no imminent release):** schedule bi-weekly. Mechanical drift accumulates slowly enough that weekly is noise.
- **Post-incident:** dispatch immediately, regardless of schedule.

A small set of high-signal changes should always trigger an ad-hoc reasoning run, even mid-cycle:

- Any new `arch:*` gate starts failing.
- A `god-module-budget` style threshold (if added) trips on a previously healthy file.
- A BusEvent or Tauri command is added or renamed (BusEvent allowlist drift is a P0).
- A new mobile platform target is added (i.e. desktop + iOS + Android, currently desktop + iOS + Android per the matrix doc).
