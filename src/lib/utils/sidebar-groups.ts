/**
 * Sidebar grouping utilities — pure functions for building the project folder tree.
 *
 * Transforms a flat list of TaskRun into ProjectFolder[] where each folder
 * contains ConversationGroup[] (runs grouped by session_id).
 */

import type { TaskRun, SessionFolder } from "$lib/types";
import type { ScheduledTask, ScheduledTaskRun } from "$lib/types/scheduled-task";

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

/** One scheduled task hub per workspace — groups all execution runs for a task definition. */
export interface ScheduledTaskHubGroup {
  hubKey: string; // "sched:<taskId>:<cwd>"
  taskId: string;
  taskName: string;
  cwd: string;
  enabled: boolean;
  runs: TaskRun[];
  executions: ScheduledTaskRun[];
  latestRun: TaskRun;
  latestStatus: TaskRun["status"];
  executionCount: number;
  latestActivityAt: string;
}

const LEGACY_DEFAULT_WORKSPACE = "default";

/** Normalize folder workspace id from API/storage (handles legacy `default` + snake_case). */
export function resolveSessionFolderWorkspaceId(folder: SessionFolder): string {
  const raw = normalizeCwd(
    folder.workspaceId ?? (folder as SessionFolder & { workspace_id?: string }).workspace_id ?? "",
  );
  if (raw === LEGACY_DEFAULT_WORKSPACE) return "";
  return raw;
}

export function normalizeSessionFolderList(folders: SessionFolder[]): SessionFolder[] {
  return folders.map((folder) => ({
    ...folder,
    workspaceId: resolveSessionFolderWorkspaceId(folder),
  }));
}

function subFolderDisplayCount(subFolders: SessionFolderGroup[]): number {
  return subFolders.reduce(
    (sum, sf) => sum + (sf.conversationCount > 0 ? sf.conversationCount : 1),
    0,
  );
}

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
  /** Scheduled task hubs in this workspace (not shown as flat conversations). */
  scheduledTaskHubs: ScheduledTaskHubGroup[];
  /** Only sessions NOT assigned to any sub-folder or scheduled hub. */
  conversations: ConversationGroup[];
}

export function isScheduledTaskRun(run: TaskRun): boolean {
  return !!run.scheduled_task_id;
}

