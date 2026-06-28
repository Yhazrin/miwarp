/**
 * Tests for the FilePreviewPane loading-state-machine deadlock fix.
 *
 * Covers:
 *   1. Pane stays mounted across a successful load; the parent can re-issue a path
 *      and onLoaded fires for each one (no stuck Spinner).
 *   2. Switching path mid-load: the older response is discarded by loadSeq and
 *      does NOT clobber the newer file's state.
 *   3. Bumping `reloadToken` triggers a fresh IPC without changing the path.
 *   4. Empty path shows an empty state (no Spinner).
 *
 * Implementation note: Svelte 5's `mount()` is imperative; props are passed at
 * construction. We mount a `Harness.svelte` wrapper that takes a `$state`-
 * backed record (via `harness-state.svelte.ts`); tests call `setProps` to
 * mutate the record and exercise the SAME pane across prop changes — the
 * exact production code path that previously deadlocked.
 *
 * Env: jsdom — Svelte 5 components need a DOM root to mount against.
 */
/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { mount, unmount } from "svelte";

// `vi.mock` is hoisted above imports; the mock factory cannot reference
// top-level `vi.fn()` values directly. Hoist them explicitly with vi.hoisted.
const { apiMocks } = vi.hoisted(() => ({
  apiMocks: {
    readTextFile: vi.fn(),
    readFileBase64: vi.fn(),
    statTextFile: vi.fn(),
    writeTextFile: vi.fn(),
    getGitDiff: vi.fn(),
  },
}));

vi.mock("$lib/api", () => apiMocks);
vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));
// Stub theme-store so its eager `new ThemeStore()` singleton doesn't crash
// in jsdom (matchMedia is absent). The pane itself never reads theme state
// directly; this just neutralises the transitive import.
vi.mock("$lib/stores/theme-store.svelte", () => ({
  themeStore: { mode: "system", effectiveMode: "light", isDark: false },
}));

import Harness from "./Harness.svelte";
import { createHarnessState, type HarnessHandle } from "./harness-state.svelte";

beforeAll(() => {
  // jsdom needs an origin for localStorage; perf utilities call the bare
  // `localStorage` identifier during HighlightedCode's eager module init.
  // Install a minimal in-memory shim on BOTH `window` and `globalThis` so
  // either access path resolves to the same store.
  const store = new Map<string, string>();
  const shim: Storage = {
    length: 0,
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => {
      store.delete(k);
    },
    setItem: (k, v) => {
      store.set(k, String(v));
    },
  };
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      writable: true,
      value: shim,
    });
  }
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: shim,
  });
});

