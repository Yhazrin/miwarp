import { describe, expect, it } from "vitest";
import { resolveSessionIslandMotionFrame, sessionIslandMotionStyle } from "./session-island-motion";

describe("session island physical motion", () => {
  it("keeps every geometry channel on the same normalized progress", () => {
    const frame = resolveSessionIslandMotionFrame(0.5);

    expect(frame).toMatchObject({
      progress: 0.5,
      shellWidth: 290,
      tier2Width: 212,
      revealWidth: 14,
      railGap: 3,
      contextWidth: 82,
      contextLabelWidth: 38,
      contextLabelMargin: 2,
      tier2Offset: -4,
      tier2Scale: 0.97,
      borderRadius: 20,
      borderAlpha: 0.1,
    });
  });

  it("clamps spring overshoot without invalid capsule geometry", () => {
    expect(resolveSessionIslandMotionFrame(-0.2).progress).toBe(0);
    expect(resolveSessionIslandMotionFrame(1.2).progress).toBe(1);
    expect(resolveSessionIslandMotionFrame(Number.NaN).progress).toBe(0);
  });

  it("emits a single frame of CSS custom properties", () => {
    const style = sessionIslandMotionStyle(1);

    expect(style).toContain("--session-island-motion-progress:1.00000");
    expect(style).toContain("--session-island-motion-shell-width:424.000px");
    expect(style).toContain("--session-island-motion-radius:22.000px");
  });
});
