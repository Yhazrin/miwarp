import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  findBuiltInSkill,
  installAllBuiltInSkills,
  installBuiltInSkill,
  listRecommendedBuiltInSkills,
} from "./install-builtin";

vi.mock("$lib/api", () => ({
  createSkill: vi.fn().mockResolvedValue({ name: "mind-map", path: "/tmp/mind-map" }),
}));

import { createSkill } from "$lib/api";

describe("install-builtin", () => {
  beforeEach(() => {
    vi.mocked(createSkill).mockClear();
  });

  it("lists recommended built-in skills", () => {
    const skills = listRecommendedBuiltInSkills();
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.some((skill) => skill.name === "architecture-diagram")).toBe(true);
  });

  it("installs a built-in skill via createSkill", async () => {
    await installBuiltInSkill("mind-map", "user");
    expect(createSkill).toHaveBeenCalledWith(
      "mind-map",
      expect.any(String),
      expect.stringContaining("# Mind Map"),
      "user",
      undefined,
    );
  });

  it("throws for unknown built-in skill", async () => {
    await expect(installBuiltInSkill("missing-skill", "user")).rejects.toThrow(
      "Unknown built-in skill",
    );
  });

  it("installs only missing built-in skills", async () => {
    const count = await installAllBuiltInSkills("user", new Set(["mind-map"]));
    expect(count).toBe(listRecommendedBuiltInSkills().length - 1);
    expect(createSkill).toHaveBeenCalledTimes(count);
    expect(findBuiltInSkill("mind-map")?.name).toBe("mind-map");
  });
});
