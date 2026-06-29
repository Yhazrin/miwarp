import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBootstrapDemandController,
  routeNeedsAttentionBootstrap,
  routeNeedsRunsBootstrap,
  routeNeedsTeamsBootstrap,
} from "./layout-bootstrap-demand";

vi.mock("$lib/stores/attention-queue-store.svelte", () => ({
  attentionQueueStore: {
    reconcile: vi.fn().mockResolvedValue({}),
    loadSnapshot: vi.fn().mockResolvedValue({}),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn(),
  },
}));

vi.mock("./team-subscription.svelte", () => ({
  createTeamSubscription: vi.fn(() => ({ dispose: vi.fn() })),
}));

const { createTeamSubscription } = await import("./team-subscription.svelte");
const { attentionQueueStore } = await import("$lib/stores/attention-queue-store.svelte");

describe("layout-bootstrap-demand route predicates", () => {
  it("runs bootstrap only for chat/explorer/workbench/scheduled routes", () => {
    expect(routeNeedsRunsBootstrap("/chat")).toBe(true);
    expect(routeNeedsRunsBootstrap("/explorer")).toBe(true);
    expect(routeNeedsRunsBootstrap("/workbench")).toBe(true);
    expect(routeNeedsRunsBootstrap("/scheduled-tasks/abc")).toBe(true);
    expect(routeNeedsRunsBootstrap("/settings")).toBe(false);
    expect(routeNeedsRunsBootstrap("/personal")).toBe(false);
  });

  it("teams bootstrap only on /teams", () => {
    expect(routeNeedsTeamsBootstrap("/teams")).toBe(true);
    expect(routeNeedsTeamsBootstrap("/chat")).toBe(false);
  });

  it("attention bootstrap only on /workbench", () => {
    expect(routeNeedsAttentionBootstrap("/workbench")).toBe(true);
    expect(routeNeedsAttentionBootstrap("/chat")).toBe(false);
  });
});

describe("createBootstrapDemandController", () => {
  const teamStore = {
    loadTeams: vi.fn(),
    forceRefresh: vi.fn(),
    handleTeamUpdate: vi.fn(),
    handleTaskUpdate: vi.fn(),
  };
  const runsStore = {
    loadRuns: vi.fn().mockResolvedValue(undefined),
    loadSidebarFavorites: vi.fn().mockResolvedValue(undefined),
    startPoll: vi.fn(() => vi.fn()),
  };
  const sessionFolderStore = {
    load: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts runs + session folders once for chat route", () => {
    const ctl = createBootstrapDemandController({ teamStore, runsStore, sessionFolderStore });
    ctl.ensureForRoute("/chat");
    ctl.ensureForRoute("/chat");
    expect(runsStore.startPoll).toHaveBeenCalledTimes(1);
    expect(runsStore.loadRuns).toHaveBeenCalledTimes(1);
    expect(runsStore.loadSidebarFavorites).toHaveBeenCalledTimes(1);
    expect(sessionFolderStore.load).toHaveBeenCalledTimes(1);
    expect(createTeamSubscription).not.toHaveBeenCalled();
    ctl.dispose();
  });

  it("starts teams subscription on /teams", () => {
    const ctl = createBootstrapDemandController({ teamStore, runsStore, sessionFolderStore });
    ctl.ensureForRoute("/teams");
    expect(createTeamSubscription).toHaveBeenCalledTimes(1);
    ctl.dispose();
  });

  it("reconciles attention queue on /workbench", async () => {
    const ctl = createBootstrapDemandController({ teamStore, runsStore, sessionFolderStore });
    ctl.ensureForRoute("/workbench");
    await Promise.resolve();
    await Promise.resolve();
    expect(attentionQueueStore.reconcile).toHaveBeenCalledTimes(1);
    expect(attentionQueueStore.loadSnapshot).toHaveBeenCalledTimes(1);
    expect(attentionQueueStore.subscribe).toHaveBeenCalledTimes(1);
    ctl.dispose();
    // dispose() unwinds the attention subscription so dev HMR / layout teardown
    // don't leak the listener pinned to a possibly-replaced transport.
    expect(attentionQueueStore.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("does not unsubscribe attention queue if it was never started", () => {
    const ctl = createBootstrapDemandController({ teamStore, runsStore, sessionFolderStore });
    ctl.dispose();
    expect(attentionQueueStore.unsubscribe).not.toHaveBeenCalled();
  });
});
