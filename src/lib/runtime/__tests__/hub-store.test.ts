import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/api", () => ({
  checkAgentCli: vi.fn(),
  detectMimoRuntime: vi.fn(),
}));

function makeLocalStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", makeLocalStorageMock());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

import * as api from "$lib/api";
import { RuntimeHubStore, RUNTIME_PROBE_TTL_MS } from "$lib/stores/runtime-hub-store.svelte";
import type { RuntimeDetectionMap } from "../types";

const mockCheckAgentCli = vi.mocked(api.checkAgentCli);
const mockDetectMimoRuntime = vi.mocked(api.detectMimoRuntime);

function claudeAndOpenCodeDetections(): RuntimeDetectionMap {
  return {
    claude: { available: true, binary: "/usr/bin/claude", version: "2.1.161" },
    opencode: {
      available: true,
      binary: "/usr/bin/opencode",
      version: "1.17.9",
    },
  };
}

function mimoMissing(): { available: boolean; binary: string; version: null } {
  return { available: false, binary: "mimo", version: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckAgentCli.mockRejectedValue(new Error("not installed"));
  mockDetectMimoRuntime.mockResolvedValue(mimoMissing());
});

afterEach(() => {
  // vi.unstubAllGlobals() runs in the outer afterEach (after stub install).
});

describe("RuntimeHubStore.refresh TTL", () => {
  it("skips probe when last refresh is within TTL unless forced", async () => {
    mockCheckAgentCli.mockImplementation(async (agent) => ({
      agent,
      found: true,
      path: `/usr/bin/${agent}`,
      version: "1.0",
    }));
    mockDetectMimoRuntime.mockResolvedValue(mimoMissing());

    const store = new RuntimeHubStore();
    await store.refresh(true);
    expect(mockCheckAgentCli.mock.calls.length).toBe(4);

    mockCheckAgentCli.mockClear();
    await store.refresh(false);
    expect(mockCheckAgentCli).not.toHaveBeenCalled();

    await store.refresh(true);
    expect(mockCheckAgentCli.mock.calls.length).toBe(4);
    expect(RUNTIME_PROBE_TTL_MS).toBeGreaterThan(0);
  });
});

describe("RuntimeHubStore.refresh single-flight", () => {
  it("runs a single probe even when called concurrently", async () => {
    let probeResolve: () => void = () => {};
    const probeGate = new Promise<void>((r) => {
      probeResolve = r;
    });

    mockCheckAgentCli.mockImplementation(async (agent) => {
      await probeGate;
      return { agent, found: true, path: `/usr/bin/${agent}`, version: "1.0" };
    });
    mockDetectMimoRuntime.mockImplementation(async () => {
      await probeGate;
      return mimoMissing();
    });

    const store = new RuntimeHubStore();
    // Trigger four concurrent refreshes BEFORE the mock resolves.
    const all = Promise.all([store.refresh(), store.refresh(), store.refresh(), store.refresh()]);

    // Yield once so the in-flight performRefresh can kick off its first
    // (and only) probe batch.
    await new Promise((r) => setTimeout(r, 5));

    // All four concurrent refreshes must share the single in-flight probe.
    // If single-flight were broken, we'd see 4 × 4 = 16 calls queued up.
    expect(mockCheckAgentCli.mock.calls.length).toBeLessThanOrEqual(4);

    probeResolve();
    await all;

    // After completion, exactly one batch of 4 probes should have executed.
    expect(mockCheckAgentCli.mock.calls.length).toBe(4);
  });
});

describe("RuntimeHubStore.defaultRuntime", () => {
  it("keeps a still-available default runtime", async () => {
    mockCheckAgentCli.mockImplementation(async (agent) => {
      const detected = claudeAndOpenCodeDetections();
      const entry = detected[agent as keyof RuntimeDetectionMap];
      return entry?.available
        ? { agent, found: true, path: entry.binary, version: entry.version ?? undefined }
        : { agent, found: false };
    });
    mockDetectMimoRuntime.mockResolvedValue(mimoMissing());

    localStorage.setItem("ocv:default-runtime", "opencode");
    const store = new RuntimeHubStore();
    store.init();
    await store.refresh();

    expect(store.defaultRuntime).toBe("opencode");
  });

  it("falls back to a startable runtime when the persisted default is unavailable", async () => {
    mockCheckAgentCli.mockImplementation(async (agent) => {
      const detected = claudeAndOpenCodeDetections();
      const entry = detected[agent as keyof RuntimeDetectionMap];
      return entry?.available
        ? { agent, found: true, path: entry.binary, version: entry.version ?? undefined }
        : { agent, found: false };
    });
    mockDetectMimoRuntime.mockResolvedValue(mimoMissing());

    localStorage.setItem("ocv:default-runtime", "codex"); // not detected
    const store = new RuntimeHubStore();
    store.init();
    await store.refresh();

    // The persisted default "codex" isn't available, so we must fall back
    // to a startable+available runtime (claude or opencode).
    expect(store.defaultRuntime).not.toBe("codex");
    const runtime = store.runtime(store.defaultRuntime);
    expect(runtime?.available).toBe(true);
    expect(runtime?.selectable).toBe(true);
  });

  it("falls back to claude when nothing is selectable", async () => {
    mockCheckAgentCli.mockResolvedValue({ agent: "x", found: false });
    mockDetectMimoRuntime.mockResolvedValue(mimoMissing());

    const store = new RuntimeHubStore();
    localStorage.setItem("ocv:default-runtime", "opencode");
    (store as unknown as { initialized: boolean }).initialized = false;
    store.init();
    await store.refresh();

    expect(store.defaultRuntime).toBe("claude");
  });
});

