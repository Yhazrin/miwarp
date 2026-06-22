import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserSettings } from "$lib/types";
import { resolveLayoutCachedSettings, type SettingsCacheContext } from "$lib/layout-chrome-context";
import {
  SettingsTabLoadController,
  fetchCliBehaviorTabData,
  fetchDevicesTabData,
  fetchRuntimesTabData,
  fetchUpdatesTabData,
  loadSettingsPageCore,
  type SettingsTabLoaderDeps,
} from "./settings-tab-loaders";

function makeDeps(overrides: Partial<SettingsTabLoaderDeps> = {}): SettingsTabLoaderDeps {
  return {
    getUserSettings: vi.fn().mockResolvedValue({ auth_mode: "cli" }),
    getWebServerStatus: vi.fn().mockResolvedValue({
      enabled: true,
      running: true,
      port: 9476,
      bind: "0.0.0.0",
    }),
    getWebServerToken: vi.fn().mockResolvedValue("token"),
    getLocalIp: vi.fn().mockResolvedValue("192.168.1.2"),
    getCliConfig: vi.fn().mockResolvedValue({ thinkingEnabled: true }),
    getProjectCliConfig: vi.fn().mockResolvedValue({}),
    getAgentSettings: vi.fn().mockResolvedValue({ mimo_binary_path: "" }),
    isDesktop: () => true,
    runtimeHubRefresh: vi.fn().mockResolvedValue(undefined),
    cliUpdateLoadCache: vi.fn(),
    readProjectCwd: () => "/project",
    ...overrides,
  };
}

describe("settings tab fetch helpers", () => {
  let mounted: boolean;
  let guard: { isActive: () => boolean };

  beforeEach(() => {
    mounted = true;
    guard = { isActive: () => mounted };
  });

  it("fetchDevicesTabData does not run when appearance-only path is used", async () => {
    const deps = makeDeps();
    const controller = new SettingsTabLoadController();
    const load = vi.fn(async (tab: string) => {
      if (tab === "devices") await fetchDevicesTabData(guard, deps);
    });

    await controller.ensureTabLoaded("appearance", guard, load);

    expect(load).toHaveBeenCalledWith("appearance");
    expect(deps.getWebServerStatus).not.toHaveBeenCalled();
  });

  it("fetchDevicesTabData loads web server IPC only for devices tab", async () => {
    const deps = makeDeps();
    await fetchDevicesTabData(guard, deps);

    expect(deps.getWebServerStatus).toHaveBeenCalledTimes(1);
    expect(deps.getWebServerToken).toHaveBeenCalledTimes(1);
    expect(deps.getLocalIp).toHaveBeenCalledTimes(1);
  });

  it("fetchCliBehaviorTabData loads cli config without runtime probes", async () => {
    const deps = makeDeps();
    await fetchCliBehaviorTabData(guard, deps);

    expect(deps.getCliConfig).toHaveBeenCalledTimes(1);
    expect(deps.getProjectCliConfig).toHaveBeenCalledTimes(1);
    expect(deps.runtimeHubRefresh).not.toHaveBeenCalled();
  });

  it("fetchRuntimesTabData loads runtime hub without diagnostics", async () => {
    const deps = makeDeps();
    await fetchRuntimesTabData(guard, deps);

    expect(deps.runtimeHubRefresh).toHaveBeenCalledTimes(1);
    expect(deps.getAgentSettings).toHaveBeenCalledWith("mimo");
    expect(deps.getCliConfig).not.toHaveBeenCalled();
  });

  it("fetchUpdatesTabData only hydrates local cache", () => {
    const deps = makeDeps();
    fetchUpdatesTabData(guard, deps);

    expect(deps.cliUpdateLoadCache).toHaveBeenCalledTimes(1);
    expect(deps.runtimeHubRefresh).not.toHaveBeenCalled();
    expect(deps.getWebServerStatus).not.toHaveBeenCalled();
  });

  it("returns null when guard is inactive after async work", async () => {
    const deps = makeDeps({
      getWebServerStatus: vi.fn().mockImplementation(async () => {
        mounted = false;
        return { enabled: true, running: false, port: 9476, bind: "127.0.0.1" };
      }),
    });

    const result = await fetchDevicesTabData(guard, deps);
    expect(result).toBeNull();
  });
});

