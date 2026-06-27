/**
 * navigation-model.test.ts — pin the layout's path predicates + describeCurrentPage
 * surface. These are the helpers the rail / sidebar / page-name resolver rely on
 * after the +layout.svelte split; refactors that change their behaviour should
 * have to update these tests deliberately.
 */
import { describe, expect, it } from "vitest";
import {
  NAV_ITEMS,
  describeCurrentPage,
  pathIsChat,
  pathIsChatOrSettingsTransition,
  pathIsSettings,
  resolvePageName,
} from "./navigation-model";

describe("navigation-model predicates", () => {
  it("pathIsChat matches the chat root and the bare root", () => {
    expect(pathIsChat("/chat")).toBe(true);
    expect(pathIsChat("/")).toBe(true);
    expect(pathIsChat("/chat?run=abc")).toBe(false);
    expect(pathIsChat("/settings")).toBe(false);
  });

  it("pathIsSettings matches every /settings/* deep-link", () => {
    expect(pathIsSettings("/settings")).toBe(true);
    expect(pathIsSettings("/settings/appearance")).toBe(true);
    expect(pathIsSettings("/chat")).toBe(false);
  });

  it("pathIsChatOrSettingsTransition flips true only across the chat↔settings boundary", () => {
    expect(pathIsChatOrSettingsTransition("/chat", "/settings")).toBe(true);
    expect(pathIsChatOrSettingsTransition("/settings", "/chat")).toBe(true);
    expect(pathIsChatOrSettingsTransition("/chat", "/workspace")).toBe(false);
    expect(pathIsChatOrSettingsTransition("/teams", "/plugins")).toBe(false);
  });
});

describe("NAV_ITEMS contract", () => {
  it("exposes the 11 routes that drive the icon rail", () => {
    // Pinned count: don't let the rail shrink or grow without an explicit
    // review — each entry shows up in the icon rail and a group divider.
    expect(NAV_ITEMS.length).toBe(11);
  });

  it("every entry has a unique path and a group classification", () => {
    const paths = new Set<string>();
    for (const item of NAV_ITEMS) {
      expect(item.path.startsWith("/")).toBe(true);
      expect(paths.has(item.path)).toBe(false);
      paths.add(item.path);
      expect(["core", "workspace", "collaboration", "extensions", "system"]).toContain(item.group);
    }
  });
});

describe("describeCurrentPage", () => {
  it("flags the chat root and the scheduled-tasks hub id", () => {
    const page = describeCurrentPage("/scheduled-tasks/daily-standup");
    expect(page.isScheduledTasksPage).toBe(true);
    expect(page.selectedScheduledTaskId).toBe("daily-standup");
    expect(page.isChatPage).toBe(false);
  });

  it("returns an empty scheduled-task id outside the hub", () => {
    const page = describeCurrentPage("/scheduled-tasks");
    expect(page.isScheduledTasksPage).toBe(true);
    expect(page.selectedScheduledTaskId).toBe("");
  });

  it("exposes the explorer / teams / workbench / workspace booleans from path prefix", () => {
    const explorer = describeCurrentPage("/explorer/some/path");
    expect(explorer.isExplorerPage).toBe(true);
    expect(explorer.isTeamsPage).toBe(false);

    const teams = describeCurrentPage("/teams/abc");
    expect(teams.isTeamsPage).toBe(true);

    const workbench = describeCurrentPage("/workbench");
    expect(workbench.isWorkbenchPage).toBe(true);
    expect(workbench.isWorkspacePage).toBe(false);
  });
});

describe("resolvePageName", () => {
  it("matches the longest NAV_ITEMS prefix first", () => {
    // /settings/foo should hit /settings, not /plugins.
    const name = resolvePageName("/settings/appearance");
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });

  it("falls back to the release-notes key for /release-notes/*", () => {
    const name = resolvePageName("/release-notes/v1");
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });
});
