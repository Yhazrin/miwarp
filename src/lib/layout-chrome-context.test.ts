import { describe, expect, it, vi } from "vitest";
import type { TaskRun, UserSettings } from "$lib/types";
import {
  resolveLayoutCachedRuns,
  resolveLayoutCachedSettings,
  routeNeedsLayoutContentPanel,
  type RunsCacheContext,
  type SettingsCacheContext,
} from "./layout-chrome-context";

describe("routeNeedsLayoutContentPanel", () => {
  it("returns true for sidebar-dependent routes", () => {
    expect(routeNeedsLayoutContentPanel("/")).toBe(true);
    expect(routeNeedsLayoutContentPanel("/chat")).toBe(true);
    expect(routeNeedsLayoutContentPanel("/plugins")).toBe(true);
    expect(routeNeedsLayoutContentPanel("/explorer")).toBe(true);
    expect(routeNeedsLayoutContentPanel("/teams")).toBe(true);
    expect(routeNeedsLayoutContentPanel("/settings")).toBe(true);
    expect(routeNeedsLayoutContentPanel("/scheduled-tasks")).toBe(true);
  });

  it("returns false for routes without a layout sidebar content panel", () => {
    expect(routeNeedsLayoutContentPanel("/workbench")).toBe(false);
    expect(routeNeedsLayoutContentPanel("/usage")).toBe(false);
    expect(routeNeedsLayoutContentPanel("/personal")).toBe(false);
    expect(routeNeedsLayoutContentPanel("/history")).toBe(false);
    expect(routeNeedsLayoutContentPanel("/release-notes")).toBe(false);
    expect(routeNeedsLayoutContentPanel("/api/skills")).toBe(false);
  });
});

describe("resolveLayoutCachedSettings", () => {
  const sampleSettings = { auth_mode: "cli" } as UserSettings;

  it("returns immediate settings without awaiting whenReady", async () => {
    const cache: SettingsCacheContext = {
      settings: sampleSettings,
      whenReady: vi.fn().mockResolvedValue(null),
      refresh: vi.fn().mockResolvedValue(null),
    };

    await expect(resolveLayoutCachedSettings(cache)).resolves.toEqual(sampleSettings);
    expect(cache.whenReady).not.toHaveBeenCalled();
  });

  it("awaits whenReady when settings are not yet hydrated", async () => {
    const hydrated = { auth_mode: "api_key" } as UserSettings;
    const cache: SettingsCacheContext = {
      settings: null,
      whenReady: vi.fn().mockResolvedValue(hydrated),
      refresh: vi.fn().mockResolvedValue(hydrated),
    };

    await expect(resolveLayoutCachedSettings(cache)).resolves.toEqual(hydrated);
    expect(cache.whenReady).toHaveBeenCalledTimes(1);
  });

  it("returns null when no cache is provided", async () => {
    await expect(resolveLayoutCachedSettings(undefined)).resolves.toBeNull();
  });
});

describe("resolveLayoutCachedRuns", () => {
  const sampleRuns = [{ id: "r1", started_at: "2026-01-01T00:00:00Z" }] as unknown as TaskRun[];

  it("returns immediate runs without awaiting whenReady", async () => {
    const cache: RunsCacheContext = {
      runs: sampleRuns,
      whenReady: vi.fn().mockResolvedValue([]),
    };

    await expect(resolveLayoutCachedRuns(cache)).resolves.toEqual(sampleRuns);
    expect(cache.whenReady).not.toHaveBeenCalled();
  });

  it("awaits whenReady when runs are not yet hydrated", async () => {
    const cache: RunsCacheContext = {
      runs: [],
      whenReady: vi.fn().mockResolvedValue(sampleRuns),
    };

    await expect(resolveLayoutCachedRuns(cache)).resolves.toEqual(sampleRuns);
    expect(cache.whenReady).toHaveBeenCalledTimes(1);
  });

  it("returns null after timeout when whenReady never resolves", async () => {
    // Gate that never resolves — simulates a stuck backend where listRuns
    // threw and the gate never fired. Without the timeout race the page
    // would hang forever.
    const cache: RunsCacheContext = {
      runs: [],
      whenReady: () => new Promise<TaskRun[]>(() => {}),
    };

    await expect(resolveLayoutCachedRuns(cache, { timeoutMs: 50 })).resolves.toBeNull();
  });

  it("returns null when no cache is provided", async () => {
    await expect(resolveLayoutCachedRuns(undefined)).resolves.toBeNull();
  });
});
