import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/api", () => ({
  checkAgentCli: vi.fn(),
  detectMimoRuntime: vi.fn(),
}));

import * as api from "$lib/api";
import {
  probeRuntimeAvailability,
  probeRuntimeAvailabilityFor,
  probeRuntimeAvailabilityWithStatus,
} from "../availability";

const mockCheckAgentCli = vi.mocked(api.checkAgentCli);
const mockDetectMimoRuntime = vi.mocked(api.detectMimoRuntime);

describe("runtime availability probes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps controlled CLI probes into runtime detections", async () => {
    mockCheckAgentCli.mockImplementation(async (agent) => {
      const fixtures: Record<string, { path: string; version: string }> = {
        claude: { path: "/opt/homebrew/bin/claude", version: "2.1.161" },
        codex: { path: "/Users/test/.local/bin/codex", version: "0.24.0" },
        opencode: { path: "/Users/test/.local/bin/opencode", version: "1.17.9" },
        cursor: { path: "/usr/local/bin/cursor", version: "2.3.1" },
      };
      const fixture = fixtures[agent];
      return fixture
        ? { agent, found: true, path: fixture.path, version: fixture.version }
        : { agent, found: false };
    });
    mockDetectMimoRuntime.mockResolvedValue({
      available: true,
      binary: "/Users/test/.local/bin/mimo",
      version: "1.3.0",
    });

    await expect(probeRuntimeAvailability()).resolves.toEqual({
      claude: {
        available: true,
        binary: "/opt/homebrew/bin/claude",
        version: "2.1.161",
      },
      codex: {
        available: true,
        binary: "/Users/test/.local/bin/codex",
        version: "0.24.0",
      },
      mimo: {
        available: true,
        binary: "/Users/test/.local/bin/mimo",
        version: "1.3.0",
      },
      opencode: {
        available: true,
        binary: "/Users/test/.local/bin/opencode",
        version: "1.17.9",
      },
      cursor: {
        available: true,
        binary: "/usr/local/bin/cursor",
        version: "2.3.1",
      },
    });
  });

  it("does not claim runtimes are available when probes fail", async () => {
    mockCheckAgentCli.mockRejectedValue(new Error("transport unavailable"));
    mockDetectMimoRuntime.mockRejectedValue(new Error("transport unavailable"));

    const result = await probeRuntimeAvailability();

    expect(result.claude?.available).toBe(false);
    expect(result.codex?.available).toBe(false);
    expect(result.mimo?.available).toBe(false);
    expect(result.opencode?.available).toBe(false);
    expect(result.cursor?.available).toBe(false);
  });

  it("reports a total probe failure only when every probe rejects", async () => {
    mockCheckAgentCli.mockRejectedValue(new Error("transport unavailable"));
    mockDetectMimoRuntime.mockRejectedValue(new Error("transport unavailable"));

    await expect(probeRuntimeAvailabilityWithStatus()).resolves.toMatchObject({
      probeFailed: true,
    });
  });

  it("keeps partial probe failures as usable availability data", async () => {
    mockCheckAgentCli.mockImplementation(async (agent) => {
      if (agent === "cursor") throw new Error("cursor probe unavailable");
      return { agent, found: false };
    });
    mockDetectMimoRuntime.mockResolvedValue({
      available: false,
      binary: "mimo",
      version: null,
    });

    const result = await probeRuntimeAvailabilityWithStatus();

    expect(result.probeFailed).toBe(false);
    expect(result.detections.cursor?.available).toBe(false);
    expect(result.detections.claude?.available).toBe(false);
  });

  it("returns a single runtime snapshot through the convenience probe", async () => {
    mockCheckAgentCli.mockImplementation(async (agent) => ({
      agent,
      found: agent === "codex",
      version: agent === "codex" ? "0.24.0" : undefined,
    }));
    mockDetectMimoRuntime.mockResolvedValue({
      available: false,
      binary: "mimo",
      version: null,
    });

    await expect(probeRuntimeAvailabilityFor("codex")).resolves.toEqual({
      available: true,
      binary: "codex",
      version: "0.24.0",
    });
  });
});
