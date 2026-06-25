---
name: schedule
description: Create a scheduled task
category: automation
icon: ⏰
---

# Schedule Skill

Create a recurring or one-time task. Confirm the requested cadence, timezone, workspace, and task prompt before creating it.

## Usage

`/schedule <task-id> [cron-expression|<ISO-timestamp>]`

## Examples

- `/schedule daily-backup "0 2 * * *"`
- `/schedule weekly-report "0 9 * * 1"`
- `/schedule reminder "2026-12-25T10:00:00+08:00"`

Prefer a clear task name, preserve the user's timezone, and state whether the schedule is exact or flexible.
