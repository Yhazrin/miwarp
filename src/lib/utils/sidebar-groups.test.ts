import { describe, it, expect } from "vitest";
import type { TaskRun, SessionFolder } from "$lib/types";
import {
  buildProjectFolders,
  buildEnrichedProjectFolders,
  autoExpandForRun,
  subFolderKeyForRun,
  expandForProjectChange,
  normalizeCwd,
  isScheduledTaskRun,
} from "./sidebar-groups";
import type { ScheduledTask } from "$lib/types/scheduled-task";

// ── Test helpers ──

function makeRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: "r1",
    prompt: "hello",
    cwd: "/project",
    agent: "claude",
    auth_mode: "cli",
    status: "completed",
    started_at: "2024-01-01T00:00:00Z",
    execution_path: "session_actor",
    ...overrides,
  };
}

const NO_FAVS = new Set<string>();
const NO_PINS: string[] = [];

// ── normalizeCwd ──

describe("normalizeCwd", () => {
  it("returns empty for undefined/null/empty", () => {
    expect(normalizeCwd(undefined)).toBe("");
    expect(normalizeCwd("")).toBe("");
    expect(normalizeCwd("  ")).toBe("");
  });

  it("returns empty for root slash", () => {
    expect(normalizeCwd("/")).toBe("");
    expect(normalizeCwd("\\")).toBe("");
  });

  it("strips trailing slashes", () => {
    expect(normalizeCwd("/path/to/proj/")).toBe("/path/to/proj");
    expect(normalizeCwd("/path/to/proj///")).toBe("/path/to/proj");
  });

  it("preserves_drive_root", () => {
    expect(normalizeCwd("C:\\")).toBe("C:/");
    expect(normalizeCwd("C:/")).toBe("C:/");
  });

  it("unifies_case_and_separators", () => {
    expect(normalizeCwd("c:\\Repo")).toBe("C:/Repo");
    expect(normalizeCwd("C:/Repo")).toBe("C:/Repo");
    expect(normalizeCwd("c:\\Repo")).toBe(normalizeCwd("C:/Repo"));
  });

  it("preserves_unc", () => {
    expect(normalizeCwd("\\\\server\\share")).toBe("//server/share");
    expect(normalizeCwd("//server/share")).toBe("//server/share");
  });

  it("bare_drive_letter", () => {
    expect(normalizeCwd("C:")).toBe("C:/");
    expect(normalizeCwd("d:")).toBe("D:/");
  });

  it("cwd_trailing_backslash_normalized", () => {
    const a = normalizeCwd("C:\\Users\\proj\\");
    const b = normalizeCwd("C:\\Users\\proj");
    expect(a).toBe(b);
    expect(a).toBe("C:/Users/proj");
  });
});

// ── buildProjectFolders ──

