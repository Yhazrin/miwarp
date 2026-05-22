/**
 * Prompt Validator
 *
 * Validates that skill prompts are self-contained and don't reference
 * session context that won't be available during scheduled execution.
 *
 * Based on Claude Code/Cowork design patterns.
 */

export interface PromptIssue {
  type: "forbidden_reference" | "missing_context" | "unresolved_variable" | "session_dependency";
  severity: "error" | "warning";
  message: string;
  position?: { line: number; column: number };
  suggestion?: string;
}

export interface PromptValidationResult {
  isValid: boolean;
  issues: PromptIssue[];
  suggestions: string[];
  warnings: string[];
}

// Forbidden patterns that indicate session dependency
const FORBIDDEN_PATTERNS = [
  {
    pattern: /current\s+(conversation|session|chat)/i,
    message:
      "References to 'current conversation/session/chat' are not allowed in scheduled skills",
    type: "forbidden_reference" as const,
    suggestion: "Use explicit context parameters instead",
  },
  {
    pattern: /the\s+above/i,
    message: "References to 'the above' content are not allowed",
    type: "forbidden_reference" as const,
    suggestion: "Include the necessary context directly in the prompt",
  },
  {
    pattern: /as\s+mentioned\s+(previously|before)/i,
    message: "References to 'as mentioned previously/before' are not allowed",
    type: "forbidden_reference" as const,
    suggestion: "Repeat or reference the information explicitly",
  },
  {
    pattern: /earlier\s+(in\s+this|we)\s+(conversation|session|chat)/i,
    message: "References to 'earlier in this conversation/session' are not allowed",
    type: "forbidden_reference" as const,
    suggestion: "Include the information directly in the prompt",
  },
  {
    pattern: /previous\s+(message|turn|step)/i,
    message: "References to 'previous message/turn/step' are not allowed",
    type: "forbidden_reference" as const,
    suggestion: "Reference specific content by including it directly",
  },
  {
    pattern: /the\s+last\s+(message|response|output)/i,
    message: "References to 'the last message/response/output' are not allowed",
    type: "forbidden_reference" as const,
    suggestion: "Use explicit parameters or include the context",
  },
  {
    pattern: /this\s+session/i,
    message: "References to 'this session' are not allowed in scheduled skills",
    type: "forbidden_reference" as const,
    suggestion: "Use project path or explicit context instead",
  },
  {
    pattern: /in\s+our\s+(conversation|dialog|exchange)/i,
    message: "References to 'in our conversation/dialog' are not allowed",
    type: "forbidden_reference" as const,
    suggestion: "Use explicit references instead",
  },
  {
    pattern: /\bI\b(?!.*\b(am|was|will|would|should|could)\b)/,
    message: "First-person references may indicate session dependency",
    type: "session_dependency" as const,
    suggestion: "Consider rephrasing from a neutral perspective",
  },
];

// Patterns that suggest missing context
const CONTEXT_PATTERNS = [
  {
    pattern: /\$\{([^}]+)\}/,
    message: "Unresolved template variable detected",
    type: "unresolved_variable" as const,
    suggestion: "Ensure all template variables are defined or provide defaults",
  },
  {
    pattern: /\{\{([^}]+)\}\}/,
    message: "Unresolved template variable detected",
    type: "unresolved_variable" as const,
    suggestion: "Replace with actual values or use parameters",
  },
];

// Warning patterns
const WARNING_PATTERNS = [
  {
    pattern: /TODO|FIXME|HACK|XXX/i,
    message: "Contains TODO/FIXME markers - may need attention before scheduling",
    type: "missing_context" as const,
  },
  {
    pattern: /\?\?/,
    message: "Contains unresolved placeholders",
    type: "unresolved_variable" as const,
  },
];

/**
 * Validate that a prompt is self-contained for scheduled execution.
 */
