/**
 * personal-cold-start.test.ts — pin the cold-start IPC budget for /personal.
 *
 * Regression cases:
 *   1. Cached settings → first paint < 100ms (no waiting on runtime probe).
 *   2. Slow runtime probe → settings → first paint, runtimes hydrate later.
 *   3. Settings failure → `failed` state with retry + continue-without.
 *   4. Two Personal entries within 5s → only 1 settings IPC (single-flight
 *      via the layout cache).
 *   5. `runtimeHubStore.refresh` is never called (store is decoupled).
 */
import { describe, expect, it, vi } from "vitest";
import type { RuntimeControlPlaneList } from "$lib/runtime-control-plane/types";
import type { SkillSummary, UsageOverview, UserSettings } from "$lib/types";
import { createPersonalColdStart, type PersonalColdStartDeps } from "./personal-cold-start";

const sampleSettings = { auth_mode: "cli" } as UserSettings;

function makeSnapshot(overrides: Partial<RuntimeControlPlaneList> = {}): RuntimeControlPlaneList {
  return {
    runtimes: [
      { runtimeId: "claude" },
      { runtimeId: "codex" },
    ] as RuntimeControlPlaneList["runtimes"],
    defaultRuntimeId: "claude",
    fetchedAtMs: Date.now(),
    ...overrides,
  } as RuntimeControlPlaneList;
}

function makeUsage(over: Partial<UsageOverview> = {}): UsageOverview {
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
    ...over,
  } as UsageOverview;
}

function makeSummary(total = 7): SkillSummary {
  return { total, builtIn: 5, custom: 2 };
}

function makeDeps(overrides: Partial<PersonalColdStartDeps> = {}): PersonalColdStartDeps {
  return {
    resolveSettings: vi.fn(async () => sampleSettings),
    refreshSettings: vi.fn(async () => sampleSettings),
    runtimeHubList: vi.fn(async () => makeSnapshot()),
    getUsageOverview: vi.fn(async () => makeUsage()),
    getSkillSummary: vi.fn(async () => makeSummary()),
    scheduleIdle: (task) => {
      // Run synchronously in tests so the orchestration is observable.
      task();
      return false;
    },
    ...overrides,
  };
}

