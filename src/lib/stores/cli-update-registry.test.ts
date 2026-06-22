import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CliUpdateRegistry } from "./cli-update-registry.svelte";

vi.mock("$lib/api", () => ({
  checkAgentCli: vi.fn(),
  getCliDistTags: vi.fn(),
  detectMimoRuntime: vi.fn(),
}));

vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

import { checkAgentCli, getCliDistTags, detectMimoRuntime } from "$lib/api";
import {
  createCliUpdateRegistry,
  cliUpdateRegistry,
  type CliToolEntry,
} from "./cli-update-registry.svelte";

const mockCheckAgentCli = vi.mocked(checkAgentCli);
const mockGetCliDistTags = vi.mocked(getCliDistTags);
const mockDetectMimoRuntime = vi.mocked(detectMimoRuntime);

const STORAGE_KEY = "ocv:cli-update-registry";

const localStorageStore = new Map<string, string>();

function snapshotEntries(registry: CliUpdateRegistry): CliToolEntry[] {
  return registry.entries.map((entry) => ({ ...entry }));
}

beforeEach(() => {
  localStorageStore.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => localStorageStore.get(k) ?? null,
    setItem: (k: string, v: string) => localStorageStore.set(k, v),
    removeItem: (k: string) => localStorageStore.delete(k),
  });

  mockCheckAgentCli.mockReset();
  mockGetCliDistTags.mockReset();
  mockDetectMimoRuntime.mockReset();

  cliUpdateRegistry.reset();
});

afterEach(() => {
  cliUpdateRegistry.reset();
  vi.restoreAllMocks();
});

