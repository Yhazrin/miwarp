/**
 * Sidebar grouping utilities — pure functions for building the project folder tree.
 *
 * Transforms a flat list of TaskRun into ProjectFolder[] where each folder
 * contains ConversationGroup[] (runs grouped by session_id).
 */

import type { TaskRun, SessionFolder } from "$lib/types";

// ── Public types ──

export interface ConversationGroup {
  groupKey: string; // "s:<session_id>" or "r:<run.id>"
  runs: TaskRun[]; // sorted by started_at desc
  title: string;
  latestRun: TaskRun;
  isFavorite: boolean;
  totalMessages: number;
}

export interface ProjectFolder {
  cwd: string; // "" = uncategorized
  folderKey: string; // "uncategorized" or "cwd:<path>"
  isUncategorized: boolean;
  conversations: ConversationGroup[];
  conversationCount: number;
  latestActivityAt: string; // last_activity_at ?? started_at (safe)
}

export interface SessionFolderGroup {
  folderId: string;
  folderKey: string; // "sf:<folderId>"
  name: string;
  conversations: ConversationGroup[];
  conversationCount: number;
  latestActivityAt: string;
}

// ── Logical session folders (workspace binding) ──

/**
 * Parent project path for a logical session folder: uses `workspaceId` from when the folder was created.
 * Empty / placeholder values (legacy `"default"`, normalized empty) → uncategorized (`""`).
 * This is the user's explicit "which project this folder belongs to", not inferred from runs.
 */
export function logicalFolderParentCwd(folder: SessionFolder): string {
  const w = normalizeCwd(folder.workspaceId);
  if (!w) return "";
  if (w.toLowerCase() === "default") return "";
  return w;
}

// ── normalizeCwd ──

/** Normalize cwd: unify separators + strip trailing + uppercase drive; empty/"/"/"\" → "" */
export function normalizeCwd(cwd: string | undefined): string {
  let s = (cwd ?? "").trim();
  if (!s || s === "/" || s === "\\") return "";
  // Windows: backslash → forward slash
  s = s.replace(/\\/g, "/");
  // Windows: drive letter uppercase (c:/Repo → C:/Repo)
  s = s.replace(/^([a-z]):/, (_, d: string) => d.toUpperCase() + ":");
  // Bare drive letter "C:" → "C:/"
  if (/^[A-Z]:$/.test(s)) return s + "/";
  // Preserve drive root "C:/"
  if (/^[A-Z]:\/$/.test(s)) return s;
  // Preserve UNC root "//server" (strip trailing slash if "//server/")
  if (/^\/\/[^/]+\/?$/.test(s)) return s.replace(/\/$/, "");
  // Strip trailing slashes
  return s.replace(/\/+$/, "");
}

// ── Sort key helper ──

function sortKey(run: TaskRun): string {
  return run.last_activity_at ?? run.started_at;
}

// ── Main grouping function ──

