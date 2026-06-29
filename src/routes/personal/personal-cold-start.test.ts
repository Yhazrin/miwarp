/**
 * personal-cold-start.test.ts — pin the cold-start IPC budget for /personal.
 *
 * Runtime installation and health probing is intentionally absent from this
 * route. Personal uses the static runtime registry; only Settings, activity,
 * and the lightweight skill count participate in hydration.
 */
import { describe, expect, it, vi } from "vitest";
import type { SkillSummary, UsageOverview, UserSettings } from "$lib/types";
import {
  createPersonalColdStart,
  type PersonalColdStartCallbacks,
  type PersonalColdStartDeps,
} from "./personal-cold-start";

const sampleSettings = { auth_mode: "cli" } as UserSettings;

function makeUsage(overrides: Partial<UsageOverview> = {}): UsageOverview {
  return {
    totalCostUsd: 1.23,
    totalTokens: 0,
    totalRuns: 4,
    daily: [
      { date: "2026-06-22", costUsd: 0.1, runs: 1, inputTokens: 0, outputTokens: 0 },
      { date: "2026-06-23", costUsd: 0.2, runs: 0, inputTokens: 0, outputTokens: 0 },
      { date: "2026-06-24", costUsd: 0.3, runs: 1, inputTokens: 0, outputTokens: 0 },
      { date: "2026-06-25", costUsd: 0.1, runs: 0, inputTokens: 0, outputTokens: 0 },
      { date: "2026-06-26", costUsd: 0.2, runs: 1, inputTokens: 0, outputTokens: 0 },
      { date: "2026-06-27", costUsd: 0.2, runs: 0, inputTokens: 0, outputTokens: 0 },
      { date: "2026-06-28", costUsd: 0.23, runs: 1, inputTokens: 0, outputTokens: 0 },
    ],
    ...overrides,
  } as UsageOverview;
}

function makeSummary(total = 7): SkillSummary {
  return { total, builtIn: 5, custom: Math.max(0, total - 5) };
}

function makeDeps(overrides: Partial<PersonalColdStartDeps> = {}): PersonalColdStartDeps {
  return {
    resolveSettings: vi.fn(async () => sampleSettings),
    refreshSettings: vi.fn(async () => sampleSettings),
    getUsageOverview: vi.fn(async () => makeUsage()),
    getSkillSummary: vi.fn(async () => makeSummary()),
    scheduleIdle: (task) => {
      task();
      return false;
    },
    ...overrides,
  };
}

function makeCallbacks(
  overrides: Partial<PersonalColdStartCallbacks> = {},
): PersonalColdStartCallbacks {
  return {
    onSettingsLoad: vi.fn(),
    onActivityLoaded: vi.fn(),
    onSkillCountLoaded: vi.fn(),
    ...overrides,
  };
}

describe("personal cold-start — first paint budget", () => {
  it("has no runtime probe dependency", () => {
    const deps = makeDeps();
    expect(Object.keys(deps)).not.toContain("runtimeHubList");
    expect(Object.keys(deps)).not.toContain("runtimeHubStoreRefresh");
  });

  it("resolves settings without waiting for background hydration", async () => {
    let resolveSettings!: (value: UserSettings) => void;
    const settingsPromise = new Promise<UserSettings>((resolve) => {
      resolveSettings = resolve;
    });
    const neverUsage = new Promise<UsageOverview>(() => undefined);
    const neverSkills = new Promise<SkillSummary>(() => undefined);

    const onSettingsLoad = vi.fn();
    const controller = createPersonalColdStart(
      makeDeps({
        resolveSettings: () => settingsPromise,
        getUsageOverview: () => neverUsage,
        getSkillSummary: () => neverSkills,
      }),
      makeCallbacks({ onSettingsLoad }),
    );

    const startedAt = Date.now();
    controller.start();
    resolveSettings(sampleSettings);

    await vi.waitFor(() => expect(onSettingsLoad).toHaveBeenCalledWith("ready", sampleSettings));
    expect(Date.now() - startedAt).toBeLessThan(100);
  });

  it("schedules all non-settings hydration in one idle task", () => {
    const scheduleIdle = vi.fn();
    createPersonalColdStart(makeDeps({ scheduleIdle }), makeCallbacks()).start();
    expect(scheduleIdle).toHaveBeenCalledTimes(1);
  });

  it("exposes settings failure, retry, and continue-without paths", async () => {
    const refreshSettings = vi.fn(async () => sampleSettings);
    const onSettingsLoad = vi.fn();
    const controller = createPersonalColdStart(
      makeDeps({
        resolveSettings: vi.fn(async () => null),
        refreshSettings,
      }),
      makeCallbacks({ onSettingsLoad }),
    );

    controller.start();
    await vi.waitFor(() => expect(onSettingsLoad).toHaveBeenCalledWith("failed", null));

    await controller.retry();
    expect(refreshSettings).toHaveBeenCalledTimes(1);
    expect(onSettingsLoad).toHaveBeenLastCalledWith("ready", sampleSettings);

    const placeholder = { auth_mode: "cli" } as UserSettings;
    controller.continueWithoutSettings(placeholder);
    expect(onSettingsLoad).toHaveBeenLastCalledWith("ready", placeholder);
  });
});

