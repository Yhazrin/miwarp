/**
 * @vitest-environment jsdom
 *
 * Regression: logical sub-folder rows must always render under an expanded workspace.
 * Session pagination applies to conversation lists only (unfoldered + inside each logical folder).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount } from "svelte";
import ProjectFolderItem from "../ProjectFolderItem.svelte";
import type {
  ConversationGroup,
  EnrichedProjectFolder,
  SessionFolderGroup,
} from "$lib/utils/sidebar-groups";
import type { TaskRun } from "$lib/types";
import {
  DEFAULT_SESSION_PAGE_SIZE,
  SESSION_PAGE_INCREMENT,
} from "$lib/utils/sidebar-session-pagination";

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
    conversationCount: 0,
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

function makeConversation(index: number, runId: string, title: string): ConversationGroup {
  const run = makeRun({ id: runId, prompt: title });
  return {
    groupKey: `s:${runId}`,
    runs: [run],
    title,
    latestRun: run,
    isFavorite: false,
    totalMessages: 0,
  };
}

function makeSubFolderWithSessions(
  name: string,
  sessionCount: number,
  id?: string,
): SessionFolderGroup {
  const folderId = id ?? `sf-${name}`;
  const conversations = Array.from({ length: sessionCount }, (_, i) =>
    makeConversation(i, `${folderId}-r${i}`, `${name} session ${i + 1}`),
  );
  return {
    folderId,
    folderKey: `sf:${folderId}`,
    name,
    conversations,
    conversationCount: sessionCount,
    latestActivityAt: "2024-06-01T00:00:00Z",
  };
}

function countSubstring(text: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

const baseProps = {
  label: "miwarp",
  expanded: true,
  onToggle: () => {},
  onSelectConversation: () => {},
  onCreateSubFolder: () => {},
  onToggleSubFolder: () => {},
};

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

  it("renders all logical folder headers when workspace is expanded", async () => {
    const subFolders = [makeSubFolder("Feature A"), makeSubFolder("Bugfix"), makeSubFolder("Docs")];
    instance = mount(ProjectFolderItem, {
      target,
      props: {
        ...baseProps,
        folder: makeFolder({ conversationCount: 3 }),
        subFolders,
        expandedSubFolders: new Set<string>(),
      },
    });

    await new Promise((r) => setTimeout(r, 300));

    const text = target.textContent ?? "";
    expect(text).toContain("Feature A");
    expect(text).toContain("Bugfix");
    expect(text).toContain("Docs");

    const logical = target.querySelector(".sidebar-logical-folders");
    expect(logical).not.toBeNull();
    expect(logical!.querySelectorAll('[class*="group/sf"]').length).toBe(3);
  });

  it("paginates sessions inside each logical folder but keeps every folder row visible", async () => {
    const subFolders = [
      makeSubFolderWithSessions("Alpha", 8, "f-alpha"),
      makeSubFolderWithSessions("Beta", 8, "f-beta"),
      makeSubFolderWithSessions("Gamma", 8, "f-gamma"),
    ];
    instance = mount(ProjectFolderItem, {
      target,
      props: {
        ...baseProps,
        folder: makeFolder({ conversationCount: 24 }),
        subFolders,
        expandedSubFolders: new Set(subFolders.map((sf) => sf.folderKey)),
      },
    });

    await new Promise((r) => setTimeout(r, 300));

    expect(target.textContent).toContain("Alpha");
    expect(target.textContent).toContain("Beta");
    expect(target.textContent).toContain("Gamma");

    const sessionBlocks = target.querySelectorAll(".sidebar-subfolder-sessions");
    expect(sessionBlocks.length).toBe(3);

    for (const block of sessionBlocks) {
      const blockText = block.textContent ?? "";
      expect(countSubstring(blockText, "session")).toBe(DEFAULT_SESSION_PAGE_SIZE);
      expect(blockText).toMatch(/显示更多|Show.*more/i);
    }

    expect(
      target.querySelectorAll(".sidebar-subfolder-sessions button[type='button']").length,
    ).toBe(3);
    expect(target.textContent?.includes(String(Math.min(SESSION_PAGE_INCREMENT, 3)))).toBe(true);
  });

  it("paginates unfoldered sessions without hiding logical folders", async () => {
    const subFolders = [makeSubFolder("Only folder")];
    const unfoldered = Array.from({ length: 8 }, (_, i) =>
      makeConversation(i, `u-r${i}`, `unfoldered ${i + 1}`),
    );
    instance = mount(ProjectFolderItem, {
      target,
      props: {
        ...baseProps,
        folder: makeFolder({
          conversations: unfoldered,
          conversationCount: 8 + 1,
        }),
        subFolders,
        expandedSubFolders: new Set<string>(),
      },
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(target.textContent).toContain("Only folder");
    expect(target.querySelector(".sidebar-logical-folders")).not.toBeNull();
    expect(countSubstring(target.textContent ?? "", "unfoldered")).toBe(DEFAULT_SESSION_PAGE_SIZE);
  });

  it("shows all 10 logical folders with 5 sessions each and paginates 20 unfoldered sessions", async () => {
    const subFolders = Array.from({ length: 10 }, (_, i) =>
      makeSubFolderWithSessions(`Folder ${i + 1}`, 20, `f-${i + 1}`),
    );
    const unfoldered = Array.from({ length: 20 }, (_, i) =>
      makeConversation(i, `root-r${i}`, `root session ${i + 1}`),
    );
    instance = mount(ProjectFolderItem, {
      target,
      props: {
        ...baseProps,
        folder: makeFolder({
          conversations: unfoldered,
          conversationCount: 20 + subFolders.reduce((n, sf) => n + sf.conversationCount, 0),
        }),
        subFolders,
        expandedSubFolders: new Set(subFolders.map((sf) => sf.folderKey)),
      },
    });

    await new Promise((r) => setTimeout(r, 300));

    const logical = target.querySelector(".sidebar-logical-folders");
    expect(logical).not.toBeNull();
    expect(logical!.querySelectorAll('[class*="group/sf"]').length).toBe(10);

    for (let i = 1; i <= 10; i += 1) {
      expect(target.textContent).toContain(`Folder ${i}`);
    }

    const sessionBlocks = target.querySelectorAll(".sidebar-subfolder-sessions");
    expect(sessionBlocks.length).toBe(10);
    for (const block of sessionBlocks) {
      expect(countSubstring(block.textContent ?? "", "session")).toBe(DEFAULT_SESSION_PAGE_SIZE);
    }

    expect(countSubstring(target.textContent ?? "", "root session")).toBe(
      DEFAULT_SESSION_PAGE_SIZE,
    );
    expect(target.textContent).toMatch(/显示更多|Show.*more/i);
  });
});
