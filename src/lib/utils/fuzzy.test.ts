/**
 * Unit tests for fuzzy search utilities.
 */
import { describe, it, expect } from "vitest";
import {
  levenshteinDistance,
  similarity,
  fuzzyMatch,
  multiFieldFuzzyMatch,
  highlightMatches,
} from "./fuzzy";

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("hello", "hello")).toBe(0);
    expect(levenshteinDistance("", "")).toBe(0);
  });

  it("handles case insensitivity", () => {
    expect(levenshteinDistance("HELLO", "hello")).toBe(0);
  });

  it("calculates correct distance for substitutions", () => {
    expect(levenshteinDistance("cat", "bat")).toBe(1);
    expect(levenshteinDistance("hello", "hallo")).toBe(1);
  });

  it("calculates correct distance for insertions", () => {
    expect(levenshteinDistance("cat", "cats")).toBe(1);
    expect(levenshteinDistance("", "abc")).toBe(3);
  });

  it("calculates correct distance for deletions", () => {
    expect(levenshteinDistance("cats", "cat")).toBe(1);
    expect(levenshteinDistance("abc", "")).toBe(3);
  });

  it("handles substring cases efficiently", () => {
    expect(levenshteinDistance("hello world", "world")).toBe(6);
    expect(levenshteinDistance("world", "hello world")).toBe(6);
  });
});

describe("similarity", () => {
  it("returns 1 for identical strings", () => {
    expect(similarity("hello", "hello")).toBe(1);
  });

  it("returns 0 for empty strings", () => {
    expect(similarity("", "hello")).toBe(0);
    expect(similarity("hello", "")).toBe(0);
  });

  it("returns correct similarity ratio", () => {
    expect(similarity("hello", "hallo")).toBeGreaterThan(0.7);
    expect(similarity("hello", "world")).toBeLessThan(0.5);
  });
});

describe("fuzzyMatch", () => {
  it("matches empty query", () => {
    const result = fuzzyMatch("", "anything");
    expect(result.matched).toBe(true);
    expect(result.score).toBe(1);
    expect(result.strategy).toBe("exact");
  });

  it("matches exact strings", () => {
    const result = fuzzyMatch("hello", "hello");
    expect(result.matched).toBe(true);
    expect(result.score).toBe(1);
    expect(result.strategy).toBe("exact");
  });

  it("matches substrings", () => {
    const result = fuzzyMatch("world", "hello world");
    expect(result.matched).toBe(true);
    expect(result.strategy).toBe("substring");
  });

  it("matches word boundaries", () => {
    const result = fuzzyMatch("hi world", "hello world today");
    expect(result.matched).toBe(true);
    expect(result.strategy).toBe("word_boundary");
  });

  it("matches acronyms", () => {
    const result = fuzzyMatch("cte", "create trigger explanation");
    expect(result.matched).toBe(true);
    expect(result.strategy).toBe("acronym");
  });

  it("uses fuzzy matching for typos", () => {
    const result = fuzzyMatch("hallo", "hello");
    expect(result.matched).toBe(true);
    expect(result.strategy).toBe("fuzzy");
  });

  it("returns false for non-matches", () => {
    const result = fuzzyMatch("xyz", "hello");
    expect(result.matched).toBe(false);
  });
});

describe("multiFieldFuzzyMatch", () => {
  it("matches in any field", () => {
    const result = multiFieldFuzzyMatch("hello", {
      name: "greeting",
      description: "hello world",
    });
    expect(result.matched).toBe(true);
    expect(result.field).toBe("description");
  });

  it("respects field weights", () => {
    const result = multiFieldFuzzyMatch(
      "test",
      { name: "test", description: "something else" },
      { weights: { name: 2, description: 1 } },
    );
    expect(result.field).toBe("name");
  });

  it("respects threshold", () => {
    const result = multiFieldFuzzyMatch(
      "xyz",
      { name: "hello", description: "world" },
      { threshold: 0.8 },
    );
    expect(result.matched).toBe(false);
  });
});

describe("highlightMatches", () => {
  it("returns unchanged text for empty query", () => {
    const result = highlightMatches("hello world", "");
    expect(result).toEqual([{ text: "hello world", highlighted: false }]);
  });

  it("highlights matching substring", () => {
    const result = highlightMatches("hello world", "world");
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ text: "hello ", highlighted: false });
    expect(result[1]).toEqual({ text: "world", highlighted: true });
  });

  it("returns unchanged text for no match", () => {
    const result = highlightMatches("hello world", "xyz");
    expect(result).toEqual([{ text: "hello world", highlighted: false }]);
  });
});