export function buildProjectFolders(
  runs: TaskRun[],
  favoriteRunIds: Set<string>,
  pinnedCwds: string[],
  removedCwds: string[] = [],
): ProjectFolder[] {
  // 1. Build removed set (empty string excluded — Uncategorized never removed)
  const removedSet = new Set(removedCwds.map(normalizeCwd));
  removedSet.delete("");

  // 2. Clean pinnedCwds — normalize + filter empty + filter removed
  const cleanPinned = pinnedCwds.map(normalizeCwd).filter((c) => c !== "" && !removedSet.has(c));

  // 3. Bucket runs by normalized cwd (use parent_cwd for worktree sessions)
  const cwdBuckets = new Map<string, TaskRun[]>();
  for (const run of runs) {
    const cwd = normalizeCwd(run.parent_cwd ?? run.cwd);
    let bucket = cwdBuckets.get(cwd);
    if (!bucket) {
      bucket = [];
      cwdBuckets.set(cwd, bucket);
    }
    bucket.push(run);
  }

  // 4. Remove buckets in removedSet
  for (const cwd of removedSet) {
    cwdBuckets.delete(cwd);
  }

  // 5. Ensure pinned cwds have entries (even if empty)
  for (const cwd of cleanPinned) {
    if (!cwdBuckets.has(cwd)) {
      cwdBuckets.set(cwd, []);
    }
  }

  // 6. Build folders
  const folders: ProjectFolder[] = [];

  for (const [cwd, bucketRuns] of cwdBuckets) {
    const isUncategorized = cwd === "";
    const folderKey = isUncategorized ? "uncategorized" : `cwd:${cwd}`;

    // Group runs by session_id within this cwd
    const sessionMap = new Map<string, TaskRun[]>();
    const standalone: TaskRun[] = [];

    for (const run of bucketRuns) {
      if (run.session_id) {
        let group = sessionMap.get(run.session_id);
        if (!group) {
          group = [];
          sessionMap.set(run.session_id, group);
        }
        group.push(run);
      } else {
        standalone.push(run);
      }
    }

    // Build conversation groups
    const conversations: ConversationGroup[] = [];

    // Session-based groups
    for (const [sessionId, sessionRuns] of sessionMap) {
      // Sort runs by started_at desc
      sessionRuns.sort((a, b) => b.started_at.localeCompare(a.started_at));
      const latestRun = sessionRuns[0];
      const earliestRun = sessionRuns[sessionRuns.length - 1];
      const title = latestRun.name?.trim() || earliestRun.prompt?.trim() || "Untitled";
      const isFavorite = sessionRuns.some((r) => favoriteRunIds.has(r.id));
      const totalMessages = sessionRuns.reduce((sum, r) => sum + (r.message_count ?? 0), 0);

      conversations.push({
        groupKey: `s:${sessionId}`,
        runs: sessionRuns,
        title,
        latestRun,
        isFavorite,
        totalMessages,
      });
    }

    // Standalone runs (no session_id)
    for (const run of standalone) {
      const title = run.name?.trim() || run.prompt?.trim() || "Untitled";
      conversations.push({
        groupKey: `r:${run.id}`,
        runs: [run],
        title,
        latestRun: run,
        isFavorite: favoriteRunIds.has(run.id),
        totalMessages: run.message_count ?? 0,
      });
    }

    // Sort conversations by latest activity desc
    conversations.sort((a, b) => sortKey(b.latestRun).localeCompare(sortKey(a.latestRun)));

    const latestActivityAt = conversations.length > 0 ? sortKey(conversations[0].latestRun) : "";

    folders.push({
      cwd,
      folderKey,
      isUncategorized,
      conversations,
      conversationCount: conversations.length,
      latestActivityAt,
    });
  }

  // 7. Sort: normal projects by latestActivityAt desc, Uncategorized always last
  folders.sort((a, b) => {
    if (a.isUncategorized && !b.isUncategorized) return 1;
    if (!a.isUncategorized && b.isUncategorized) return -1;
    return b.latestActivityAt.localeCompare(a.latestActivityAt);
  });

  return folders;
}

// ── Expand helpers ──

/** Auto-expand the folder containing selectedRunId. Returns new Set or null (no change). */
export function autoExpandForRun(
  selectedRunId: string | undefined,
  projectFolders: ProjectFolder[],
  expandedProjects: Set<string>,
): Set<string> | null {
  if (!selectedRunId) return null;

  for (const folder of projectFolders) {
    const found = folder.conversations.some((conv) =>
      conv.runs.some((r) => r.id === selectedRunId),
    );
    if (found) {
      if (expandedProjects.has(folder.folderKey)) return null; // already expanded
      const next = new Set(expandedProjects);
      next.add(folder.folderKey);
      return next;
    }
  }

  return null;
}

/** Expand a folder by its folderKey. Returns new Set or null (skip). */
export function expandForProjectChange(
  folderKey: string,
  expandedProjects: Set<string>,
): Set<string> | null {
  if (!folderKey) return null; // empty = "All Projects" → skip
  if (expandedProjects.has(folderKey)) return null; // already expanded
  const next = new Set(expandedProjects);
  next.add(folderKey);
  return next;
}

// ── Build conversation group from a set of runs ──

