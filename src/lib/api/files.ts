// files API functions
// Auto-generated from api.ts

import { getTransport } from "../transport";
export interface MediaArtifactMetadata {
  path: string;
  name: string;
  size: number;
  mime: string;
  kind: string;
  previewable: boolean;
}

import { EVT_FAVORITES_CHANGED } from "../utils/bus-events";
import { dbg } from "../utils/debug";
import { perfMarkAsync } from "../utils/perf";
import { CMD, type CmdName } from "../tauri-commands";

function invoke<T>(cmd: CmdName | string, args?: Record<string, unknown>): Promise<T> {
  return getTransport().invoke<T>(cmd, args);
}
import type {
  DirListing,
  SessionFolder,
  GitSummary,
  RemoteTestResult,
  PromptSearchResult,
  PromptFavorite,
  ExportReport,
  ImportReport,
  CliSessionInfo,
  } from "../types";
import type {
  } from "../runtime-control-plane/types";
import type {
  } from "../types/task";
import type {
  } from "../types/run-journal";
import type {
  } from "../types/attention-queue";



export async function listSessionFolders(workspaceId: string): Promise<SessionFolder[]> {
  dbg("api", "listSessionFolders", { workspaceId });
  return invoke<SessionFolder[]>(CMD.list_session_folders, { workspaceId });
}

export async function listAllSessionFolders(): Promise<SessionFolder[]> {
  dbg("api", "listAllSessionFolders");
  return invoke<SessionFolder[]>(CMD.list_all_session_folders);
}

export async function createSessionFolder(
  name: string,
  workspaceId: string,
): Promise<SessionFolder> {
  dbg("api", "createSessionFolder", { name, workspaceId });
  return invoke<SessionFolder>(CMD.create_session_folder, { name, workspaceId });
}

export async function renameSessionFolder(folderId: string, newName: string): Promise<void> {
  dbg("api", "renameSessionFolder", { folderId, newName });
  return invoke<void>(CMD.rename_session_folder, { folderId, newName });
}

export async function deleteSessionFolder(folderId: string, cascade: boolean): Promise<number> {
  dbg("api", "deleteSessionFolder", { folderId, cascade });
  return invoke<number>(CMD.delete_session_folder, { folderId, cascade });
}

export async function moveRunToFolder(runId: string, folderId: string | null): Promise<void> {
  dbg("api", "moveRunToFolder", { runId, folderId });
  return invoke<void>(CMD.move_run_to_folder, { runId, folderId });
}

export async function batchMoveToFolder(
  runIds: string[],
  folderId: string | null,
): Promise<number> {
  dbg("api", "batchMoveToFolder", { runIds, folderId });
  return invoke<number>(CMD.batch_move_to_folder, { runIds, folderId });
}

export async function searchPrompts(query: string, limit?: number): Promise<PromptSearchResult[]> {
  dbg("api", "searchPrompts", { query, limit });
  return invoke<PromptSearchResult[]>(CMD.search_prompts, { query, limit });
}

export async function addPromptFavorite(
  runId: string,
  seq: number,
  text: string,
): Promise<PromptFavorite> {
  dbg("api", "addPromptFavorite", { runId, seq });
  const result = await invoke<PromptFavorite>(CMD.add_prompt_favorite, { runId, seq, text });
  window.dispatchEvent(new Event(EVT_FAVORITES_CHANGED));
  return result;
}

export async function removePromptFavorite(runId: string, seq: number): Promise<void> {
  dbg("api", "removePromptFavorite", { runId, seq });
  await invoke<void>(CMD.remove_prompt_favorite, { runId, seq });
  window.dispatchEvent(new Event(EVT_FAVORITES_CHANGED));
}

export async function updatePromptFavoriteTags(
  runId: string,
  seq: number,
  tags: string[],
): Promise<void> {
  dbg("api", "updatePromptFavoriteTags", { runId, seq, tags });
  await invoke<void>(CMD.update_prompt_favorite_tags, { runId, seq, tags });
  window.dispatchEvent(new Event(EVT_FAVORITES_CHANGED));
}

export async function updatePromptFavoriteNote(
  runId: string,
  seq: number,
  note: string,
): Promise<void> {
  dbg("api", "updatePromptFavoriteNote", { runId, seq, note });
  await invoke<void>(CMD.update_prompt_favorite_note, { runId, seq, note });
  window.dispatchEvent(new Event(EVT_FAVORITES_CHANGED));
}

