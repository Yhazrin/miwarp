import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Mock $lib/stores so the controller can be exercised without booting a
// real SessionStore or Tauri transport.
vi.mock("$lib/stores", () => {
  const subscribeCurrentMock = vi.fn();
  const releaseConnectionMock = vi.fn();
  const sessionStoreStub = { id: "session-store" };
  return {
    getEventMiddleware: () => ({
      subscribeCurrent: (runId: string, store: unknown) => {
        subscribeCurrentMock(runId, store);
        if (runId === "") releaseConnectionMock();
      },
    }),
    sessionStore: sessionStoreStub,
    __subscribeCurrentMock: subscribeCurrentMock,
    __releaseConnectionMock: releaseConnectionMock,
  };
});

import { WorkbenchSessionController } from "./workbench-session-controller";
import * as storesModule from "$lib/stores";
import type { TaskRun } from "$lib/types";
import type { WorkbenchProjectSummary } from "./workbench-store.svelte";

const subscribeCurrentMock = (
  storesModule as unknown as {
    __subscribeCurrentMock: Mock<(runId: string, store: unknown) => void>;
  }
).__subscribeCurrentMock;
const releaseConnectionMock = (
  storesModule as unknown as {
    __releaseConnectionMock: Mock<() => void>;
  }
).__releaseConnectionMock;

const projectA: WorkbenchProjectSummary = {
  id: "cwd:/a",
  cwd: "/a",
  label: "A",
  description: "/a",
  sessionCount: 1,
  lastActiveAt: "2024-01-01T00:00:00.000Z",
  status: "idle",
};
const projectB: WorkbenchProjectSummary = {
  id: "cwd:/b",
  cwd: "/b",
  label: "B",
  description: "/b",
  sessionCount: 1,
  lastActiveAt: "2024-02-01T00:00:00.000Z",
  status: "active",
};
const deskRunA: TaskRun = {
  id: "run-desk-a",
  prompt: "p",
  cwd: "/a",
  parent_cwd: "/a",
  agent: "claude",
  status: "stopped",
  started_at: "2024-01-01T00:00:00.000Z",
  last_activity_at: "2024-01-02T00:00:00.000Z",
  run_surface: "project_desk",
  message_count: 1,
  last_message_preview: "hi",
} as TaskRun;
const deskRunB: TaskRun = {
  id: "run-desk-b",
  prompt: "p",
  cwd: "/b",
  parent_cwd: "/b",
  agent: "claude",
  status: "running",
  started_at: "2024-02-01T00:00:00.000Z",
  last_activity_at: "2024-02-02T00:00:00.000Z",
  run_surface: "project_desk",
} as TaskRun;

describe("WorkbenchSessionController", () => {
  let controller: WorkbenchSessionController;

  beforeEach(() => {
    controller = new WorkbenchSessionController();
    subscribeCurrentMock.mockClear();
    releaseConnectionMock.mockClear();
  });

  it("returns same project without re-subscribing when projectId matches", async () => {
    const result = await controller.selectProject(projectA, {
      runs: [deskRunA],
      activeRunByProject: { [projectA.id]: deskRunA.id },
      currentProjectId: projectA.id,
    });
    expect(result.projectId).toBe(projectA.id);
    expect(result.activeRunId).toBe(deskRunA.id);
    expect(result.switchedSubscription).toBe(false);
    expect(result.releasedOwner).toBe(false);
    expect(subscribeCurrentMock).not.toHaveBeenCalled();
  });

  it("releases ownership when target project has no active run", async () => {
    subscribeCurrentMock.mockImplementation((runId) => {
      if (runId === "") releaseConnectionMock();
    });
    const result = await controller.selectProject(null, {
      runs: [deskRunA],
      activeRunByProject: { [projectA.id]: deskRunA.id },
      currentProjectId: projectA.id,
    });
    expect(result.projectId).toBe("");
    expect(result.activeRunId).toBe("");
    expect(result.releasedOwner).toBe(true);
    expect(subscribeCurrentMock).toHaveBeenCalledWith("", storesModule.sessionStore);
    expect(releaseConnectionMock).toHaveBeenCalled();
  });

  it("swaps subscription to new active run when switching projects", async () => {
    const result = await controller.selectProject(projectB, {
      runs: [deskRunA, deskRunB],
      activeRunByProject: { [projectA.id]: deskRunA.id },
      currentProjectId: projectA.id,
    });
    expect(result.projectId).toBe(projectB.id);
    expect(result.activeRunId).toBe(deskRunB.id);
    expect(result.switchedSubscription).toBe(true);
    expect(result.releasedOwner).toBe(false);
    expect(subscribeCurrentMock).toHaveBeenCalledWith(deskRunB.id, storesModule.sessionStore);
  });

  it("bumps generation on every call so async callers can abort stale transitions", async () => {
    expect(controller.generation).toBe(0);
    await controller.selectProject(projectA, {
      runs: [deskRunA],
      activeRunByProject: { [projectA.id]: deskRunA.id },
      currentProjectId: projectA.id,
    });
    const first = controller.generation;
    await controller.selectProject(projectB, {
      runs: [deskRunA, deskRunB],
      activeRunByProject: { [projectA.id]: deskRunA.id },
      currentProjectId: projectA.id,
    });
    expect(controller.generation).toBeGreaterThan(first);
  });

  it("prefers persisted active run over auto-resolution", async () => {
    const result = await controller.selectProject(projectB, {
      runs: [deskRunA, deskRunB],
      activeRunByProject: { [projectB.id]: deskRunA.id /* wrong cwd but id present */ },
      currentProjectId: projectA.id,
    });
    // Persisted run is honored even if its cwd doesn't match — caller may
    // have migrated projects; controller never silently drops a sticky
    // choice without an explicit user click.
    expect(result.activeRunId).toBe(deskRunA.id);
  });
});
