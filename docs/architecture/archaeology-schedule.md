# Archaeology Schedule

> Status: **active since v1.1.0 / archaeology-cadence**
> Owner: `chore/archaeology-scheduled-audit` branch
> Source of truth: `.github/workflows/archaeology-scheduled-audit.yml`

## Cadence

The codebase archaeology runs on two complementary tracks. The
mechanical half fires automatically; the reasoning half is triggered
by a human in a Claude Code session.

| Track | Frequency | Trigger | Output |
| --- | --- | --- | --- |
| Mechanical (archaeology-scheduled-audit) | Weekly, Mon 09:00 UTC | cron + `workflow_dispatch` | `archaeology-report.md` artifact, run fails on regression |
| Reasoning (`/miwarp-codebase-archaeologist`) | Per minor release; ad-hoc on mechanical regression | Claude Code session | Findings / Evidence / Architecture Map / Open Questions |

The full operating procedure lives in
`.claude/skills/miwarp-codebase-archaeologist/references/scheduled-run.md`.
The skill body itself is the canonical workflow for the reasoning track.

## Why this exists

The previous audit pattern (single-shot, on-demand, full multi-agent
synthesis) was a 12-15 minute task that nobody had time to run on a
recurring schedule. The dual-track split solves that:

- The **mechanical** track costs CI minutes, not human minutes, and
  catches *mechanical* drift (a gate flipping, a test suite dropping,
  a god file growing past its warn threshold).
- The **reasoning** track is reserved for *semantic* drift (a new
  god module, a missing ADR, a cross-layer smell that no gate covers).
  The mechanical report tells the human whether the reasoning run is
  warranted at all.

## Decision: when to open a fix branch

Findings from the reasoning run are classified `P0` / `P1` / `P2` /
`P3` (see `SKILL.md §5`). The decision rule:

- `P0` → open `fix/pX-...` branch the same day, merge before next
  release tag.
- `P1` → open a branch within the same sprint, include in next
  minor release notes.
- `P2` → back-burner; address when an adjacent refactor makes it cheap.
- `P3` → archive in the report; revisit at the next major version.

A `P0` from the mechanical report (a gate flipping) is treated as an
automatic `P0` from the reasoning run, without waiting for a human
classification. The next reasoning run after a mechanical failure
should explicitly call out the regression in its Findings Status
section.

## Future work

The current schedule is *weekly*. As the team grows, the right
adjustments are likely:

- **Pre-release (1-2 weeks before tag):** daily mechanical, manual
  reasoning on the release branch.
- **Post-incident:** ad-hoc mechanical + reasoning both.
- **New mobile target (Android / iOS expansion):** add a mobile-only
  arch gate to the mechanical track so per-platform drift surfaces
  weekly instead of per-release.
