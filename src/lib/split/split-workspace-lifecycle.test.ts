/**
 * Split workspace lifecycle tests — covers P0-2 URL/run reconciliation.
 *
 * Focus areas:
 *  - `reconcileSplitFromUrl` third branch: `wantSplit && enabled && urlRunId`
 *    (a) matches active pane  → no-op
 *    (b) matches another pane → activate that pane
 *    (c) matches no pane      → rewrite URL back to active pane's runId
 *  - `isSplitUrlSyncLocked` + `withSplitUrlSyncLock` for round-trip safety
 *  - `syncSplitUrlFromStore` does NOT write when URL already matches
 *
 * The lifecycle module is stateful (deps, urlSyncLock). Each test resets
 * the lifecycle via `unregisterSplitWorkspaceLifecycle()` so tests are
 * isolated.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  unregisterSplitWorkspaceLifecycle,
  registerSplitWorkspaceLifecycle,
  reconcileSplitFromUrl,
  isSplitUrlSyncLocked,
  withSplitUrlSyncLock,
  syncSplitUrlFromStore,
  enterSplitWorkspace,
  activateSplitPane,
  refreshInactivePaneSnapshot,
} from "./split-workspace-lifecycle";
import { splitWorkspaceStore } from "./split-workspace-store.svelte";
import { buildSplitPanes, SPLIT_QUERY_PARAM, PANES_QUERY_PARAM } from "./split-workspace-url";
import type { SplitWorkspaceLifecycleDeps } from "./split-workspace-lifecycle";
import type { SessionStore } from "$lib/stores/session-store.svelte";
import * as api from "$lib/api";

vi.mock("$lib/api", () => ({
  getRun: vi.fn().mockResolvedValue({ id: "fake", status: "pending" }),
  getBusEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

function makeFakeSessionStore(): SessionStore {
  return {
    loadRun: vi.fn().mockResolvedValue(undefined),
    run: undefined,
    timeline: [],
    buildSnapshotFromEvents: vi.fn().mockReturnValue({
      timeline: [],
      tools: [],
      turnUsages: [],
    }),
  } as unknown as SessionStore;
}

function makeDeps(): {
  deps: SplitWorkspaceLifecycleDeps;
  pageUrl: URL;
  replaceStateSpy: ReturnType<typeof vi.fn>;
} {
  const pageUrl = new URL("http://localhost/chat?run=run-a");
  const replaceStateSpy = vi.fn((url: URL) => {
    // Reflect the URL mutation so subsequent `getPageUrl()` reads see it,
    // matching real browser history behaviour.
    pageUrl.search = url.search;
    pageUrl.pathname = url.pathname;
    pageUrl.hash = url.hash;
  });
  return {
    pageUrl,
    replaceStateSpy,
    deps: {
      getSessionStore: () => makeFakeSessionStore(),
      getPageUrl: () => pageUrl,
      replaceState: replaceStateSpy,
      getXtermRef: () => undefined,
      getCwd: () => "/work",
      getCurrentRunId: () => "run-a",
    },
  };
}

beforeEach(() => {
  unregisterSplitWorkspaceLifecycle();
  splitWorkspaceStore.exit();
  splitWorkspaceStore.enabled = false;
  splitWorkspaceStore.panes = [];
  splitWorkspaceStore.activePaneId = null;
});

describe("isSplitUrlSyncLocked + withSplitUrlSyncLock", () => {
  it("starts unlocked", () => {
    expect(isSplitUrlSyncLocked()).toBe(false);
  });

  it("withSplitUrlSyncLock flips on for the duration of fn", () => {
    expect(isSplitUrlSyncLocked()).toBe(false);
    withSplitUrlSyncLock(() => {
      expect(isSplitUrlSyncLocked()).toBe(true);
    });
    expect(isSplitUrlSyncLocked()).toBe(false);
  });

  it("withSplitUrlSyncLock restores prior state on nested calls", () => {
    withSplitUrlSyncLock(() => {
      withSplitUrlSyncLock(() => {
        expect(isSplitUrlSyncLocked()).toBe(true);
      });
      // Still locked — outer lock wasn't broken by inner fn.
      expect(isSplitUrlSyncLocked()).toBe(true);
    });
    expect(isSplitUrlSyncLocked()).toBe(false);
  });

  it("withSplitUrlSyncLock releases lock even when fn throws", () => {
    expect(() =>
      withSplitUrlSyncLock(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(isSplitUrlSyncLocked()).toBe(false);
  });
});

describe("reconcileSplitFromUrl — case 1 (deep link restores full pane set)", () => {
  it("restores multiple panes from ?panes= payload", async () => {
    const { deps, replaceStateSpy } = makeDeps();
    registerSplitWorkspaceLifecycle(deps);
    splitWorkspaceStore.exit();

    const encoded = buildSplitPanes(
      [
        { id: "p1", r: "run-a" },
        { id: "p2", r: "run-b" },
        { id: "p3", r: "run-c" },
      ],
      "p2",
    );
    const params = new URLSearchParams(`split=1&run=run-b&panes=${encoded}&layout=triple`);

    await reconcileSplitFromUrl(params);

    expect(splitWorkspaceStore.enabled).toBe(true);
    expect(splitWorkspaceStore.panes).toHaveLength(3);
    expect(splitWorkspaceStore.panes.map((p) => p.runId)).toEqual(["run-a", "run-b", "run-c"]);
    // Active pane should be the one from the URL (run-b), not run-a.
    const active = splitWorkspaceStore.panes.find(
      (p) => p.paneId === splitWorkspaceStore.activePaneId,
    );
    expect(active?.runId).toBe("run-b");
    expect(splitWorkspaceStore.layoutMode).toBe("triple");
    // URL should have been re-synced to use the canonical (real pane ids).
    const lastCall = replaceStateSpy.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    const writtenUrl = lastCall![0] as URL;
    expect(writtenUrl.searchParams.get(SPLIT_QUERY_PARAM)).toBe("1");
    expect(writtenUrl.searchParams.get(PANES_QUERY_PARAM)).not.toBeNull();
  });

  it("back-compat: legacy ?split=1&run=X enters single-pane mode", async () => {
    const { deps } = makeDeps();
    registerSplitWorkspaceLifecycle(deps);
    splitWorkspaceStore.exit();

    const params = new URLSearchParams("split=1&run=run-a");
    await reconcileSplitFromUrl(params);

    expect(splitWorkspaceStore.enabled).toBe(true);
    expect(splitWorkspaceStore.panes).toHaveLength(1);
    expect(splitWorkspaceStore.panes[0].runId).toBe("run-a");
    expect(splitWorkspaceStore.layoutMode).toBe("single");
  });
});

describe("reconcileSplitFromUrl — third branch (wantSplit && enabled && urlRunId)", () => {
  it("(a) urlRun matches active pane → no-op (no activate, no replaceState)", async () => {
    const { deps, replaceStateSpy } = makeDeps();
    registerSplitWorkspaceLifecycle(deps);
    await enterSplitWorkspace({ activeRunId: "run-a" });
    replaceStateSpy.mockClear();

    const params = new URLSearchParams("split=1&run=run-a");
    await reconcileSplitFromUrl(params);

    expect(replaceStateSpy).not.toHaveBeenCalled();
    expect(splitWorkspaceStore.activePaneId).not.toBeNull();
  });

  it("(b) urlRun matches another open pane → activate that pane", async () => {
    const { deps, replaceStateSpy } = makeDeps();
    registerSplitWorkspaceLifecycle(deps);
    await enterSplitWorkspace({ activeRunId: "run-a" });
    // Add a second pane that's inactive by default.
    splitWorkspaceStore.addPane("run-b", { makeActive: false });
    const targetPane = splitWorkspaceStore.panes.find((p) => p.runId === "run-b")!;
    expect(splitWorkspaceStore.activePaneId).not.toBe(targetPane.paneId);
    replaceStateSpy.mockClear();

    const params = new URLSearchParams("split=1&run=run-b");
    await reconcileSplitFromUrl(params);

    expect(splitWorkspaceStore.activePaneId).toBe(targetPane.paneId);
  });

  it("(c) urlRun does NOT match any pane → URL rewritten to active runId", async () => {
    const { deps, replaceStateSpy, pageUrl } = makeDeps();
    registerSplitWorkspaceLifecycle(deps);
    await enterSplitWorkspace({ activeRunId: "run-a" });
    // Manually desync the URL: pretend the user pasted an old bookmark for a
    // run that no longer exists in this workspace.
    pageUrl.search = "?split=1&run=run-ghost";
    replaceStateSpy.mockClear();

    const params = new URLSearchParams("split=1&run=run-ghost");
    await reconcileSplitFromUrl(params);

    // Should rewrite URL back to active run.
    expect(replaceStateSpy).toHaveBeenCalled();
    const lastCall = replaceStateSpy.mock.calls.at(-1);
    const lastUrl = lastCall![0] as URL;
    expect(lastUrl.searchParams.get("run")).toBe("run-a");
    expect(lastUrl.searchParams.get("split")).toBe("1");
    // Active pane should still be the original.
    const activePane = splitWorkspaceStore.panes.find(
      (p) => p.paneId === splitWorkspaceStore.activePaneId,
    );
    expect(activePane?.runId).toBe("run-a");
  });

  it("returns early when reconcile called under urlSyncLock", async () => {
    const { deps, replaceStateSpy } = makeDeps();
    registerSplitWorkspaceLifecycle(deps);
    await enterSplitWorkspace({ activeRunId: "run-a" });
    splitWorkspaceStore.addPane("run-b", { makeActive: false });
    replaceStateSpy.mockClear();

    const params = new URLSearchParams("split=1&run=run-b");
    await withSplitUrlSyncLock(async () => {
      await reconcileSplitFromUrl(params);
    });

    // Locked at entry → reconcile bails out, no activate, no URL rewrite.
    expect(replaceStateSpy).not.toHaveBeenCalled();
    expect(splitWorkspaceStore.activePaneId).not.toBe(
      splitWorkspaceStore.panes.find((p) => p.runId === "run-b")!.paneId,
    );
  });
});

describe("syncSplitUrlFromStore", () => {
  it("does not write when URL already matches store state", async () => {
    const { deps, replaceStateSpy } = makeDeps();
    registerSplitWorkspaceLifecycle(deps);
    await enterSplitWorkspace({ activeRunId: "run-a" });
    // `enterSplitWorkspace` already wrote the canonical URL. Now sync
    // should be a no-op.
    replaceStateSpy.mockClear();
    syncSplitUrlFromStore();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("writes when active run changes", async () => {
    const { deps, replaceStateSpy } = makeDeps();
    registerSplitWorkspaceLifecycle(deps);
    await enterSplitWorkspace({ activeRunId: "run-a" });
    splitWorkspaceStore.addPane("run-b", { makeActive: false });
    replaceStateSpy.mockClear();

    await activateSplitPane(splitWorkspaceStore.panes.find((p) => p.runId === "run-b")!.paneId);
    // After activateSplitPane, URL should reflect run-b.
    const writtenUrls = replaceStateSpy.mock.calls.map((c) => String(c[0]));
    const found = writtenUrls.some((u) => u.includes("run=run-b"));
    expect(found).toBe(true);
  });
});

describe("refreshInactivePaneSnapshot (P2-3 polling helper)", () => {
  it("no-op when pane is the active pane", async () => {
    const { deps } = makeDeps();
    registerSplitWorkspaceLifecycle(deps);
    await enterSplitWorkspace({ activeRunId: "run-a" });
    const active = splitWorkspaceStore.panes[0];
    // Snapshot a non-null cachedSnapshot so the helper wouldn't bail on
    // the snapshot check.
    active.cachedSnapshot = {
      run: { id: "run-a", status: "pending" } as never,
      timeline: [],
      tools: [],
      turnUsages: [],
      fetchedAt: 0,
      latestEventTime: 0,
    };
    const loadRunSpy = deps.getSessionStore().loadRun as ReturnType<typeof vi.fn>;
    loadRunSpy.mockClear();
    await refreshInactivePaneSnapshot(active.paneId);
    // Active pane → refresh is a no-op (no loadRun, no fetchSnapshot).
    expect(loadRunSpy).not.toHaveBeenCalled();
  });

  it("no-op when pane id is unknown", async () => {
    const { deps } = makeDeps();
    registerSplitWorkspaceLifecycle(deps);
    await refreshInactivePaneSnapshot("ghost");
    // Should silently bail without throwing.
    expect(splitWorkspaceStore.panes).toHaveLength(0);
  });

  it("triggers snapshot refresh when pane is inactive with a cached snapshot", async () => {
    const { deps } = makeDeps();
    registerSplitWorkspaceLifecycle(deps);
    await enterSplitWorkspace({ activeRunId: "run-a" });
    splitWorkspaceStore.addPane("run-b", { makeActive: false });
    const inactive = splitWorkspaceStore.panes.find((p) => p.runId === "run-b")!;
    inactive.cachedSnapshot = {
      run: { id: "run-b", status: "pending" } as never,
      timeline: [],
      tools: [],
      turnUsages: [],
      fetchedAt: 0,
      latestEventTime: 0,
    };
    // Spy on api.getRun (mocked at module level).
    const apiGetRunSpy = vi.mocked(api.getRun);
    apiGetRunSpy.mockClear();
    await refreshInactivePaneSnapshot(inactive.paneId);
    expect(apiGetRunSpy).toHaveBeenCalledWith("run-b");
  });
});
