/**
 * layout-bootstrap.test.ts — pin the layout's localStorage / settings helpers
 * that the refactor lifted out of +layout.svelte. Tests run in `node` env
 * (vitest default), so we install a tiny in-memory localStorage shim before
 * importing the module under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  (globalThis as unknown as { window: { screen?: { width: number; height: number } } }).window = {
    screen: { width: 1440, height: 900 },
  };
});
afterEach(() => {
  (globalThis as unknown as { localStorage?: MemoryStorage }).localStorage = undefined;
});

// Import AFTER the shim is installed so the module's top-level reads work.
const bootstrap = await import("./layout-bootstrap");
const {
  createSettingsLoader,
  loadPinnedCwds,
  loadSavedProjectCwd,
  loadSidebarWidth,
  persistSidebarWidth,
  sidebarWidthKey,
} = bootstrap;

const SIDEBAR_PREFIX = "ocv:sidebar-width:";

describe("layout-bootstrap sidebar width", () => {
  it("returns the default when nothing is stored", () => {
    expect(loadSidebarWidth()).toBe(280);
  });

  it("clamps stored values into the [180, 500] range", () => {
    localStorage.setItem(`${SIDEBAR_PREFIX}${sidebarWidthKey()}`, "10");
    expect(loadSidebarWidth()).toBe(180);
    localStorage.setItem(`${SIDEBAR_PREFIX}${sidebarWidthKey()}`, "9999");
    expect(loadSidebarWidth()).toBe(500);
  });

  it("persists a clamped value via persistSidebarWidth", () => {
    persistSidebarWidth(42);
    expect(loadSidebarWidth()).toBe(180);
    persistSidebarWidth(640);
    expect(loadSidebarWidth()).toBe(500);
    persistSidebarWidth(320);
    expect(loadSidebarWidth()).toBe(320);
  });

  it("migrates the legacy unkeyed entry on first read", () => {
    localStorage.setItem("ocv:sidebar-width", "300");
    const width = loadSidebarWidth();
    expect(width).toBe(300);
    expect(localStorage.getItem(`${SIDEBAR_PREFIX}${sidebarWidthKey()}`)).toBe("300");
  });
});

describe("layout-bootstrap project CWD / pinned cwds", () => {
  it("loadSavedProjectCwd returns empty string when unset", () => {
    expect(loadSavedProjectCwd()).toBe("");
  });

  it("loadPinnedCwds returns an empty array when unset / malformed", () => {
    expect(loadPinnedCwds()).toEqual([]);
    localStorage.setItem("ocv:pinned-cwds", "not-json");
    expect(loadPinnedCwds()).toEqual([]);
  });

  it("loadPinnedCwds returns a normalised array when set", () => {
    localStorage.setItem("ocv:pinned-cwds", JSON.stringify(["/Users/a", "/Users/b"]));
    expect(loadPinnedCwds()).toEqual(["/Users/a", "/Users/b"]);
  });
});

describe("createSettingsLoader single-flight", () => {
  it("returns the same promise for concurrent start() calls", () => {
    const loader = createSettingsLoader();
    const p1 = loader.start();
    const p2 = loader.start();
    expect(p1).toBe(p2);
  });

  it("exposes the in-flight promise via promise()", () => {
    const loader = createSettingsLoader();
    expect(loader.promise()).toBeNull();
    const p = loader.start();
    expect(loader.promise()).toBe(p);
  });
});

describe("createSettingsLoader refresh", () => {
  it("returns a fresh promise so callers see a new fetch", () => {
    const loader = createSettingsLoader();
    const first = loader.start();
    const refreshed = loader.refresh();
    expect(refreshed).not.toBe(first);
  });

  it("dedupes concurrent refresh() calls with each other", () => {
    const loader = createSettingsLoader();
    void loader.start();
    const p1 = loader.refresh();
    const p2 = loader.refresh();
    expect(p1).toBe(p2);
  });
});
