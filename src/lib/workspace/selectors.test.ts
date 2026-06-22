import { describe, expect, it } from "vitest";
import type { TaskRun } from "$lib/types";
import {
  agentLabelForRun,
  buildWorkspaceCapsule,
  buildWorkspaceListEntries,
  buildWorkspaceView,
  executionTargetForCwd,
  findDefaultWorkspaceCwd,
  isActiveRunStatus,
  isFailedRunStatus,
  modelLabelForRun,
  runtimeLabelForRun,
  safeDisplayString,
  workspaceLabelForCwd,
} from "./selectors";

function makeRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: "run-1",
    prompt: "hello",
    cwd: "/project/a",
    agent: "claude",
    auth_mode: "cli",
    status: "completed",
    started_at: "2024-06-01T10:00:00Z",
    last_activity_at: "2024-06-01T11:00:00Z",
    execution_path: "session_actor",
    session_id: "sess-1",
    ...overrides,
  };
}

describe("safeDisplayString", () => {
  it("returns fallback for empty or non-string values", () => {
    expect(safeDisplayString(undefined, "x")).toBe("x");
    expect(safeDisplayString(null, "x")).toBe("x");
    expect(safeDisplayString("   ", "x")).toBe("x");
    expect(safeDisplayString(42, "x")).toBe("x");
  });

  it("trims valid strings", () => {
    expect(safeDisplayString("  ok  ", "x")).toBe("ok");
  });
});

describe("executionTargetForCwd", () => {
  it("always emits local target in Phase 1", () => {
    expect(executionTargetForCwd("/project/a")).toEqual({
      kind: "local",
      cwd: "/project/a",
    });
  });
});

describe("buildWorkspaceListEntries", () => {
  it("groups runs by parent_cwd for worktree sessions", () => {
    const runs = [
      makeRun({ id: "w1", cwd: "/project/a/.miwarp/worktrees/wt1", parent_cwd: "/project/a" }),
      makeRun({
        id: "w2",
        cwd: "/project/b",
        parent_cwd: undefined,
        started_at: "2024-06-02T10:00:00Z",
        last_activity_at: "2024-06-02T11:00:00Z",
      }),
    ];

    const entries = buildWorkspaceListEntries(runs);
    expect(entries).toHaveLength(2);
    expect(entries.some((entry) => entry.cwd === "/project/a")).toBe(true);
    expect(entries.some((entry) => entry.cwd === "/project/b")).toBe(true);
  });

  it("sorts folders by latest activity descending", () => {
    const runs = [
      makeRun({
        id: "old",
        cwd: "/old",
        started_at: "2024-01-01T00:00:00Z",
        last_activity_at: "2024-01-01T00:00:00Z",
      }),
      makeRun({
        id: "new",
        cwd: "/new",
        started_at: "2024-06-01T00:00:00Z",
        last_activity_at: "2024-06-01T00:00:00Z",
      }),
    ];

    const entries = buildWorkspaceListEntries(runs);
    expect(entries[0]?.cwd).toBe("/new");
  });

  it("counts running, failed, and attention states", () => {
    const runs = [
      makeRun({ id: "r-run", status: "running" }),
      makeRun({
        id: "r-fail",
        status: "failed",
        session_id: "s2",
        started_at: "2024-06-01T09:00:00Z",
        last_activity_at: "2024-06-01T09:30:00Z",
      }),
    ];

    const entries = buildWorkspaceListEntries(runs, {
      hasAttention: (runId) => runId === "r-run",
    });

    expect(entries[0]?.runningCount).toBe(1);
    expect(entries[0]?.failedCount).toBe(1);
    expect(entries[0]?.attentionCount).toBe(1);
  });

  it("returns empty list for no runs", () => {
    expect(buildWorkspaceListEntries([])).toEqual([]);
  });
});

describe("buildWorkspaceCapsule", () => {
  it("builds recent sessions with continue and attention ordering", () => {
    const runs = [
      makeRun({
        id: "done",
        status: "completed",
        started_at: "2024-06-01T08:00:00Z",
        last_activity_at: "2024-06-01T08:30:00Z",
      }),
      makeRun({
        id: "active",
        status: "running",
        session_id: "sess-active",
        started_at: "2024-06-01T09:00:00Z",
        last_activity_at: "2024-06-01T09:30:00Z",
      }),
      makeRun({
        id: "failed",
        status: "failed",
        session_id: "sess-failed",
        started_at: "2024-06-01T10:00:00Z",
        last_activity_at: "2024-06-01T10:30:00Z",
      }),
    ];

    const capsule = buildWorkspaceCapsule("/project/a", runs, {
      hasAttention: (runId) => runId === "failed",
      resolveCanContinue: (run) => run.id === "done",
    });

    expect(capsule.isEmpty).toBe(false);
    expect(capsule.sessions[0]?.latestRun.id).toBe("failed");
    expect(capsule.sessions[1]?.latestRun.id).toBe("active");
    expect(capsule.sessions[2]?.latestRun.id).toBe("done");
    expect(capsule.sessions.find((row) => row.latestRun.id === "done")?.canContinue).toBe(true);
  });

  it("orders active before failed when neither needs attention", () => {
    const runs = [
      makeRun({
        id: "failed",
        status: "failed",
        session_id: "sess-failed",
        started_at: "2024-06-01T10:00:00Z",
        last_activity_at: "2024-06-01T10:30:00Z",
      }),
      makeRun({
        id: "active",
        status: "running",
        session_id: "sess-active",
        started_at: "2024-06-01T09:00:00Z",
        last_activity_at: "2024-06-01T09:30:00Z",
      }),
    ];

    const capsule = buildWorkspaceCapsule("/project/a", runs);
    expect(capsule.sessions[0]?.latestRun.id).toBe("active");
    expect(capsule.sessions[1]?.latestRun.id).toBe("failed");
  });

  it("returns empty capsule for unknown cwd", () => {
    const capsule = buildWorkspaceCapsule("/missing", [makeRun()]);
    expect(capsule.isEmpty).toBe(true);
    expect(capsule.sessions).toEqual([]);
  });

  it("degrades unknown agent/model fields", () => {
    const runs = [
      makeRun({
        agent: "",
        model: undefined,
        platform_id: undefined,
      }),
    ];

    const row = buildWorkspaceCapsule("/project/a", runs).sessions[0];
    expect(row?.agentLabel).toBe("unknown");
    expect(row?.modelLabel).toBe("—");
  });
});

