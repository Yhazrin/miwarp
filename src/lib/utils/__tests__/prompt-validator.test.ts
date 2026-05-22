/**
 * Prompt Validator Tests
 */
import { describe, it, expect } from "vitest";
import {
  validateSelfContained,
  isPromptSafe,
  getValidationSummary,
  formatIssuesForDisplay,
  createValidationReport,
} from "../prompt-validator";

describe("validateSelfContained", () => {
  it("should pass for a self-contained prompt", () => {
    const prompt = `Review the following code for security issues:
# Example code
function processUserInput(input: string) {
  return executeQuery(input);
}`;
    const result = validateSelfContained(prompt);
    expect(result.isValid).toBe(true);
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("should detect 'current conversation' references", () => {
    const prompt = "Based on the current conversation, summarize the key points.";
    const result = validateSelfContained(prompt);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.type === "forbidden_reference")).toBe(true);
  });

  it("should detect 'the above' references", () => {
    const prompt = "Refactor the code mentioned above to improve performance.";
    const result = validateSelfContained(prompt);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.type === "forbidden_reference")).toBe(true);
  });

  it("should detect 'as mentioned previously' references", () => {
    const prompt = "As mentioned previously, we need to fix the memory leak.";
    const result = validateSelfContained(prompt);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.type === "forbidden_reference")).toBe(true);
  });

  it("should detect 'earlier in this conversation' references", () => {
    const prompt = "Earlier in this session we discussed the architecture.";
    const result = validateSelfContained(prompt);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.type === "forbidden_reference")).toBe(true);
  });

  it("should detect 'previous message' references", () => {
    const prompt = "Building on the previous message, add error handling.";
    const result = validateSelfContained(prompt);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.type === "forbidden_reference")).toBe(true);
  });

  it("should detect 'this session' references", () => {
    const prompt = "This session should focus on refactoring the auth module.";
    const result = validateSelfContained(prompt);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.type === "forbidden_reference")).toBe(true);
  });

  it("should detect unresolved template variables", () => {
    const prompt = "Process the following: ${userInput} and ${config}";
    const result = validateSelfContained(prompt);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.type === "unresolved_variable")).toBe(true);
  });

  it("should detect double-brace template variables", () => {
    const prompt = "Update the configuration with {{apiKey}} and {{endpoint}}";
    const result = validateSelfContained(prompt);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.type === "unresolved_variable")).toBe(true);
  });

  it("should warn about TODO markers", () => {
    const prompt = "Review the code. TODO: add error handling";
    const result = validateSelfContained(prompt);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("should return position information", () => {
    const prompt = "Line 1: OK\nLine 2: Based on current conversation\nLine 3: OK";
    const result = validateSelfContained(prompt);
    const conversationIssue = result.issues.find((i) => i.message.includes("current conversation"));
    expect(conversationIssue?.position).toBeDefined();
    expect(conversationIssue?.position?.line).toBe(2);
  });

  it("should include suggestions", () => {
    const prompt = "Based on current session, proceed with the refactor.";
    const result = validateSelfContained(prompt);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });
});

describe("isPromptSafe", () => {
  it("should return true for safe prompts", () => {
    const safe = "Review the code at /path/to/file for security issues.";
    expect(isPromptSafe(safe)).toBe(true);
  });

  it("should return false for unsafe prompts", () => {
    const unsafe = "Based on the above code, add unit tests.";
    expect(isPromptSafe(unsafe)).toBe(false);
  });
});

describe("getValidationSummary", () => {
  it("should return 'Valid' for passing prompts", () => {
    const prompt = "Write unit tests for the authentication module.";
    const result = validateSelfContained(prompt);
    const summary = getValidationSummary(result);
    expect(summary).toContain("Valid");
  });

  it("should return error count for failing prompts", () => {
    const prompt = "Based on current conversation, summarize the work.";
    const result = validateSelfContained(prompt);
    const summary = getValidationSummary(result);
    expect(summary).toContain("error");
  });
});

describe("formatIssuesForDisplay", () => {
  it("should format issues as readable strings", () => {
    const issues = [
      {
        type: "forbidden_reference" as const,
        severity: "error" as const,
        message: "Test error message",
        position: { line: 5, column: 10 },
      },
    ];
    const formatted = formatIssuesForDisplay(issues);
    expect(formatted[0]).toContain("[error]");
    expect(formatted[0]).toContain("line 5");
  });
});

describe("createValidationReport", () => {
  it("should create a passing report for valid prompts", () => {
    const prompt = "Review /path/to/project for security issues.";
    const report = createValidationReport(prompt, "security-review");
    expect(report.passed).toBe(true);
    expect(report.report).toContain("PASSED");
    expect(report.issues).toHaveLength(0);
  });

  it("should create a failing report for invalid prompts", () => {
    const prompt = "Based on the previous message, add more tests.";
    const report = createValidationReport(prompt, "test-writer");
    expect(report.passed).toBe(false);
    expect(report.report).toContain("FAILED");
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it("should include skill name in report", () => {
    const prompt = "Review the codebase";
    const report = createValidationReport(prompt, "code-review");
    expect(report.report).toContain("code-review");
  });
});
