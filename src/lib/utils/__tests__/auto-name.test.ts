import { describe, expect, it } from "vitest";
import {
  deriveAutoName,
  shouldAutoName,
  shouldTriggerAutoTitle,
  type AutoNameState,
} from "../auto-name";

describe("deriveAutoName", () => {
  it("uses the first line", () => {
    expect(deriveAutoName("Fix login bug\nextra")).toBe("Fix login bug");
  });

  it("truncates long lines", () => {
    const long = "a".repeat(50);
    expect(deriveAutoName(long)).toBe("a".repeat(40) + "…");
  });
});

describe("shouldTriggerAutoTitle", () => {
  const base: AutoNameState = {
    phase: "idle",
    runId: "run-1",
    runName: undefined,
    prompt: "Fix the login bug",
    autoNameDone: false,
  };

  it("fires on first idle with prompt", () => {
    expect(shouldTriggerAutoTitle(base)).toBe(true);
  });

  it("does not fire when already done", () => {
    expect(shouldTriggerAutoTitle({ ...base, autoNameDone: true })).toBe(false);
  });

  it("does not fire when run already has a name", () => {
    expect(shouldTriggerAutoTitle({ ...base, runName: "Named" })).toBe(false);
  });

  it("does not fire for slash commands", () => {
    expect(shouldTriggerAutoTitle({ ...base, prompt: "/help" })).toBe(false);
  });
});

describe("shouldAutoName", () => {
  const base: AutoNameState = {
    phase: "idle",
    runId: "run-1",
    runName: undefined,
    prompt: "Fix the login bug",
    autoNameDone: false,
  };

  it("returns fallback title when triggered", () => {
    const result = shouldAutoName(base);
    expect(result.fire).toBe(true);
    expect(result.autoName).toBe("Fix the login bug");
  });

  it("does not fire when autoNameDone is true", () => {
    expect(shouldAutoName({ ...base, autoNameDone: true }).fire).toBe(false);
  });
});
