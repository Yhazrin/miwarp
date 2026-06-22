import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { appUpdateCoordinator } from "./app-update-coordinator.svelte";

// Mock the app-updater module
vi.mock("$lib/utils/app-updater", () => ({
  discoverAppUpdate: vi.fn(),
  checkAppUpdateStatus: vi.fn(),
  installInAppUpdate: vi.fn(),
  openExternalUpdateUrl: vi.fn(),
  relaunchApplication: vi.fn(),
}));

import {
  checkAppUpdateStatus,
  installInAppUpdate,
  openExternalUpdateUrl,
  relaunchApplication,
} from "$lib/utils/app-updater";

const mockCheck = vi.mocked(checkAppUpdateStatus);
const mockInstall = vi.mocked(installInAppUpdate);
const mockOpenExternal = vi.mocked(openExternalUpdateUrl);
const mockRelaunch = vi.mocked(relaunchApplication);

// Mock localStorage
const localStorageStore = new Map<string, string>();
const sessionStorageStore = new Map<string, string>();

beforeEach(() => {
  localStorageStore.clear();
  sessionStorageStore.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => localStorageStore.get(k) ?? null,
    setItem: (k: string, v: string) => localStorageStore.set(k, v),
    removeItem: (k: string) => localStorageStore.delete(k),
  });
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => sessionStorageStore.get(k) ?? null,
    setItem: (k: string, v: string) => sessionStorageStore.set(k, v),
    removeItem: (k: string) => sessionStorageStore.delete(k),
  });
  vi.useFakeTimers();
  mockCheck.mockReset();
  mockInstall.mockReset();
  mockOpenExternal.mockReset();
  mockRelaunch.mockReset();
  // Reset coordinator state
  appUpdateCoordinator.reset();
  appUpdateCoordinator.setAutoCheckEnabled(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  appUpdateCoordinator.destroy();
});

