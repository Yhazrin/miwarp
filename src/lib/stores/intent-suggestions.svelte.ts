/**
 * Intent Suggestion Engine — predicts next actions based on recent tool patterns.
 *
 * Inspired by Claude Code's context-aware suggestions, this module:
 * - Detects tool patterns (edit-flow, test-flow, commit-flow, etc.)
 * - Suggests relevant next actions based on detected patterns
 * - Adapts suggestions based on project context (language, framework, etc.)
 * - Provides ranked suggestions with confidence scores
 */

import { t } from "$lib/i18n/index.svelte";

// ── Types ────────────────────────────────────────────────────────────────────

export type IntentPattern =
  | "edit-flow"
  | "test-flow"
  | "commit-flow"
  | "read-flow"
  | "search-flow"
  | "build-flow"
  | "debug-flow"
  | "review-flow"
  | "explore-flow"
  | "unknown";

export interface IntentSuggestion {
  action: string;
  label: string;
  description: string;
  icon: string;
  confidence: number; // 0.0 - 1.0
  keywords: string[];
  /** Shortcut key hint */
  shortcut?: string;
}

export interface IntentContext {
  recentTools: string[];
  projectLanguage?: string;
  hasGitChanges?: boolean;
  sessionPhase?: string;
  cwd?: string;
}

// ── Pattern Definitions ───────────────────────────────────────────────────────

const TOOL_SEQUENCES: Record<IntentPattern, string[][]> = {
  "edit-flow": [
    ["Read", "Edit"],
    ["Read", "Write"],
    ["Glob", "Read", "Edit"],
  ],
  "test-flow": [
    ["Bash", "Bash"], // npm test, cargo test
    ["Bash", "Read"], // test then review
    ["Bash", "Write"], // create test then run
  ],
  "commit-flow": [
    ["Bash", "Bash"], // git add + git commit
    ["Bash", "Bash", "Bash"], // git add + commit + push
  ],
  "read-flow": [
    ["Read", "Read"],
    ["Glob", "Read"],
    ["Grep", "Read"],
  ],
  "search-flow": [
    ["Grep", "Grep"],
    ["Grep", "Read"],
    ["Grep", "Grep", "Read"],
  ],
  "build-flow": [
    ["Bash"], // build commands
    ["Bash", "Read"], // build then check output
  ],
  "debug-flow": [
    ["Bash", "Read"], // run + check logs
    ["Bash", "Grep"], // run + search errors
  ],
  "review-flow": [
    ["Bash"], // git diff, git status
    ["Bash", "Bash"], // diff + review
  ],
  "explore-flow": [["Glob"], ["Grep"], ["Read"]],
  unknown: [],
};

