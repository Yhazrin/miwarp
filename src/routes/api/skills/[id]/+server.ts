/**
 * Individual Skill API endpoint
 *
 * Handles GET, PUT, DELETE operations for a specific skill.
 */
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { dbg, dbgWarn } from "$lib/utils/debug";
import type { Skill } from "$lib/types/skill";

// Shared skill storage (in production would use a database)
// For now we import from parent, but in real app would be a service
const skills: Skill[] = [];

export const GET: RequestHandler = async ({ params }) => {
  const { id } = params;

  const skill = skills.find((s) => s.id === id);
  if (!skill) {
    return json({ error: "Skill not found" }, { status: 404 });
  }

  return json({ skill });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const { id } = params;

  try {
    const body = await request.json();
    const index = skills.findIndex((s) => s.id === id);

    if (index === -1) {
      return json({ error: "Skill not found" }, { status: 404 });
    }

    // Update the skill
    const updatedSkill = {
      ...skills[index],
      ...body,
      updatedAt: new Date().toISOString(),
    };

    skills[index] = updatedSkill;
    dbg("api-skills-id", "PUT", { id });

    return json({ skill: updatedSkill });
  } catch (e) {
    dbgWarn("api-skills-id", "PUT error", e);
    return json({ error: "Invalid request body" }, { status: 400 });
  }
};

export const DELETE: RequestHandler = async ({ params }) => {
  const { id } = params;

  const index = skills.findIndex((s) => s.id === id);
  if (index === -1) {
    return json({ error: "Skill not found" }, { status: 404 });
  }

  const skill = skills[index];
  if (skill.isBuiltIn) {
    return json({ error: "Cannot delete built-in skills" }, { status: 403 });
  }

  skills.splice(index, 1);
  dbg("api-skills-id", "DELETE", { id });

  return json({ success: true });
};