describe("buildProjectFolders", () => {
  it("groups_runs_by_session_id", () => {
    const runs = [
      makeRun({ id: "r1", session_id: "s1", started_at: "2024-01-01T00:00:00Z" }),
      makeRun({ id: "r2", session_id: "s1", started_at: "2024-01-02T00:00:00Z" }),
      makeRun({ id: "r3", session_id: "s1", started_at: "2024-01-03T00:00:00Z" }),
    ];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS);
    expect(folders).toHaveLength(1);
    expect(folders[0].conversations).toHaveLength(1);
    expect(folders[0].conversations[0].runs).toHaveLength(3);
  });

  it("no_session_id_stays_individual", () => {
    const runs = [makeRun({ id: "r1" }), makeRun({ id: "r2" })];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS);
    expect(folders).toHaveLength(1);
    expect(folders[0].conversations).toHaveLength(2);
  });

  it("mixed_sessions_and_standalone", () => {
    const runs = [
      makeRun({ id: "r1", session_id: "s1" }),
      makeRun({ id: "r2", session_id: "s1" }),
      makeRun({ id: "r3" }), // standalone
    ];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS);
    expect(folders[0].conversations).toHaveLength(2); // 1 session group + 1 standalone
  });

  it("cross_cwd_same_session_id_separate", () => {
    const runs = [
      makeRun({ id: "r1", session_id: "s1", cwd: "/projA" }),
      makeRun({ id: "r2", session_id: "s1", cwd: "/projB" }),
    ];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS);
    expect(folders).toHaveLength(2);
    // Each folder should have its own conversation group
    expect(folders[0].conversations).toHaveLength(1);
    expect(folders[1].conversations).toHaveLength(1);
  });

  it("empty_cwd_goes_to_uncategorized", () => {
    const runs = [
      makeRun({ id: "r1", cwd: "" }),
      makeRun({ id: "r2", cwd: "/" }),
      makeRun({ id: "r3", cwd: "/proj" }),
    ];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS);
    const uncat = folders.find((f) => f.isUncategorized);
    expect(uncat).toBeDefined();
    expect(uncat!.conversations).toHaveLength(2); // r1 and r2 both → uncategorized
    const proj = folders.find((f) => !f.isUncategorized);
    expect(proj).toBeDefined();
    expect(proj!.conversations).toHaveLength(1);
  });

  it("uncategorized_folder_at_end", () => {
    const runs = [
      makeRun({ id: "r1", cwd: "", started_at: "2024-12-01T00:00:00Z" }), // newer
      makeRun({ id: "r2", cwd: "/proj", started_at: "2024-01-01T00:00:00Z" }), // older
    ];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS);
    expect(folders).toHaveLength(2);
    expect(folders[folders.length - 1].isUncategorized).toBe(true);
  });

  it("pinned_cwds_empty_folders", () => {
    const folders = buildProjectFolders([], NO_FAVS, ["/pinned/proj"]);
    expect(folders).toHaveLength(1);
    expect(folders[0].cwd).toBe("/pinned/proj");
    expect(folders[0].conversations).toHaveLength(0);
  });

  it("favorites_propagate_to_conversation", () => {
    const runs = [makeRun({ id: "r1", session_id: "s1" }), makeRun({ id: "r2", session_id: "s1" })];
    const favs = new Set(["r2"]);
    const folders = buildProjectFolders(runs, favs, NO_PINS);
    expect(folders[0].conversations[0].isFavorite).toBe(true);
  });

  it("sort_order_newest_first", () => {
    const runs = [
      makeRun({
        id: "r1",
        session_id: "s1",
        started_at: "2024-01-01T00:00:00Z",
        last_activity_at: "2024-01-01T00:00:00Z",
      }),
      makeRun({
        id: "r2",
        session_id: "s2",
        started_at: "2024-06-01T00:00:00Z",
        last_activity_at: "2024-06-01T00:00:00Z",
      }),
    ];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS);
    expect(folders[0].conversations[0].groupKey).toBe("s:s2");
    expect(folders[0].conversations[1].groupKey).toBe("s:s1");
  });

  it("title_prefers_latest_name", () => {
    const runs = [
      makeRun({
        id: "r1",
        session_id: "s1",
        started_at: "2024-01-01T00:00:00Z",
        prompt: "early prompt",
      }),
      makeRun({
        id: "r2",
        session_id: "s1",
        started_at: "2024-02-01T00:00:00Z",
        name: "My Custom Name",
      }),
    ];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS);
    expect(folders[0].conversations[0].title).toBe("My Custom Name");
  });

  it("title_fallback_to_earliest_prompt", () => {
    const runs = [
      makeRun({
        id: "r1",
        session_id: "s1",
        started_at: "2024-01-01T00:00:00Z",
        prompt: "first prompt",
      }),
      makeRun({
        id: "r2",
        session_id: "s1",
        started_at: "2024-02-01T00:00:00Z",
        prompt: "second prompt",
      }),
    ];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS);
    // No name on latestRun → fallback to earliest prompt
    expect(folders[0].conversations[0].title).toBe("first prompt");
  });

  it("title_empty_name_not_used", () => {
    const runs = [
      makeRun({
        id: "r1",
        session_id: "s1",
        started_at: "2024-01-01T00:00:00Z",
        prompt: "real prompt",
      }),
      makeRun({
        id: "r2",
        session_id: "s1",
        started_at: "2024-02-01T00:00:00Z",
        name: "  ",
        prompt: "second",
      }),
    ];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS);
    // "  " should be trimmed to "" and skipped → fallback to earliest prompt
    expect(folders[0].conversations[0].title).toBe("real prompt");
  });

  it("no_label_field_on_folder", () => {
    const runs = [makeRun({ id: "r1" })];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS);

    expect((folders[0] as any).label).toBeUndefined();
    expect(folders[0].cwd).toBeDefined();
    expect(folders[0].isUncategorized).toBeDefined();
  });

  it("group_key_has_prefix", () => {
    const runs = [
      makeRun({ id: "r1", session_id: "s1" }),
      makeRun({ id: "r2" }), // standalone
    ];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS);
    const keys = folders[0].conversations.map((c) => c.groupKey);
    expect(keys).toContain("s:s1");
    expect(keys).toContain("r:r2");
  });

  it("pinned_cwds_filters_empty_and_root", () => {
    const folders = buildProjectFolders([], NO_FAVS, ["", "/", "/real/proj"]);
    // Only /real/proj should produce a folder
    expect(folders).toHaveLength(1);
    expect(folders[0].cwd).toBe("/real/proj");
  });

  it("cwd_trailing_slash_normalized", () => {
    const runs = [
      makeRun({ id: "r1", cwd: "/path/to/proj/" }),
      makeRun({ id: "r2", cwd: "/path/to/proj" }),
    ];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS);
    expect(folders).toHaveLength(1);
    expect(folders[0].conversations).toHaveLength(2);
  });

  it("cwd_trailing_backslash_normalized", () => {
    const runs = [
      makeRun({ id: "r1", cwd: "C:\\Users\\proj\\" }),
      makeRun({ id: "r2", cwd: "C:\\Users\\proj" }),
    ];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS);
    expect(folders).toHaveLength(1);
    expect(folders[0].cwd).toBe("C:/Users/proj");
  });

  it("removed_cwd_not_in_folders", () => {
    const runs = [makeRun({ id: "r1", cwd: "/projA" }), makeRun({ id: "r2", cwd: "/projB" })];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS, ["/projA"]);
    expect(folders).toHaveLength(1);
    expect(folders[0].cwd).toBe("/projB");
  });

  it("uncategorized_never_removed", () => {
    const runs = [makeRun({ id: "r1", cwd: "" }), makeRun({ id: "r2", cwd: "/proj" })];
    // Attempt to remove "" (Uncategorized) — should have no effect
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS, [""]);
    const uncat = folders.find((f) => f.isUncategorized);
    expect(uncat).toBeDefined();
    expect(uncat!.conversations).toHaveLength(1);
  });

  it("removed_cwd_in_pinnedCwds_no_empty_folder", () => {
    // If a cwd is both pinned and removed, it should not generate a folder
    const folders = buildProjectFolders([], NO_FAVS, ["/pinned/proj"], ["/pinned/proj"]);
    expect(folders).toHaveLength(0);
  });

  it("removed_cwd_normalization_consistent", () => {
    const runs = [makeRun({ id: "r1", cwd: "C:\\Users\\proj" })];
    // Remove with different formatting — should still match after normalization
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS, ["c:\\Users\\proj\\"]);
    expect(folders).toHaveLength(0);
  });
});