// Pattern-specific suggestions
const PATTERN_SUGGESTIONS: Record<IntentPattern, IntentSuggestion[]> = {
  "edit-flow": [
    {
      action: "git_diff",
      label: t("intent.viewChanges"),
      description: t("intent.viewChangesDesc"),
      icon: "📝",
      confidence: 0.9,
      keywords: ["diff", "changes", "review"],
      shortcut: "Ctrl+D",
    },
    {
      action: "git_commit",
      label: t("intent.commitChanges"),
      description: t("intent.commitDesc"),
      icon: "✅",
      confidence: 0.7,
      keywords: ["commit", "save", "stash"],
    },
    {
      action: "run_test",
      label: t("intent.runTests"),
      description: t("intent.runTestsDesc"),
      icon: "🧪",
      confidence: 0.6,
      keywords: ["test", "spec"],
    },
  ],
  "test-flow": [
    {
      action: "view_coverage",
      label: t("intent.viewCoverage"),
      description: t("intent.viewCoverageDesc"),
      icon: "📊",
      confidence: 0.8,
      keywords: ["coverage", "report"],
    },
    {
      action: "run_tests",
      label: t("intent.runTests"),
      description: t("intent.runTestsDesc"),
      icon: "🧪",
      confidence: 0.8,
      keywords: ["test", "spec"],
    },
    {
      action: "git_commit",
      label: t("intent.commitChanges"),
      description: t("intent.commitDesc"),
      icon: "✅",
      confidence: 0.6,
      keywords: ["commit", "save"],
    },
  ],
  "commit-flow": [
    {
      action: "git_push",
      label: t("intent.pushChanges"),
      description: t("intent.pushDesc"),
      icon: "🚀",
      confidence: 0.9,
      keywords: ["push", "remote"],
      shortcut: "Ctrl+P",
    },
    {
      action: "git_status",
      label: t("intent.checkStatus"),
      description: t("intent.statusDesc"),
      icon: "📋",
      confidence: 0.7,
      keywords: ["status", "state"],
    },
  ],
  "read-flow": [
    {
      action: "grep",
      label: t("intent.searchCode"),
      description: t("intent.searchDesc"),
      icon: "🔍",
      confidence: 0.8,
      keywords: ["search", "find", "grep"],
    },
    {
      action: "glob",
      label: t("intent.findFiles"),
      description: t("intent.findFilesDesc"),
      icon: "📁",
      confidence: 0.6,
      keywords: ["find", "files", "glob"],
    },
  ],
  "search-flow": [
    {
      action: "read",
      label: t("intent.readFile"),
      description: t("intent.readFileDesc"),
      icon: "📄",
      confidence: 0.8,
      keywords: ["read", "view", "open"],
    },
    {
      action: "edit",
      label: t("intent.editFile"),
      description: t("intent.editDesc"),
      icon: "✏️",
      confidence: 0.7,
      keywords: ["edit", "modify", "change"],
    },
  ],
  "build-flow": [
    {
      action: "run_build",
      label: t("intent.runBuild"),
      description: t("intent.runBuildDesc"),
      icon: "🔨",
      confidence: 0.9,
      keywords: ["build", "compile", "make"],
    },
    {
      action: "view_output",
      label: t("intent.viewOutput"),
      description: t("intent.viewOutputDesc"),
      icon: "📺",
      confidence: 0.7,
      keywords: ["output", "logs", "terminal"],
    },
  ],
  "debug-flow": [
    {
      action: "view_logs",
      label: t("intent.viewLogs"),
      description: t("intent.viewLogsDesc"),
      icon: "📋",
      confidence: 0.9,
      keywords: ["logs", "error", "debug"],
    },
    {
      action: "grep_error",
      label: t("intent.searchError"),
      description: t("intent.searchErrorDesc"),
      icon: "🔍",
      confidence: 0.8,
      keywords: ["error", "exception", "fail"],
    },
    {
      action: "run_debug",
      label: t("intent.runDebug"),
      description: t("intent.runDebugDesc"),
      icon: "🐛",
      confidence: 0.7,
      keywords: ["debug", "trace"],
    },
  ],
  "review-flow": [
    {
      action: "git_diff",
      label: t("intent.viewChanges"),
      description: t("intent.viewChangesDesc"),
      icon: "📝",
      confidence: 0.9,
      keywords: ["diff", "changes"],
    },
    {
      action: "git_status",
      label: t("intent.checkStatus"),
      description: t("intent.statusDesc"),
      icon: "📋",
      confidence: 0.8,
      keywords: ["status", "state"],
    },
  ],
  "explore-flow": [
    {
      action: "read",
      label: t("intent.readFile"),
      description: t("intent.readFileDesc"),
      icon: "📄",
      confidence: 0.8,
      keywords: ["read", "view"],
    },
    {
      action: "edit",
      label: t("intent.editFile"),
      description: t("intent.editDesc"),
      icon: "✏️",
      confidence: 0.6,
      keywords: ["edit", "modify"],
    },
  ],
  unknown: [
    {
      action: "git_status",
      label: t("intent.checkStatus"),
      description: t("intent.statusDesc"),
      icon: "📋",
      confidence: 0.5,
      keywords: ["status", "state"],
    },
    {
      action: "run_help",
      label: t("intent.showHelp"),
      description: t("intent.helpDesc"),
      icon: "❓",
      confidence: 0.4,
      keywords: ["help", "guide"],
    },
  ],
};

// ── Intent Engine ─────────────────────────────────────────────────────────────

export class IntentEngine {
  private patternCounts: Map<IntentPattern, number> = new Map();
  private recentTools: string[] = [];
  private context: IntentContext = { recentTools: [] };

  /** Update with new tool calls */
  updateTools(tools: string[]): void {
    this.recentTools = [...this.recentTools, ...tools].slice(-20); // Keep last 20
    this.context.recentTools = this.recentTools;
  }

  /** Update context metadata */
  updateContext(updates: Partial<IntentContext>): void {
    this.context = { ...this.context, ...updates };
  }

  /** Clear all state */
  reset(): void {
    this.patternCounts.clear();
    this.recentTools = [];
    this.context = { recentTools: [] };
  }

  /** Detect the most likely pattern from recent tools */
  detectPattern(): IntentPattern {
    const recent = this.recentTools.slice(-5); // Look at last 5 tools
    if (recent.length === 0) return "unknown";

    let bestPattern: IntentPattern = "unknown";
    let bestScore = 0;

    for (const [pattern, sequences] of Object.entries(TOOL_SEQUENCES)) {
      if (pattern === "unknown") continue;

      for (const seq of sequences) {
        const score = this.matchSequence(recent, seq);
        if (score > bestScore) {
          bestScore = score;
          bestPattern = pattern as IntentPattern;
        }
      }
    }

    return bestPattern;
  }

