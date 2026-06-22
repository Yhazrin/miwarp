/**
 * Skill Execution API endpoint
 *
 * Handles skill execution requests.
 */
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { skillExecutor } from "$lib/services/skill-executor";
import { createBuiltInSkills } from "$lib/skills/builtin-catalog";
import { dbg, dbgWarn } from "$lib/utils/debug";

const skills = createBuiltInSkills();

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const { skillId, skillName, args = "" } = body;

    dbg("api-skills-execute", "POST", {
      skillId,
      skillName,
      hasArgs: typeof args === "string" && args.length > 0,
    });

    // Find the skill
    const skill = skills.find(
      (s) => s.id === skillId || s.name.toLowerCase() === skillName?.toLowerCase(),
    );

    if (!skill) {
      const available = skills
        .map((candidate) => `- /${candidate.name} - ${candidate.description}`)
        .join("\n");
      return json({
        success: true,
        result: `Skill "${skillName}" not found. Available built-in skills:\n${available}`,
      });
    }

    // Execute the skill
    const result = await skillExecutor.execute(skill, args);

    return json({
      success: result.success,
      result: result.output,
      error: result.error,
      metadata: result.metadata,
    });
  } catch (e) {
    dbgWarn("api-skills-execute", "error", e);
    return json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Execution failed",
      },
      { status: 500 },
    );
  }
};
