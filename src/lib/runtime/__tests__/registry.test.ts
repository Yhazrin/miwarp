import { describe, expect, it } from "vitest";
import {
  agentToRuntimeId,
  getRuntimeLaunchSupport,
  isStartableRuntime,
  isSupportedRuntimeId,
  listRuntimeDescriptors,
  mergeRuntimeAvailability,
  normalizeSessionAgent,
  resolveSelectionFallback,
  runtimeIdToAgent,
  usesStreamSession,
} from "../registry";

describe("runtime registry descriptors", () => {
  it("lists all supported ids in sort order", () => {
    const ids = listRuntimeDescriptors().map((d) => d.id);
    expect(ids).toEqual([
      "claude",
      "codex",
      "mimo",
      "opencode",
      "cursor",
      "gemini",
      "aider",
      "qwen-code",
      "custom",
    ]);
  });

  it("classifies startable vs coming-soon launch support", () => {
    expect(isStartableRuntime("claude")).toBe(true);
    expect(isStartableRuntime("codex")).toBe(true);
    expect(isStartableRuntime("mimo")).toBe(true);
    expect(isStartableRuntime("opencode")).toBe(true);
    expect(isStartableRuntime("cursor")).toBe(true);
    expect(getRuntimeLaunchSupport("cursor")).toBe("startable");
    expect(getRuntimeLaunchSupport("gemini")).toBe("coming-soon");
    expect(getRuntimeLaunchSupport("custom")).toBe("coming-soon");
  });

  it("guards supported runtime ids", () => {
    expect(isSupportedRuntimeId("codex")).toBe(true);
    expect(isSupportedRuntimeId("not-a-runtime")).toBe(false);
  });
});

describe("mergeRuntimeAvailability", () => {
  it("marks coming-soon descriptors as non-selectable", () => {
    const resolved = mergeRuntimeAvailability({});
    const gemini = resolved.find((r) => r.id === "gemini");
    expect(gemini?.status).toBe("coming-soon");
    expect(gemini?.selectable).toBe(false);
    expect(gemini?.available).toBe(false);
  });

  it("merges detection for startable runtimes", () => {
    const resolved = mergeRuntimeAvailability({
      codex: { available: true, binary: "/usr/bin/codex", version: "0.9.0" },
      mimo: { available: false, binary: "mimo", version: null },
    });

    const codex = resolved.find((r) => r.id === "codex");
    expect(codex?.available).toBe(true);
    expect(codex?.selectable).toBe(true);
    expect(codex?.version).toBe("0.9.0");

    const mimo = resolved.find((r) => r.id === "mimo");
    expect(mimo?.available).toBe(false);
    expect(mimo?.selectable).toBe(false);
    expect(mimo?.status).toBe("unavailable");
  });

  it("marks a detected cursor runtime as available and chat-selectable", () => {
    const cursor = mergeRuntimeAvailability({
      cursor: { available: true, binary: "/usr/local/bin/agent", version: "1.0" },
    }).find((runtime) => runtime.id === "cursor");
    expect(cursor?.available).toBe(true);
    expect(cursor?.selectable).toBe(true);
    expect(cursor?.status).toBe("available");
  });

  it("does not claim a startable runtime is available without detection", () => {
    const claude = mergeRuntimeAvailability({}).find((r) => r.id === "claude");
    expect(claude?.available).toBe(false);
    expect(claude?.selectable).toBe(false);
  });
});

describe("resolveSelectionFallback", () => {
  const resolved = mergeRuntimeAvailability({
    codex: { available: false },
    mimo: { available: true, binary: "mimo", version: "1.0" },
  });

  it("keeps selectable selection", () => {
    expect(resolveSelectionFallback("mimo", resolved)).toBe("mimo");
  });

  it("falls back to first detected selectable runtime", () => {
    expect(resolveSelectionFallback("codex", resolved)).toBe("mimo");
  });

  it("falls back to claude when nothing is selectable", () => {
    const none = mergeRuntimeAvailability({
      claude: { available: false },
      codex: { available: false },
      mimo: { available: false },
    });
    expect(resolveSelectionFallback("mimo", none)).toBe("claude");
  });
});

describe("session agent pass-through", () => {
  it("maps runtime ids to backend agent strings", () => {
    expect(runtimeIdToAgent("codex")).toBe("codex");
    expect(runtimeIdToAgent("qwen-code")).toBe("qwen-code");
  });

  it("normalizes aliases and empty values", () => {
    expect(normalizeSessionAgent("mimocode")).toBe("mimo");
    expect(normalizeSessionAgent("")).toBe("claude");
    expect(agentToRuntimeId("codex")).toBe("codex");
  });

  it("classifies stream-session agents", () => {
    expect(usesStreamSession("claude")).toBe(true);
    expect(usesStreamSession("mimo")).toBe(true);
    expect(usesStreamSession("codex")).toBe(false);
    expect(usesStreamSession("opencode")).toBe(false);
  });
});
