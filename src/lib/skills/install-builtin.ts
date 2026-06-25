import { createSkill } from "$lib/api";
import { createBuiltInSkills } from "./builtin-catalog";
import type { Skill } from "$lib/types/skill";

export function listRecommendedBuiltInSkills(): Skill[] {
  return createBuiltInSkills();
}

export function findBuiltInSkill(name: string): Skill | undefined {
  return createBuiltInSkills().find((skill) => skill.name === name);
}

export async function installBuiltInSkill(
  name: string,
  scope: "user" | "project",
  cwd?: string,
): Promise<void> {
  const skill = findBuiltInSkill(name);
  if (!skill?.content) {
    throw new Error(`Unknown built-in skill: ${name}`);
  }
  await createSkill(skill.name, skill.description, skill.content, scope, cwd);
}

export async function installAllBuiltInSkills(
  scope: "user" | "project",
  installedNames: ReadonlySet<string>,
  cwd?: string,
): Promise<number> {
  const pending = listRecommendedBuiltInSkills().filter((skill) => !installedNames.has(skill.name));
  for (const skill of pending) {
    await installBuiltInSkill(skill.name, scope, cwd);
  }
  return pending.length;
}
