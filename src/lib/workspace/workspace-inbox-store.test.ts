import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/api", () => ({
  listRunsLite: vi.fn(),
  getGitSummary: vi.fn(),
}));

import * as api from "$lib/api";
import { EVT_RUNS_CHANGED } from "$lib/utils/bus-events";
import { WorkspaceInboxStore } from "./workspace-inbox-store.svelte";

const mockListRunsLite = vi.mocked(api.listRunsLite);
const mockGetGitSummary = vi.mocked(api.getGitSummary);

function makeRun(id: string, cwd: string) {
  return {
    id,
    prompt: "hello",
    cwd,
    agent: "claude",
    auth_mode: "cli",
    status: "completed" as const,
    started_at: "2024-06-01T00:00:00Z",
    execution_path: "session_actor" as const,
  };
}

describe("WorkspaceInboxStore.refreshRuns single-flight", () => {
  beforeEach(() => {
    mockListRunsLite.mockReset();
  });

  it("dedupes concurrent refresh calls", async () => {
    let resolve!: (value: ReturnType<typeof makeRun>[]) => void;
    mockListRunsLite.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );

    const store = new WorkspaceInboxStore();
    const first = store.refreshRuns();
    const second = store.refreshRuns();

    expect(mockListRunsLite).toHaveBeenCalledTimes(1);
    resolve([makeRun("r1", "/project")]);
    await Promise.all([first, second]);
    expect(store.runs).toHaveLength(1);
  });

  it("stores error on failure", async () => {
    mockListRunsLite.mockRejectedValue(new Error("ipc down"));
    const store = new WorkspaceInboxStore();
    await store.refreshRuns();
    expect(store.error).toBe("ipc down");
  });
});

describe("WorkspaceInboxStore.ensureGitSummary", () => {
  beforeEach(() => {
    mockGetGitSummary.mockReset();
  });

  it("caches git summary per cwd", async () => {
    mockGetGitSummary.mockResolvedValue({
      branch: "main",
      files: [],
      total_files: 0,
      total_insertions: 0,
      total_deletions: 0,
    });

    const store = new WorkspaceInboxStore();
    await store.ensureGitSummary("/project");
    await store.ensureGitSummary("/project");

    expect(mockGetGitSummary).toHaveBeenCalledTimes(1);
    expect(store.gitSnapshot("/project")).toMatchObject({
      branch: "main",
      isClean: true,
      loading: false,
      error: null,
    });
  });

  it("records error instead of throwing for non-repo cwd", async () => {
    mockGetGitSummary.mockRejectedValue(new Error("not a git repository"));
    const store = new WorkspaceInboxStore();
    await store.ensureGitSummary("/project");

    expect(store.gitSnapshot("/project")).toMatchObject({
      error: "not a git repository",
      loading: false,
    });
  });

  it("skips git fetch for empty cwd", async () => {
    const store = new WorkspaceInboxStore();
    await store.ensureGitSummary("");
    expect(mockGetGitSummary).not.toHaveBeenCalled();
    expect(store.gitSnapshot("")).toBeNull();
  });
});

describe("WorkspaceInboxStore EVT_RUNS_CHANGED", () => {
  beforeEach(() => {
    mockListRunsLite.mockReset();
    mockListRunsLite.mockResolvedValue([]);
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers runs-changed listener on init", async () => {
    const store = new WorkspaceInboxStore();
    store.init();
    expect(window.addEventListener).toHaveBeenCalledWith(EVT_RUNS_CHANGED, expect.any(Function));
    store.dispose();
    expect(window.removeEventListener).toHaveBeenCalledWith(EVT_RUNS_CHANGED, expect.any(Function));
  });
});
