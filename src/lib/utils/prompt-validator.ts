/**
 * Prompt Validator for Scheduled Tasks
 * 
 * Ensures scheduled task prompts are self-contained and don't reference
 * ephemeral context that won't be available during execution.
 * 
 * Design patterns from Claude Code's scheduled task design:
 * - Future runs will NOT have access to current conversation
 * - Forbidden: "current conversation", "the above", "previously mentioned"
 * - Must use explicit references or embedded context
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  score: number; // 0-100 self-containment score
}

export interface ValidationError {
  type: "error" | "warning";
  code: string;
  message: string;
  position?: { start: number; end: number };
  suggestion?: string;
}

export type ValidationWarning = ValidationError;

// Forbidden patterns that indicate non-self-contained prompts
const FORBIDDEN_PATTERNS: Array<{
  pattern: RegExp;
  code: string;
  message: string;
  suggestion: string;
}> = [
  {
    pattern: /\b(above|below|previous|earlier|last)\s+(message|response|conversation|turn|step)\b/gi,
    code: "EPHEMERAL_REF",
    message: "Reference to '{match}' implies context from current session that won't be available",
    suggestion: "Embed the necessary context directly in the prompt or reference files/project state",
  },
  {
    pattern: /\b(this|that)\s+(conversation|chat|message|response|context)\b/gi,
    code: "DEMONSTRATIVE_REF",
    message: "Demonstrative reference to '{match}' won't resolve in scheduled context",
    suggestion: "Use explicit context or file references instead",
  },
  {
    pattern: /\b(the\s+)?(above-mentioned|above-mentioned|mentioned\s+above|as\s+mentioned)\b/gi,
    code: "MENTIONED_REF",
    message: "Reference to '{match}' is not self-contained",
    suggestion: "Include the referenced information directly in the prompt",
  },
  {
    pattern: /\b(continue|from\s+before|going\s+back)\b/gi,
    code: "CONTINUATION_REF",
    message: "'{match}' implies continuation from previous context",
    suggestion: "Include all necessary state and context in the prompt itself",
  },
  {
    pattern: /\bas\s+we\s+(discussed|talked|were|said|were\s+talking)\b/gi,
    code: "DISCUSSION_REF",
    message: "Reference to ongoing discussion is not self-contained",
    suggestion: "Summarize the relevant discussion points directly in the prompt",
  },
];

// Warning patterns (less severe but still indicate potential issues)
const WARNING_PATTERNS: Array<{
  pattern: RegExp;
  code: string;
  message: string;
  suggestion: string;
}> = [
  {
    pattern: /\b(according\s+to|based\s+on)\s+(our|the)\s+(conversation|chat|discussion)\b/gi,
    code: "BASED_ON_CHAT",
    message: "Reference to '{match}' may not resolve correctly",
    suggestion: "Be explicit about the source of information",
  },
  {
    pattern: /\b(like\s+we|as\s+I)\s+(said|told|mentioned|discussed)\b/gi,
    code: "FIRST_PERSON_REF",
    message: "First-person reference to previous conversation may be confusing",
    suggestion: "Use neutral third-person or project-specific references",
  },
  {
    pattern: /\bremember\s+(that|when|what|which)\b/gi,
    code: "REMEMBER_REF",
    message: "'{match}' implies shared memory that scheduled tasks don't have",
    suggestion: "Include all necessary context explicitly",
  },
  {
    pattern: /\b(it\s+was|there\s+was)\s+(mentioned|said|suggested|decided)\b/gi,
    code: "PAST_TENSE_REF",
    message: "Past tense reference implies shared context",
    suggestion: "Be explicit about the source of information",
  },
];

// Good patterns that indicate self-contained prompts
const GOOD_PATTERNS: RegExp[] = [
  /\bread\s+file\b/gi,
  /\banalyze\s+project\b/gi,
  /\bcheck\s+git\b/gi,
  /\blook\s+at\s+the\b/gi,
  /\bbased\s+on\s+.*file/gi,
  /\bfrom\s+.*\.json/gi,
  /\baccording\s+to\s+.*\.md/gi,
  /\busing\s+(the\s+)?\w+\.yaml/gi,
  /\bin\s+the\s+project/gi,
  /\bfrom\s+project/gi,
];

// Text patterns that indicate explicit context embedding
const EMBEDDED_CONTEXT_MARKERS: RegExp[] = [
  /```[\s\S]+?```/,  // Code blocks
  /'''[\s\S]+?'''/,  // Triple-quoted strings
  /"""[\s\S]+?"""/,  // Triple-double-quoted strings
  /<example>[\s\S]+?<\/example>/gi,  // Example tags
  /<!--[\s\S]+?-->/g,  // HTML comments
  /\{[\s\S]+?\}/,  // JSON-like blocks
];

/**
 * Validate a prompt for self-containment.
 * Used to ensure scheduled tasks won't fail due to missing context.
 */
