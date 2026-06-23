import { describe, expect, it } from "vitest";
import { builtInSkillNames, createBuiltInSkills } from "./builtin-catalog";

describe("built-in skill catalog", () => {
  it("returns unique built-in skills", () => {
    const skills = createBuiltInSkills();
    const names = skills.map((skill) => skill.name);
    const ids = skills.map((skill) => skill.id);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect(builtInSkillNames()).toEqual(names);
    expect(skills.every((skill) => skill.isBuiltIn && skill.source === "builtin")).toBe(true);
  });

  it.each([
    "visualize-data",
    "architecture-diagram",
    "project-status-dashboard",
    "decision-map",
    "mind-map",
  ])("preinstalls %s", (name) => {
    const skill = createBuiltInSkills().find((candidate) => candidate.name === name);
    expect(skill).toBeDefined();
    expect(skill?.author).toBe("MiWarp");
    expect(skill?.version).toBe("1.0.0");
  });

  it("returns independent copies", () => {
    const first = createBuiltInSkills();
    const second = createBuiltInSkills();
    first[0].description = "changed";
    first[0].tags?.push("extra");
    expect(second[0].description).not.toBe("changed");
    expect(second[0].tags).not.toContain("extra");
  });
});
