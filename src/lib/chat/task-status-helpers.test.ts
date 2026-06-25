import { describe, expect, it } from "vitest";
import type {
  QualityGateVerdict,
  ReviewOutcome,
  TaskMergeDecisionKind,
  TaskPriority,
  TaskStatus,
} from "$lib/types/task";
import {
  MERGE_DECISION_KEYS,
  PRIORITY_KEYS,
  REVIEW_KEYS,
  STATUS_KEYS,
  STATUS_TONE,
  VERDICT_KEYS,
  isActiveStatus,
} from "./task-status-helpers";

describe("task-status-helpers", () => {
  it("maps every task status to a stable i18n key", () => {
    const statuses: TaskStatus[] = [
      "draft",
      "ready",
      "running",
      "needs_attention",
      "verifying",
      "review",
      "done",
      "failed",
      "archived",
    ];
    for (const status of statuses) {
      expect(STATUS_KEYS[status]).toBe(`tasks_status_${status}`);
    }
  });

  it("maps every priority to a stable i18n key", () => {
    const priorities: TaskPriority[] = ["low", "medium", "high", "critical"];
    for (const priority of priorities) {
      expect(PRIORITY_KEYS[priority]).toBe(`tasks_priority_${priority}`);
    }
  });

  it("flags active statuses", () => {
    expect(isActiveStatus("draft")).toBe(false);
    expect(isActiveStatus("ready")).toBe(false);
    expect(isActiveStatus("running")).toBe(true);
    expect(isActiveStatus("needs_attention")).toBe(true);
    expect(isActiveStatus("verifying")).toBe(true);
    expect(isActiveStatus("review")).toBe(true);
    expect(isActiveStatus("done")).toBe(false);
    expect(isActiveStatus("failed")).toBe(false);
    expect(isActiveStatus("archived")).toBe(false);
  });

  it("uses warning tone for needs_attention and danger for failed", () => {
    expect(STATUS_TONE["needs_attention"]).toBe("warning");
    expect(STATUS_TONE["failed"]).toBe("danger");
    expect(STATUS_TONE["done"]).toBe("success");
  });

  it("covers verdict and review outcome mappings", () => {
    const verdicts: QualityGateVerdict[] = ["pending", "pass", "warn", "fail"];
    for (const verdict of verdicts) {
      expect(VERDICT_KEYS[verdict]).toBeDefined();
    }
    const outcomes: ReviewOutcome[] = ["pending", "approved", "changes_requested", "rejected"];
    for (const outcome of outcomes) {
      expect(REVIEW_KEYS[outcome]).toBeDefined();
    }
    const decisions: TaskMergeDecisionKind[] = ["pending", "merge", "keep_branch", "discard"];
    for (const decision of decisions) {
      expect(MERGE_DECISION_KEYS[decision]).toBeDefined();
    }
  });
});