describe("buildWorkspaceView", () => {
  it("shares one folder build for list and capsule", () => {
    const runs = [
      makeRun({ id: "a1", cwd: "/project/a" }),
      makeRun({
        id: "b1",
        cwd: "/project/b",
        started_at: "2024-07-01T00:00:00Z",
        last_activity_at: "2024-07-01T00:00:00Z",
      }),
    ];

    const view = buildWorkspaceView(runs, "/project/a");
    expect(view.entries).toHaveLength(2);
    expect(view.capsule.cwd).toBe("/project/a");
    expect(view.capsule.sessions).toHaveLength(1);
    expect(view.entries.every((entry) => entry.executionTarget.kind === "local")).toBe(true);
  });
});

describe("findDefaultWorkspaceCwd", () => {
  it("prefers saved cwd when present", () => {
    const entries = buildWorkspaceListEntries([
      makeRun({ cwd: "/a" }),
      makeRun({ id: "b", cwd: "/b", last_activity_at: "2024-07-01T00:00:00Z" }),
    ]);
    expect(findDefaultWorkspaceCwd(entries, "/a")).toBe("/a");
  });

  it("falls back when the preferred cwd no longer exists", () => {
    const entries = buildWorkspaceListEntries([
      makeRun({ cwd: "/a", last_activity_at: "2024-01-01T00:00:00Z" }),
      makeRun({ id: "b", cwd: "/b", last_activity_at: "2024-07-01T00:00:00Z" }),
    ]);
    expect(findDefaultWorkspaceCwd(entries, "/removed")).toBe("/b");
  });

  it("falls back to most recent non-uncategorized folder", () => {
    const entries = buildWorkspaceListEntries([
      makeRun({ cwd: "/a", last_activity_at: "2024-01-01T00:00:00Z" }),
      makeRun({ id: "b", cwd: "/b", last_activity_at: "2024-07-01T00:00:00Z" }),
    ]);
    expect(findDefaultWorkspaceCwd(entries, "")).toBe("/b");
  });

  it("skips uncategorized even when it is most recent", () => {
    const entries = buildWorkspaceListEntries([
      makeRun({
        id: "uncat",
        cwd: "",
        last_activity_at: "2024-08-01T00:00:00Z",
      }),
      makeRun({
        id: "proj",
        cwd: "/project/a",
        last_activity_at: "2024-06-01T00:00:00Z",
      }),
    ]);
    expect(findDefaultWorkspaceCwd(entries, "")).toBe("/project/a");
  });
});

describe("run label helpers", () => {
  it("uses workspace alias when provided", () => {
    expect(workspaceLabelForCwd("/project/a", false, { "/project/a": "Alpha" })).toBe("Alpha");
  });

  it("maps claude agent to runtime label", () => {
    expect(runtimeLabelForRun(makeRun({ agent: "claude" }))).toBeTruthy();
    expect(agentLabelForRun(makeRun({ agent: "claude" }))).toBe("claude");
  });

  it("degrades unknown agent to unknown runtime label", () => {
    expect(runtimeLabelForRun(makeRun({ agent: "mystery-runtime" }))).toBe("mystery-runtime");
    expect(runtimeLabelForRun(makeRun({ agent: "" }))).toBe("unknown");
  });

  it("classifies active and failed statuses safely", () => {
    expect(isActiveRunStatus("running")).toBe(true);
    expect(isActiveRunStatus("waiting_input")).toBe(true);
    expect(isActiveRunStatus(undefined)).toBe(false);
    expect(isFailedRunStatus("error")).toBe(true);
    expect(isFailedRunStatus("failed")).toBe(true);
    expect(isFailedRunStatus("completed")).toBe(false);
  });

  it("falls back to platform id for model label", () => {
    expect(modelLabelForRun(makeRun({ model: "", platform_id: "anthropic" }))).toBeTruthy();
  });
});