describe("SettingsTabLoadController", () => {
  let mounted: boolean;
  let guard: { isActive: () => boolean };

  beforeEach(() => {
    mounted = true;
    guard = { isActive: () => mounted };
  });

  it("dedupes repeated ensureTabLoaded for the same tab", async () => {
    const deps = makeDeps();
    const load = vi.fn(async (tab: string) => {
      if (tab === "runtimes") await fetchRuntimesTabData(guard, deps);
    });
    const controller = new SettingsTabLoadController();

    await Promise.all([
      controller.ensureTabLoaded("runtimes", guard, load),
      controller.ensureTabLoaded("runtimes", guard, load),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(deps.runtimeHubRefresh).toHaveBeenCalledTimes(1);
    expect(controller.isLoaded("runtimes")).toBe(true);
  });

  it("does not mark tab loaded when guard becomes inactive before completion", async () => {
    let resolveRefresh: () => void = () => {};
    const refreshGate = new Promise<void>((r) => {
      resolveRefresh = r;
    });
    const deps = makeDeps({
      runtimeHubRefresh: vi.fn().mockImplementation(async () => {
        await refreshGate;
      }),
    });
    const load = async (tab: string) => {
      if (tab === "runtimes") await fetchRuntimesTabData(guard, deps);
    };
    const controller = new SettingsTabLoadController();

    const pending = controller.ensureTabLoaded("runtimes", guard, load);
    mounted = false;
    resolveRefresh();
    await pending;

    expect(controller.isLoaded("runtimes")).toBe(false);
  });

  it("allows reload after bumpGeneration", async () => {
    const deps = makeDeps();
    const load = async (tab: string) => {
      if (tab === "updates") fetchUpdatesTabData(guard, deps);
    };
    const controller = new SettingsTabLoadController();

    await controller.ensureTabLoaded("updates", guard, load);
    controller.bumpGeneration();
    await controller.ensureTabLoaded("updates", guard, load);

    expect(deps.cliUpdateLoadCache).toHaveBeenCalledTimes(2);
  });

  it("does not mark a failed load as loaded and allows retry", async () => {
    const controller = new SettingsTabLoadController();
    const load = vi
      .fn<(tab: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("probe failed"))
      .mockResolvedValueOnce(undefined);

    await expect(controller.ensureTabLoaded("runtimes", guard, load)).rejects.toThrow(
      "probe failed",
    );
    expect(controller.isLoaded("runtimes")).toBe(false);

    await controller.ensureTabLoaded("runtimes", guard, load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(controller.isLoaded("runtimes")).toBe(true);
  });

  it("an old generation cannot clear the replacement in-flight request", async () => {
    let resolveFirst: () => void = () => {};
    let resolveSecond: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });
    const load = vi
      .fn<(tab: string) => Promise<void>>()
      .mockImplementationOnce(() => firstGate)
      .mockImplementationOnce(() => secondGate);
    const controller = new SettingsTabLoadController();

    const first = controller.ensureTabLoaded("updates", guard, load);
    await Promise.resolve();
    controller.bumpGeneration();
    const second = controller.ensureTabLoaded("updates", guard, load);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);

    resolveFirst();
    await first;
    const duplicate = controller.ensureTabLoaded("updates", guard, load);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);

    resolveSecond();
    await Promise.all([second, duplicate]);
    expect(controller.isLoaded("updates")).toBe(true);
  });

  it("switching tabs does not reload an already loaded tab", async () => {
    const deps = makeDeps();
    const load = async (tab: string) => {
      if (tab === "devices") await fetchDevicesTabData(guard, deps);
      if (tab === "runtimes") await fetchRuntimesTabData(guard, deps);
    };
    const controller = new SettingsTabLoadController();

    await controller.ensureTabLoaded("devices", guard, load);
    await controller.ensureTabLoaded("runtimes", guard, load);
    await controller.ensureTabLoaded("devices", guard, load);

    expect(deps.getWebServerStatus).toHaveBeenCalledTimes(1);
    expect(deps.runtimeHubRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("loadSettingsPageCore", () => {
  it("returns null when unmounted before settings resolve", async () => {
    let mounted = true;
    const guard = { isActive: () => mounted };
    const deps = makeDeps({
      getUserSettings: vi.fn().mockImplementation(async () => {
        mounted = false;
        return { auth_mode: "cli" };
      }),
    });

    const result = await loadSettingsPageCore(guard, deps);
    expect(result).toBeNull();
  });
});

describe("settings cold-start IPC budget", () => {
  const sampleSettings = { auth_mode: "cli" } as UserSettings;

  it("resolveLayoutCachedSettings skips getUserSettings when layout cache is warm", async () => {
    const getUserSettings = vi.fn();
    const cache: SettingsCacheContext = {
      settings: sampleSettings,
      whenReady: vi.fn().mockResolvedValue(sampleSettings),
    };

    const resolved = await resolveLayoutCachedSettings(cache);
    expect(resolved).toEqual(sampleSettings);
    expect(getUserSettings).not.toHaveBeenCalled();
    expect(cache.whenReady).not.toHaveBeenCalled();
  });

  it("resolveLayoutCachedSettings dedupes via whenReady instead of a second IPC", async () => {
    const hydrated = { auth_mode: "api_key" } as UserSettings;
    const whenReady = vi.fn().mockResolvedValue(hydrated);
    const cache: SettingsCacheContext = {
      settings: null,
      whenReady,
    };

    const resolved = await resolveLayoutCachedSettings(cache);
    expect(resolved).toEqual(hydrated);
    expect(whenReady).toHaveBeenCalledTimes(1);
  });
});