export function validatePrompt(prompt: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  
  // Check forbidden patterns
  for (const { pattern, code, message, suggestion } of FORBIDDEN_PATTERNS) {
    const matches = prompt.match(pattern);
    if (matches) {
      for (const match of matches) {
        errors.push({
          type: "error",
          code,
          message: message.replace("{match}", match),
          suggestion,
        });
      }
    }
  }
  
  // Check warning patterns
  for (const { pattern, code, message, suggestion } of WARNING_PATTERNS) {
    const matches = prompt.match(pattern);
    if (matches) {
      for (const match of matches) {
        warnings.push({
          type: "warning",
          code,
          message: message.replace("{match}", match),
          suggestion,
        });
      }
    }
  }
  
  // Calculate self-containment score
  let score = 100;
  
  // Deduct for errors (25 points each)
  score -= errors.length * 25;
  
  // Deduct for warnings (10 points each)
  score -= warnings.length * 10;
  
  // Bonus for good patterns (5 points each, max +15)
  const goodMatches = GOOD_PATTERNS.reduce((count, pattern) => {
    return count + (prompt.match(pattern)?.length || 0);
  }, 0);
  score += Math.min(goodMatches * 5, 15);
  
  // Bonus for embedded context (10 points each, max +20)
  const embeddedMatches = EMBEDDED_CONTEXT_MARKERS.reduce((count, pattern) => {
    return count + (prompt.match(pattern)?.length || 0);
  }, 0);
  score += Math.min(embeddedMatches * 10, 20);
  
  // Ensure score is within bounds
  score = Math.max(0, Math.min(100, score));
  
  const valid = errors.length === 0;
  
  return { valid, errors, warnings, score };
}

/**
 * Auto-fix a prompt by suggesting context embedding.
 * Returns the original prompt with inline comments on how to improve it.
 */
export function suggestPromptFixes(prompt: string): string {
  const result = validatePrompt(prompt);
  
  if (result.valid && result.warnings.length === 0) {
    return prompt; // No changes needed
  }
  
  // Build suggestions
  const suggestions: string[] = [];
  
  if (result.errors.length > 0) {
    suggestions.push("# ERRORS TO FIX:");
    for (const error of result.errors) {
      suggestions.push(`- ${error.message}`);
      suggestions.push(`  Suggestion: ${error.suggestion}`);
    }
  }
  
  if (result.warnings.length > 0) {
    suggestions.push("");
    suggestions.push("# WARNINGS:");
    for (const warning of result.warnings) {
      suggestions.push(`- ${warning.message}`);
      suggestions.push(`  Suggestion: ${warning.suggestion}`);
    }
  }
  
  // Add context embedding suggestion
  suggestions.push("");
  suggestions.push("# RECOMMENDATION:");
  suggestions.push("Consider embedding necessary context directly in the prompt using:");
  suggestions.push("- Code blocks with example input/output");
  suggestions.push("- File references with specific paths");
  suggestions.push("- Explicit state descriptions");
  suggestions.push("- JSON-like configuration blocks");
  
  return `# PROMPT VALIDATION REPORT
Self-Containment Score: ${result.score}/100

${suggestions.join("\n")}

---

ORIGINAL PROMPT:
${prompt}
`;
}

