/**
 * Skill dependency resolver service.
 * Handles skill-to-skill dependencies, version checking, and dependency resolution.
 * Based on Claude Code/Cowork design patterns.
 */
import type { Skill, SkillDependency } from "$lib/types/skill";

export interface DependencyResult {
  resolved: string[]; // Successfully resolved skill IDs
  missing: string[]; // Missing skill IDs
  versionMismatch: Array<{
    skillId: string;
    required: string;
    found?: string;
  }>;
}

/**
 * Resolve dependencies for a skill.
 */
export function resolveDependencies(
  skillId: string,
  skills: Skill[],
  getSkillById: (id: string) => Skill | undefined,
): DependencyResult {
  const skill = getSkillById(skillId);
  if (!skill?.dependencies?.length) {
    return { resolved: [], missing: [], versionMismatch: [] };
  }

  const resolved: string[] = [];
  const missing: string[] = [];
  const versionMismatch: DependencyResult["versionMismatch"] = [];

  const resolve = (deps: SkillDependency[], chain: Set<string> = new Set()): void => {
    for (const dep of deps) {
      if (chain.has(dep.skillId)) {
        // Circular dependency detected
        continue;
      }

      const depSkill = getSkillById(dep.skillId);
      if (!depSkill) {
        missing.push(dep.skillId);
        continue;
      }

      // Check version constraint
      if (dep.version && !satisfiesVersion(depSkill.version || "1.0.0", dep.version)) {
        versionMismatch.push({
          skillId: dep.skillId,
          required: dep.version,
          found: depSkill.version,
        });
        continue;
      }

      resolved.push(dep.skillId);
      chain.add(dep.skillId);

      // Recursively resolve dependencies
      if (depSkill.dependencies?.length) {
        resolve(depSkill.dependencies, chain);
      }
    }
  };

  resolve(skill.dependencies);

  return {
    resolved: [...new Set(resolved)], // Deduplicate
    missing: [...new Set(missing)],
    versionMismatch,
  };
}

/**
 * Check if all dependencies for a skill are satisfied.
 */
export function checkDependencies(
  skillId: string,
  skills: Skill[],
  getSkillById: (id: string) => Skill | undefined,
): { satisfied: boolean; errors: string[] } {
  const result = resolveDependencies(skillId, skills, getSkillById);
  const errors: string[] = [];

  for (const missingId of result.missing) {
    errors.push(`Missing dependency: ${missingId}`);
  }

  for (const mismatch of result.versionMismatch) {
    errors.push(
      `Version mismatch for ${mismatch.skillId}: requires ${mismatch.required}, found ${mismatch.found || "none"}`,
    );
  }

  return {
    satisfied: result.missing.length === 0 && result.versionMismatch.length === 0,
    errors,
  };
}

/**
 * Get installation order for skills (topologically sorted).
 */
export function getInstallOrder(
  skillIds: string[],
  getSkillById: (id: string) => Skill | undefined,
): string[] {
  const visited = new Set<string>();
  const order: string[] = [];

  const visit = (id: string, visiting: Set<string> = new Set()): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      // Circular dependency - skip
      return;
    }

    visiting.add(id);
    const skill = getSkillById(id);
    if (skill?.dependencies?.length) {
      for (const dep of skill.dependencies) {
        visit(dep.skillId, visiting);
      }
    }

    visiting.delete(id);
    visited.add(id);
    order.push(id);
  };

  for (const id of skillIds) {
    visit(id);
  }

  return order;
}

/**
 * Simple semver-like version comparison.
 */
export function satisfiesVersion(installedVersion: string, constraint: string): boolean {
  if (!constraint) return true;
  if (!installedVersion) return false;

  const parse = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);

  const [a = 0, b = 0, c = 0] = parse(installedVersion);
  const cons = constraint.trim();

  if (cons.startsWith(">=")) {
    const [ca = 0, cb = 0, cc = 0] = parse(cons.slice(2));
    return a > ca || (a === ca && b > cb) || (a === ca && b === cb && c >= cc);
  }
  if (cons.startsWith(">")) {
    const [ca = 0, cb = 0, cc = 0] = parse(cons.slice(1));
    return a > ca || (a === ca && b > cb) || (a === ca && b === cb && c > cc);
  }
  if (cons.startsWith("<=")) {
    const [ca = 0, cb = 0, cc = 0] = parse(cons.slice(2));
    return a < ca || (a === ca && b < cb) || (a === ca && b === cb && c <= cc);
  }
  if (cons.startsWith("<")) {
    const [ca = 0, cb = 0, cc = 0] = parse(cons.slice(1));
    return a < ca || (a === ca && b < cb) || (a === ca && b === cb && c < cc);
  }
  if (cons.startsWith("=")) {
    return installedVersion === cons.slice(1).trim();
  }
  if (cons.startsWith("^")) {
    const [ca = 0, cb = 0] = parse(cons.slice(1));
    return a === ca && b >= cb;
  }
  if (cons.startsWith("~")) {
    const [ca = 0, cb = 0, cc = 0] = parse(cons.slice(1));
    return a === ca && b === cb && c >= cc;
  }

  // Default: exact match
  return installedVersion === cons;
}

/**
 * Compare two versions for sorting.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);

  const [a1 = 0, a2 = 0, a3 = 0] = parse(a);
  const [b1 = 0, b2 = 0, b3 = 0] = parse(b);

  if (a1 !== b1) return b1 - a1;
  if (a2 !== b2) return b2 - a2;
  return b3 - a3;
}