describe("RuntimeHubStore.setDefault", () => {
  it("refuses to set a desktop runtime as the chat default", async () => {
    mockCheckAgentCli.mockImplementation(async (agent) => {
      if (agent === "cursor") {
        return { agent, found: true, path: "/usr/bin/cursor", version: "1.0" };
      }
      return { agent, found: false };
    });
    mockDetectMimoRuntime.mockResolvedValue(mimoMissing());

    const store = new RuntimeHubStore();
    store.init();
    await store.refresh();

    expect(store.setDefault("cursor")).toBe(false);
    expect(store.defaultRuntime).not.toBe("cursor");
  });

  it("persists accepted defaults to localStorage", async () => {
    mockCheckAgentCli.mockImplementation(async (agent) => {
      const detected = claudeAndOpenCodeDetections();
      const entry = detected[agent as keyof RuntimeDetectionMap];
      return entry?.available
        ? { agent, found: true, path: entry.binary, version: entry.version ?? undefined }
        : { agent, found: false };
    });
    mockDetectMimoRuntime.mockResolvedValue(mimoMissing());

    const store = new RuntimeHubStore();
    store.init();
    await store.refresh();

    expect(store.setDefault("opencode")).toBe(true);
    expect(store.defaultRuntime).toBe("opencode");
    expect(localStorage.getItem("ocv:default-runtime")).toBe("opencode");
  });

  it("refuses to set a runtime that is not available", async () => {
    mockCheckAgentCli.mockResolvedValue({ agent: "x", found: false });
    mockDetectMimoRuntime.mockResolvedValue(mimoMissing());

    const store = new RuntimeHubStore();
    store.init();
    await store.refresh();

    expect(store.setDefault("opencode")).toBe(false);
    expect(store.defaultRuntime).not.toBe("opencode");
  });
});

describe("RuntimeHubStore error recovery", () => {
  it("recovers loading=true after a failed probe and exposes the error", async () => {
    mockCheckAgentCli.mockImplementation(async (_agent) => {
      throw new Error("boom");
    });
    mockDetectMimoRuntime.mockImplementation(async () => {
      throw new Error("boom");
    });

    const store = new RuntimeHubStore();
    store.init();
    await store.refresh();

    expect(store.loading).toBe(false);
    expect(String(store.error)).toMatch(/probe|did not respond/i);
    // detections should be empty + everything marked unavailable
    expect(store.runtimes.find((r) => r.id === "opencode")?.available).toBe(false);
    expect(store.installedCount).toBe(0);
  });

  it("clears the error on a subsequent successful probe", async () => {
    // Phase 1: all probes fail.
    mockCheckAgentCli.mockImplementation(async (_agent) => {
      throw new Error("boom");
    });
    mockDetectMimoRuntime.mockImplementation(async () => {
      throw new Error("boom");
    });

    const store = new RuntimeHubStore();
    store.init();
    await store.refresh();
    expect(String(store.error)).toMatch(/probe|did not respond/i);

    // Phase 2: switch mocks to a successful detection.
    mockCheckAgentCli.mockImplementation(async (agent) => {
      const detected = claudeAndOpenCodeDetections();
      const entry = detected[agent as keyof RuntimeDetectionMap];
      return entry?.available
        ? { agent, found: true, path: entry.binary, version: entry.version ?? undefined }
        : { agent, found: false };
    });
    mockDetectMimoRuntime.mockResolvedValue(mimoMissing());

    await store.refresh(true);
    expect(store.error).toBeNull();
    expect(store.runtimes.find((r) => r.id === "opencode")?.available).toBe(true);
  });
});

describe("RuntimeHubStore probes empty environment", () => {
  it("treats the world as not-installed when nothing is detected", async () => {
    mockCheckAgentCli.mockResolvedValue({ agent: "x", found: false });
    mockDetectMimoRuntime.mockResolvedValue(mimoMissing());

    const store = new RuntimeHubStore();
    store.init();
    await store.refresh();

    expect(store.installedCount).toBe(0);
    expect(store.startableCount).toBe(0);
    expect(store.defaultRuntime).toBe("claude");
  });
});