function buildConversationsForRuns(
  bucketRuns: TaskRun[],
  favoriteRunIds: Set<string>,
): ConversationGroup[] {
  const sessionMap = new Map<string, TaskRun[]>();
  const standalone: TaskRun[] = [];

  for (const run of bucketRuns) {
    if (run.session_id) {
      let group = sessionMap.get(run.session_id);
      if (!group) {
        group = [];
        sessionMap.set(run.session_id, group);
      }
      group.push(run);
    } else {
      standalone.push(run);
    }
  }

  const conversations: ConversationGroup[] = [];

  for (const [sessionId, sessionRuns] of sessionMap) {
    sessionRuns.sort((a, b) => b.started_at.localeCompare(a.started_at));
    const latestRun = sessionRuns[0];
    const earliestRun = sessionRuns[sessionRuns.length - 1];
    const title = latestRun.name?.trim() || earliestRun.prompt?.trim() || "Untitled";
    const isFavorite = sessionRuns.some((r) => favoriteRunIds.has(r.id));
    const totalMessages = sessionRuns.reduce((sum, r) => sum + (r.message_count ?? 0), 0);

    conversations.push({
      groupKey: `s:${sessionId}`,
      runs: sessionRuns,
      title,
      latestRun,
      isFavorite,
      totalMessages,
    });
  }

  for (const run of standalone) {
    const title = run.name?.trim() || run.prompt?.trim() || "Untitled";
    conversations.push({
      groupKey: `r:${run.id}`,
      runs: [run],
      title,
      latestRun: run,
      isFavorite: favoriteRunIds.has(run.id),
      totalMessages: run.message_count ?? 0,
    });
  }

  conversations.sort((a, b) => sortKey(b.latestRun).localeCompare(sortKey(a.latestRun)));
  return conversations;
}

// ── Enriched project folders (logical sub-folders nested inside project paths) ──

export interface EnrichedProjectFolder extends ProjectFolder {
  /** Logical sub-folders that contain sessions from this project path. */
  subFolders: SessionFolderGroup[];
  /** Only sessions NOT assigned to any sub-folder. */
  conversations: ConversationGroup[];
}

/**
 * Builds project folders enriched with nested logical sub-folders.
 * - Sessions assigned to a SessionFolder are excluded from `conversations` (they appear in `subFolders`).
 * - Each SessionFolderGroup is placed under the project from `SessionFolder.workspaceId` (set when the folder is created).
 * - If `workspaceId` is empty/placeholder and the folder has sessions, parent path falls back to majority cwd of those runs.
 * - Empty folders with no usable `workspaceId` stay in the uncategorized bucket.
 */
