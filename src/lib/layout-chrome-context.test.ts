import { describe, expect, it, vi } from "vitest";
import type { UserSettings } from "$lib/types";
import {
  resolveLayoutCachedSettings,
  routeNeedsLayoutContentPanel,
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
    expect(routeNeedsLayoutContentPanel("/workspace")).toBe(true);
  });

  it("returns false for routes without a layout sidebar content panel", () => {
    expect(routeNeedsLayoutContentPanel("/usage")).toBe(false);
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
    };

    await expect(resolveLayoutCachedSettings(cache)).resolves.toEqual(sampleSettings);
    expect(cache.whenReady).not.toHaveBeenCalled();
  });

  it("awaits whenReady when settings are not yet hydrated", async () => {
    const hydrated = { auth_mode: "api_key" } as UserSettings;
    const cache: SettingsCacheContext = {
      settings: null,
      whenReady: vi.fn().mockResolvedValue(hydrated),
    };

    await expect(resolveLayoutCachedSettings(cache)).resolves.toEqual(hydrated);
    expect(cache.whenReady).toHaveBeenCalledTimes(1);
  });

  it("returns null when no cache is provided", async () => {
    await expect(resolveLayoutCachedSettings(undefined)).resolves.toBeNull();
  });
});
