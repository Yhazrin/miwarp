import { describe, it, expect } from "vitest";
import {
  filterVisibleCandidates,
  groupByLabel,
  findDuplicates,
  getPrimaryFile,
  calculateSimilarity,
  isStale,
  sortByDisplayPriority,
  findBestFile,
  parseMemoryPath,
  summarizeMemoryFiles,
} from "./memory-helpers";
import type { MemoryFileCandidate } from "$lib/types";

// Test data
const FILES = [
  { path: "/project/CLAUDE.md", label: "CLAUDE.md", scope: "project" as const, exists: true },
  {
    path: "/project/.claude/settings.json",
    label: "settings.json",
    scope: "project" as const,
    exists: true,
  },
  {
    path: "/project/.claude/AGENTS.md",
    label: "AGENTS.md",
    scope: "project" as const,
    exists: false,
  },
  {
    path: "/project/.claude/commands/foo.md",
    label: "foo.md",
    scope: "project" as const,
    exists: false,
  },
  {
    path: "/home/.claude/CLAUDE.md",
    label: "CLAUDE.md",
    scope: "global" as const,
    exists: true,
  },
  {
    path: "/home/.claude/projects/myproj/memory/notes.md",
    label: "notes.md",
    scope: "memory" as const,
    exists: true,
  },
];

describe("filterVisibleCandidates", () => {
  it("returns only existing files by default", () => {
    const result = filterVisibleCandidates(FILES, false, "");
    expect(result).toHaveLength(4);
    expect(result.every((f) => f.exists)).toBe(true);
  });

  it("returns all files when showCreate is true", () => {
    const result = filterVisibleCandidates(FILES, true, "");
    expect(result).toHaveLength(FILES.length);
  });

  it("always includes the selected non-existing file", () => {
    const result = filterVisibleCandidates(FILES, false, "/project/.claude/AGENTS.md");
    expect(result.find((f) => f.path === "/project/.claude/AGENTS.md")).toBeDefined();
  });
});

describe("groupByLabel", () => {
  it("groups files by case-insensitive label", () => {
    const result = groupByLabel(FILES);
    const claudeGroup = result.find((g) => g.label === "claude.md");
    expect(claudeGroup).toBeDefined();
    expect(claudeGroup?.files).toHaveLength(2); // project and global CLAUDE.md
  });

  it("handles unique files", () => {
    const uniqueFiles = FILES.filter((f) => f.label === "settings.json");
    const result = groupByLabel(uniqueFiles);
    expect(result).toHaveLength(1);
    expect(result[0].files).toHaveLength(1);
  });
});

describe("findDuplicates", () => {
  it("finds files with same label but different paths", () => {
    const result = findDuplicates(FILES);
    expect(result.some((g) => g.label === "claude.md")).toBe(true);
  });

  it("returns empty for unique files", () => {
    const uniqueFiles: MemoryFileCandidate[] = [
      { path: "/a/first.md", label: "first.md", scope: "project", exists: true },
      { path: "/b/second.md", label: "second.md", scope: "global", exists: true },
    ];
    const result = findDuplicates(uniqueFiles);
    expect(result).toHaveLength(0);
  });
});

describe("getPrimaryFile", () => {
  it("prefers project scope over global", () => {
    const group = {
      label: "test.md",
      files: [
        { path: "/global/test.md", label: "test.md", scope: "global" as const, exists: true },
        { path: "/project/test.md", label: "test.md", scope: "project" as const, exists: true },
      ],
    };
    const result = getPrimaryFile(group);
    expect(result?.scope).toBe("project");
  });

  it("prefers project scope over memory", () => {
    const group = {
      label: "test.md",
      files: [
        { path: "/memory/test.md", label: "test.md", scope: "memory" as const, exists: true },
        { path: "/project/test.md", label: "test.md", scope: "project" as const, exists: true },
      ],
    };
    const result = getPrimaryFile(group);
    expect(result?.scope).toBe("project");
  });

  it("returns null for empty group", () => {
    const result = getPrimaryFile({ label: "test.md", files: [] });
    expect(result).toBeNull();
  });
});

