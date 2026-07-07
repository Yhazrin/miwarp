import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CliUpdateRegistry } from "./cli-update-registry.svelte";

vi.mock("$lib/api", () => ({
  checkAgentCli: vi.fn(),
  getCliDistTags: vi.fn(),
  detectMimoRuntime: vi.fn(),
  checkCliBinary: vi.fn(),
  detectCliTool: vi.fn(),
  runCliUpdate: vi.fn(),
}));

vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

import {
  checkAgentCli,
  getCliDistTags,
  detectMimoRuntime,
  checkCliBinary,
  detectCliTool,
  runCliUpdate,
} from "$lib/api";
import {
  createCliUpdateRegistry,
  cliUpdateRegistry,
  type CliToolEntry,
} from "./cli-update-registry.svelte";

const mockCheckAgentCli = vi.mocked(checkAgentCli);
const mockGetCliDistTags = vi.mocked(getCliDistTags);
const mockDetectMimoRuntime = vi.mocked(detectMimoRuntime);
const mockCheckCliBinary = vi.mocked(checkCliBinary);
const mockDetectCliTool = vi.mocked(detectCliTool);
const mockRunCliUpdate = vi.mocked(runCliUpdate);

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
  mockCheckCliBinary.mockReset();
  mockDetectCliTool.mockReset();
  mockRunCliUpdate.mockReset();

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

  describe("CC-Switch detection", () => {
    it("lists ccswitch in the default registry entries", () => {
      const registry = createCliUpdateRegistry();
      const entry = registry.getEntry("ccswitch");
      expect(entry).toBeDefined();
      expect(entry?.id).toBe("ccswitch");
      expect(entry?.strategy).toBe("homebrew_cask");
      expect(entry?.name).toBe("CC Switch");
    });

    it("reports installed when detected via Spotlight (DMG install)", async () => {
      const registry = createCliUpdateRegistry();
      mockDetectCliTool.mockResolvedValue({
        tool_id: "ccswitch",
        found: true,
        version: "3.16.5",
        install_method: "dmg",
        install_path: "/Applications/CC-Switch.app",
      });

      await registry.checkTool("ccswitch");

      const ccswitch = registry.getEntry("ccswitch");
      expect(ccswitch?.status).toBe("installed");
      expect(ccswitch?.installedVersion).toBe("3.16.5");
      expect(ccswitch?.installMethod).toBe("dmg");
      expect(ccswitch?.installPath).toBe("/Applications/CC-Switch.app");
      expect(mockDetectCliTool).toHaveBeenCalledWith("ccswitch");
    });

    it("reports installed when detected via Homebrew Cask", async () => {
      const registry = createCliUpdateRegistry();
      mockDetectCliTool.mockResolvedValue({
        tool_id: "ccswitch",
        found: true,
        version: "3.16.5",
        install_method: "brew_cask",
        install_path: "/Applications/CC-Switch.app/Contents/MacOS/CC-Switch",
      });

      await registry.checkTool("ccswitch");

      const ccswitch = registry.getEntry("ccswitch");
      expect(ccswitch?.installMethod).toBe("brew_cask");
    });

    it("reports unknown when CC-Switch is not on disk at all", async () => {
      const registry = createCliUpdateRegistry();
      mockDetectCliTool.mockResolvedValue({
        tool_id: "ccswitch",
        found: false,
        version: null,
        install_method: "unknown",
        install_path: null,
      });

      await registry.checkTool("ccswitch");

      const ccswitch = registry.getEntry("ccswitch");
      expect(ccswitch?.status).toBe("unknown");
      expect(ccswitch?.installMethod).toBe("unknown");
    });
  });

  describe("one-click install/update", () => {
    it("canAutoUpdate returns true for npm_global and homebrew_cask strategies", () => {
      const registry = createCliUpdateRegistry();
      expect(registry.canAutoUpdate("claude-code")).toBe(true);
      expect(registry.canAutoUpdate("codex")).toBe(true);
      expect(registry.canAutoUpdate("mimo")).toBe(true);
      expect(registry.canAutoUpdate("ccswitch")).toBe(true);
    });

    it("installOrUpdate marks status as installing then install_done on success", async () => {
      const registry = createCliUpdateRegistry();
      mockRunCliUpdate.mockResolvedValue({
        success: true,
        stdout: "added 1 package",
        stderr: "",
      });
      // Post-refresh via checkTool will set status to "installed" once the
      // background fire-and-forget resolves. Pre-stage the mock so it lands
      // on a known terminal state.
      mockDetectCliTool.mockResolvedValue({
        tool_id: "ccswitch",
        found: true,
        version: "3.16.6",
        install_method: "dmg",
        install_path: "/Applications/CC-Switch.app",
      });

      const result = await registry.installOrUpdate("ccswitch");
      // Let the post-refresh microtask settle before asserting.
      await new Promise((r) => setTimeout(r, 0));

      expect(result.success).toBe(true);
      expect(mockRunCliUpdate).toHaveBeenCalledWith("ccswitch");
      expect(registry.getEntry("ccswitch")?.status).toMatch(/install_done|installed/);
    });

    it("installOrUpdate marks install_failed when the backend reports failure", async () => {
      const registry = createCliUpdateRegistry();
      mockRunCliUpdate.mockResolvedValue({
        success: false,
        stdout: "",
        stderr: "EACCES permission denied",
      });
      // Post-refresh hits checkAgentCli("codex"); stage it so the background
      // checkTool doesn't override our install_failed assertion with "error".
      mockCheckAgentCli.mockResolvedValue({
        agent: "codex",
        found: true,
        version: "0.142.6",
      });

      const result = await registry.installOrUpdate("codex");
      await new Promise((r) => setTimeout(r, 0));

      expect(result.success).toBe(false);
      const codex = registry.getEntry("codex");
      expect(codex?.status).toBe("install_failed");
      expect(codex?.error).toContain("EACCES");
    });

    it("installOrUpdate throws and marks install_failed when the backend rejects", async () => {
      const registry = createCliUpdateRegistry();
      mockRunCliUpdate.mockRejectedValue(new Error("network unreachable"));

      await expect(registry.installOrUpdate("mimo")).rejects.toThrow("network unreachable");
      expect(registry.getEntry("mimo")?.status).toBe("install_failed");
      expect(registry.getEntry("mimo")?.error).toBe("network unreachable");
    });
  });
});
