/**
 * Tests for the explorer-tree-store deadlock fix.
 *
 * Verifies:
 *   1. Root directory read failures surface `treeError` (never a fake empty list).
 *   2. Folder expansion failures set `loadState="error"` with `loadError`, and the
 *      node is NOT marked loaded (no false "empty directory" rendering).
 *   3. `retryFolder()` clears the error and re-issues the IPC.
 *
 * Env: node (default — no DOM required for the store logic itself).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// `vi.mock` is hoisted above imports; the mock factory cannot reference
// top-level `vi.fn()` values directly. Hoist them explicitly with vi.hoisted.
const { apiMocks } = vi.hoisted(() => ({
  apiMocks: { listDirectory: vi.fn() },
}));

vi.mock("$lib/api", () => apiMocks);
vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

import { ExplorerTreeStore, entriesToNodes } from "../explorer-tree-store.svelte";

describe("ExplorerTreeStore — load error surfacing", () => {
  beforeEach(() => {
    apiMocks.listDirectory.mockReset();
  });

  it("sets treeError on root load failure and does NOT fake an empty list", async () => {
    apiMocks.listDirectory.mockRejectedValueOnce(new Error("permission denied"));
    const store = new ExplorerTreeStore();

    await store.loadRootTree("/home/user/project");

    expect(store.treeError).toBe("permission denied");
    expect(store.fileTree).toEqual([]);
    expect(store.treeLoading).toBe(false);
  });

  it("clears treeError on a successful reload after a previous failure", async () => {
    const store = new ExplorerTreeStore();
    apiMocks.listDirectory.mockRejectedValueOnce(new Error("flake"));
    await store.loadRootTree("/home/user/project");
    expect(store.treeError).toBe("flake");

    apiMocks.listDirectory.mockResolvedValueOnce({
      entries: [
        { name: "src", is_dir: true, size: 0 },
        { name: "README.md", is_dir: false, size: 12 },
      ],
    });
    await store.loadRootTree("/home/user/project");

    expect(store.treeError).toBeNull();
    expect(store.fileTree).toHaveLength(2);
  });

  it("marks folder as loadState=error with loadError on expansion failure; never reports empty", async () => {
    const store = new ExplorerTreeStore();
    apiMocks.listDirectory.mockResolvedValueOnce({
      entries: [{ name: "secrets", is_dir: true, size: 0 }],
    });
    await store.loadRootTree("/home/user/project");
    const folder = store.fileTree[0];
    expect(folder.loadState).toBe("idle");

    apiMocks.listDirectory.mockRejectedValueOnce(new Error("access denied"));
    await store.toggleFolder(folder);

    expect(folder.loadState).toBe("error");
    expect(folder.loadError).toBe("access denied");
    expect(folder.loaded).toBe(false); // back-compat: never silently marked loaded
    expect(folder.expanded).toBe(false); // never silently expanded
    expect(folder.children).toEqual([]); // never silently populated
  });

  it("retryFolder() clears the error and re-issues the IPC; success path clears the marker", async () => {
    const store = new ExplorerTreeStore();
    apiMocks.listDirectory.mockResolvedValueOnce({
      entries: [{ name: "secrets", is_dir: true, size: 0 }],
    });
    await store.loadRootTree("/home/user/project");
    const folder = store.fileTree[0];

    apiMocks.listDirectory.mockRejectedValueOnce(new Error("flake"));
    await store.toggleFolder(folder);
    expect(folder.loadState).toBe("error");

    apiMocks.listDirectory.mockResolvedValueOnce({
      entries: [{ name: "key.txt", is_dir: false, size: 5 }],
    });
    await store.retryFolder(folder);

    expect(folder.loadState).toBe("ready");
    expect(folder.loaded).toBe(true);
    expect(folder.loadError).toBeUndefined();
    expect(folder.children).toHaveLength(1);
    expect(apiMocks.listDirectory).toHaveBeenCalledTimes(3);
  });

  it("ignores re-toggles while a folder load is in flight", async () => {
    const store = new ExplorerTreeStore();
    apiMocks.listDirectory.mockResolvedValueOnce({
      entries: [{ name: "src", is_dir: true, size: 0 }],
    });
    await store.loadRootTree("/home/user/project");
    const folder = store.fileTree[0];

    // First toggle kicks off the load; do not resolve yet.
    let resolveList!: (v: {
      entries: Array<{ name: string; is_dir: boolean; size: number }>;
    }) => void;
    apiMocks.listDirectory.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    const firstToggle = store.toggleFolder(folder);
    expect(folder.loadState).toBe("loading");

    // Second concurrent toggle must NOT issue a new IPC (only one in flight at a time).
    const secondToggle = store.toggleFolder(folder);
    expect(apiMocks.listDirectory).toHaveBeenCalledTimes(2);

    resolveList({ entries: [{ name: "a.ts", is_dir: false, size: 1 }] });
    await firstToggle;
    await secondToggle;

    expect(folder.loadState).toBe("ready");
    expect(apiMocks.listDirectory).toHaveBeenCalledTimes(2);
  });
});

describe("entriesToNodes (pure helper)", () => {
  it("seeds loadState='idle' on every row", () => {
    const nodes = entriesToNodes(
      [
        { name: "src", is_dir: true, size: 0 },
        { name: "a.txt", is_dir: false, size: 12 },
      ],
      "/root",
      0,
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[0].loadState).toBe("idle");
    expect(nodes[1].loadState).toBe("idle");
  });
});
