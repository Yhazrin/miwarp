/**
 * Skill Validator - Ensures skills are self-contained
 *
 * Based on Codex Claude Cowork design patterns.
 * Scheduled tasks run without access to the original session,
 * so all context must be embedded in the skill prompt.
 *
 * Usage:
 * ```typescript
 * const result = validateSkill(skill);
 * if (!result.valid) {
 *   console.error(result.errors);
 * }
 * ```
 */

export interface ValidationError {
  code: string;
  message: string;
  location?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface Skill {
  name: string;
  description: string;
  prompt?: string;
  frontmatter?: Record<string, unknown>;
  content?: string;
}

const FORBIDDEN_PATTERNS = [
  { pattern: /current conversation/i, code: "FORBIDDEN_REFERENCE" },
  { pattern: /the above/i, code: "FORBIDDEN_REFERENCE" },
  { pattern: /previous message/i, code: "FORBIDDEN_REFERENCE" },
  { pattern: /as mentioned earlier/i, code: "FORBIDDEN_REFERENCE" },
  { pattern: /from the context/i, code: "FORBIDDEN_REFERENCE" },
  { pattern: /in our conversation/i, code: "FORBIDDEN_REFERENCE" },
  { pattern: /earlier we discussed/i, code: "FORBIDDEN_REFERENCE" },
  { pattern: /this conversation/i, code: "FORBIDDEN_REFERENCE" },
  { pattern: /the session/i, code: "FORBIDDEN_REFERENCE" },
  { pattern: /your last message/i, code: "FORBIDDEN_REFERENCE" },
];

const REQUIRED_FRONTMATTER = ["name", "description"];

const RECOMMENDED_PATTERNS = [
  {
    pattern: /\{taskId\}/i,
    warning: "MISSING_TASK_ID",
    suggestion: "Use {taskId} to reference the scheduled task",
  },
  {
    pattern: /\{description\}/i,
    warning: "MISSING_DESCRIPTION",
    suggestion: "Use {description} to reference the task description",
  },
  {
    pattern: /\{date\}|{time\}|{now\}/i,
    warning: "MISSING_TIMESTAMP",
    suggestion: "Consider adding timestamp context",
  },
];

/**
 * Validate that a skill is self-contained and safe for scheduled execution
 */
export function validateSkill(skill: Skill): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Check required frontmatter fields
  for (const field of REQUIRED_FRONTMATTER) {
    if (!skill.frontmatter?.[field] && !skill[field as keyof Skill]) {
      errors.push({
        code: "MISSING_FIELD",
        message: `Skill frontmatter missing required field: ${field}`,
      });
    }
  }

  // Get the content to validate
  const content = skill.prompt || skill.content || "";

  if (!content) {
    warnings.push({
      code: "EMPTY_CONTENT",
      message: "Skill has no prompt or content to validate",
    });
  }

  // Check for forbidden references
  for (const { pattern, code } of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) {
      errors.push({
        code,
        message: `Skill content contains forbidden reference: "${pattern.source}"`,
        location: "prompt/content",
      });
    }
  }

  // Check for recommended patterns
  for (const { pattern, warning, suggestion } of RECOMMENDED_PATTERNS) {
    if (!pattern.test(content)) {
      warnings.push({
        code: warning,
        message: `Skill content doesn't use recommended pattern: ${warning}`,
        suggestion,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate multiple skills at once
 */
export function validateSkills(skills: Skill[]): Map<string, ValidationResult> {
  const results = new Map<string, ValidationResult>();

  for (const skill of skills) {
    const name = skill.name || (skill.frontmatter?.name as string) || "unknown";
    results.set(name, validateSkill(skill));
  }

  return results;
}

/**
 * Check if a skill is safe for scheduled execution
 */
export function isSafeForScheduling(skill: Skill): boolean {
  const result = validateSkill(skill);
  return result.valid;
}

/**
 * Get a summary report of validation results
 */
export function formatValidationReport(results: Map<string, ValidationResult>): string {
  const lines: string[] = ["# Skill Validation Report", ""];

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const [name, result] of results) {
    lines.push(`## ${name}`);
    lines.push(`- Valid: ${result.valid ? "✅" : "❌"}`);
    lines.push(`- Errors: ${result.errors.length}`);
    lines.push(`- Warnings: ${result.warnings.length}`);

    if (result.errors.length > 0) {
      lines.push("");
      lines.push("**Errors:**");
      for (const err of result.errors) {
        lines.push(`  - [${err.code}] ${err.message}`);
      }
    }

    if (result.warnings.length > 0) {
      lines.push("");
      lines.push("**Warnings:**");
      for (const warn of result.warnings) {
        lines.push(`  - [${warn.code}] ${warn.message}`);
        if (warn.suggestion) {
          lines.push(`    Suggestion: ${warn.suggestion}`);
        }
      }
    }

    lines.push("");
    totalErrors += result.errors.length;
    totalWarnings += result.warnings.length;
  }

  lines.push("---");
  lines.push(`**Summary:** ${totalErrors} errors, ${totalWarnings} warnings`);

  return lines.join("\n");
}