describe("personal cold-start — per-card hydration", () => {
  it("emits the last seven daily cost entries", async () => {
    const getUsageOverview = vi.fn(async () =>
      makeUsage({
        daily: [
          { date: "2026-06-21", costUsd: 9, runs: 1, inputTokens: 0, outputTokens: 0 },
          { date: "2026-06-22", costUsd: 0.1, runs: 1, inputTokens: 0, outputTokens: 0 },
          { date: "2026-06-23", costUsd: 0.2, runs: 0, inputTokens: 0, outputTokens: 0 },
          { date: "2026-06-24", costUsd: 0.3, runs: 1, inputTokens: 0, outputTokens: 0 },
          { date: "2026-06-25", costUsd: 0.1, runs: 0, inputTokens: 0, outputTokens: 0 },
          { date: "2026-06-26", costUsd: 0.2, runs: 1, inputTokens: 0, outputTokens: 0 },
          { date: "2026-06-27", costUsd: 0.2, runs: 0, inputTokens: 0, outputTokens: 0 },
          { date: "2026-06-28", costUsd: 0.23, runs: 1, inputTokens: 0, outputTokens: 0 },
        ],
      }),
    );
    const onActivityLoaded = vi.fn();

    createPersonalColdStart(
      makeDeps({ getUsageOverview }),
      makeCallbacks({ onActivityLoaded }),
    ).start();

    await vi.waitFor(() => expect(onActivityLoaded).toHaveBeenCalled());
    expect(onActivityLoaded.mock.calls[0]?.[0]).toEqual({
      runs7d: 4,
      totalCostUsd: 1.23,
      dailyCost: [0.1, 0.2, 0.3, 0.1, 0.2, 0.2, 0.23],
    });
  });

  it("loads only the aggregate skill count", async () => {
    const getSkillSummary = vi.fn(async () => makeSummary(12));
    const onSkillCountLoaded = vi.fn();

    createPersonalColdStart(
      makeDeps({ getSkillSummary }),
      makeCallbacks({ onSkillCountLoaded }),
    ).start();

    await vi.waitFor(() => expect(onSkillCountLoaded).toHaveBeenCalledWith(12));
    expect(getSkillSummary).toHaveBeenCalledTimes(1);
  });

  it("degrades activity and skill failures without blocking the page", async () => {
    const onActivityLoaded = vi.fn();
    const onSkillCountLoaded = vi.fn();

    createPersonalColdStart(
      makeDeps({
        getUsageOverview: vi.fn(async () => {
          throw new Error("usage unavailable");
        }),
        getSkillSummary: vi.fn(async () => {
          throw new Error("skills unavailable");
        }),
      }),
      makeCallbacks({ onActivityLoaded, onSkillCountLoaded }),
    ).start();

    await vi.waitFor(() =>
      expect(onActivityLoaded).toHaveBeenCalledWith({
        runs7d: null,
        totalCostUsd: null,
        dailyCost: [],
      }),
    );
    expect(onSkillCountLoaded).toHaveBeenCalledWith(null);
  });
});