describe("CliUpdateRegistry", () => {
  describe("Claude Code version check", () => {
    it("reports up_to_date when installed matches latest", async () => {
      const registry = createCliUpdateRegistry();
      mockCheckAgentCli.mockResolvedValue({
        agent: "claude",
        found: true,
        version: "1.2.3",
      });
      mockGetCliDistTags.mockResolvedValue({ latest: "1.2.3" });

      await registry.checkTool("claude-code");

      const claude = registry.getEntry("claude-code");
      expect(claude?.status).toBe("up_to_date");
      expect(claude?.installedVersion).toBe("1.2.3");
      expect(claude?.latestVersion).toBe("1.2.3");
    });

    it("reports update_available when installed differs from latest", async () => {
      const registry = createCliUpdateRegistry();
      mockCheckAgentCli.mockResolvedValue({
        agent: "claude",
        found: true,
        version: "1.0.0",
      });
      mockGetCliDistTags.mockResolvedValue({ latest: "1.2.3" });

      await registry.checkTool("claude-code");

      const claude = registry.getEntry("claude-code");
      expect(claude?.status).toBe("update_available");
      expect(claude?.installedVersion).toBe("1.0.0");
      expect(claude?.latestVersion).toBe("1.2.3");
    });
  });

  describe("Codex version check", () => {
    it("reports installed (never up_to_date) when found with no remote latest", async () => {
      const registry = createCliUpdateRegistry();
      mockCheckAgentCli.mockResolvedValue({
        agent: "codex",
        found: true,
        version: "0.9.0",
      });

      await registry.checkTool("codex");

      const codex = registry.getEntry("codex");
      expect(codex?.status).toBe("installed");
      expect(codex?.status).not.toBe("up_to_date");
      expect(codex?.installedVersion).toBe("0.9.0");
      expect(codex?.latestVersion).toBeNull();
    });
  });

  describe("MiMo runtime check", () => {
    it("reports installed when runtime is available", async () => {
      const registry = createCliUpdateRegistry();
      mockDetectMimoRuntime.mockResolvedValue({
        available: true,
        binary: "/usr/local/bin/mimo",
        version: "2.1.0",
      });

      await registry.checkTool("mimo");

      const mimo = registry.getEntry("mimo");
      expect(mimo?.status).toBe("installed");
      expect(mimo?.installedVersion).toBe("2.1.0");
      expect(mimo?.latestVersion).toBeNull();
    });
  });

  describe("unknown tool", () => {
    it("no-ops for unrecognized tool ids", async () => {
      const registry = createCliUpdateRegistry();
      const before = snapshotEntries(registry);

      await registry.checkTool("not-a-real-tool");

      expect(snapshotEntries(registry)).toEqual(before);
      expect(mockCheckAgentCli).not.toHaveBeenCalled();
      expect(mockGetCliDistTags).not.toHaveBeenCalled();
      expect(mockDetectMimoRuntime).not.toHaveBeenCalled();
    });
  });

  describe("single-flight", () => {
    it("deduplicates concurrent checkTool calls per tool", async () => {
      const registry = createCliUpdateRegistry();
      let resolveCheck!: (value: { agent: string; found: boolean; version: string }) => void;
      mockCheckAgentCli.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCheck = resolve;
          }),
      );
      mockGetCliDistTags.mockResolvedValue({ latest: "1.0.0" });

      const first = registry.checkTool("claude-code");
      const second = registry.checkTool("claude-code");

      expect(mockCheckAgentCli).toHaveBeenCalledTimes(1);

      resolveCheck({ agent: "claude", found: true, version: "1.0.0" });
      await Promise.all([first, second]);

      expect(registry.getEntry("claude-code")?.status).toBe("up_to_date");
    });

    it("deduplicates concurrent checkAll calls", async () => {
      const registry = createCliUpdateRegistry();
      mockCheckAgentCli.mockImplementation(async (agent) => ({
        agent,
        found: true,
        version: "1.0.0",
      }));
      mockGetCliDistTags.mockResolvedValue({ latest: "1.0.0" });
      mockDetectMimoRuntime.mockResolvedValue({
        available: true,
        binary: "/bin/mimo",
        version: "1.0.0",
      });

      const first = registry.checkAll();
      const second = registry.checkAll();
      await Promise.all([first, second]);

      expect(mockCheckAgentCli).toHaveBeenCalledTimes(2);
      expect(mockDetectMimoRuntime).toHaveBeenCalledTimes(1);
    });
  });

  describe("API failure degradation", () => {
    it("does not reject and reports unknown when Claude checks fail entirely", async () => {
      const registry = createCliUpdateRegistry();
      mockCheckAgentCli.mockRejectedValue(new Error("IPC unavailable"));
      mockGetCliDistTags.mockRejectedValue(new Error("Network down"));

      await expect(registry.checkTool("claude-code")).resolves.toBeUndefined();

      const claude = registry.getEntry("claude-code");
      expect(claude?.status).toBe("unknown");
      expect(claude?.installedVersion).toBeNull();
      expect(claude?.latestVersion).toBeNull();
      expect(claude?.error).toBeNull();
    });

    it("reports installed up_to_date truthfully when only dist-tags fail", async () => {
      const registry = createCliUpdateRegistry();
      mockCheckAgentCli.mockResolvedValue({
        agent: "claude",
        found: true,
        version: "1.2.3",
      });
      mockGetCliDistTags.mockRejectedValue(new Error("Registry unreachable"));

      await expect(registry.checkTool("claude-code")).resolves.toBeUndefined();

      const claude = registry.getEntry("claude-code");
      expect(claude?.status).toBe("up_to_date");
      expect(claude?.installedVersion).toBe("1.2.3");
      expect(claude?.latestVersion).toBeNull();
      expect(claude?.error).toBeNull();
    });

    it("reports unknown when Codex check rejects", async () => {
      const registry = createCliUpdateRegistry();
      mockCheckAgentCli.mockRejectedValue(new Error("spawn failed"));

      await expect(registry.checkTool("codex")).resolves.toBeUndefined();

      const codex = registry.getEntry("codex");
      expect(codex?.status).toBe("unknown");
      expect(codex?.installedVersion).toBeNull();
      expect(codex?.error).toBeNull();
    });
  });

  describe("localStorage cache", () => {
    it("persists checked state after checkTool", async () => {
      const registry = createCliUpdateRegistry();
      mockCheckAgentCli.mockResolvedValue({
        agent: "codex",
        found: true,
        version: "0.5.0",
      });

      await registry.checkTool("codex");

      const raw = localStorageStore.get(STORAGE_KEY);
      expect(raw).toBeDefined();
      const cached = JSON.parse(raw!) as CliToolEntry[];
      const codex = cached.find((entry) => entry.id === "codex");
      expect(codex?.status).toBe("installed");
      expect(codex?.installedVersion).toBe("0.5.0");
    });

    it("loadCache restores persisted entries", async () => {
      const writer = createCliUpdateRegistry();
      mockCheckAgentCli.mockResolvedValue({
        agent: "claude",
        found: true,
        version: "1.0.0",
      });
      mockGetCliDistTags.mockResolvedValue({ latest: "2.0.0" });
      await writer.checkTool("claude-code");

      const reader = createCliUpdateRegistry();
      reader.loadCache();

      const claude = reader.getEntry("claude-code");
      expect(claude?.status).toBe("update_available");
      expect(claude?.installedVersion).toBe("1.0.0");
      expect(claude?.latestVersion).toBe("2.0.0");
    });
  });

  describe("singleton export", () => {
    it("preserves the shared cliUpdateRegistry instance API", async () => {
      mockCheckAgentCli.mockResolvedValue({
        agent: "claude",
        found: true,
        version: "1.0.0",
      });
      mockGetCliDistTags.mockResolvedValue({ latest: "1.0.0" });

      await cliUpdateRegistry.checkTool("claude-code");

      expect(cliUpdateRegistry.getEntry("claude-code")?.status).toBe("up_to_date");
      cliUpdateRegistry.reset();
    });
  });
});