  /** Get suggestions for the current context */
  getSuggestions(maxCount = 5): IntentSuggestion[] {
    const pattern = this.detectPattern();
    let suggestions = [...PATTERN_SUGGESTIONS[pattern]];

    // Boost confidence based on recent tool matches
    const recentSet = new Set(this.recentTools);
    suggestions = suggestions.map((s) => ({
      ...s,
      confidence: this.calculateConfidence(s, recentSet),
    }));

    // Sort by confidence
    suggestions.sort((a, b) => b.confidence - a.confidence);

    // Apply context-based filtering
    suggestions = this.applyContextFilters(suggestions);

    return suggestions.slice(0, maxCount);
  }

  /** Get the top suggestion */
  getTopSuggestion(): IntentSuggestion | null {
    const suggestions = this.getSuggestions(1);
    return suggestions[0] ?? null;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private matchSequence(tools: string[], sequence: string[]): number {
    if (sequence.length > tools.length) return 0;

    let matches = 0;
    let toolIdx = tools.length - 1;

    // Work backwards through the sequence
    for (let seqIdx = sequence.length - 1; seqIdx >= 0; seqIdx--) {
      if (toolIdx < 0) break;
      if (tools[toolIdx] === sequence[seqIdx]) {
        matches++;
      }
      toolIdx--;
    }

    return matches / sequence.length;
  }

  private calculateConfidence(suggestion: IntentSuggestion, recentTools: Set<string>): number {
    let confidence = suggestion.confidence;

    // Boost if keywords match recent tools
    const lowerRecent = Array.from(recentTools).map((t) => t.toLowerCase());
    for (const keyword of suggestion.keywords) {
      if (lowerRecent.some((t) => t.includes(keyword.toLowerCase()))) {
        confidence += 0.1;
      }
    }

    // Reduce confidence if session is idle
    if (this.context.sessionPhase === "idle") {
      confidence *= 0.8;
    }

    // Boost if there are pending git changes
    if (suggestion.action.startsWith("git_") && this.context.hasGitChanges) {
      confidence += 0.15;
    }

    return Math.min(1.0, confidence);
  }

  private applyContextFilters(suggestions: IntentSuggestion[]): IntentSuggestion[] {
    let filtered = [...suggestions];

    // Filter based on project language
    if (this.context.projectLanguage) {
      const lang = this.context.projectLanguage.toLowerCase();

      // Boost language-specific suggestions
      filtered = filtered.map((s) => {
        let boost = 0;
        if (lang === "rust" && s.keywords.includes("cargo")) boost = 0.2;
        if (lang === "javascript" || lang === "typescript") {
          if (s.keywords.includes("npm") || s.keywords.includes("node")) boost = 0.2;
        }
        return { ...s, confidence: Math.min(1.0, s.confidence + boost) };
      });
    }

    return filtered;
  }
}

// ── Singleton instance ────────────────────────────────────────────────────────

let intentEngine: IntentEngine | null = null;

export function getIntentEngine(): IntentEngine {
  if (!intentEngine) {
    intentEngine = new IntentEngine();
  }
  return intentEngine;
}

// ── Default suggestion labels (fallback when i18n not loaded) ────────────────

export const DEFAULT_SUGGESTIONS: Record<string, string> = {
  "intent.viewChanges": "View Changes",
  "intent.viewChangesDesc": "Show git diff of recent changes",
  "intent.commitChanges": "Commit Changes",
  "intent.commitDesc": "Commit pending changes",
  "intent.runTests": "Run Tests",
  "intent.runTestsDesc": "Execute test suite",
  "intent.viewCoverage": "View Coverage",
  "intent.viewCoverageDesc": "Show test coverage report",
  "intent.pushChanges": "Push Changes",
  "intent.pushDesc": "Push commits to remote",
  "intent.checkStatus": "Check Status",
  "intent.statusDesc": "Show git status",
  "intent.searchCode": "Search Code",
  "intent.searchDesc": "Search for text in files",
  "intent.findFiles": "Find Files",
  "intent.findFilesDesc": "Find files matching pattern",
  "intent.readFile": "Read File",
  "intent.readFileDesc": "Open and read a file",
  "intent.editFile": "Edit File",
  "intent.editDesc": "Make changes to a file",
  "intent.runBuild": "Run Build",
  "intent.runBuildDesc": "Build the project",
  "intent.viewOutput": "View Output",
  "intent.viewOutputDesc": "Show build/test output",
  "intent.viewLogs": "View Logs",
  "intent.viewLogsDesc": "Show application logs",
  "intent.searchError": "Search Error",
  "intent.searchErrorDesc": "Find error messages",
  "intent.runDebug": "Run Debug",
  "intent.runDebugDesc": "Run in debug mode",
  "intent.showHelp": "Show Help",
  "intent.helpDesc": "Display available commands",
};