function buildScheduledTaskHubsForCwd(
  cwd: string,
  scheduledRuns: TaskRun[],
  scheduledTasks: ScheduledTask[],
  scheduledTaskRuns: ScheduledTaskRun[],
): ScheduledTaskHubGroup[] {
  const byTask = new Map<string, TaskRun[]>();
  for (const run of scheduledRuns) {
    const taskId = run.scheduled_task_id;
    if (!taskId) continue;
    let bucket = byTask.get(taskId);
    if (!bucket) {
      bucket = [];
      byTask.set(taskId, bucket);
    }
    bucket.push(run);
  }

  const hubs: ScheduledTaskHubGroup[] = [];
  for (const [taskId, taskRuns] of byTask) {
    taskRuns.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
    const latestRun = taskRuns[0];
    const task = scheduledTasks.find((t) => t.id === taskId);
    const taskName =
      task?.name?.trim() ||
      latestRun.name?.replace(/^⏱\s*/, "").trim() ||
      latestRun.prompt?.trim().slice(0, 40) ||
      "Scheduled task";
    const executions = scheduledTaskRuns
      .filter((r) => r.taskId === taskId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    hubs.push({
      hubKey: `sched:${taskId}:${cwd}`,
      taskId,
      taskName,
      cwd,
      enabled: task?.enabled ?? true,
      runs: taskRuns,
      executions,
      latestRun,
      latestStatus: latestRun.status,
      executionCount: taskRuns.length,
      latestActivityAt: sortKey(latestRun),
    });
  }

  hubs.sort((a, b) => b.latestActivityAt.localeCompare(a.latestActivityAt));
  return hubs;
}

/**
 * Builds project folders enriched with nested logical sub-folders.
 * - Sessions assigned to a SessionFolder are excluded from `conversations` (they appear in `subFolders`).
 * - Each SessionFolderGroup is assigned to the project path that its sessions belong to.
 * - Empty SessionFolders stay under their `workspaceId` (not uncategorized).
 */
export function buildEnrichedProjectFolders(
  runs: TaskRun[],
  sessionFolders: SessionFolder[],
  favoriteRunIds: Set<string>,
  pinnedCwds: string[],
  removedCwds: string[] = [],
  scheduledTasks: ScheduledTask[] = [],
  scheduledTaskRuns: ScheduledTaskRun[] = [],
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

  const manualUnfoldered = unfoldered.filter((r) => !isScheduledTaskRun(r));
  const scheduledUnfoldered = unfoldered.filter((r) => isScheduledTaskRun(r));

  // 2. Determine which cwd each SessionFolder belongs to (majority vote from its sessions)
  const folderCwdMap = new Map<string, string>();
  for (const folder of sessionFolders) {
    const bucketRuns = folderRunMap.get(folder.id) ?? [];
    if (bucketRuns.length === 0) {
      folderCwdMap.set(folder.id, resolveSessionFolderWorkspaceId(folder));
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
  const scheduledByCwd = new Map<string, TaskRun[]>();
  for (const run of manualUnfoldered) {
    const cwd = normalizeCwd(run.parent_cwd ?? run.cwd);
    if (removedSet.has(cwd)) continue;
    let bucket = cwdBuckets.get(cwd);
    if (!bucket) {
      bucket = [];
      cwdBuckets.set(cwd, bucket);
    }
    bucket.push(run);
  }
  for (const run of scheduledUnfoldered) {
    const cwd = normalizeCwd(run.parent_cwd ?? run.cwd);
    if (removedSet.has(cwd)) continue;
    let bucket = scheduledByCwd.get(cwd);
    if (!bucket) {
      bucket = [];
      scheduledByCwd.set(cwd, bucket);
    }
    bucket.push(run);
  }
  // Ensure pinned cwds exist
  for (const cwd of cleanPinned) {
    if (!cwdBuckets.has(cwd)) cwdBuckets.set(cwd, []);
  }
  // Ensure every logical folder's workspace appears (including empty folders)
  for (const folder of sessionFolders) {
    const cwd = resolveSessionFolderWorkspaceId(folder);
    if (cwd !== "" && !removedSet.has(cwd) && !cwdBuckets.has(cwd)) {
      cwdBuckets.set(cwd, []);
    }
  }
  // Also ensure any cwd that has session folders appears (from run-majority vote)
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

  // Attach sub-folder workspaces even if they only have logical folders (no unfoldered runs)
  for (const cwd of cwdSubFolders.keys()) {
    if (cwd === "") {
      if (!cwdBuckets.has("")) cwdBuckets.set("", []);
      continue;
    }
    if (!removedSet.has(cwd) && !cwdBuckets.has(cwd)) {
      cwdBuckets.set(cwd, []);
    }
  }

  // 5. Build EnrichedProjectFolders
  const folders: EnrichedProjectFolder[] = [];
  for (const [cwd, bucketRuns] of cwdBuckets) {
    const isUncategorized = cwd === "";
    const folderKey = isUncategorized ? "uncategorized" : `cwd:${cwd}`;
    const conversations = buildConversationsForRuns(bucketRuns, favoriteRunIds);
    const scheduledTaskHubs = buildScheduledTaskHubsForCwd(
      cwd,
      scheduledByCwd.get(cwd) ?? [],
      scheduledTasks,
      scheduledTaskRuns,
    );
    const subFolders = cwdSubFolders.get(cwd) ?? [];
    const allLatest = [
      ...conversations.map((c) => sortKey(c.latestRun)),
      ...subFolders.map((sf) => sf.latestActivityAt),
      ...scheduledTaskHubs.map((h) => h.latestActivityAt),
    ]
      .sort()
      .reverse();
    const latestActivityAt = allLatest[0] ?? "";
    const totalCount =
      conversations.length + subFolderDisplayCount(subFolders) + scheduledTaskHubs.length;

    folders.push({
      cwd,
      folderKey,
      isUncategorized,
      conversations,
      conversationCount: totalCount,
      latestActivityAt,
      subFolders,
      scheduledTaskHubs,
    });
  }

  // Workspaces that only have scheduled hubs (no manual runs yet)
  for (const [cwd, schedRuns] of scheduledByCwd) {
    if (cwdBuckets.has(cwd)) continue;
    if (removedSet.has(cwd)) continue;
    const isUncategorized = cwd === "";
    const folderKey = isUncategorized ? "uncategorized" : `cwd:${cwd}`;
    const scheduledTaskHubs = buildScheduledTaskHubsForCwd(
      cwd,
      schedRuns,
      scheduledTasks,
      scheduledTaskRuns,
    );
    const subFolders = cwdSubFolders.get(cwd) ?? [];
    const allLatest = [
      ...subFolders.map((sf) => sf.latestActivityAt),
      ...scheduledTaskHubs.map((h) => h.latestActivityAt),
    ]
      .sort()
      .reverse();
    folders.push({
      cwd,
      folderKey,
      isUncategorized,
      conversations: [],
      conversationCount: scheduledTaskHubs.length + subFolderDisplayCount(subFolders),
      latestActivityAt: allLatest[0] ?? "",
      subFolders,
      scheduledTaskHubs,
    });
  }

  folders.sort((a, b) => {
    if (a.isUncategorized && !b.isUncategorized) return 1;
    if (!a.isUncategorized && b.isUncategorized) return -1;
    return b.latestActivityAt.localeCompare(a.latestActivityAt);
  });

  return folders;
}

// ── Flat list builder (Cursor-style) ──

export interface FlatListResult {
  /** Pinned conversations, sorted by latest activity desc. */
  pinned: ConversationGroup[];
  /** All non-pinned non-archived conversations, sorted by latest activity desc. */
  recent: ConversationGroup[];
  /** Archived conversations (completed/idle for > 1 hour). */
  archived: ConversationGroup[];
}

const ARCHIVE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/**
 * Build a flat sorted list of conversations from all runs.
 * Groups by session_id, sorts by activity, partitions into pinned/recent/archived.
 */
export function buildFlatConversationList(
  runs: TaskRun[],
  favoriteRunIds: Set<string>,
): FlatListResult {
  // Group by session_id
  const sessionMap = new Map<string, TaskRun[]>();
  const standalone: TaskRun[] = [];

  for (const run of runs) {
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

  const allConversations: ConversationGroup[] = [];

  for (const [, sessionRuns] of sessionMap) {
    sessionRuns.sort((a, b) => b.started_at.localeCompare(a.started_at));
    const latestRun = sessionRuns[0];
    const earliestRun = sessionRuns[sessionRuns.length - 1];
    const title = latestRun.name?.trim() || earliestRun.prompt?.trim() || "Untitled";
    const isFavorite = sessionRuns.some((r) => favoriteRunIds.has(r.id));
    const totalMessages = sessionRuns.reduce((sum, r) => sum + (r.message_count ?? 0), 0);
    allConversations.push({
      groupKey: `s:${latestRun.session_id}`,
      runs: sessionRuns,
      title,
      latestRun,
      isFavorite,
      totalMessages,
    });
  }

  for (const run of standalone) {
    const title = run.name?.trim() || run.prompt?.trim() || "Untitled";
    allConversations.push({
      groupKey: `r:${run.id}`,
      runs: [run],
      title,
      latestRun: run,
      isFavorite: favoriteRunIds.has(run.id),
      totalMessages: run.message_count ?? 0,
    });
  }

  // Sort by latest activity desc
  allConversations.sort((a, b) =>
    sortKey(b.latestRun).localeCompare(sortKey(a.latestRun)),
  );

  // Partition: pinned / recent / archived
  const pinned: ConversationGroup[] = [];
  const recent: ConversationGroup[] = [];
  const archived: ConversationGroup[] = [];
  const now = Date.now();

  for (const conv of allConversations) {
    if (conv.isFavorite) {
      pinned.push(conv);
      continue;
    }
    const status = conv.latestRun.status;
    const isTerminal = status === "completed" || status === "idle" || status === "error" || status === "stopped";
    const lastActivity = new Date(conv.latestRun.last_activity_at ?? conv.latestRun.started_at).getTime();
    const isStale = now - lastActivity > ARCHIVE_THRESHOLD_MS;

    if (isTerminal && isStale) {
      archived.push(conv);
    } else {
      recent.push(conv);
    }
  }

  return { pinned, recent, archived };
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