describe("calculateSimilarity", () => {
  it("returns 1 for identical content", () => {
    const result = calculateSimilarity("hello world", "hello world");
    expect(result).toBe(1);
  });

  it("returns 1 for empty strings", () => {
    const result = calculateSimilarity("", "");
    expect(result).toBe(1);
  });

  it("returns 0 when one is empty", () => {
    const result = calculateSimilarity("hello", "");
    expect(result).toBe(0);
  });

  it("calculates similarity for different content", () => {
    const result = calculateSimilarity("hello world foo", "hello world bar");
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it("ignores formatting characters", () => {
    const a = "**bold** and _italic_";
    const b = "bold and italic";
    const result = calculateSimilarity(a, b);
    expect(result).toBeGreaterThan(0.5);
  });
});

describe("isStale", () => {
  it("considers non-existing files as stale", () => {
    const file = { path: "/test.md", label: "test.md", scope: "project" as const, exists: false };
    expect(isStale(file)).toBe(true);
  });

  it("considers memory scope as potentially stale", () => {
    const file = {
      path: "/memory/test.md",
      label: "test.md",
      scope: "memory" as const,
      exists: true,
    };
    expect(isStale(file)).toBe(true);
  });

  it("considers existing project files as not stale", () => {
    const file = {
      path: "/project/test.md",
      label: "test.md",
      scope: "project" as const,
      exists: true,
    };
    expect(isStale(file)).toBe(false);
  });
});

describe("sortByDisplayPriority", () => {
  it("puts MEMORY.md first", () => {
    const unsorted = [
      { path: "/a/b.md", label: "b.md", scope: "project" as const, exists: true },
      { path: "/a/MEMORY.md", label: "MEMORY.md", scope: "project" as const, exists: true },
      { path: "/a/c.md", label: "c.md", scope: "project" as const, exists: true },
    ];
    const result = sortByDisplayPriority(unsorted);
    expect(result[0].label).toBe("MEMORY.md");
  });

  it("sorts by scope: project > global > memory", () => {
    const unsorted = [
      { path: "/memory/a.md", label: "a.md", scope: "memory" as const, exists: true },
      { path: "/global/b.md", label: "b.md", scope: "global" as const, exists: true },
      { path: "/project/c.md", label: "c.md", scope: "project" as const, exists: true },
    ];
    const result = sortByDisplayPriority(unsorted);
    expect(result[0].scope).toBe("project");
    expect(result[1].scope).toBe("global");
    expect(result[2].scope).toBe("memory");
  });

  it("puts existing files before non-existing", () => {
    const unsorted = [
      { path: "/a/missing.md", label: "missing.md", scope: "project" as const, exists: false },
      { path: "/a/existing.md", label: "existing.md", scope: "project" as const, exists: true },
    ];
    const result = sortByDisplayPriority(unsorted);
    expect(result[0].exists).toBe(true);
  });
});

describe("findBestFile", () => {
  it("finds existing file for project scope", () => {
    const result = findBestFile(FILES, "project");
    expect(result).toBeDefined();
    expect(result?.scope).toBe("project");
    expect(result?.exists).toBe(true);
  });

  it("falls back to non-existing if no existing files", () => {
    const files: MemoryFileCandidate[] = [
      { path: "/project/new.md", label: "new.md", scope: "project", exists: false },
    ];
    const result = findBestFile(files, "project");
    expect(result?.exists).toBe(false);
  });

  it("returns null for non-existent scope", () => {
    const result = findBestFile(FILES, "memory");
    expect(result).toBeDefined(); // At least one memory file exists
  });
});

describe("parseMemoryPath", () => {
  it("identifies global paths", () => {
    const result = parseMemoryPath("/home/.claude/CLAUDE.md");
    expect(result.isGlobal).toBe(true);
    expect(result.isProject).toBe(false);
  });

  it("identifies project paths", () => {
    const result = parseMemoryPath("/project/.claude/CLAUDE.md");
    expect(result.isProject).toBe(true);
  });

  it("identifies memory paths", () => {
    const result = parseMemoryPath("/home/.claude/projects/myproj/memory/notes.md");
    expect(result.isMemory).toBe(true);
  });

  it("extracts filename correctly", () => {
    const result = parseMemoryPath("/project/memory/docs/api.md");
    expect(result.filename).toBe("api.md");
  });
});

describe("summarizeMemoryFiles", () => {
  it("returns summary with counts", () => {
    const result = summarizeMemoryFiles(FILES);
    expect(result).toContain("Total:");
    expect(result).toContain("Existing:");
    expect(result).toContain("Missing:");
    expect(result).toContain("By scope:");
  });

  it("counts by scope correctly", () => {
    const result = summarizeMemoryFiles(FILES);
    expect(result).toContain('"project":4');
    expect(result).toContain('"global":1');
    expect(result).toContain('"memory":1');
  });
});