export function buildEnrichedProjectFolders(
  runs: TaskRun[],
  sessionFolders: SessionFolder[],
  favoriteRunIds: Set<string>,
  pinnedCwds: string[],
  removedCwds: string[] = [],
): EnrichedProjectFolder[] {
  // 1. Partition runs: foldered vs unfoldered
  const folderRunMap = new Map<string, TaskRun[]>();
  const unfoldered: TaskRun[] = [];
  for (const run of runs) {
    if (run.folder_id) {
      let bucket = folderRunMap.get(run.folder_id);
      if (!bucket) {
        bucket = [];
        folderRunMap.set(run.folder_id, bucket);
      }
      bucket.push(run);
    } else {
      unfoldered.push(run);
    }
  }

  // 2. Map each SessionFolder → parent project cwd (explicit workspace first, else infer from runs)
  const folderCwdMap = new Map<string, string>();
  for (const folder of sessionFolders) {
    const bucketRuns = folderRunMap.get(folder.id) ?? [];
    const fromWorkspace = logicalFolderParentCwd(folder);
    if (fromWorkspace !== "") {
      folderCwdMap.set(folder.id, fromWorkspace);
      continue;
    }
    if (bucketRuns.length === 0) {
      folderCwdMap.set(folder.id, "");
      continue;
    }
    // Count cwd occurrences
    const cwdCounts = new Map<string, number>();
    for (const r of bucketRuns) {
      const cwd = normalizeCwd(r.parent_cwd ?? r.cwd);
      cwdCounts.set(cwd, (cwdCounts.get(cwd) ?? 0) + 1);
    }
    // Pick majority cwd
    let bestCwd = "";
    let bestCount = 0;
    for (const [cwd, count] of cwdCounts) {
      if (count > bestCount) {
        bestCwd = cwd;
        bestCount = count;
      }
    }
    folderCwdMap.set(folder.id, bestCwd);
  }

  // 3. Build project folder buckets from UNFOLDERED runs
  const removedSet = new Set(removedCwds.map(normalizeCwd));
  removedSet.delete("");
  const cleanPinned = pinnedCwds.map(normalizeCwd).filter((c) => c !== "" && !removedSet.has(c));

  const cwdBuckets = new Map<string, TaskRun[]>();
  for (const run of unfoldered) {
    const cwd = normalizeCwd(run.parent_cwd ?? run.cwd);
    if (removedSet.has(cwd)) continue;
    let bucket = cwdBuckets.get(cwd);
    if (!bucket) {
      bucket = [];
      cwdBuckets.set(cwd, bucket);
    }
    bucket.push(run);
  }
  // Ensure pinned cwds exist
  for (const cwd of cleanPinned) {
    if (!cwdBuckets.has(cwd)) cwdBuckets.set(cwd, []);
  }
  // Also ensure any cwd that has session folders appears
  for (const [, cwd] of folderCwdMap) {
    if (cwd !== "" && !removedSet.has(cwd) && !cwdBuckets.has(cwd)) {
      cwdBuckets.set(cwd, []);
    }
  }

  // 4. Build sub-folder groups map: cwd → SessionFolderGroup[]
  const cwdSubFolders = new Map<string, SessionFolderGroup[]>();
  for (const folder of sessionFolders) {
    const cwd = folderCwdMap.get(folder.id) ?? "";
    const bucketRuns = folderRunMap.get(folder.id) ?? [];
    const conversations = buildConversationsForRuns(bucketRuns, favoriteRunIds);
    const latestActivityAt =
      conversations.length > 0 ? sortKey(conversations[0].latestRun) : folder.updatedAt;
    const sfg: SessionFolderGroup = {
      folderId: folder.id,
      folderKey: `sf:${folder.id}`,
      name: folder.name,
      conversations,
      conversationCount: conversations.length,
      latestActivityAt,
    };
    let arr = cwdSubFolders.get(cwd);
    if (!arr) {
      arr = [];
      cwdSubFolders.set(cwd, arr);
    }
    arr.push(sfg);
    // Ensure uncategorized cwd bucket exists for folders with no project
    if (cwd === "" && !cwdBuckets.has("")) cwdBuckets.set("", []);
  }
  // Sort sub-folder lists
  for (const arr of cwdSubFolders.values()) {
    arr.sort((a, b) => b.latestActivityAt.localeCompare(a.latestActivityAt));
  }

  // 5. Build EnrichedProjectFolders
  const folders: EnrichedProjectFolder[] = [];
  for (const [cwd, bucketRuns] of cwdBuckets) {
    const isUncategorized = cwd === "";
    const folderKey = isUncategorized ? "uncategorized" : `cwd:${cwd}`;
    const conversations = buildConversationsForRuns(bucketRuns, favoriteRunIds);
    const subFolders = cwdSubFolders.get(cwd) ?? [];
    const allLatest = [
      ...conversations.map((c) => sortKey(c.latestRun)),
      ...subFolders.map((sf) => sf.latestActivityAt),
    ]
      .sort()
      .reverse();
    const latestActivityAt = allLatest[0] ?? "";
    const totalCount =
      conversations.length + subFolders.reduce((s, sf) => s + sf.conversationCount, 0);

    folders.push({
      cwd,
      folderKey,
      isUncategorized,
      conversations,
      conversationCount: totalCount,
      latestActivityAt,
      subFolders,
    });
  }

  folders.sort((a, b) => {
    if (a.isUncategorized && !b.isUncategorized) return 1;
    if (!a.isUncategorized && b.isUncategorized) return -1;
    return b.latestActivityAt.localeCompare(a.latestActivityAt);
  });

  return folders;
}

// ── Session folder groups ──

export function buildSessionFolderGroups(
  runs: TaskRun[],
  sessionFolders: SessionFolder[],
  favoriteRunIds: Set<string>,
): { folderGroups: SessionFolderGroup[]; unassignedRuns: TaskRun[] } {
  // Partition runs: those with folder_id vs those without
  const folderRunMap = new Map<string, TaskRun[]>();
  const unassigned: TaskRun[] = [];

  for (const run of runs) {
    if (run.folder_id) {
      let bucket = folderRunMap.get(run.folder_id);
      if (!bucket) {
        bucket = [];
        folderRunMap.set(run.folder_id, bucket);
      }
      bucket.push(run);
    } else {
      unassigned.push(run);
    }
  }

  const folderGroups: SessionFolderGroup[] = [];

  for (const folder of sessionFolders) {
    const bucketRuns = folderRunMap.get(folder.id) ?? [];
    const conversations = buildConversationsForRuns(bucketRuns, favoriteRunIds);
    const latestActivityAt =
      conversations.length > 0 ? sortKey(conversations[0].latestRun) : folder.updatedAt;

    folderGroups.push({
      folderId: folder.id,
      folderKey: `sf:${folder.id}`,
      name: folder.name,
      conversations,
      conversationCount: conversations.length,
      latestActivityAt,
    });
  }

  // Sort by latest activity desc
  folderGroups.sort((a, b) => b.latestActivityAt.localeCompare(a.latestActivityAt));

  return { folderGroups, unassignedRuns: unassigned };
}