describe("AppUpdateCoordinator", () => {
  describe("single-flight check", () => {
    it("deduplicates concurrent check calls", async () => {
      mockCheck.mockResolvedValue({
        offer: null,
        error: null,
        upToDateVersion: "1.0.8",
      });

      const [r1, r2, r3] = await Promise.all([
        appUpdateCoordinator.checkForUpdate(),
        appUpdateCoordinator.checkForUpdate(),
        appUpdateCoordinator.checkForUpdate(),
      ]);

      expect(mockCheck).toHaveBeenCalledTimes(1);
      expect(r1.phase).toBe("up_to_date");
      expect(r2.phase).toBe("up_to_date");
      expect(r3.phase).toBe("up_to_date");
    });
  });

  describe("available offer", () => {
    it("transitions to available when update found", async () => {
      mockCheck.mockResolvedValue({
        offer: {
          kind: "in_app",
          version: "1.0.9",
          currentVersion: "1.0.8",
          notes: "Bug fixes",
        },
        error: null,
        upToDateVersion: null,
      });

      const result = await appUpdateCoordinator.checkForUpdate();
      expect(result.phase).toBe("available");
      expect(result.offer?.kind).toBe("in_app");
      expect(result.offer?.version).toBe("1.0.9");
    });

    it("transitions to up_to_date when no update", async () => {
      mockCheck.mockResolvedValue({
        offer: null,
        error: null,
        upToDateVersion: "1.0.8",
      });

      const result = await appUpdateCoordinator.checkForUpdate();
      expect(result.phase).toBe("up_to_date");
      expect(result.upToDateVersion).toBe("1.0.8");
    });
  });

  describe("dismiss and snooze", () => {
    it("dismiss uses sessionStorage", async () => {
      mockCheck.mockResolvedValue({
        offer: {
          kind: "in_app",
          version: "1.0.9",
          currentVersion: "1.0.8",
          notes: "",
        },
        error: null,
        upToDateVersion: null,
      });

      await appUpdateCoordinator.checkForUpdate();
      expect(appUpdateCoordinator.phase).toBe("available");

      appUpdateCoordinator.dismiss();
      expect(appUpdateCoordinator.phase).toBe("idle");
      expect(sessionStorageStore.get("ocv:update-dismissed:1.0.9")).toBe("1");
    });

    it("snooze uses localStorage with 24h expiry", async () => {
      mockCheck.mockResolvedValue({
        offer: {
          kind: "in_app",
          version: "1.0.9",
          currentVersion: "1.0.8",
          notes: "",
        },
        error: null,
        upToDateVersion: null,
      });

      await appUpdateCoordinator.checkForUpdate();
      appUpdateCoordinator.snooze();
      expect(appUpdateCoordinator.phase).toBe("idle");

      const raw = localStorageStore.get("ocv:update-snoozed");
      expect(raw).toBeDefined();
      const parsed = JSON.parse(raw!);
      expect(parsed.version).toBe("1.0.9");
      expect(parsed.until).toBeGreaterThan(Date.now());
    });

    it("snoozed version is skipped on next check", async () => {
      // First check: available
      mockCheck.mockResolvedValueOnce({
        offer: {
          kind: "in_app",
          version: "1.0.9",
          currentVersion: "1.0.8",
          notes: "",
        },
        error: null,
        upToDateVersion: null,
      });

      await appUpdateCoordinator.checkForUpdate();
      appUpdateCoordinator.snooze();

      // Second check: same version snoozed → up_to_date
      mockCheck.mockResolvedValueOnce({
        offer: {
          kind: "in_app",
          version: "1.0.9",
          currentVersion: "1.0.8",
          notes: "",
        },
        error: null,
        upToDateVersion: null,
      });

      const result = await appUpdateCoordinator.checkForUpdate();
      expect(result.phase).toBe("up_to_date");
    });
  });

  describe("progress", () => {
    it("tracks download and install progress", async () => {
      mockCheck.mockResolvedValue({
        offer: {
          kind: "in_app",
          version: "1.0.9",
          currentVersion: "1.0.8",
          notes: "",
        },
        error: null,
        upToDateVersion: null,
      });

      await appUpdateCoordinator.checkForUpdate();

      mockInstall.mockImplementation(async (onProgress) => {
        onProgress?.({ phase: "downloading", percent: 0 });
        onProgress?.({ phase: "downloading", percent: 50 });
        onProgress?.({ phase: "downloading", percent: 100 });
        onProgress?.({ phase: "installing", percent: 100 });
        onProgress?.({ phase: "ready_to_restart", percent: null });
      });

      await appUpdateCoordinator.installUpdate();

      expect(appUpdateCoordinator.phase).toBe("ready_to_restart");
    });
  });

  describe("restartApplication", () => {
    async function reachReadyToRestart(): Promise<void> {
      mockCheck.mockResolvedValue({
        offer: {
          kind: "in_app",
          version: "1.0.9",
          currentVersion: "1.0.8",
          notes: "",
        },
        error: null,
        upToDateVersion: null,
      });
      await appUpdateCoordinator.checkForUpdate();
      mockInstall.mockImplementation(async (onProgress) => {
        onProgress?.({ phase: "ready_to_restart", percent: null });
      });
      await appUpdateCoordinator.installUpdate();
      expect(appUpdateCoordinator.phase).toBe("ready_to_restart");
    }

    it("calls relaunchApplication when ready_to_restart", async () => {
      await reachReadyToRestart();
      mockRelaunch.mockResolvedValue(undefined);

      await appUpdateCoordinator.restartApplication();

      expect(mockRelaunch).toHaveBeenCalledTimes(1);
      expect(appUpdateCoordinator.phase).toBe("ready_to_restart");
    });

    it("transitions to failed when relaunch fails", async () => {
      await reachReadyToRestart();
      mockRelaunch.mockRejectedValue(new Error("Relaunch failed"));

      await appUpdateCoordinator.restartApplication();

      expect(appUpdateCoordinator.phase).toBe("failed");
      expect(appUpdateCoordinator.state.error).toContain("Relaunch failed");
    });

    it("no-ops when not in ready_to_restart", async () => {
      await appUpdateCoordinator.restartApplication();
      expect(mockRelaunch).not.toHaveBeenCalled();
    });
  });

  describe("failure retry", () => {
    it("transitions to failed on error", async () => {
      mockCheck.mockRejectedValue(new Error("Network error"));

      const result = await appUpdateCoordinator.checkForUpdate();
      expect(result.phase).toBe("failed");
      expect(result.error).toContain("Network error");
    });

    it("retry transitions to idle and re-checks", async () => {
      mockCheck.mockRejectedValueOnce(new Error("fail"));
      await appUpdateCoordinator.checkForUpdate();
      expect(appUpdateCoordinator.phase).toBe("failed");

      mockCheck.mockResolvedValue({
        offer: null,
        error: null,
        upToDateVersion: "1.0.8",
      });

      await appUpdateCoordinator.retry();
      expect(appUpdateCoordinator.phase).toBe("up_to_date");
    });
  });

  describe("up_to_date", () => {
    it("reports up_to_date when no update available", async () => {
      mockCheck.mockResolvedValue({
        offer: null,
        error: null,
        upToDateVersion: "1.0.8",
      });

      const result = await appUpdateCoordinator.checkForUpdate();
      expect(result.phase).toBe("up_to_date");
      expect(result.upToDateVersion).toBe("1.0.8");
    });
  });

  describe("external fallback", () => {
    it("opens external URL for non-in-app updates", async () => {
      mockCheck.mockResolvedValue({
        offer: {
          kind: "external",
          version: "1.0.9",
          currentVersion: "1.0.8",
          downloadUrl: "https://example.com/download",
        },
        error: null,
        upToDateVersion: null,
      });

      await appUpdateCoordinator.checkForUpdate();
      expect(appUpdateCoordinator.phase).toBe("available");

      mockOpenExternal.mockResolvedValue(undefined);
      await appUpdateCoordinator.installUpdate();
      expect(mockOpenExternal).toHaveBeenCalledWith("https://example.com/download");
      expect(appUpdateCoordinator.phase).toBe("idle");
    });
  });

  describe("auto-check preferences", () => {
    it("respects auto-check disabled", () => {
      appUpdateCoordinator.setAutoCheckEnabled(false);
      expect(appUpdateCoordinator.getAutoCheckEnabled()).toBe(false);
      expect(localStorageStore.get("ocv:update-auto-check")).toBe("0");
    });

    it("defaults to enabled", () => {
      expect(appUpdateCoordinator.getAutoCheckEnabled()).toBe(true);
    });
  });

  describe("startAutoCheck / destroy", () => {
    it("starts silent check after delay", async () => {
      mockCheck.mockResolvedValue({
        offer: null,
        error: null,
        upToDateVersion: "1.0.8",
      });

      appUpdateCoordinator.startAutoCheck();

      // Not yet checked
      expect(mockCheck).not.toHaveBeenCalled();

      // Advance past startup delay (5s)
      await vi.advanceTimersByTimeAsync(5100);
      expect(mockCheck).toHaveBeenCalledTimes(1);
    });

    it("destroy clears timers", () => {
      appUpdateCoordinator.startAutoCheck();
      appUpdateCoordinator.destroy();

      // Should not throw or continue checking
      expect(appUpdateCoordinator.phase).toBe("idle");
    });
  });

  describe("CLI strategy mapping", () => {
    it("Claude Code uses native_update strategy", async () => {
      // This tests the CLI registry, not the coordinator
      const { cliUpdateRegistry } = await import("./cli-update-registry.svelte");
      const claude = cliUpdateRegistry.getEntry("claude-code");
      expect(claude?.strategy).toBe("native_update");
      expect(claude?.updateCommand).toBe("claude update");
    });

    it("Codex uses official_installer strategy", async () => {
      const { cliUpdateRegistry } = await import("./cli-update-registry.svelte");
      const codex = cliUpdateRegistry.getEntry("codex");
      expect(codex?.strategy).toBe("official_installer");
    });

    it("MiMo uses repo_guided strategy", async () => {
      const { cliUpdateRegistry } = await import("./cli-update-registry.svelte");
      const mimo = cliUpdateRegistry.getEntry("mimo");
      expect(mimo?.strategy).toBe("repo_guided");
    });
  });
});
