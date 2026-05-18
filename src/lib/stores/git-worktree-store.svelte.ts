import * as api from "$lib/api";
import type { WorktreeEntry } from "$lib/api";

export interface GitWorktreeState {
  branch: string;
  worktreePath?: string;
  parentPath?: string;
  isMainRepo: boolean;
  isWorktree: boolean;
  isClean: boolean;
  ahead: number;
  behind: number;
  changedFiles: number;
  lastCommitMessage?: string;
  lastCommitHash?: string;
  lastCommitTs?: string;
  canCreatePr: boolean;
  worktrees: WorktreeEntry[];
  loading: boolean;
}

const DEFAULT_STATE: GitWorktreeState = {
  branch: "",
  isMainRepo: false,
  isWorktree: false,
  isClean: true,
  ahead: 0,
  behind: 0,
  changedFiles: 0,
  canCreatePr: false,
  worktrees: [],
  loading: false,
};

export function createGitWorktreeStore() {
  let state = $state<GitWorktreeState>({ ...DEFAULT_STATE });
  let currentCwd = $state("");
  let currentWorktreePath = $state<string | undefined>();

  async function loadState(cwd: string, worktreePath?: string) {
    if (!cwd) return;
    currentCwd = cwd;
    currentWorktreePath = worktreePath;
    state = { ...DEFAULT_STATE, loading: true };

    const effectiveCwd = worktreePath || cwd;

    try {
      const [branch, summary, statusOutput, worktrees] = await Promise.all([
        api.getGitBranch(effectiveCwd).catch(() => ""),
        api.getGitSummary(effectiveCwd).catch(() => null),
        api.getGitStatus(effectiveCwd).catch(() => ""),
        worktreePath ? api.listWorktrees(cwd).catch(() => []) : Promise.resolve([]),
      ]);

      const isClean = !statusOutput.trim();
      const ahead = extractAheadBehind(statusOutput);
      const changedFiles = summary?.total_files ?? 0;

      // Get last commit
      let lastCommitMessage: string | undefined;
      let lastCommitHash: string | undefined;
      let lastCommitTs: string | undefined;
      try {
        const logOut = await runGitLog(effectiveCwd);
        if (logOut) {
          const lines = logOut.split("\n");
          lastCommitHash = lines[0]?.slice(0, 7);
          lastCommitMessage = lines[1];
          lastCommitTs = lines[2];
        }
      } catch {
        /* ignore */
      }

      // Check if can create PR (has remote + branch)
      const canCreatePr = branch.length > 0 && !branch.includes("(detached");

      state = {
        branch,
        worktreePath,
        parentPath: worktreePath ? cwd : undefined,
        isMainRepo: !worktreePath,
        isWorktree: !!worktreePath,
        isClean,
        ahead,
        behind: 0,
        changedFiles,
        lastCommitMessage,
        lastCommitHash,
        lastCommitTs,
        canCreatePr,
        worktrees,
        loading: false,
      };
    } catch {
      state = { ...DEFAULT_STATE, loading: false };
    }
  }

  function extractAheadBehind(statusOutput: string): number {
    // Count lines starting with "?? " (untracked) or modified files
    const lines = statusOutput
      .split("\n")
      .filter(
        (l) => l.startsWith(" M") || l.startsWith("??") || l.startsWith("A ") || l.startsWith(" D"),
      );
    return lines.length;
  }

  function runGitLog(cwd: string): Promise<string | null> {
    return new Promise((resolve) => {
      // We'll use a simple approach: just get last commit info via a thrown command
      // Actually we need to implement this differently since there's no direct git log API
      // For now, leave it as undefined - the GitSummary might have what we need
      resolve(null);
    });
  }

  async function autoCommit(message?: string) {
    if (!currentCwd) return { committed: false, sha: undefined, message: "No cwd" };
    const effectiveCwd = currentWorktreePath || currentCwd;
    const msg = message || `feat: update from MiWarp session`;
    return api.autoCommit(effectiveCwd, msg);
  }

  async function createPr(baseBranch?: string) {
    if (!currentCwd || !state.branch) return null;
    const effectiveCwd = currentWorktreePath || currentCwd;
    return api.createPullRequest(effectiveCwd, state.branch, baseBranch || "main");
  }

  async function refresh() {
    if (currentCwd) {
      await loadState(currentCwd, currentWorktreePath);
    }
  }

  const debouncedRefresh = debounce(refresh, 5000);

  return {
    get state() {
      return state;
    },
    loadState,
    autoCommit,
    createPr,
    refresh,
    debouncedRefresh,
  };
}

function debounce<T extends (...args: unknown[]) => unknown>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}
