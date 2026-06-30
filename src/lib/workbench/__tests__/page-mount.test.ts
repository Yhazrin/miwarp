/**
 * Regression test for the workbench `/+page.svelte` mount effect.
 *
 * The page runs `workbenchStore.refresh(...)` inside a `$effect` that
 * reads `workspacesStore.list` and the layout runs cache. If those
 * reactive reads are NOT wrapped in `untrack` (or migrated to
 * `onMount`), every subsequent store update — e.g. `runsSidebarStore.runs`
 * getting a new run appended — re-fires the effect and triggers a
 * redundant `list_runs_lite` IPC + project rebuild.
 *
 * This test mounts a harness that mirrors the production `$effect`
 * block, then asserts that mutating the runs cache (and the workspaces
 * list) AFTER mount does NOT cause additional `refresh()` calls.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount } from "svelte";
import type { TaskRun } from "$lib/types";
import HarnessRoot from "./HarnessRoot.svelte";
import { workspacesStore } from "$lib/stores/workspaces-store.svelte";
import { createRunsCacheState } from "./runs-cache-state.svelte";

// Stub the heavy child components pulled in transitively by
// workbench-store.svelte so the harness can mount without booting
// SessionStore / attention queue / DBG.
vi.mock("$lib/stores", () => ({
  sessionStore: {},
}));

vi.mock("$lib/stores/attention-queue-store.svelte", () => ({
  attentionQueueStore: { enqueue: vi.fn() },
}));

vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

// Mock the workbench store BEFORE importing HarnessRoot so the harness
// picks up the stubbed `refresh`.
const { refreshSpy } = vi.hoisted(() => ({
  refreshSpy: vi.fn(async () => undefined),
}));

vi.mock("$lib/workbench/workbench-store.svelte", () => ({
  workbenchStore: { refresh: refreshSpy },
}));

function makeRun(over: Partial<TaskRun> = {}): TaskRun {
  return {
    id: "run-1",
    prompt: "p",
    cwd: "/a",
    parent_cwd: "/a",
    agent: "claude",
    status: "running",
    started_at: "2024-01-01T00:00:00.000Z",
    run_surface: "project_desk",
    ...over,
  } as TaskRun;
}

async function flush() {
  // Two ticks: one for the $effect scheduler to register, one for the
  // async IIFE inside the effect to call refresh().
  await new Promise<void>((r) => setTimeout(r, 0));
  await new Promise<void>((r) => setTimeout(r, 0));
  await new Promise<void>((r) => setTimeout(r, 0));
}

describe("workbench +page.svelte — mount effect fires only once", () => {
  let target: HTMLDivElement | null = null;
  let instance: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    refreshSpy.mockClear();
    // Start every test from a clean, empty workspaces list so the
    // effect's first reactive read is deterministic.
    workspacesStore.list = [];
  });

  afterEach(() => {
    if (instance) {
      unmount(instance);
      instance = null;
    }
    target?.remove();
    target = null;
  });

  it("calls refresh() exactly once on mount", async () => {
    const cache = createRunsCacheState([makeRun()]);
    target = document.createElement("div");
    document.body.appendChild(target);

    instance = mount(HarnessRoot, {
      target,
      props: {
        cache,
        whenReady: async () => cache.runs,
      },
    });
    await flush();

    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT re-fire refresh() when runsSidebarStore.runs is updated after mount", async () => {
    const cache = createRunsCacheState([makeRun()]);
    target = document.createElement("div");
    document.body.appendChild(target);

    instance = mount(HarnessRoot, {
      target,
      props: {
        cache,
        whenReady: async () => cache.runs,
      },
    });
    await flush();
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    // Simulate the sidebar receiving a new run (push-based update).
    cache.setRuns([
      makeRun(),
      makeRun({ id: "run-2", last_activity_at: "2024-02-01T00:00:00.000Z" }),
    ]);
    await flush();
    await flush();

    // No cascade: the effect was untracked and only ran at mount.
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT re-fire refresh() when workspacesStore.list is updated after mount", async () => {
    const cache = createRunsCacheState([makeRun()]);
    target = document.createElement("div");
    document.body.appendChild(target);

    instance = mount(HarnessRoot, {
      target,
      props: {
        cache,
        whenReady: async () => cache.runs,
      },
    });
    await flush();
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    // Simulate the layout hydrating the workspaces list after mount.
    workspacesStore.list = [{ cwd: "/a", label: "alpha", isUncategorized: false }];
    await flush();
    await flush();

    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });
});
