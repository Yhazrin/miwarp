import type { TaskRun } from "$lib/types";
import { agentToRuntimeId } from "$lib/runtime/registry";
import { canResumeStructurally } from "$lib/stores/types";
import { PLATFORM_PRESETS } from "$lib/utils/platform-presets";
import {
  buildProjectFolders,
  normalizeCwd,
  type ConversationGroup,
  type ProjectFolder,
} from "$lib/utils/sidebar-groups";
import type {
  ExecutionTarget,
  ExecutionTargetLocal,
  WorkspaceAggregateOptions,
  WorkspaceCapsuleView,
  WorkspaceListEntry,
  WorkspaceSessionRow,
} from "$lib/types/workspace";

const ACTIVE_RUN_STATUSES = new Set(["running", "waiting_input", "waiting_approval"]);
const FAILED_RUN_STATUSES = new Set(["failed", "error"]);

const DEFAULT_MAX_RECENT = 8;

function resolveFolders(runs: TaskRun[], options: WorkspaceAggregateOptions): ProjectFolder[] {
  return buildProjectFolders(
    runs,
    options.favoriteRunIds ?? new Set<string>(),
    options.pinnedCwds ?? [],
    options.removedCwds ?? [],
  );
}

/** Coerce unknown API fields to a safe display string. */
export function safeDisplayString(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return fallback;
}

/** Phase 1 always returns local; remote union arm is reserved for future registration. */
export function executionTargetForCwd(cwd: string): ExecutionTargetLocal {
  return { kind: "local", cwd: normalizeCwd(cwd) };
}

export function workspaceLabelForCwd(
  cwd: string,
  isUncategorized: boolean,
  aliases: Record<string, string> = {},
): string {
  if (isUncategorized) return "";
  const normalized = normalizeCwd(cwd);
  const alias = aliases[normalized]?.trim();
  if (alias) return alias;
  const parts = normalized.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || normalized;
}

export function agentLabelForRun(run: TaskRun): string {
  return safeDisplayString(run.agent, "unknown");
}

export function runtimeLabelForRun(run: TaskRun): string {
  const agent = safeDisplayString(run.agent, "");
  const runtimeId = agentToRuntimeId(agent);
  if (runtimeId) return runtimeId;
  return agent || "unknown";
}

export function modelLabelForRun(run: TaskRun, platformId?: string): string {
  const model = safeDisplayString(run.model, "");
  if (model) return model;
  const platform = safeDisplayString(platformId ?? run.platform_id, "");
  if (platform) {
    const preset = PLATFORM_PRESETS.find((p) => p.id === platform);
    if (preset) return preset.name;
    return platform;
  }
  return "—";
}

export function runActivityTimestamp(run: TaskRun): string {
  return safeDisplayString(run.last_activity_at ?? run.started_at, "");
}

export function isActiveRunStatus(status: unknown): boolean {
  return typeof status === "string" && ACTIVE_RUN_STATUSES.has(status);
}

export function isFailedRunStatus(status: unknown): boolean {
  return typeof status === "string" && FAILED_RUN_STATUSES.has(status);
}

function defaultCanContinue(run: TaskRun): boolean {
  return canResumeStructurally(run, safeDisplayString(run.status, ""));
}

function summarizeFolderRuns(
  folder: ProjectFolder,
  hasAttention: (runId: string) => boolean,
): { runningCount: number; attentionCount: number; failedCount: number } {
  let runningCount = 0;
  let attentionCount = 0;
  let failedCount = 0;

  for (const conversation of folder.conversations) {
    for (const run of conversation.runs) {
      if (isActiveRunStatus(run.status)) runningCount += 1;
      if (isFailedRunStatus(run.status)) failedCount += 1;
      if (hasAttention(run.id)) attentionCount += 1;
    }
  }

  return { runningCount, attentionCount, failedCount };
}

function folderToListEntry(
  folder: ProjectFolder,
  options: WorkspaceAggregateOptions,
): WorkspaceListEntry {
  const hasAttention = options.hasAttention ?? (() => false);
  const aliases = options.workspaceAliases ?? {};
  return {
    cwd: folder.cwd,
    folderKey: folder.folderKey,
    label: folder.isUncategorized
      ? ""
      : workspaceLabelForCwd(folder.cwd, false, aliases) || folder.cwd,
    isUncategorized: folder.isUncategorized,
    conversationCount: folder.conversationCount,
    latestActivityAt: folder.latestActivityAt,
    ...summarizeFolderRuns(folder, hasAttention),
    executionTarget: executionTargetForCwd(folder.cwd),
  };
}

