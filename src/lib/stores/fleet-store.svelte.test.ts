/**
 * FleetStore unit tests (v1.2.0).
 *
 * Covers: filter derivation, optimistic stop update, refresh error path.
 * Live-update WS behavior is exercised end-to-end via a live web_server
 * (out of scope for unit tests).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("$lib/api", () => ({
  listFleet: vi.fn(),
  getFleetMetrics: vi.fn(),
  getFleetMember: vi.fn(),
  stopFleetMember: vi.fn(),
  sendToFleetMember: vi.fn(),
}));

vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

import { FleetStore } from "./fleet-store.svelte";
import * as api from "$lib/api";

const sampleMembers = [
  {
    id: "a",
    agent: "claude",
    status: "running" as const,
    cwd: "/home/u/proj-foo",
    startedAt: "2026-06-23T00:00:00Z",
    lastActivityAt: "2026-06-23T00:00:00Z",
    currentTaskPreview: "fix login bug",
    metrics: {
      uptimeSecs: 100,
      toolCalls: 0,
      tokensUsed: 0,
      costUsdEstimate: 0,
      messageCount: 0,
    },
  },
  {
    id: "b",
    agent: "codex",
    status: "idle" as const,
    cwd: "/home/u/proj-bar",
    startedAt: "2026-06-23T00:00:01Z",
    lastActivityAt: "2026-06-23T00:00:01Z",
    currentTaskPreview: "refactor API",
    metrics: {
      uptimeSecs: 200,
      toolCalls: 0,
      tokensUsed: 0,
      costUsdEstimate: 0,
      messageCount: 0,
    },
  },
  {
    id: "c",
    agent: "claude",
    status: "error" as const,
    cwd: "/home/u/proj-baz",
    startedAt: "2026-06-23T00:00:02Z",
    lastActivityAt: "2026-06-23T00:00:02Z",
    currentTaskPreview: "deploy to prod",
    metrics: {
      uptimeSecs: 50,
      toolCalls: 0,
      tokensUsed: 0,
      costUsdEstimate: 0,
      messageCount: 0,
    },
  },
];

describe("FleetStore", () => {
  let store: FleetStore;

  beforeEach(() => {
    store = new FleetStore();
    vi.mocked(api.listFleet).mockReset();
    vi.mocked(api.getFleetMetrics).mockReset();
    vi.mocked(api.getFleetMember).mockReset();
    vi.mocked(api.stopFleetMember).mockReset();
  });

  describe("refresh", () => {
    it("loads members and metrics on success", async () => {
      vi.mocked(api.listFleet).mockResolvedValue(sampleMembers);
      vi.mocked(api.getFleetMetrics).mockResolvedValue({
        total: 3,
        byStatus: { running: 1, idle: 1, error: 1 },
        byAgent: { claude: 2, codex: 1 },
        totalTokensToday: 0,
        totalCostTodayUsd: 0,
      });

      await store.refresh();

      expect(store.members).toHaveLength(3);
      expect(store.metrics?.total).toBe(3);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it("captures error and clears loading on failure", async () => {
      vi.mocked(api.listFleet).mockRejectedValue(new Error("boom"));
      vi.mocked(api.getFleetMetrics).mockResolvedValue({
        total: 0,
        byStatus: {},
        byAgent: {},
        totalTokensToday: 0,
        totalCostTodayUsd: 0,
      });

      await store.refresh();

      expect(store.error).toContain("boom");
      expect(store.loading).toBe(false);
    });
  });

  describe("filteredMembers", () => {
    beforeEach(() => {
      store.members = sampleMembers;
    });

    it("returns all when filters are defaults", () => {
      expect(store.filteredMembers).toHaveLength(3);
    });

    it("filters by status", () => {
      store.filters.status = "running";
      expect(store.filteredMembers.map((m) => m.id)).toEqual(["a"]);
    });

    it("filters by agent", () => {
      store.filters.agent = "codex";
      expect(store.filteredMembers.map((m) => m.id)).toEqual(["b"]);
    });

    it("filters by search term across id/cwd/preview", () => {
      store.filters.search = "deploy";
      expect(store.filteredMembers.map((m) => m.id)).toEqual(["c"]);
    });

    it("combines all filters", () => {
      store.filters.agent = "claude";
      store.filters.status = "error";
      store.filters.search = "baz";
      expect(store.filteredMembers).toHaveLength(1);
    });
  });

  describe("availableAgents", () => {
    it("returns distinct sorted agent names", () => {
      store.members = sampleMembers;
      expect(store.availableAgents).toEqual(["claude", "codex"]);
    });

    it("returns empty array when no members", () => {
      expect(store.availableAgents).toEqual([]);
    });
  });

  describe("statusCounts", () => {
    it("tallies each status", () => {
      store.members = sampleMembers;
      expect(store.statusCounts).toEqual({
        running: 1,
        idle: 1,
        error: 1,
      });
    });
  });

  describe("stopMember", () => {
    it("optimistically updates status on success", async () => {
      store.members = sampleMembers;
      vi.mocked(api.stopFleetMember).mockResolvedValue(true);

      const ok = await store.stopMember("a");

      expect(ok).toBe(true);
      const updated = store.members.find((m) => m.id === "a");
      expect(updated?.status).toBe("stopped");
    });

    it("returns false and sets error on failure", async () => {
      store.members = sampleMembers;
      vi.mocked(api.stopFleetMember).mockRejectedValue(new Error("nope"));

      const ok = await store.stopMember("a");

      expect(ok).toBe(false);
      expect(store.error).toContain("nope");
    });
  });

  describe("sendToMember", () => {
    it("returns accepted flag from api", async () => {
      vi.mocked(api.sendToFleetMember).mockResolvedValue({
        runId: "a",
        accepted: true,
      });

      const ok = await store.sendToMember("a", "hello");

      expect(ok).toBe(true);
    });

    it("returns false on error", async () => {
      vi.mocked(api.sendToFleetMember).mockRejectedValue(new Error("x"));

      const ok = await store.sendToMember("a", "hello");

      expect(ok).toBe(false);
      expect(store.error).toContain("x");
    });
  });

  describe("resetFilters", () => {
    it("resets to defaults", () => {
      store.filters = { status: "running", agent: "codex", search: "x" };
      store.resetFilters();
      expect(store.filters).toEqual({
        status: "all",
        agent: "all",
        search: "",
      });
    });
  });
});