// ── autoExpandForRun ──

describe("autoExpandForRun", () => {
  it("auto_expand_adds_folder_for_selected_run", () => {
    const runs = [makeRun({ id: "r1", cwd: "/proj" })];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS);
    const result = autoExpandForRun("r1", folders, new Set());
    expect(result).not.toBeNull();
    expect(result!.has("cwd:/proj")).toBe(true);
  });

  it("auto_expand_returns_null_if_already_expanded", () => {
    const runs = [makeRun({ id: "r1", cwd: "/proj" })];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS);
    const result = autoExpandForRun("r1", folders, new Set(["cwd:/proj"]));
    expect(result).toBeNull();
  });

  it("auto_expand_returns_null_if_no_selected_run", () => {
    const runs = [makeRun({ id: "r1" })];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS);
    expect(autoExpandForRun(undefined, folders, new Set())).toBeNull();
    expect(autoExpandForRun("", folders, new Set())).toBeNull();
  });

  it("auto_expand_adds_workspace_when_run_is_in_logical_subfolder", () => {
    const cwd = "/project/miwarp";
    const runs = [makeRun({ id: "r-in-folder", cwd, folder_id: "f1", session_id: "s1" })];
    const sessionFolders: SessionFolder[] = [
      {
        id: "f1",
        name: "Feature",
        workspaceId: cwd,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];
    const folders = buildEnrichedProjectFolders(runs, sessionFolders, NO_FAVS, NO_PINS);
    const result = autoExpandForRun("r-in-folder", folders, new Set());
    expect(result).not.toBeNull();
    expect(result!.has(`cwd:${cwd}`)).toBe(true);
  });

  it("subFolderKeyForRun_returns_sf_key_for_foldered_run", () => {
    const cwd = "/project/miwarp";
    const runs = [makeRun({ id: "r-in-folder", cwd, folder_id: "f1", session_id: "s1" })];
    const sessionFolders: SessionFolder[] = [
      {
        id: "f1",
        name: "Feature",
        workspaceId: cwd,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];
    const folders = buildEnrichedProjectFolders(runs, sessionFolders, NO_FAVS, NO_PINS);
    expect(subFolderKeyForRun("r-in-folder", folders)).toBe("sf:f1");
    expect(subFolderKeyForRun("missing", folders)).toBeNull();
  });
});

