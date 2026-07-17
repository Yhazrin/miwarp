import type { ConversationGroup } from "$lib/utils/sidebar-groups";
import type { TaskRun } from "$lib/types";

/** Phase 1 extension point: only `local` instances are emitted today. */
type ExecutionTargetKind "local" | "remote";

export interface ExecutionTargetLocal {
  kind: "local";
  cwd: string;
}

/** Reserved for remote compute registration — not instantiated in Phase 1. */
interface ExecutionTargetRemote {
  kind: "remote";
  cwd: string;
  hostName?: string;
  remoteCwd?: string;
}

type ExecutionTarget ExecutionTargetLocal | ExecutionTargetRemote;

export interface WorkspaceListEntry {
  cwd: string;
  folderKey: string;
  label: string;
  isUncategorized: boolean;
  conversationCount: number;
  latestActivityAt: string;
  runningCount: number;
  attentionCount: number;
  failedCount: number;
  executionTarget: ExecutionTarget;
}

export interface WorkspaceSessionRow {
  groupKey: string;
  title: string;
  latestRun: TaskRun;
  status: string;
  agentLabel: string;
  runtimeLabel: string;
  modelLabel: string;
  lastActivityAt: string;
  canContinue: boolean;
  needsAttention: boolean;
  isActive: boolean;
  isFailed: boolean;
  href: string;
}

export interface WorkspaceGitSnapshot {
  branch: string;
  changedFiles: number;
  isClean: boolean;
  loading: boolean;
  error: string | null;
}

export interface WorkspaceCapsuleView {
  cwd: string;
  label: string;
  executionTarget: ExecutionTarget;
  sessions: WorkspaceSessionRow[];
  recentGroups: ConversationGroup[];
  isEmpty: boolean;
}

export interface WorkspaceAggregateOptions {
  favoriteRunIds?: Set<string>;
  pinnedCwds?: string[];
  removedCwds?: string[];
  workspaceAliases?: Record<string, string>;
  folderSortOrder?: string;
  hasAttention?: (runId: string) => boolean;
  resolveCanContinue?: (run: TaskRun) => boolean;
  maxRecentSessions?: number;
}
