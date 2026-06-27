import { describe, expect, it } from "vitest";
import {
  isRealRuntimeE2eEnabled,
  parseSelectedRuntimes,
  shouldSkipForProbeState,
  skipLabelForProbeState,
  SKIPPED_ENVIRONMENT,
} from "./constants";

describe("runtime real e2e constants", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(isRealRuntimeE2eEnabled({})).toBe(false);
    expect(isRealRuntimeE2eEnabled({ MIWARP_RUNTIME_REAL_E2E: "1" })).toBe(true);
    expect(isRealRuntimeE2eEnabled({ MIWARP_RUNTIME_REAL_E2E: "true" })).toBe(true);
  });

  it("maps non-ready probe states to SKIPPED_ENVIRONMENT", () => {
    expect(shouldSkipForProbeState("ready")).toBe(false);
    expect(shouldSkipForProbeState("binary_missing")).toBe(true);
    expect(skipLabelForProbeState("unauthenticated")).toBe(SKIPPED_ENVIRONMENT);
    expect(skipLabelForProbeState("ready")).toBeNull();
  });

  it("parses runtime filters", () => {
    expect(parseSelectedRuntimes("claude,mimo")).toEqual(["claude", "mimo"]);
    expect(parseSelectedRuntimes(undefined)).toEqual([
      "claude",
      "codex",
      "mimo",
      "opencode",
      "cursor",
    ]);
    expect(parseSelectedRuntimes("claude,gemini")).toEqual(["claude"]);
  });
});