// ── expandForProjectChange ──

describe("expandForProjectChange", () => {
  it("expand_for_project_change_adds_cwd", () => {
    const result = expandForProjectChange("cwd:/proj", new Set());
    expect(result).not.toBeNull();
    expect(result!.has("cwd:/proj")).toBe(true);
  });

  it("expand_for_project_change_skips_empty_cwd", () => {
    const result = expandForProjectChange("", new Set());
    expect(result).toBeNull();
  });

  it("expand_for_project_change_skips_already_expanded", () => {
    const result = expandForProjectChange("cwd:/proj", new Set(["cwd:/proj"]));
    expect(result).toBeNull();
  });

  it("folderKey_uncategorized_does_not_conflict_with_all_projects", () => {
    // "All Projects" sends empty string → expandForProjectChange should skip
    const result = expandForProjectChange("", new Set());
    expect(result).toBeNull();
    // Uncategorized folder has folderKey "uncategorized", not ""
    const runs = [makeRun({ id: "r1", cwd: "" })];
    const folders = buildProjectFolders(runs, NO_FAVS, NO_PINS);
    const uncatFolder = folders.find((f) => f.isUncategorized);
    expect(uncatFolder?.folderKey).toBe("uncategorized");
  });
});

describe("sessionFolderWorkspaceId", () => {
  it("maps empty cwd to default storage id", async () => {
    const { sessionFolderWorkspaceId } = await import("./sidebar-groups");
    expect(sessionFolderWorkspaceId("")).toBe("default");
    expect(sessionFolderWorkspaceId("/a/b")).toBe("/a/b");
  });
});