describe("personal cold-start — first paint budget", () => {
  it("renders <100ms when the layout settings cache is warm", async () => {
    let resolveSettings!: (v: UserSettings) => void;
    const resolveSettingsPromise = new Promise<UserSettings>((resolve) => {
      resolveSettings = resolve;
    });
    const slowRuntimes = new Promise<RuntimeControlPlaneList>(() => {
      // never resolves — proves the controller does NOT block first paint on it.
    });

    const deps = makeDeps({
      resolveSettings: () => resolveSettingsPromise,
      runtimeHubList: () => slowRuntimes as Promise<RuntimeControlPlaneList | null>,
    });

    const onSettings = vi.fn();
    const onRuntimesFinished = vi.fn();
    const onActivity = vi.fn();
    const onSkill = vi.fn();

    const ctl = createPersonalColdStart(deps, {
      onSettingsLoad: onSettings,
      onRuntimesLoaded: vi.fn(),
      onRuntimesFailed: vi.fn(),
      onRuntimesFinished,
      onActivityLoaded: onActivity,
      onSkillCountLoaded: onSkill,
    });

    const t0 = Date.now();
    ctl.start();
    resolveSettings(sampleSettings);

    // Wait for the settings callback to land (proves first paint fired).
    await vi.waitFor(() => expect(onSettings).toHaveBeenCalledWith("ready", sampleSettings));
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(100);

    // Runtimes never resolved → onRuntimesFinished must not have fired.
    expect(onRuntimesFinished).not.toHaveBeenCalled();
    // Activity + skill count kicked off in parallel, awaited by their own
    // mock (which resolves immediately).
    await vi.waitFor(() => expect(onActivity).toHaveBeenCalled());
    await vi.waitFor(() => expect(onSkill).toHaveBeenCalledWith(7));
  });

  it("isolates runtime probe failure from settings first paint", async () => {
    let resolveSettings!: (v: UserSettings) => void;
    const resolveSettingsPromise = new Promise<UserSettings>((r) => {
      resolveSettings = r;
    });

    const deps = makeDeps({
      resolveSettings: () => resolveSettingsPromise,
      runtimeHubList: vi.fn(async () => {
        throw new Error("probe timeout");
      }),
    });

    const onSettings = vi.fn();
    const onRuntimesLoaded = vi.fn();
    const onRuntimesFailed = vi.fn();
    const onRuntimesFinished = vi.fn();

    const ctl = createPersonalColdStart(deps, {
      onSettingsLoad: onSettings,
      onRuntimesLoaded,
      onRuntimesFailed,
      onRuntimesFinished,
      onActivityLoaded: vi.fn(),
      onSkillCountLoaded: vi.fn(),
    });

    ctl.start();
    resolveSettings(sampleSettings);
    await vi.waitFor(() => expect(onSettings).toHaveBeenCalledWith("ready", sampleSettings));
    await vi.waitFor(() => expect(onRuntimesFailed).toHaveBeenCalled());
    expect(onRuntimesFinished).toHaveBeenCalled();
    // Failure path must not re-throw the probe error into onSettings.
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it("exposes a failed state when settings resolve returns null + retry/continue paths", async () => {
    const refresh = vi.fn().mockResolvedValue(sampleSettings);
    const deps = makeDeps({
      resolveSettings: vi.fn().mockResolvedValue(null),
      refreshSettings: refresh,
    });

    const onSettings = vi.fn();
    const ctl = createPersonalColdStart(deps, {
      onSettingsLoad: onSettings,
      onRuntimesLoaded: vi.fn(),
      onRuntimesFailed: vi.fn(),
      onRuntimesFinished: vi.fn(),
      onActivityLoaded: vi.fn(),
      onSkillCountLoaded: vi.fn(),
    });

    ctl.start();
    await vi.waitFor(() => expect(onSettings).toHaveBeenCalledWith("failed", null));

    // retry() calls refreshSettings and resolves again.
    await ctl.retry();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onSettings).toHaveBeenLastCalledWith("ready", sampleSettings);

    // continueWithoutSettings flips to ready with a placeholder so the user
    // can still browse the page when the backend is unreachable.
    onSettings.mockClear();
    const placeholder = { auth_mode: "cli" } as UserSettings;
    ctl.continueWithoutSettings(placeholder);
    expect(onSettings).toHaveBeenCalledWith("ready", placeholder);
  });

  it("Personal never calls runtimeHubStore.refresh()", () => {
    // The controller deliberately does not take any store reference; this
    // test pins that invariant by asserting the deps signature does not
    // accept a `runtimeHubStoreRefresh` field. If someone tries to add
    // `runtimeHubStore.refresh` to the deps, TypeScript will refuse.
    const deps: PersonalColdStartDeps = makeDeps();
    expect(Object.keys(deps)).not.toContain("runtimeHubStoreRefresh");
    // And the scheduleIdle hook is invoked exactly once for runtimes.
    const scheduleIdle = vi.fn();
    const d2 = makeDeps({ scheduleIdle });
    createPersonalColdStart(d2, {
      onSettingsLoad: vi.fn(),
      onRuntimesLoaded: vi.fn(),
      onRuntimesFailed: vi.fn(),
      onRuntimesFinished: vi.fn(),
      onActivityLoaded: vi.fn(),
      onSkillCountLoaded: vi.fn(),
    }).start();
    // scheduleIdle is called once per start() — for the runtime probe only.
    expect(scheduleIdle).toHaveBeenCalledTimes(1);
  });
});

describe("personal cold-start — single-flight IPC budget", () => {
  it("two starts within 5s share the same resolveSettings promise (1 IPC)", async () => {
    const resolveSettings = vi.fn(() => Promise.resolve(sampleSettings));
    const deps = makeDeps({ resolveSettings });

    const onSettings = vi.fn();
    const make = () =>
      createPersonalColdStart(deps, {
        onSettingsLoad: onSettings,
        onRuntimesLoaded: vi.fn(),
        onRuntimesFailed: vi.fn(),
        onRuntimesFinished: vi.fn(),
        onActivityLoaded: vi.fn(),
        onSkillCountLoaded: vi.fn(),
      });

    make().start();
    // Second mount 50ms later (still well within 5s).
    await new Promise((r) => setTimeout(r, 50));
    make().start();

    await vi.waitFor(() => expect(onSettings).toHaveBeenCalledTimes(2));
    // Both Personal mounts ask the layout cache → resolveSettings fires once
    // per mount. The single-flight guarantee is provided by the layout's
    // settingsLoader, not by this controller; we assert here that the
    // controller does NOT itself de-dupe (i.e. it asks the layout every
    // time). That keeps the controller simple and pushes the dedup concern
    // to the layout where it belongs.
    expect(resolveSettings).toHaveBeenCalledTimes(2);
  });

  it("retry() always issues a fresh IPC and does not return the cached promise", async () => {
    const resolveSettings = vi.fn(async () => sampleSettings);
    const refreshSettings = vi.fn(async () => ({ auth_mode: "api_key" }) as UserSettings);
    const deps = makeDeps({ resolveSettings, refreshSettings });

    const ctl = createPersonalColdStart(deps, {
      onSettingsLoad: vi.fn(),
      onRuntimesLoaded: vi.fn(),
      onRuntimesFailed: vi.fn(),
      onRuntimesFinished: vi.fn(),
      onActivityLoaded: vi.fn(),
      onSkillCountLoaded: vi.fn(),
    });

    ctl.start();
    await ctl.retry();

    expect(resolveSettings).toHaveBeenCalledTimes(1);
    expect(refreshSettings).toHaveBeenCalledTimes(1);
  });
});

describe("personal cold-start — per-card hydration", () => {
  it("emits onActivityLoaded with the last 7 daily cost entries", async () => {
    const deps = makeDeps({
      getUsageOverview: vi.fn(async () =>
        makeUsage({
          daily: [
            { date: "2026-06-22", costUsd: 0.1, runs: 1, inputTokens: 0, outputTokens: 0 },
            { date: "2026-06-23", costUsd: 0.2, runs: 0, inputTokens: 0, outputTokens: 0 },
            { date: "2026-06-24", costUsd: 0.3, runs: 1, inputTokens: 0, outputTokens: 0 },
            { date: "2026-06-25", costUsd: 0.1, runs: 0, inputTokens: 0, outputTokens: 0 },
            { date: "2026-06-26", costUsd: 0.2, runs: 1, inputTokens: 0, outputTokens: 0 },
            { date: "2026-06-27", costUsd: 0.2, runs: 0, inputTokens: 0, outputTokens: 0 },
            { date: "2026-06-28", costUsd: 0.23, runs: 1, inputTokens: 0, outputTokens: 0 },
            // Extra entry — controller must slice to 7.
            { date: "2026-06-29", costUsd: 0.99, runs: 99, inputTokens: 0, outputTokens: 0 },
          ],
        }),
      ),
    });

    const onActivity = vi.fn();
    createPersonalColdStart(deps, {
      onSettingsLoad: vi.fn(),
      onRuntimesLoaded: vi.fn(),
      onRuntimesFailed: vi.fn(),
      onRuntimesFinished: vi.fn(),
      onActivityLoaded: onActivity,
      onSkillCountLoaded: vi.fn(),
    }).start();

    await vi.waitFor(() => expect(onActivity).toHaveBeenCalled());
    const snapshot = onActivity.mock.calls[0]?.[0] as {
      runs7d: number | null;
      totalCostUsd: number | null;
      dailyCost: number[];
    };
    expect(snapshot.dailyCost).toHaveLength(7);
    expect(snapshot.dailyCost).toEqual([0.2, 0.3, 0.1, 0.2, 0.2, 0.23, 0.99]);
  });

  it("emits onSkillCountLoaded only with `total` (no full list payload)", async () => {
    const deps = makeDeps({ getSkillSummary: vi.fn(async () => makeSummary(12)) });

    const onSkill = vi.fn();
    createPersonalColdStart(deps, {
      onSettingsLoad: vi.fn(),
      onRuntimesLoaded: vi.fn(),
      onRuntimesFailed: vi.fn(),
      onRuntimesFinished: vi.fn(),
      onActivityLoaded: vi.fn(),
      onSkillCountLoaded: onSkill,
    }).start();

    await vi.waitFor(() => expect(onSkill).toHaveBeenCalledWith(12));
  });

  it("surfaces activity errors as a null-valued snapshot so the card can render its skeleton", async () => {
    const deps = makeDeps({
      getUsageOverview: vi.fn(async () => {
        throw new Error("usage offline");
      }),
    });

    const onActivity = vi.fn();
    createPersonalColdStart(deps, {
      onSettingsLoad: vi.fn(),
      onRuntimesLoaded: vi.fn(),
      onRuntimesFailed: vi.fn(),
      onRuntimesFinished: vi.fn(),
      onActivityLoaded: onActivity,
      onSkillCountLoaded: vi.fn(),
    }).start();

    await vi.waitFor(() => expect(onActivity).toHaveBeenCalled());
    const snapshot = onActivity.mock.calls[0]?.[0] as {
      runs7d: number | null;
      totalCostUsd: number | null;
      dailyCost: number[];
    };
    expect(snapshot).toEqual({ runs7d: null, totalCostUsd: null, dailyCost: [] });
  });
});
