import { describe, expect, it } from "vitest";
import {
  applySoundFeedbackLevel,
  getSoundFeedbackLevel,
  normalizeSoundFeedbackLevel,
} from "../sound-feedback-service";

describe("sound-feedback-service", () => {
  it("normalizes unknown levels to minimal", () => {
    expect(normalizeSoundFeedbackLevel(undefined)).toBe("minimal");
    expect(normalizeSoundFeedbackLevel("loud")).toBe("minimal");
  });

  it("applies off level", () => {
    applySoundFeedbackLevel("off");
    expect(getSoundFeedbackLevel()).toBe("off");
    applySoundFeedbackLevel("minimal");
  });
});