export function buildWorkspaceListEntries(
  runs: TaskRun[],
  options: WorkspaceAggregateOptions = {},
): WorkspaceListEntry[] {
  return resolveFolders(runs, options).map((folder) => folderToListEntry(folder, options));
}

function conversationToSessionRow(
  conversation: ConversationGroup,
  options: WorkspaceAggregateOptions,
): WorkspaceSessionRow {
  const run = conversation.latestRun;
  const hasAttention = options.hasAttention ?? (() => false);
  const resolveCanContinue = options.resolveCanContinue ?? defaultCanContinue;
  const status = safeDisplayString(run.status, "unknown");

  return {
    groupKey: conversation.groupKey,
    title: safeDisplayString(conversation.title, "Untitled"),
    latestRun: run,
    status,
    agentLabel: agentLabelForRun(run),
    runtimeLabel: runtimeLabelForRun(run),
    modelLabel: modelLabelForRun(run),
    lastActivityAt: runActivityTimestamp(run),
    canContinue: resolveCanContinue(run),
    needsAttention: hasAttention(run.id),
    isActive: isActiveRunStatus(status),
    isFailed: isFailedRunStatus(status),
    href: `/chat?run=${encodeURIComponent(run.id)}`,
  };
}

function sortSessionRows(rows: WorkspaceSessionRow[]): WorkspaceSessionRow[] {
  return [...rows].sort((a, b) => {
    const rank = (row: WorkspaceSessionRow) => {
      if (row.needsAttention) return 0;
      if (row.isActive) return 1;
      if (row.isFailed) return 2;
      return 3;
    };
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    return b.lastActivityAt.localeCompare(a.lastActivityAt);
  });
}

function findFolderForCwd(folders: ProjectFolder[], cwd: string): ProjectFolder | null {
  const normalized = normalizeCwd(cwd);
  return (
    folders.find((item) => item.cwd === normalized) ??
    folders.find((item) => item.isUncategorized && normalized === "") ??
    null
  );
}

function buildCapsuleFromFolder(
  folder: ProjectFolder | null,
  normalizedCwd: string,
  options: WorkspaceAggregateOptions,
): WorkspaceCapsuleView {
  const aliases = options.workspaceAliases ?? {};
  const maxRecent = options.maxRecentSessions ?? DEFAULT_MAX_RECENT;

  if (!folder || folder.conversations.length === 0) {
    return {
      cwd: normalizedCwd,
      label: workspaceLabelForCwd(normalizedCwd, normalizedCwd === "", aliases),
      executionTarget: executionTargetForCwd(normalizedCwd),
      sessions: [],
      recentGroups: [],
      isEmpty: true,
    };
  }

  const rows = sortSessionRows(
    folder.conversations.map((conversation) => conversationToSessionRow(conversation, options)),
  ).slice(0, maxRecent);

  return {
    cwd: folder.cwd,
    label: folder.isUncategorized
      ? ""
      : workspaceLabelForCwd(folder.cwd, false, aliases) || folder.cwd,
    executionTarget: executionTargetForCwd(folder.cwd),
    sessions: rows,
    recentGroups: folder.conversations.slice(0, maxRecent),
    isEmpty: rows.length === 0,
  };
}

export function buildWorkspaceCapsule(
  cwd: string,
  runs: TaskRun[],
  options: WorkspaceAggregateOptions = {},
): WorkspaceCapsuleView {
  const normalized = normalizeCwd(cwd);
  const folders = resolveFolders(runs, options);
  return buildCapsuleFromFolder(findFolderForCwd(folders, normalized), normalized, options);
}

/** Single pass over runs for list + capsule (avoids duplicate buildProjectFolders). */
export function buildWorkspaceView(
  runs: TaskRun[],
  selectedCwd: string,
  options: WorkspaceAggregateOptions = {},
): { entries: WorkspaceListEntry[]; capsule: WorkspaceCapsuleView } {
  const folders = resolveFolders(runs, options);
  const normalized = normalizeCwd(selectedCwd);
  return {
    entries: folders.map((folder) => folderToListEntry(folder, options)),
    capsule: buildCapsuleFromFolder(findFolderForCwd(folders, normalized), normalized, options),
  };
}

export function findDefaultWorkspaceCwd(
  entries: WorkspaceListEntry[],
  preferredCwd: string,
): string | null {
  if (entries.length === 0) return null;
  const normalizedPreferred = normalizeCwd(preferredCwd);
  if (normalizedPreferred) {
    const match = entries.find((entry) => entry.cwd === normalizedPreferred);
    if (match) return match.cwd;
  }
  const firstNonEmpty = entries.find((entry) => !entry.isUncategorized);
  return firstNonEmpty?.cwd ?? entries[0]?.cwd ?? null;
}
