/**
 * Skill Execution API endpoint
 *
 * Handles skill execution requests.
 */
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { skillExecutor } from "$lib/services/skill-executor";
import type { Skill } from "$lib/types/skill";

// Import skill storage from main API (in production would use a database)
const skills: Skill[] = [];

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const { skillId, skillName, args = "" } = body;

    dbg("api-skills-execute", "POST", { skillId, skillName, args });

    // Find the skill
    const skill = skills.find(
      (s) => s.id === skillId || s.name.toLowerCase() === skillName?.toLowerCase(),
    );

    if (!skill) {
      // Return help output for unknown skills
      return json({
        success: true,
        result: `Skill "${skillName}" not found. Available built-in skills:\n- /schedule - Create scheduled tasks\n- /consolidate-memory - Organize memory files\n- /setup-cowork - Guided setup`,
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
