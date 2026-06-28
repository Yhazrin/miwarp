/**
 * @vitest-environment jsdom
 *
 * Regression: logical sub-folders must render under an expanded workspace
 * (folder name + chevron visible). treeExpand height animation must not clip them.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount } from "svelte";
import ProjectFolderItem from "../ProjectFolderItem.svelte";
import type { EnrichedProjectFolder, SessionFolderGroup } from "$lib/utils/sidebar-groups";
import type { TaskRun } from "$lib/types";

function makeRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: "r1",
    prompt: "hello",
    cwd: "/project/miwarp",
    agent: "claude",
    auth_mode: "api",
    status: "completed",
    started_at: "2024-06-01T00:00:00Z",
    execution_path: "session_actor",
    ...overrides,
  };
}

vi.mock("$lib/utils/debug", () => ({
  dbg: vi.fn(),
  dbgWarn: vi.fn(),
}));

vi.mock("$lib/stores/theme-store.svelte", () => ({
  themeStore: { mode: "system", effectiveMode: "light", isDark: false },
}));

function makeFolder(overrides: Partial<EnrichedProjectFolder> = {}): EnrichedProjectFolder {
  return {
    cwd: "/project/miwarp",
    folderKey: "cwd:/project/miwarp",
    isUncategorized: false,
    conversations: [],
    conversationCount: 2,
    latestActivityAt: "2024-06-01T00:00:00Z",
    subFolders: [],
    scheduledTaskHubs: [],
    ...overrides,
  };
}

function makeSubFolder(name: string, id = `sf-${name}`): SessionFolderGroup {
  return {
    folderId: id,
    folderKey: `sf:${id}`,
    name,
    conversations: [],
    conversationCount: 0,
    latestActivityAt: "2024-06-01T00:00:00Z",
  };
}

describe("ProjectFolderItem logical sub-folders", () => {
  let target: HTMLDivElement;
  let instance: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    target = document.createElement("div");
    document.body.appendChild(target);
  });

  afterEach(() => {
    if (instance) {
      unmount(instance);
      instance = null;
    }
    target.remove();
  });

  it("renders logical folder headers when workspace is expanded", async () => {
    const subFolders = [makeSubFolder("Feature A"), makeSubFolder("Bugfix")];
    instance = mount(ProjectFolderItem, {
      target,
      props: {
        folder: makeFolder({ conversationCount: 2 }),
        label: "miwarp",
        expanded: true,
        subFolders,
        onToggle: () => {},
        onSelectConversation: () => {},
        onCreateSubFolder: () => {},
        expandedSubFolders: new Set<string>(),
        onToggleSubFolder: () => {},
      },
    });

    await new Promise((r) => setTimeout(r, 250));

    const text = target.textContent ?? "";
    expect(text).toContain("Feature A");
    expect(text).toContain("Bugfix");

    const children = target.querySelector(".sidebar-logical-folders") as HTMLElement | null;
    expect(children).not.toBeNull();
    expect(children!.querySelectorAll("[role='button']").length).toBeGreaterThanOrEqual(2);
  });

  it("shows unfoldered sessions pagination when subFolders exist", async () => {
    const subFolders = [makeSubFolder("Only folder")];
    instance = mount(ProjectFolderItem, {
      target,
      props: {
        folder: makeFolder({
          conversations: [
            {
              groupKey: "s:1",
              runs: [makeRun()],
              title: "hello",
              latestRun: makeRun(),
              isFavorite: false,
              totalMessages: 0,
            },
          ],
        }),
        label: "miwarp",
        expanded: true,
        subFolders,
        onToggle: () => {},
        onSelectConversation: () => {},
        onCreateSubFolder: () => {},
        expandedSubFolders: new Set<string>(),
        onToggleSubFolder: () => {},
      },
    });

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    expect(target.textContent).toContain("Only folder");
    expect(target.querySelector(".sidebar-logical-folders")).not.toBeNull();
  });
});