/**
 * Check if a prompt mentions any files or directories.
 * Useful for determining if the task depends on project state.
 */
export function extractFileReferences(prompt: string): string[] {
  // Common file path patterns
  const patterns = [
    /\b[\w\-\./]+\.(md|json|yaml|yml|toml|js|ts|jsx|tsx|py|rs|go|java|cpp|c|h)\b/gi,
    /\b(?:src|lib|app|components|utils|config|docs|tests?)\/[\w\-\./]+/gi,
    /\breference[ds]?\s+(?:to\s+)?([^\s,]+)/gi,
    /\b(?:from|to|in)\s+([^\s,]+(?:\/[^\s,]+)+)/gi,
  ];
  
  const references = new Set<string>();
  
  for (const pattern of patterns) {
    const matches = prompt.match(pattern);
    if (matches) {
      for (const match of matches) {
        // Clean up the reference
        const cleaned = match.trim().replace(/[.,;:!?]+$/, "");
        if (cleaned.length > 1 && !cleaned.startsWith("#")) {
          references.add(cleaned);
        }
      }
    }
  }
  
  return Array.from(references);
}

/**
 * Create a context wrapper for prompts that need project state.
 * Embeds the context directly in the prompt.
 */
export function wrapWithContext(
  prompt: string,
  context: {
    projectState?: string;
    files?: Array<{ path: string; content?: string; summary?: string }>;
    previousRuns?: string;
    notes?: string;
  }
): string {
  const parts: string[] = [];
  
  // Add project state
  if (context.projectState) {
    parts.push(`# PROJECT STATE\n${context.projectState}`);
  }
  
  // Add file references
  if (context.files && context.files.length > 0) {
    parts.push("# CONTEXT FILES");
    for (const file of context.files) {
      if (file.content) {
        parts.push(`\n## ${file.path}\n\`\`\`\n${file.content}\n\`\`\``);
      } else if (file.summary) {
        parts.push(`\n## ${file.path}\n${file.summary}`);
      } else {
        parts.push(`\n## ${file.path} (content to be read at runtime)`);
      }
    }
  }
  
  // Add previous runs summary
  if (context.previousRuns) {
    parts.push(`# PREVIOUS RUNS\n${context.previousRuns}`);
  }
  
  // Add notes
  if (context.notes) {
    parts.push(`# NOTES\n${context.notes}`);
  }
  
  // Combine with original prompt
  if (parts.length > 0) {
    return `${parts.join("\n\n")}\n\n---\n\n# TASK\n${prompt}`;
  }
  
  return prompt;
}

/**
 * Validate a scheduled task configuration.
 * Returns detailed validation results including prompt analysis.
 */
export interface TaskValidationOptions {
  allowWarnings?: boolean;
  minScore?: number;
  requireFileReferences?: boolean;
}

export function validateScheduledTask(
  prompt: string,
  options: TaskValidationOptions = {}
): ValidationResult & {
  fileReferences: string[];
  isSelfContained: boolean;
} {
  const {
    allowWarnings = true,
    minScore = 60,
    requireFileReferences = false,
  } = options;
  
  // Validate the prompt content
  const promptResult = validatePrompt(prompt);
  
  // Extract file references
  const fileReferences = extractFileReferences(prompt);
  
  // Determine self-containment
  const isSelfContained = 
    promptResult.errors.length === 0 &&
    (allowWarnings || promptResult.warnings.length === 0) &&
    promptResult.score >= minScore &&
    (!requireFileReferences || fileReferences.length > 0);
  
  return {
    ...promptResult,
    fileReferences,
    isSelfContained,
  };
}