export async function listPromptFavorites(): Promise<PromptFavorite[]> {
  dbg("api", "listPromptFavorites");
  return invoke<PromptFavorite[]>(CMD.list_prompt_favorites);
}

export async function listPromptTags(): Promise<string[]> {
  dbg("api", "listPromptTags");
  return invoke<string[]>(CMD.list_prompt_tags);
}

export async function listDirectory(path: string, showHidden?: boolean): Promise<DirListing> {
  dbg("api", "listDirectory", path, { showHidden });
  return invoke<DirListing>(CMD.list_directory, { path, showHidden });
}

export async function checkIsDirectory(path: string): Promise<boolean> {
  return invoke<boolean>(CMD.check_is_directory, { path });
}

export async function listRemoteDirectory(
  hostName: string,
  path: string,
  showHidden?: boolean,
): Promise<DirListing> {
  dbg("api", "listRemoteDirectory", { hostName, path, showHidden });
  return invoke<DirListing>(CMD.list_remote_directory, {
    hostName,
    path,
    showHidden: showHidden ?? null,
  });
}

export async function resolveRemoteHome(hostName: string): Promise<string> {
  dbg("api", "resolveRemoteHome", { hostName });
  return invoke<string>(CMD.resolve_remote_home, { hostName });
}

export async function readFileBase64(
  path: string,
  cwd?: string,
  grant?: string,
): Promise<[string, string]> {
  return perfMarkAsync(
    "ipc-readFileBase64",
    () =>
      invoke<[string, string]>("read_file_base64", {
        path,
        cwd: cwd ?? null,
        grant: grant ?? null,
      }),
    { path },
  );
}

export async function issueDropGrant(paths: string[]): Promise<string> {
  return perfMarkAsync("ipc-issueDropGrant", () => invoke<string>("issue_drop_grant", { paths }), {
    count: paths.length,
  });
}

export async function validateMediaFile(
  path: string,
  cwd?: string,
): Promise<MediaArtifactMetadata> {
  dbg("api", "validateMediaFile", { path, cwd });
  return invoke<MediaArtifactMetadata>(CMD.validate_media_file, {
    path,
    cwd: cwd ?? null,
  });
}

export async function getGitSummary(cwd: string): Promise<GitSummary> {
  dbg("api", "getGitSummary", cwd);
  return invoke<GitSummary>(CMD.get_git_summary, { cwd });
}

export async function getGitBranch(cwd: string): Promise<string> {
  dbg("api", "getGitBranch", cwd);
  return invoke<string>(CMD.get_git_branch, { cwd });
}

export async function getGitDiff(cwd: string, staged: boolean, file?: string): Promise<string> {
  dbg("api", "getGitDiff", { cwd, staged, file });
  return perfMarkAsync(
    "ipc-getGitDiff",
    () => invoke<string>(CMD.get_git_diff, { cwd, staged, file: file ?? null }),
    { cwd, staged, file },
  );
}

export async function getGitStatus(cwd: string): Promise<string> {
  dbg("api", "getGitStatus", cwd);
  return invoke<string>(CMD.get_git_status, { cwd });
}

export async function getGitTimeline(
  cwd: string,
  limit = 12,
): Promise<import("../types").GitTimelineResponse> {
  dbg("api", "getGitTimeline", { cwd, limit });
  return invoke<import("../types").GitTimelineResponse>(CMD.get_git_timeline, { cwd, limit });
}

export async function listMemoryFiles(
  cwd?: string,
): Promise<import("../types").MemoryFileCandidate[]> {
  dbg("api", "listMemoryFiles", { cwd });
  return invoke<import("../types").MemoryFileCandidate[]>(CMD.list_memory_files, {
    cwd: cwd ?? null,
  });
}

export async function revealFileInFinder(path: string): Promise<void> {
  dbg("api", "revealFileInFinder", path);
  return invoke<void>(CMD.reveal_file_in_finder, { path });
}

export async function openDirectoryInFinder(path: string): Promise<void> {
  dbg("api", "openDirectoryInFinder", path);
  return invoke<void>(CMD.open_directory_in_finder, { path });
}

export async function readTextFile(path: string, cwd?: string): Promise<string> {
  dbg("api", "readTextFile", path, { cwd });
  return perfMarkAsync(
    "ipc-readTextFile",
    async () => {
      const content = await invoke<string>(CMD.read_text_file, { path, cwd: cwd ?? null });
      return content;
    },
    { path, chars: 0 }, // chars not known until after; left for shape consistency
  );
}

