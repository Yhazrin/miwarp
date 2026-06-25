import { describe, expect, it } from "vitest";
import { canDeleteRun } from "./types";

describe("canDeleteRun", () => {
  it("allows idle sessions between turns", () => {
    expect(canDeleteRun("idle")).toBe(true);
  });

  it("blocks actively executing runs", () => {
    expect(canDeleteRun("pending")).toBe(false);
    expect(canDeleteRun("running")).toBe(false);
  });

  it("allows completed and stopped runs", () => {
    expect(canDeleteRun("completed")).toBe(true);
    expect(canDeleteRun("stopped")).toBe(true);
    expect(canDeleteRun("failed")).toBe(true);
  });

  it("allows waiting states", () => {
    expect(canDeleteRun("waiting_input")).toBe(true);
    expect(canDeleteRun("waiting_approval")).toBe(true);
  });
});
