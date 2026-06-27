/**
 * project-selection-store.test.ts — pin the projectCwd / pinnedCwds /
 * removedCwds state machine. Runs in `node` env (vitest default) so we
 * install a localStorage shim AND a minimal EventTarget-shaped window
 * shim before importing the store.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  get length() {
    return this.map.size;
  }
}

/** Minimal Window stand-in: only the EventTarget surface + localStorage
 *  accessor the store needs. Avoids pulling jsdom into the test env. */
function makeWindow(): {
  addEventListener: (t: string, h: EventListenerOrEventListenerObject) => void;
  removeEventListener: (t: string, h: EventListenerOrEventListenerObject) => void;
  dispatchEvent: (e: Event) => boolean;
  localStorage: MemoryStorage;
} {
  const target = new EventTarget();
  return {
    addEventListener: (t, h) => target.addEventListener(t, h),
    removeEventListener: (t, h) => target.removeEventListener(t, h),
    dispatchEvent: (e) => target.dispatchEvent(e),
    localStorage: new MemoryStorage(),
  };
}

const win = makeWindow();
beforeEach(() => {
  win.localStorage.clear();
  (globalThis as unknown as { window: typeof win }).window = win;
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = win.localStorage;
});
afterEach(() => {
  (globalThis as unknown as { window?: unknown }).window = undefined;
  (globalThis as unknown as { localStorage?: unknown }).localStorage = undefined;
});

const mod = await import("./project-selection-store.svelte");
const { projectSelectionStore } = mod;
const { EVT_PROJECT_CHANGED } = await import("$lib/utils/bus-events");

describe("projectSelectionStore.setProjectCwd", () => {
  beforeEach(() => {
    projectSelectionStore.init();
  });
  afterEach(() => {
    projectSelectionStore.dispose();
  });

  it("persists the cwd to LS_PROJECT_CWD on first set", () => {
    projectSelectionStore.setProjectCwd("/Users/me/proj");
    expect(win.localStorage.getItem("ocv:project-cwd")).toBe("/Users/me/proj");
  });

  it("auto-pins a non-root cwd into LS_PINNED_CWDS exactly once", () => {
    projectSelectionStore.setProjectCwd("/Users/me/proj");
    projectSelectionStore.setProjectCwd("/Users/me/proj");
    projectSelectionStore.setProjectCwd("/Users/me/other");
    const raw = win.localStorage.getItem("ocv:pinned-cwds");
    const pinned = raw ? (JSON.parse(raw) as string[]) : [];
    expect(pinned.filter((c) => c === "/Users/me/proj")).toHaveLength(1);
    expect(pinned).toContain("/Users/me/other");
  });

  it("dispatches EVT_PROJECT_CHANGED with the new cwd on every change", () => {
    let last: { cwd: string } | null = null;
    const handler = (e: Event) => {
      last = (e as CustomEvent<{ cwd: string }>).detail;
    };
    win.addEventListener(EVT_PROJECT_CHANGED, handler);
    projectSelectionStore.setProjectCwd("/Users/me/next");
    win.removeEventListener(EVT_PROJECT_CHANGED, handler);
    expect(last).toEqual({ cwd: "/Users/me/next" });
  });

  it("clears LS_PROJECT_CWD when set to empty (All Projects)", () => {
    projectSelectionStore.setProjectCwd("/Users/me/proj");
    expect(win.localStorage.getItem("ocv:project-cwd")).toBe("/Users/me/proj");
    projectSelectionStore.setProjectCwd("");
    expect(win.localStorage.getItem("ocv:project-cwd")).toBeNull();
  });
});

describe("projectSelectionStore.toggleProject / replaceExpanded", () => {
  beforeEach(() => {
    projectSelectionStore.init();
  });
  afterEach(() => {
    projectSelectionStore.dispose();
  });

  it("toggles folder keys in and out of the expanded set", () => {
    projectSelectionStore.toggleProject("/Users/a");
    expect(projectSelectionStore.expandedProjects.has("/Users/a")).toBe(true);
    projectSelectionStore.toggleProject("/Users/a");
    expect(projectSelectionStore.expandedProjects.has("/Users/a")).toBe(false);
  });

  it("replaceExpanded replaces the set contents", () => {
    projectSelectionStore.replaceExpanded(new Set(["/Users/a", "/Users/b"]));
    expect(projectSelectionStore.expandedProjects.size).toBe(2);
    projectSelectionStore.replaceExpanded(new Set(["/Users/c"]));
    expect(projectSelectionStore.expandedProjects.size).toBe(1);
    expect(projectSelectionStore.expandedProjects.has("/Users/c")).toBe(true);
  });
});