export async function statTextFile(path: string, cwd?: string): Promise<number> {
  dbg("api", "statTextFile", path, { cwd });
  return perfMarkAsync(
    "ipc-statTextFile",
    () => invoke<number>(CMD.stat_text_file, { path, cwd: cwd ?? null }),
    { path },
  );
}

export async function writeTextFile(path: string, content: string, cwd?: string): Promise<void> {
  dbg("api", "writeTextFile", path, { cwd });
  return invoke("write_text_file", { path, content, cwd: cwd ?? null });
}

export async function readTaskOutput(path: string): Promise<string> {
  dbg("api", "readTaskOutput", path);
  return invoke<string>(CMD.read_task_output, { path });
}

export async function exportClaudeCodeHistoryArchive(outputPath: string): Promise<ExportReport> {
  dbg("api", "exportClaudeCodeHistoryArchive", { outputPath });
  return invoke<ExportReport>(CMD.export_claude_code_history_archive, { outputPath });
}

export async function importClaudeCodeHistoryArchive(archivePath: string): Promise<ImportReport> {
  dbg("api", "importClaudeCodeHistoryArchive", { archivePath });
  return invoke<ImportReport>(CMD.import_claude_code_history_archive, { archivePath });
}

export async function scanClaudeCodeHistory(): Promise<CliSessionInfo[]> {
  dbg("api", "scanClaudeCodeHistory");
  return invoke<CliSessionInfo[]>(CMD.scan_claude_code_history, {});
}

export async function testRemoteHost(
  host: string,
  user: string,
  port?: number,
  keyPath?: string,
  remoteClaudePath?: string,
): Promise<RemoteTestResult> {
  dbg("api", "testRemoteHost", { host, user, port });
  return invoke<RemoteTestResult>(CMD.test_remote_host, {
    host,
    user,
    port: port ?? null,
    keyPath: keyPath ?? null,
    remoteClaudePath: remoteClaudePath ?? null,
  });
}

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export interface AutoCommitResult {
  committed: boolean;
  sha?: string;
  message: string;
}

export interface WorktreeEntry {
  path: string;
  branch: string;
  head: string;
}

export async function createWorktree(
  parentCwd: string,
  sessionIdShort: string,
  branchName: string,
): Promise<WorktreeInfo> {
  dbg("api", "createWorktree", { parentCwd, sessionIdShort, branchName });
  return invoke<WorktreeInfo>(CMD.create_worktree, { parentCwd, sessionIdShort, branchName });
}

export async function autoCommit(cwd: string, message: string): Promise<AutoCommitResult> {
  dbg("api", "autoCommit", { cwd, message });
  return invoke<AutoCommitResult>(CMD.auto_commit, { cwd, message });
}

export async function createPullRequest(
  cwd: string,
  branch: string,
  baseBranch: string,
): Promise<string> {
  dbg("api", "createPullRequest", { cwd, branch, baseBranch });
  return invoke<string>(CMD.create_pull_request, { cwd, branch, baseBranch });
}

export async function removeWorktree(
  worktreePath: string,
  parentCwd: string,
  branchName?: string,
  force: boolean = false,
): Promise<void> {
  dbg("api", "removeWorktree", { worktreePath, parentCwd, branchName, force });
  try {
    return await invoke<void>(CMD.remove_worktree, {
      worktreePath,
      parentCwd,
      branchName: branchName ?? null,
      force,
    });
  } catch (err) {
    // Surface dirty-worktree rejections as a typed, recognizable error so
    // callers can prompt the user instead of failing opaquely.
    if (isWorktreeDirtyError(err)) {
      dbg("api", "removeWorktree.dirty", {
        worktreePath,
        dirtyFiles: err.dirtyFiles,
      });
    }
    throw err;
  }
}

export function isWorktreeDirtyError(
  err: unknown,
): err is { worktreePath: string; dirtyFiles: string[]; message: string } {
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;
  return (
    Array.isArray(e.dirtyFiles) &&
    typeof e.worktreePath === "string" &&
    typeof e.message === "string"
  );
}

export async function listWorktrees(parentCwd: string): Promise<WorktreeEntry[]> {
  dbg("api", "listWorktrees", { parentCwd });
  return invoke<WorktreeEntry[]>(CMD.list_worktrees, { parentCwd });
}

