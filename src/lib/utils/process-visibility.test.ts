import { describe, expect, it } from "vitest";
import {
  PROCESS_VISIBILITY_LEVELS,
  normalizeProcessVisibility,
  shouldHideToolCards,
  shouldShowContextDetails,
  shouldShowFullToolPayload,
  shouldShowThinking,
  shouldShowToolCards,
} from "./process-visibility";

describe("process visibility presets", () => {
  it("exposes only conversation and full-display presets", () => {
    expect(PROCESS_VISIBILITY_LEVELS).toEqual(["output", "expert"]);
  });

  it("migrates the legacy four-level values into two canonical presets", () => {
    expect(normalizeProcessVisibility("output")).toBe("output");
    expect(normalizeProcessVisibility("guided")).toBe("output");
    expect(normalizeProcessVisibility("developer")).toBe("expert");
    expect(normalizeProcessVisibility("expert")).toBe("expert");
    expect(normalizeProcessVisibility("unknown")).toBe("expert");
  });

  it("keeps conversation mode clean and full mode complete", () => {
    expect(shouldHideToolCards("output")).toBe(true);
    expect(shouldShowThinking("output")).toBe(false);
    expect(shouldShowToolCards("output")).toBe(false);
    expect(shouldShowContextDetails("output")).toBe(false);
    expect(shouldShowFullToolPayload("output")).toBe(false);

    expect(shouldHideToolCards("expert")).toBe(false);
    expect(shouldShowThinking("expert")).toBe(true);
    expect(shouldShowToolCards("expert")).toBe(true);
    expect(shouldShowContextDetails("expert")).toBe(true);
    expect(shouldShowFullToolPayload("expert")).toBe(true);
  });
});