beforeEach(() => {
  for (const fn of Object.values(apiMocks)) fn.mockReset();
  // Default stat returns 0 so we always go through the normal read path.
  apiMocks.statTextFile.mockResolvedValue(0);
  apiMocks.getGitDiff.mockResolvedValue("");
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface MountedHarness {
  target: HTMLDivElement;
  instance: ReturnType<typeof mount>;
  handle: HarnessHandle;
}

function mountHarness(
  initial: Record<string, unknown>,
  callbacks: {
    onLoaded?: (p: string) => void;
    onLoadFailed?: (p: string, err: string) => void;
  } = {},
): MountedHarness {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const handle = createHarnessState(initial);
  const instance = mount(Harness, {
    target,
    props: {
      state: handle.state,
      onLoaded: callbacks.onLoaded,
      onLoadFailed: callbacks.onLoadFailed,
    },
  });
  return { target, instance, handle };
}

async function flush() {
  // Multiple ticks to give Svelte 5's $effect scheduler + IPC promises
  // (readTextFile is awaited inside loadPreview) time to settle.
  await new Promise<void>((r) => setTimeout(r, 0));
  await new Promise<void>((r) => setTimeout(r, 0));
  await new Promise<void>((r) => setTimeout(r, 0));
}

describe("FilePreviewPane — always-mounted contract", () => {
  it("renders the pane once on mount, fires onLoaded exactly once, and stays mounted across prop changes", async () => {
    apiMocks.readTextFile.mockResolvedValue("hello world");

    const onLoaded = vi.fn();
    const onLoadFailed = vi.fn();
    const h = mountHarness(
      {
        cwd: "/workspace",
        path: "/workspace/file.txt",
        mode: "preview",
        editable: false,
        isRemote: false,
        scopeKey: "/workspace",
        reloadToken: 0,
      },
      { onLoaded, onLoadFailed },
    );
    await flush();

    expect(apiMocks.readTextFile).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledWith("/workspace/file.txt");
    expect(onLoadFailed).not.toHaveBeenCalled();

    // Switch to another file: the SAME pane stays mounted and re-issues IPC.
    // This is the central anti-deadlock invariant — the pane is NEVER swapped
    // out for a Spinner mid-load.
    apiMocks.readTextFile.mockResolvedValueOnce("other content");
    h.handle.setProps({ path: "/workspace/other.txt" });
    await flush();

    expect(apiMocks.readTextFile).toHaveBeenCalledTimes(2);
    expect(apiMocks.readTextFile).toHaveBeenLastCalledWith("/workspace/other.txt", "/workspace");
    expect(onLoaded).toHaveBeenCalledTimes(2);
    expect(onLoaded).toHaveBeenLastCalledWith("/workspace/other.txt");

    unmount(h.instance);
    h.target.remove();
  });

  it("discards stale responses when switching files mid-load (loadSeq)", async () => {
    // First call resolves slowly, second resolves fast. We expect the
    // slow response for the OLD path to be discarded — onLoaded must only
    // fire for the current path.
    let resolveSlow!: (v: string) => void;
    apiMocks.readTextFile.mockImplementationOnce(
      () => new Promise((resolve) => (resolveSlow = resolve)),
    );
    apiMocks.readTextFile.mockResolvedValueOnce("new content");

    const onLoaded = vi.fn();
    const onLoadFailed = vi.fn();
    const h = mountHarness(
      {
        cwd: "/workspace",
        path: "/workspace/old.txt",
        mode: "preview",
        editable: false,
        isRemote: false,
        scopeKey: "/workspace",
        reloadToken: 0,
      },
      { onLoaded, onLoadFailed },
    );
    await flush();
    expect(apiMocks.readTextFile).toHaveBeenCalledTimes(1);

    // Switch path while the first load is still in flight.
    h.handle.setProps({ path: "/workspace/new.txt" });
    await flush();

    // New load has fired and finished.
    expect(apiMocks.readTextFile).toHaveBeenCalledTimes(2);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenLastCalledWith("/workspace/new.txt");

    // Now resolve the stale slow promise: it must NOT trigger another onLoaded,
    // because loadSeq was bumped when the path changed.
    resolveSlow("stale content");
    await flush();
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenLastCalledWith("/workspace/new.txt");

    unmount(h.instance);
    h.target.remove();
  });

  it("bumping reloadToken triggers a fresh IPC without changing path", async () => {
    apiMocks.readTextFile.mockResolvedValueOnce("v1");
    apiMocks.readTextFile.mockRejectedValueOnce(new Error("disk gone"));
    apiMocks.readTextFile.mockResolvedValueOnce("v2");

    const onLoaded = vi.fn();
    const onLoadFailed = vi.fn();

    const h = mountHarness(
      {
        cwd: "/workspace",
        path: "/workspace/file.txt",
        mode: "preview",
        editable: false,
        isRemote: false,
        scopeKey: "/workspace",
        reloadToken: 0,
      },
      { onLoaded, onLoadFailed },
    );
    await flush();
    expect(apiMocks.readTextFile).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledWith("/workspace/file.txt");

    // First retry: bump token, the $effect re-fires.
    h.handle.setProps({ reloadToken: 1 });
    await flush();
    expect(apiMocks.readTextFile).toHaveBeenCalledTimes(2);
    expect(onLoadFailed).toHaveBeenCalledTimes(1);
    expect(onLoadFailed).toHaveBeenLastCalledWith("/workspace/file.txt", "Error: disk gone");

    // Second retry: token bumps again, success.
    h.handle.setProps({ reloadToken: 2 });
    await flush();
    expect(apiMocks.readTextFile).toHaveBeenCalledTimes(3);
    expect(onLoaded).toHaveBeenCalledTimes(2);
    expect(onLoaded).toHaveBeenLastCalledWith("/workspace/file.txt");

    unmount(h.instance);
    h.target.remove();
  });

  it("in-pane Retry button triggers a fresh IPC after a load failure", async () => {
    apiMocks.readTextFile.mockRejectedValueOnce(new Error("disk gone"));
    apiMocks.readTextFile.mockResolvedValueOnce("v2");

    const onLoaded = vi.fn();
    const onLoadFailed = vi.fn();
    const h = mountHarness(
      {
        cwd: "/workspace",
        path: "/workspace/file.txt",
        mode: "preview",
        editable: false,
        isRemote: false,
        scopeKey: "/workspace",
        reloadToken: 0,
      },
      { onLoaded, onLoadFailed },
    );
    await flush();
    expect(apiMocks.readTextFile).toHaveBeenCalledTimes(1);
    expect(onLoadFailed).toHaveBeenCalledTimes(1);

    // The pane surfaces a Retry button in its error overlay. Clicking it must
    // bump retryCounter and re-fire the IPC — without the parent being involved.
    const retryButton = Array.from(h.target.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Retry",
    );
    expect(retryButton).toBeDefined();
    retryButton?.click();
    await flush();

    expect(apiMocks.readTextFile).toHaveBeenCalledTimes(2);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledWith("/workspace/file.txt");

    unmount(h.instance);
    h.target.remove();
  });

  it("renders the empty state for an empty path instead of a Spinner (and issues no IPC)", async () => {
    const onLoaded = vi.fn();
    const onLoadFailed = vi.fn();
    const h = mountHarness(
      {
        cwd: "/workspace",
        path: "",
        mode: "preview",
        editable: false,
        isRemote: false,
        scopeKey: "/workspace",
        reloadToken: 0,
      },
      { onLoaded, onLoadFailed },
    );
    await flush();

    expect(apiMocks.readTextFile).not.toHaveBeenCalled();
    expect(onLoaded).not.toHaveBeenCalled();
    // The pane renders the filesPanel_noPreviewSelected text as the empty-state hint.
    // This is the replacement for the previous "stuck Spinner" bug.
    expect(h.target.textContent ?? "").toMatch(/Select a file/i);

    unmount(h.instance);
    h.target.remove();
  });
});