export function validateSelfContained(prompt: string): PromptValidationResult {
  const issues: PromptIssue[] = [];
  const suggestions: string[] = [];
  const warnings: string[] = [];

  const lines = prompt.split("\n");

  // Check each line for forbidden patterns
  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    for (const fp of FORBIDDEN_PATTERNS) {
      const match = line.match(fp.pattern);
      if (match) {
        issues.push({
          type: fp.type,
          severity: fp.type === "session_dependency" ? "warning" : "error",
          message: fp.message,
          position: { line: lineNumber, column: match.index! + 1 },
          suggestion: fp.suggestion,
        });
      }
    }

    // Check for unresolved variables
    for (const cp of CONTEXT_PATTERNS) {
      const match = line.match(cp.pattern);
      if (match) {
        issues.push({
          type: cp.type,
          severity: "error",
          message: cp.message,
          position: { line: lineNumber, column: match.index! + 1 },
          suggestion: cp.suggestion,
        });
      }
    }

    // Check for warnings
    for (const wp of WARNING_PATTERNS) {
      const match = line.match(wp.pattern);
      if (match) {
        warnings.push(wp.message);
      }
    }
  });

  // Generate suggestions based on issue types
  const issueTypes = new Set(issues.map((i) => i.type));
  if (issueTypes.has("forbidden_reference")) {
    suggestions.push(
      "Consider moving context-dependent references into explicit parameters or frontmatter",
    );
  }
  if (issueTypes.has("unresolved_variable")) {
    suggestions.push("Define all template variables or use static values instead");
  }
  if (issueTypes.has("session_dependency")) {
    suggestions.push(
      "Review the prompt for implicit session references and replace with explicit context",
    );
  }

  return {
    isValid: !issues.some((i) => i.severity === "error"),
    issues,
    suggestions,
    warnings,
  };
}

/**
 * Quick check if prompt contains any forbidden references.
 * Returns true if the prompt is safe for scheduled execution.
 */
export function isPromptSafe(prompt: string): boolean {
  const result = validateSelfContained(prompt);
  return result.isValid;
}

/**
 * Get a summary of validation issues for display.
 */
export function getValidationSummary(result: PromptValidationResult): string {
  if (result.isValid) {
    return result.warnings.length > 0
      ? `Valid with ${result.warnings.length} warning(s)`
      : "Valid - no issues found";
  }

  const errorCount = result.issues.filter((i) => i.severity === "error").length;
  const warningCount = result.issues.filter((i) => i.severity === "warning").length;

  return `${errorCount} error(s), ${warningCount} warning(s)`;
}

/**
 * Format issues for display in UI.
 */
export function formatIssuesForDisplay(issues: PromptIssue[]): string[] {
  return issues.map((issue) => {
    const pos = issue.position ? ` (line ${issue.position.line})` : "";
    return `[${issue.severity}] ${issue.message}${pos}`;
  });
}

/**
 * Create a validation report for scheduled tasks.
 */
export function createValidationReport(
  prompt: string,
  skillName: string,
): {
  passed: boolean;
  report: string;
  issues: PromptIssue[];
} {
  const result = validateSelfContained(prompt);

  const issueLines = result.issues.map((issue) => {
    const pos = issue.position ? `line ${issue.position.line}` : "unknown location";
    return `  - [${issue.severity}] ${issue.message} at ${pos}`;
  });

  const reportLines = [
    `Validation Report for Skill: ${skillName}`,
    "=".repeat(50),
    result.isValid ? "✅ PASSED" : "❌ FAILED",
    "",
    result.issues.length > 0 ? "Issues:" : "No issues found.",
    ...issueLines,
    "",
    result.suggestions.length > 0 ? "Suggestions:" : "",
    ...result.suggestions.map((s) => `  - ${s}`),
  ];

  return {
    passed: result.isValid,
    report: reportLines.join("\n"),
    issues: result.issues,
  };
}

// Export a default validator instance for convenience
export const promptValidator = {
  validate: validateSelfContained,
  isSafe: isPromptSafe,
  getSummary: getValidationSummary,
  formatIssues: formatIssuesForDisplay,
  createReport: createValidationReport,
};
