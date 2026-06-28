import { describe, expect, it } from "vitest";
import type { ProjectFolder } from "$lib/utils/sidebar-groups";
import {
  DEFAULT_WORKSPACE_FOLDER_SORT,
  normalizeWorkspaceFolderSortOrder,
  sortProjectFolders,
} from "./workspace-folder-sort";

function folder(
  cwd: string,
  latest: string,
  startedAts: string[] = [],
  isUncategorized = false,
): ProjectFolder {
  return {
    cwd,
    folderKey: isUncategorized ? "uncategorized" : `cwd:${cwd}`,
    isUncategorized,
    latestActivityAt: latest,
    conversationCount: startedAts.length,
    conversations: startedAts.map((started_at, i) => ({
      groupKey: `r:${i}`,
      runs: [{ id: `r${i}`, started_at, last_activity_at: started_at } as never],
      title: "t",
      latestRun: { id: `r${i}`, started_at, last_activity_at: started_at } as never,
      isFavorite: false,
      totalMessages: 0,
    })),
  };
}

describe("normalizeWorkspaceFolderSortOrder", () => {
  it("defaults invalid values to last_active", () => {
    expect(normalizeWorkspaceFolderSortOrder(undefined)).toBe(DEFAULT_WORKSPACE_FOLDER_SORT);
    expect(normalizeWorkspaceFolderSortOrder("bogus")).toBe(DEFAULT_WORKSPACE_FOLDER_SORT);
  });

  it("accepts known values", () => {
    expect(normalizeWorkspaceFolderSortOrder("name_asc")).toBe("name_asc");
  });
});

describe("sortProjectFolders", () => {
  const sample = [
    folder("/proj/beta", "2024-06-01T00:00:00Z", ["2024-01-02T00:00:00Z"]),
    folder("/proj/alpha", "2024-01-01T00:00:00Z", ["2024-06-01T00:00:00Z"]),
    folder("", "2024-12-01T00:00:00Z", [], true),
  ];

  it("sorts by last_active desc with uncategorized last", () => {
    const sorted = sortProjectFolders(sample, "last_active");
    expect(sorted.map((f) => f.cwd)).toEqual(["/proj/beta", "/proj/alpha", ""]);
  });

  it("sorts by name ascending", () => {
    const sorted = sortProjectFolders(sample, "name_asc");
    expect(sorted.map((f) => f.cwd)).toEqual(["/proj/alpha", "/proj/beta", ""]);
  });

  it("sorts by created ascending (earliest session)", () => {
    const sorted = sortProjectFolders(sample, "created_asc");
    expect(sorted.map((f) => f.cwd)).toEqual(["/proj/beta", "/proj/alpha", ""]);
  });

  it("respects workspace aliases for name sort", () => {
    const withAliases = sortProjectFolders(sample, "name_asc", {
      aliases: { "/proj/beta": "Zeta Workspace" },
    });
    expect(withAliases[0]?.cwd).toBe("/proj/alpha");
    expect(withAliases[1]?.cwd).toBe("/proj/beta");
  });

  it("preserves subFolders on enriched folders", () => {
    const enriched = [
      {
        ...folder("/proj/a", "2024-01-01T00:00:00Z"),
        subFolders: [
          {
            folderId: "f1",
            folderKey: "sf:f1",
            name: "Logic",
            conversations: [],
            conversationCount: 0,
            latestActivityAt: "2024-01-01T00:00:00Z",
          },
        ],
      },
    ];
    const sorted = sortProjectFolders(enriched, "name_asc");
    expect(sorted[0]?.subFolders).toHaveLength(1);
    expect(sorted[0]?.subFolders?.[0]?.folderId).toBe("f1");
  });
});
