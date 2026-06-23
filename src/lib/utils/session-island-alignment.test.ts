import { describe, expect, it } from "vitest";
import { normalizeSessionIslandAlignment } from "./session-island-alignment";

describe("normalizeSessionIslandAlignment", () => {
  it("returns center for center", () => {
    expect(normalizeSessionIslandAlignment("center")).toBe("center");
  });

  it("returns right for right", () => {
    expect(normalizeSessionIslandAlignment("right")).toBe("right");
  });

  it("returns center for undefined", () => {
    expect(normalizeSessionIslandAlignment(undefined)).toBe("center");
  });

  it("returns center for unknown and invalid strings", () => {
    expect(normalizeSessionIslandAlignment(null)).toBe("center");
    expect(normalizeSessionIslandAlignment("left")).toBe("center");
    expect(normalizeSessionIslandAlignment("")).toBe("center");
    expect(normalizeSessionIslandAlignment(42)).toBe("center");
  });
});
