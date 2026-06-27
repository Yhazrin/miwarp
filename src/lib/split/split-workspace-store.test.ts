/**
 * SplitWorkspaceStore unit tests — covers v1.0.8 P0 invariants:
 *
 * - max 4 panes (toast + reject)
 * - duplicate runId → activate existing (no new pane)
 * - removePane on the active pane → activates the next; if none remain, exit()
 * - markLoadResult discards stale writes when generation has advanced
 * - setLayoutMode rejects when new mode has fewer slots than current panes
 * - enter()/exit() toggle rightSidebarSuspended and preserve preSplitCwd
 *
 * Adapter and sessionStore are not exercised here — the store is state-only.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SplitWorkspaceStore, MAX_PANES, maxSlotsForLayout } from "./split-workspace-store.svelte";

// Mock debug utils (auto-mocked by vitest config convention)
vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

function makeStore() {
  const store = new SplitWorkspaceStore();
  const toastSpy = vi.fn();
  store.onToast = toastSpy;
  return { store, toastSpy };
}

describe("SplitWorkspaceStore — basics", () => {
  it("addPane requires enabled", () => {
    const { store } = makeStore();
    const result = store.addPane("run-1");
    expect(result).toBeNull();
    expect(store.panes).toHaveLength(0);
  });

  it("enter() enables and suspends sidebar", () => {
    const { store } = makeStore();
    store.enter({ cwd: "/work/proj" });
    expect(store.enabled).toBe(true);
    expect(store.rightSidebarSuspended).toBe(true);
    expect(store.preSplitCwd).toBe("/work/proj");
  });

  it("enter() with activeRunId seeds first pane and makes it active", () => {
    const { store } = makeStore();
    store.enter({ cwd: "/p", activeRunId: "run-1" });
    expect(store.panes).toHaveLength(1);
    expect(store.panes[0].runId).toBe("run-1");
    expect(store.panes[0].runtimeState).toBe("active");
    expect(store.activePaneId).toBe(store.panes[0].paneId);
  });

  it("enter() is idempotent (does not double-add activeRunId)", () => {
    const { store } = makeStore();
    store.enter({ activeRunId: "run-1" });
    store.enter({ activeRunId: "run-1" });
    expect(store.panes).toHaveLength(1);
  });

  it("exit() clears panes and restores sidebar", () => {
    const { store } = makeStore();
    store.enter({ cwd: "/x", activeRunId: "run-1" });
    store.addPane("run-2");
    store.exit();
    expect(store.enabled).toBe(false);
    expect(store.rightSidebarSuspended).toBe(false);
    expect(store.panes).toHaveLength(0);
    expect(store.activePaneId).toBeNull();
    expect(store.preSplitCwd).toBeNull();
  });
});

describe("SplitWorkspaceStore — pane limits & dedup", () => {
  beforeEach(() => {
    // No-op; each test makes its own store.
  });

  it("addPane rejects when at MAX_PANES", () => {
    const { store, toastSpy } = makeStore();
    store.enter();
    for (let i = 0; i < MAX_PANES; i++) store.addPane(`run-${i}`);
    const extra = store.addPane("run-overflow");
    expect(extra).toBeNull();
    expect(store.panes).toHaveLength(MAX_PANES);
    expect(toastSpy).toHaveBeenCalledWith("split_mode_paneLimitReached", "error");
  });

  it("addPane silently respects limit when silent=true", () => {
    const { store, toastSpy } = makeStore();
    store.enter();
    for (let i = 0; i < MAX_PANES; i++) store.addPane(`run-${i}`);
    const extra = store.addPane("run-overflow", { silent: true });
    expect(extra).toBeNull();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("addPane with duplicate runId activates the existing pane (no new entry)", () => {
    const { store, toastSpy } = makeStore();
    store.enter();
    const a = store.addPane("run-1");
    store.addPane("run-2", { makeActive: false });
    expect(store.panes).toHaveLength(2);
    expect(store.activePaneId).toBe(a!.paneId);

    const dup = store.addPane("run-1");
    expect(dup).toBe(a);
    expect(store.panes).toHaveLength(2);
    // The original a is still active (duplicate didn't switch — it confirmed).
    expect(store.activePaneId).toBe(a!.paneId);
    expect(toastSpy).toHaveBeenCalledWith("split_mode_duplicateRun", "info");
  });

  it("addPane silently dedupes without toast", () => {
    const { store, toastSpy } = makeStore();
    store.enter();
    store.addPane("run-1");
    toastSpy.mockClear();
    store.addPane("run-1", { silent: true });
    expect(toastSpy).not.toHaveBeenCalled();
  });
});

describe("SplitWorkspaceStore — removePane & active switching", () => {
  it("removePane on a non-active pane leaves active untouched", () => {
    const { store } = makeStore();
    store.enter();
    store.addPane("run-1");
    const inactive = store.addPane("run-2", { makeActive: false });
    const activeId = store.activePaneId;
    store.removePane(inactive!.paneId);
    expect(store.panes).toHaveLength(1);
    expect(store.activePaneId).toBe(activeId);
  });

  it("removePane on the active pane promotes the next remaining", () => {
    const { store } = makeStore();
    store.enter();
    const a = store.addPane("run-1");
    const b = store.addPane("run-2", { makeActive: false });
    const c = store.addPane("run-3", { makeActive: false });
    expect(store.activePaneId).toBe(a!.paneId);
    store.removePane(a!.paneId);
    expect(store.panes.map((p) => p.runId)).toEqual(["run-2", "run-3"]);
    // First remaining becomes active.
    expect(store.activePaneId).toBe(b!.paneId);
    expect(b!.runtimeState).toBe("active");
    expect(c!.runtimeState).toBe("inactive");
  });

  it("removePane on the last pane triggers exit()", () => {
    const { store } = makeStore();
    store.enter({ activeRunId: "run-1" });
    const only = store.panes[0];
    store.removePane(only.paneId);
    expect(store.enabled).toBe(false);
    expect(store.rightSidebarSuspended).toBe(false);
    expect(store.panes).toHaveLength(0);
  });

  it("removePane bumps loadGeneration on the leaving pane", () => {
    const { store } = makeStore();
    store.enter();
    const p = store.addPane("run-1");
    const genBefore = p!.loadGeneration; // 1 (initial)
    store.removePane(p!.paneId);
    // removePane invalidates any in-flight async work for the leaving pane
    // by bumping its loadGeneration. Pane is no longer in store.panes, but
    // the captured ref still carries the bumped gen.
    expect(p!.loadGeneration).toBe(genBefore + 1);
  });

  it("setActive moves active and demotes previous", () => {
    const { store } = makeStore();
    store.enter();
    const a = store.addPane("run-1");
    const b = store.addPane("run-2", { makeActive: false });
    expect(a!.runtimeState).toBe("active");
    expect(b!.runtimeState).toBe("inactive");
    store.setActive(b!.paneId);
    expect(a!.runtimeState).toBe("inactive");
    expect(b!.runtimeState).toBe("active");
    expect(store.activePaneId).toBe(b!.paneId);
  });

  it("setActive is a no-op for unknown paneId", () => {
    const { store } = makeStore();
    store.enter();
    const a = store.addPane("run-1");
    const originalActive = store.activePaneId;
    store.setActive("nope");
    expect(store.activePaneId).toBe(originalActive);
    expect(a!.runtimeState).toBe("active");
  });
});

describe("SplitWorkspaceStore — generation guard", () => {
  it("markLoadResult discards writes when generation has advanced", () => {
    const { store } = makeStore();
    store.enter();
    const p = store.addPane("run-1");
    const capturedGen = p!.loadGeneration;
    // Simulate: another caller advanced the gen (e.g. switchActive or cancel).
    p!.loadGeneration++;
    store.markLoadResult(p!.paneId, capturedGen, {
      ok: true,
      snapshot: null,
      loadState: "ready",
    });
    // loadState is still 'loading' from the original addPane call.
    expect(p!.loadState).toBe("loading");
    expect(p!.errorState).toBeNull();
  });

  it("markLoadResult accepts writes when generation matches", () => {
    const { store } = makeStore();
    store.enter();
    const p = store.addPane("run-1");
    const capturedGen = p!.loadGeneration;
    store.markLoadResult(p!.paneId, capturedGen, {
      ok: true,
      snapshot: null,
      loadState: "ready",
    });
    expect(p!.loadState).toBe("ready");
    expect(p!.errorState).toBeNull();
  });

  it("markLoadResult records error when generation matches", () => {
    const { store } = makeStore();
    store.enter();
    const p = store.addPane("run-1");
    const capturedGen = p!.loadGeneration;
    store.markLoadResult(p!.paneId, capturedGen, {
      ok: false,
      error: { code: "load_failed", message: "boom" },
    });
    expect(p!.loadState).toBe("error");
    expect(p!.errorState).toEqual({ code: "load_failed", message: "boom" });
  });

  it("markLoadResult silently no-ops on unknown paneId", () => {
    const { store } = makeStore();
    store.enter();
    store.markLoadResult("ghost", 1, {
      ok: true,
      snapshot: null,
      loadState: "ready",
    });
    expect(store.panes).toHaveLength(0);
  });
});

describe("SplitWorkspaceStore — layout mode", () => {
  it("maxSlotsForLayout returns correct counts", () => {
    expect(maxSlotsForLayout("single")).toBe(1);
    expect(maxSlotsForLayout("dual")).toBe(2);
    expect(maxSlotsForLayout("triple")).toBe(3);
    expect(maxSlotsForLayout("quad")).toBe(4);
  });

  it("setLayoutMode rejects when new mode has fewer slots than panes", () => {
    const { store, toastSpy } = makeStore();
    store.enter();
    store.addPane("run-1");
    store.addPane("run-2");
    store.setLayoutMode("single");
    expect(store.layoutMode).toBe("dual"); // unchanged
    expect(toastSpy).toHaveBeenCalledWith("split_mode_layoutWouldHide", "error");
  });

  it("setLayoutMode accepts when new mode has enough slots", () => {
    const { store } = makeStore();
    store.enter();
    store.addPane("run-1");
    store.setLayoutMode("dual");
    expect(store.layoutMode).toBe("dual");
  });
});

describe("SplitWorkspaceStore — active pane switching on add", () => {
  it("addPane demotes previous active pane when adding a new active pane", () => {
    const { store } = makeStore();
    store.enter();
    const first = store.addPane("run-1");
    const second = store.addPane("run-2");
    expect(first?.runtimeState).toBe("inactive");
    expect(second?.runtimeState).toBe("active");
    expect(store.activePaneId).toBe(second?.paneId);
  });

  it("addPane with makeActive false keeps current active pane", () => {
    const { store } = makeStore();
    store.enter({ activeRunId: "run-1" });
    const activeId = store.activePaneId;
    const second = store.addPane("run-2", { makeActive: false });
    expect(second?.runtimeState).toBe("inactive");
    expect(store.activePaneId).toBe(activeId);
    expect(store.panes.find((p) => p.paneId === activeId)?.runtimeState).toBe("active");
  });
});

describe("SplitWorkspaceStore — toast sink", () => {
  it("onToast null is safe (toasts become no-ops)", () => {
    const store = new SplitWorkspaceStore();
    store.enter();
    expect(() => store.addPane("run-1")).not.toThrow();
  });
});

describe("SplitWorkspaceStore — switchGeneration (P0-1)", () => {
  it("starts at 0", () => {
    const { store } = makeStore();
    expect(store.switchGeneration).toBe(0);
  });

  it("setActive bumps switchGeneration when active pane changes", () => {
    const { store } = makeStore();
    store.enter();
    store.addPane("run-1");
    const b = store.addPane("run-2", { makeActive: false });
    const before = store.switchGeneration;
    store.setActive(b!.paneId);
    expect(store.switchGeneration).toBe(before + 1);
  });

  it("setActive on the same pane is a no-op for switchGeneration", () => {
    const { store } = makeStore();
    store.enter();
    const a = store.addPane("run-1");
    const before = store.switchGeneration;
    store.setActive(a!.paneId);
    expect(store.switchGeneration).toBe(before);
  });

  it("removePane bumps switchGeneration", () => {
    const { store } = makeStore();
    store.enter();
    store.addPane("run-1");
    const b = store.addPane("run-2", { makeActive: false });
    const before = store.switchGeneration;
    store.removePane(b!.paneId);
    expect(store.switchGeneration).toBe(before + 1);
  });

  it("exit() bumps switchGeneration", () => {
    const { store } = makeStore();
    store.enter({ activeRunId: "run-1" });
    const before = store.switchGeneration;
    store.exit();
    expect(store.switchGeneration).toBe(before + 1);
  });

  it("setActive on unknown paneId does NOT bump switchGeneration", () => {
    const { store } = makeStore();
    store.enter();
    store.addPane("run-1");
    const before = store.switchGeneration;
    store.setActive("ghost");
    expect(store.switchGeneration).toBe(before);
  });

  it("exit() on a non-enabled store does NOT bump switchGeneration", () => {
    const { store } = makeStore();
    const before = store.switchGeneration;
    store.exit();
    expect(store.switchGeneration).toBe(before);
  });
});