describe("buildEnrichedProjectFolders", () => {
  it("empty_session_folder_stays_in_workspace_not_uncategorized", () => {
    const runs: TaskRun[] = [makeRun({ id: "r1", cwd: "/project/miwarp", session_id: "s1" })];
    const sessionFolders: SessionFolder[] = [
      {
        id: "f-empty",
        name: "My Folder",
        workspaceId: "/project/miwarp",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];
    const enriched = buildEnrichedProjectFolders(runs, sessionFolders, NO_FAVS, NO_PINS);
    const miwarp = enriched.find((f) => f.cwd === "/project/miwarp");
    expect(miwarp).toBeDefined();
    expect(miwarp!.subFolders.some((sf) => sf.folderId === "f-empty")).toBe(true);
    const uncategorized = enriched.find((f) => f.isUncategorized);
    expect(uncategorized?.subFolders.some((sf) => sf.folderId === "f-empty") ?? false).toBe(false);
  });

  it("legacy_default_workspaceId_goes_to_uncategorized", () => {
    const sessionFolders: SessionFolder[] = [
      {
        id: "f-default",
        name: "Legacy",
        workspaceId: "default",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];
    const enriched = buildEnrichedProjectFolders([], sessionFolders, NO_FAVS, NO_PINS);
    const uncategorized = enriched.find((f) => f.isUncategorized);
    expect(uncategorized?.subFolders.some((sf) => sf.folderId === "f-default")).toBe(true);
  });

  it("workspace_with_only_empty_subfolders_has_nonzero_count", () => {
    const sessionFolders: SessionFolder[] = [
      {
        id: "f1",
        name: "Empty",
        workspaceId: "/project/miwarp",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];
    const enriched = buildEnrichedProjectFolders([], sessionFolders, NO_FAVS, ["/project/miwarp"]);
    const miwarp = enriched.find((f) => f.cwd === "/project/miwarp");
    expect(miwarp?.conversationCount).toBeGreaterThan(0);
    expect(miwarp?.subFolders.length).toBe(1);
  });

  it("scheduled_runs_grouped_into_hub_not_flat_conversations", () => {
    const cwd = "/project/miwarp";
    const taskId = "task-daily";
    const runs: TaskRun[] = [
      makeRun({
        id: "r-sched-1",
        cwd,
        scheduled_task_id: taskId,
        started_at: "2024-01-02T00:00:00Z",
        name: "⏱ Daily check",
      }),
      makeRun({
        id: "r-sched-2",
        cwd,
        scheduled_task_id: taskId,
        started_at: "2024-01-03T00:00:00Z",
      }),
      makeRun({ id: "r-manual", cwd, started_at: "2024-01-04T00:00:00Z" }),
    ];
    const scheduledTasks: ScheduledTask[] = [
      {
        id: taskId,
        name: "Daily check",
        prompt: "Check logs",
        workspace: { cwd },
        agent: "claude",
        schedule: { type: "cron", cronExpression: "0 9 * * *" },
        enabled: true,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];
    const enriched = buildEnrichedProjectFolders(
      runs,
      [],
      NO_FAVS,
      NO_PINS,
      [],
      scheduledTasks,
      [],
    );
    const folder = enriched.find((f) => f.cwd === cwd);
    expect(folder).toBeDefined();
    expect(folder!.conversations).toHaveLength(1);
    expect(folder!.conversations[0].latestRun.id).toBe("r-manual");
    expect(folder!.scheduledTaskHubs).toHaveLength(1);
    expect(folder!.scheduledTaskHubs[0].taskId).toBe(taskId);
    expect(folder!.scheduledTaskHubs[0].executionCount).toBe(2);
    expect(isScheduledTaskRun(runs[0])).toBe(true);
  });

  it("scheduled_only_workspace_still_appears_with_hub", () => {
    const cwd = "/project/scheduled-only";
    const taskId = "task-only";
    const runs = [
      makeRun({
        id: "r1",
        cwd,
        scheduled_task_id: taskId,
        started_at: "2024-01-02T00:00:00Z",
      }),
    ];
    const scheduledTasks: ScheduledTask[] = [
      {
        id: taskId,
        name: "Nightly",
        prompt: "run tests",
        workspace: { cwd },
        agent: "claude",
        schedule: { type: "interval", intervalMinutes: 60 },
        enabled: false,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];
    const enriched = buildEnrichedProjectFolders(runs, [], NO_FAVS, [cwd], [], scheduledTasks, []);
    const folder = enriched.find((f) => f.cwd === cwd);
    expect(folder).toBeDefined();
    expect(folder!.conversations).toHaveLength(0);
    expect(folder!.scheduledTaskHubs).toHaveLength(1);
    expect(folder!.scheduledTaskHubs[0].enabled).toBe(false);
    expect(folder!.conversationCount).toBe(1);
  });

  it("scheduled_hub_latestSummary_falls_back_to_prompt", () => {
    const cwd = "/project/summary";
    const taskId = "task-summary";
    const runs = [
      makeRun({
        id: "r-sum-1",
        cwd,
        scheduled_task_id: taskId,
        started_at: "2024-01-02T00:00:00Z",
      }),
    ];
    const scheduledTasks: ScheduledTask[] = [
      {
        id: taskId,
        name: "Summary Task",
        prompt: "First line of the prompt\nSecond line should not appear",
        workspace: { cwd },
        agent: "claude",
        schedule: { type: "cron", cronExpression: "0 9 * * *" },
        enabled: true,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];
    const enriched = buildEnrichedProjectFolders(runs, [], NO_FAVS, [], [], scheduledTasks, []);
    const folder = enriched.find((f) => f.cwd === cwd);
    expect(folder).toBeDefined();
    const hub = folder!.scheduledTaskHubs[0];
    expect(hub.latestSummary).toBe("First line of the prompt");
  });

  it("scheduled_hub_latestSummary_prefers_run_summary_when_present", () => {
    const cwd = "/project/prefer-summary";
    const taskId = "task-prefer";
    const runs = [
      makeRun({
        id: "r-pref-1",
        cwd,
        scheduled_task_id: taskId,
        started_at: "2024-01-02T00:00:00Z",
      }),
    ];
    const scheduledTasks: ScheduledTask[] = [
      {
        id: taskId,
        name: "Prefer Summary",
        prompt: "Should not appear",
        workspace: { cwd },
        agent: "claude",
        schedule: { type: "cron", cronExpression: "0 9 * * *" },
        enabled: true,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];
    const scheduledTaskRuns = [
      {
        id: "exec-1",
        taskId,
        runId: "r-pref-1",
        startedAt: "2024-01-02T00:00:00Z",
        status: "completed" as const,
        summary: "Last run output",
      },
    ];
    const enriched = buildEnrichedProjectFolders(
      runs,
      [],
      NO_FAVS,
      [],
      [],
      scheduledTasks,
      scheduledTaskRuns,
    );
    const folder = enriched.find((f) => f.cwd === cwd);
    expect(folder).toBeDefined();
    expect(folder!.scheduledTaskHubs[0].latestSummary).toBe("Last run output");
  });
});
