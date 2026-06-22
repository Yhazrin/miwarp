import { describe, expect, it, vi, beforeEach } from "vitest";
import { RuntimeControlPlaneStore } from "../store.svelte";

vi.mock("$lib/api", () => ({
  runtimeHubList: vi.fn(async () => ({
    runtimes: [
      {
        runtimeId: "claude-code",
        displayName: "Claude Code",
        installed: true,
        auth: "authenticated",
        modelSource: "config",
        fetchedAtMs: Date.now(),
        stale: false,
        commands: { kind: "unsupported", capability: "supports_tool_calls" },
        mcp: { kind: "unsupported", capability: "supports_mcp" },
        skills: { kind: "unsupported", capability: "supports_skills" },
        health: {
          runtimeId: "claude-code",
          state: "ready",
          consecutiveFailures: 0,
          connectionGeneration: 0,
        },
      },
    ],
    defaultRuntimeId: "claude-code",
    fetchedAtMs: Date.now(),
  })),
  runtimeHubSetDefault: vi.fn(async () => "claude-code"),
  runtimeHubPreviewConfig: vi.fn(),
  runtimeHubApplyConfig: vi.fn(),
  runtimeHubHealth: vi.fn(),
}));

describe("RuntimeControlPlaneStore", () => {
  it("loads runtime list on init", async () => {
    const store = new RuntimeControlPlaneStore();
    store.init();
    await store.refresh(true);
    expect(store.list?.runtimes).toHaveLength(1);
    expect(store.selected?.runtimeId).toBe("claude-code");
  });

  it("persists session override without touching running lock state", () => {
    const store = new RuntimeControlPlaneStore();
    store.setSessionOverride({ runtimeId: "cursor", model: "gpt-4.1" });
    expect(store.effectiveRuntimeId("claude")).toBe("cursor");
    expect(store.effectiveModel("old")).toBe("gpt-4.1");
  });
});
