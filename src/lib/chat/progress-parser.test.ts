/**
 * Unit tests for the Codex Progress parser.
 * Pure functions, no DOM / IDB / IPC — safe in any environment.
 */
import { describe, expect, it } from "vitest";
import {
  mergeTodos,
  parseTodosFromEvents,
  parseTodosFromText,
} from "./progress-parser";

describe("progress-parser", () => {
  describe("parseTodosFromText", () => {
    it("parses simple markdown checkbox lists", () => {
      const out = parseTodosFromText(
        "before\n- [ ] first\n- [x] second\n- [-] cancelled\n- [~] active\nafter",
      );
      expect(out.map((t) => [t.status, t.content])).toEqual([
        ["pending", "first"],
        ["completed", "second"],
        ["failed", "cancelled"],
        ["in_progress", "active"],
      ]);
    });

    it("returns empty on no matches", () => {
      expect(parseTodosFromText("hello world")).toEqual([]);
      expect(parseTodosFromText("")).toEqual([]);
    });

    it("ignores malformed lines", () => {
      const out = parseTodosFromText("- not a checkbox\n- [ ] valid");
      expect(out).toHaveLength(1);
      expect(out[0].content).toBe("valid");
    });
  });

  describe("parseTodosFromEvents", () => {
    it("last-write-wins on duplicate task_id", () => {
      const out = parseTodosFromEvents([
        { type: "task_created", task_id: "a", subject: "step 1" },
        { type: "task_updated", task_id: "a", status: "completed" },
      ]);
      expect(out).toHaveLength(1);
      expect(out[0].status).toBe("completed");
    });

    it("maps status strings to enum", () => {
      const out = parseTodosFromEvents([
        { type: "task_created", task_id: "a", subject: "x" },
        { type: "task_updated", task_id: "a", status: "in_progress" },
        { type: "task_updated", task_id: "a", status: "failed" },
      ]);
      expect(out[0].status).toBe("failed");
    });
  });

  describe("mergeTodos", () => {
    it("structured events win on id collision with text fallback", () => {
      // id collision is exact: structured ids start with task_id; text ids
      // start with "md:". When they differ, both are kept. This test
      // documents the contract.
      const structured = [
        { type: "task_created", task_id: "structured-1", subject: "structured todo" },
      ];
      const text = [
        {
          id: "structured-1", // collides on purpose
          content: "fallback",
          status: "pending" as const,
        },
      ];
      const out = mergeTodos(structured, text);
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe("structured-1");
    });

    it("non-conflicting text todos are kept", () => {
      const structured = [{ type: "task_created", task_id: "x", subject: "x" }];
      const text = [{ id: "md:0:0", content: "y", status: "pending" as const }];
      expect(mergeTodos(structured, text)).toHaveLength(2);
    });
  });
});
