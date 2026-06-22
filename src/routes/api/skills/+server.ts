/**
 * Skills API endpoint
 *
 * Handles CRUD operations for skills via REST API.
 */
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { createBuiltInSkills } from "$lib/skills/builtin-catalog";
import type { Skill } from "$lib/types/skill";
import { dbg, dbgWarn } from "$lib/utils/debug";

// In-memory custom skill storage with immutable built-ins seeded from one catalog.
const skills: Skill[] = createBuiltInSkills();

export const GET: RequestHandler = async () => {
  dbg("api-skills", "GET list");
  return json({ skills, count: skills.length });
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = (await request.json()) as Partial<Skill>;

    if (!body.name || !body.description || !body.content) {
      return json(
        { error: "Missing required fields: name, description, content" },
        { status: 400 },
      );
    }

    if (skills.some((skill) => skill.name === body.name)) {
      return json({ error: "A skill with this name already exists" }, { status: 409 });
    }

    const newSkill: Skill = {
      id: body.id || `skill-${Date.now()}`,
      name: body.name,
      description: body.description,
      content: body.content,
      category: body.category || "custom",
      source: body.source || "local",
      isBuiltIn: false,
      createdAt: body.createdAt || new Date().toISOString(),
      updatedAt: body.updatedAt || new Date().toISOString(),
      author: body.author,
      tags: body.tags,
      icon: body.icon || "sparkles",
    };

    skills.push(newSkill);
    dbg("api-skills", "POST created", { id: newSkill.id, name: newSkill.name });

    return json({ skill: newSkill }, { status: 201 });
  } catch (error) {
    dbgWarn("api-skills", "POST error", error);
    return json({ error: "Invalid request body" }, { status: 400 });
  }
};
