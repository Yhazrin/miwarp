import { getTransport } from "./transport";
import { EVT_FAVORITES_CHANGED } from "./utils/bus-events";
import { dbg, dbgWarn, redactSensitive } from "./utils/debug";
import { perfMarkAsync } from "./utils/perf";
import { CMD, type CmdName } from "./tauri-commands";

function invoke<T>(cmd: CmdName | string, args?: Record<string, unknown>): Promise<T> {
  return getTransport().invoke<T>(cmd, args);
}
import type {
  TaskRun,
  RunSurface,
  RunEvent,
  RunArtifact,
  UserSettings,
  AgentSettings,
  DirListing,
  Attachment,
  CliCheckResult,
  ProjectInitStatus,
  CliDistTags,
  UsageOverview,
  BusEvent,
  CliInfo,
  SessionMode,
  SessionFolder,
  TeamSummary,
  TeamConfig,
  TeamTask,
  TeamInboxMessage,
  MarketplacePlugin,
  MarketplaceInfo,
  StandaloneSkill,
  InstalledPlugin,
  SkillSummary,
  PluginOperationResult,
  GitSummary,
  ConfiguredMcpServer,
  McpRegistrySearchResult,
  ProviderHealth,
  ChangelogEntry,
  RemoteTestResult,
  SshKeyInfo,
  PromptSearchResult,
  PromptFavorite,
  SyncResult,
  DiagnosticsReport,
  AgentDefinitionSummary,
  RunSearchFilters,
  RunSearchResponse,
  ExportReport,
  ImportReport,
  CliSessionInfo,
  BackendCapabilities,
  ProjectMetadata,
  ProjectGitStatus,
  ProjectNotes,
} from "./types";
import type {
  ConfigTransactionPreview,
  ConfigTransactionResult,
  RuntimeControlPlaneList,
  RuntimeHubHealthResponse,
} from "./runtime-control-plane/types";
import type {
  TaskCreateInput,
  TaskEvent,
  TaskLinkArtifactInput,
  TaskLinkRunInput,
  TaskMergeDecision,
  TaskQualityGate,
  TaskReconcileReport,
  TaskRecord,
  TaskReviewDecision,
  TaskStatus,
} from "./types/task";
import type {
  RunCheckpoint,
  RunJournalEvent,
  RunJournalReconcileReport,
  RunJournalSnapshot,
} from "./types/run-journal";
import type {
  AttentionAction,
  AttentionEvent,
  AttentionQueueSnapshot,
  AttentionReconcileReport,
} from "./types/attention-queue";

// Backend capabilities (version / IPC probe)
export async function getBackendCapabilities(): Promise<BackendCapabilities> {
  return invoke<BackendCapabilities>(CMD.get_backend_capabilities);
}

// Runs
export async function listRuns(): Promise<TaskRun[]> {
  dbg("api", "listRuns");
  try {
    const runs = await invoke<TaskRun[]>(CMD.list_runs);
    dbg("api", "listRuns →", runs.length);
    return runs;
  } catch (e) {
    dbgWarn("api", "listRuns error", e);
    throw e;
  }
}

/**
 * Lightweight run list — only reads meta.json per run (no events.jsonl
 * summary scan). Use this for pickers (forward-to-session, link-to-run)
 * that don't need message_count or last_message_preview. With hundreds of
 * runs it's ~50x faster than listRuns().
 */
export async function listRunsLite(): Promise<TaskRun[]> {
  dbg("api", "listRunsLite");
  try {
    const runs = await invoke<TaskRun[]>(CMD.list_runs_lite);
    dbg("api", "listRunsLite →", runs.length);
    return runs;
  } catch (e) {
    dbgWarn("api", "listRunsLite error, falling back to listRuns", e);
    return listRuns();
  }
}

export async function listRunsSince(since: string): Promise<TaskRun[]> {
  const { supportsCommand, warnListRunsSinceUnsupportedOnce } =
    await import("$lib/backend-capabilities.svelte");
  if (!supportsCommand("list_runs_since")) {
    return listRuns();
  }

  dbg("api", "listRunsSince", since);
  try {
    const runs = await invoke<TaskRun[]>(CMD.list_runs_since, { since });
    dbg("api", "listRunsSince →", runs.length);
    return runs;
  } catch (e) {
    const msg = String(e);
    if (msg.includes("unknown method")) {
      warnListRunsSinceUnsupportedOnce();
    } else {
      dbgWarn("api", "listRunsSince failed, falling back to full list", e);
    }
    return listRuns();
  }
}

export async function getRun(id: string): Promise<TaskRun> {
  dbg("api", "getRun", id);
  return invoke<TaskRun>(CMD.get_run, { id });
}

export async function startRun(
  prompt: string,
  cwd: string,
  agent: string,
  model?: string,
  remoteHostName?: string,
  platformId?: string,
  executionPath?: string,
  creationMode?: "single" | "worktree",
  folderId?: string,
  taskId?: string,
  runSurface?: RunSurface,
): Promise<TaskRun> {
  dbg("api", "startRun", {
    prompt: prompt.slice(0, 80),
    agent,
    cwd,
    remoteHostName,
    platformId,
    executionPath,
    creationMode,
    folderId,
    taskId,
    runSurface,
  });
  const result = await invoke<TaskRun>(CMD.start_run, {
    prompt,
    cwd,
    agent,
    model,
    remoteHostName: remoteHostName ?? null,
    platformId: platformId ?? null,
    executionPath: executionPath ?? null,
    creationMode: creationMode ?? null,
    folderId: folderId ?? null,
    taskId: taskId ?? null,
    runSurface: runSurface ?? null,
  });
  dbg("api", "startRun →", result.id);
  return result;
}

export async function stopRun(id: string): Promise<boolean> {
  dbg("api", "stopRun", id);
  return invoke<boolean>(CMD.stop_run, { id });
}

export async function renameRun(id: string, name: string): Promise<void> {
  dbg("api", "renameRun", { id, name });
  return invoke<void>(CMD.rename_run, { id, name });
}

export async function generateRunTitle(runId: string): Promise<string> {
  dbg("api", "generateRunTitle", { runId });
  return invoke<string>(CMD.generate_run_title, { runId });
}

export async function updateRunModel(id: string, model: string): Promise<void> {
  dbg("api", "updateRunModel", { id, model });
  return invoke<void>(CMD.update_run_model, { id, model });
}

// Task Core
export async function createTask(input: TaskCreateInput): Promise<TaskRecord> {
  dbg("api", "createTask", {
    title: input.title,
    objective: input.objective?.slice(0, 80),
    workspace_cwd: input.workspace_cwd,
  });
  return invoke<TaskRecord>(CMD.task_create, { input });
}

export async function getTask(id: string): Promise<TaskRecord> {
  dbg("api", "getTask", id);
  return invoke<TaskRecord>(CMD.task_get, { id });
}

export async function listTasks(): Promise<TaskRecord[]> {
  dbg("api", "listTasks");
  return invoke<TaskRecord[]>(CMD.task_list);
}

export async function listTaskEvents(id: string, sinceSeq = 0): Promise<TaskEvent[]> {
  dbg("api", "listTaskEvents", { id, sinceSeq });
  return invoke<TaskEvent[]>(CMD.task_list_events, { id, sinceSeq });
}

export async function updateTaskStatus(id: string, status: TaskStatus): Promise<TaskRecord> {
  dbg("api", "updateTaskStatus", { id, status });
  return invoke<TaskRecord>(CMD.task_update_status, { id, status });
}

export async function linkTaskRun(input: TaskLinkRunInput): Promise<TaskRecord> {
  dbg("api", "linkTaskRun", input);
  return invoke<TaskRecord>(CMD.task_link_run, { input });
}

export async function linkTaskArtifact(input: TaskLinkArtifactInput): Promise<TaskRecord> {
  dbg("api", "linkTaskArtifact", input);
  return invoke<TaskRecord>(CMD.task_link_artifact, { input });
}

export async function setTaskQualityGate(id: string, gate: TaskQualityGate): Promise<TaskRecord> {
  dbg("api", "setTaskQualityGate", { id, verdict: gate.verdict });
  return invoke<TaskRecord>(CMD.task_set_quality_gate, { id, gate });
}

export async function setTaskReviewDecision(
  id: string,
  decision: TaskReviewDecision,
): Promise<TaskRecord> {
  dbg("api", "setTaskReviewDecision", { id, outcome: decision.outcome });
  return invoke<TaskRecord>(CMD.task_set_review_decision, { id, decision });
}

export async function setTaskMergeDecision(
  id: string,
  decision: TaskMergeDecision,
): Promise<TaskRecord> {
  dbg("api", "setTaskMergeDecision", { id, decision: decision.decision });
  return invoke<TaskRecord>(CMD.task_set_merge_decision, { id, decision });
}

export async function reconcileTasksAfterRestart(): Promise<TaskReconcileReport> {
  dbg("api", "reconcileTasksAfterRestart");
  return invoke<TaskReconcileReport>(CMD.task_reconcile_after_restart);
}

export async function setTaskWorktree(
  id: string,
  worktreePath: string,
  worktreeBranch: string,
): Promise<TaskRecord> {
  dbg("api", "setTaskWorktree", { id, worktreePath, worktreeBranch });
  return invoke<TaskRecord>(CMD.task_set_worktree, { id, worktreePath, worktreeBranch });
}

export async function trackTaskChangedFile(id: string, path: string): Promise<TaskRecord> {
  dbg("api", "trackTaskChangedFile", { id, path });
  return invoke<TaskRecord>(CMD.task_track_changed_file, { id, path });
}

// Run Journal

export async function getRunJournal(runId: string): Promise<RunJournalSnapshot> {
  dbg("api", "getRunJournal", { runId });
  return invoke<RunJournalSnapshot>(CMD.run_journal_get, { runId });
}

export async function listRunJournalEvents(
  runId: string,
  sinceSeq = 0,
): Promise<RunJournalEvent[]> {
  dbg("api", "listRunJournalEvents", { runId, sinceSeq });
  return invoke<RunJournalEvent[]>(CMD.run_journal_list_events, { runId, sinceSeq });
}

export async function createRunCheckpoint(runId: string, label?: string): Promise<RunCheckpoint> {
  dbg("api", "createRunCheckpoint", { runId, label });
  return invoke<RunCheckpoint>(CMD.run_checkpoint_create, { runId, label });
}

export async function reconcileRunJournalAfterRestart(): Promise<RunJournalReconcileReport> {
  dbg("api", "reconcileRunJournalAfterRestart");
  return invoke<RunJournalReconcileReport>(CMD.run_journal_reconcile);
}

// Attention Queue

export async function getAttentionQueue(): Promise<AttentionQueueSnapshot> {
  dbg("api", "getAttentionQueue");
  return invoke<AttentionQueueSnapshot>(CMD.attention_queue_get);
}

export async function listAttentionQueueEvents(sinceSeq = 0): Promise<AttentionEvent[]> {
  dbg("api", "listAttentionQueueEvents", { sinceSeq });
  return invoke<AttentionEvent[]>(CMD.attention_queue_list_events, { sinceSeq });
}

export async function acknowledgeAttentionItem(
  id: string,
  actor?: string,
): Promise<AttentionQueueSnapshot> {
  dbg("api", "acknowledgeAttentionItem", { id, actor });
  return invoke<AttentionQueueSnapshot>(CMD.attention_queue_acknowledge, { id, actor });
}

export async function resolveAttentionItem(
  id: string,
  action: AttentionAction,
  actor?: string,
  note?: string,
): Promise<AttentionQueueSnapshot> {
  dbg("api", "resolveAttentionItem", {
    id,
    action,
    actor,
    notePresent: Boolean(note),
    noteLength: note?.length ?? 0,
  });
  return invoke<AttentionQueueSnapshot>(CMD.attention_queue_resolve, {
    id,
    action,
    actor,
    note,
  });
}

export async function reconcileAttentionQueue(): Promise<AttentionReconcileReport> {
  dbg("api", "reconcileAttentionQueue");
  return invoke<AttentionReconcileReport>(CMD.attention_queue_reconcile);
}

export async function softDeleteRuns(ids: string[]): Promise<number> {
  dbg("api", "softDeleteRuns", { ids });
  return invoke<number>(CMD.soft_delete_runs, { ids });
}

export async function hardDeleteRuns(ids: string[]): Promise<number> {
  dbg("api", "hardDeleteRuns", { ids });
  return invoke<number>(CMD.hard_delete_runs, { ids });
}

// Session Folders

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

// Prompt search & favorites

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

// Run search (History)

export async function searchRuns(filters: RunSearchFilters): Promise<RunSearchResponse> {
  dbg("api", "searchRuns", filters);
  return invoke<RunSearchResponse>(CMD.search_runs, { filters });
}

export async function getRunFiles(runId: string): Promise<string[]> {
  dbg("api", "getRunFiles", { runId });
  return invoke<string[]>(CMD.get_run_files, { runId });
}

// Chat
export async function sendChatMessage(
  runId: string,
  message: string,
  attachments?: Attachment[],
  model?: string,
  clientMessageId?: string | null,
): Promise<void> {
  dbg("api", "sendChatMessage", {
    runId,
    msgLen: message.length,
    attachments: attachments?.length ?? 0,
    clientMessageId,
  });
  return invoke("send_chat_message", {
    runId,
    message,
    attachments,
    model,
    clientMessageId: clientMessageId ?? null,
  });
}

// CLI sync
export async function syncCliSession(runId: string): Promise<SyncResult> {
  dbg("api", "syncCliSession", { runId });
  return invoke<SyncResult>(CMD.sync_cli_session, { runId });
}

// Events
export async function getRunEvents(id: string, sinceSeq?: number): Promise<RunEvent[]> {
  dbg("api", "getRunEvents", { id, sinceSeq });
  return invoke<RunEvent[]>(CMD.get_run_events, { id, sinceSeq });
}

// Artifacts
export async function getRunArtifacts(id: string): Promise<RunArtifact> {
  dbg("api", "getRunArtifacts", id);
  return invoke<RunArtifact>(CMD.get_run_artifacts, { id });
}

// Settings
export async function getUserSettings(): Promise<UserSettings> {
  dbg("api", "getUserSettings");
  return invoke<UserSettings>(CMD.get_user_settings);
}

export const USER_SETTINGS_CHANGED_EVENT = "miwarp:user-settings-changed";

export function notifyUserSettingsChanged(settings: UserSettings): void {
  if (typeof window === "undefined") return;
  void import("$lib/chat/chat-bootstrap-cache").then(({ refreshChatBootstrapSettings }) => {
    refreshChatBootstrapSettings(settings);
  });
  window.dispatchEvent(new CustomEvent(USER_SETTINGS_CHANGED_EVENT, { detail: settings }));
}

export async function updateUserSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
  dbg("api", "updateUserSettings");
  const settings = await invoke<UserSettings>(CMD.update_user_settings, { patch });
  notifyUserSettingsChanged(settings);
  return settings;
}

export async function resetUserSettings(): Promise<UserSettings> {
  dbg("api", "resetUserSettings");
  const settings = await invoke<UserSettings>(CMD.reset_user_settings);
  notifyUserSettingsChanged(settings);
  return settings;
}

/**
 * Reset ONLY the personal-profile subset of `UserSettings` — identity, AI
 * preferences, default session mode, notification prefs, UI zoom. The full
 * global `resetUserSettings` is reserved for the Settings page (where the
 * user types `RESET` to confirm); the Personal page uses this scoped reset
 * so api keys, platform credentials, remote hosts, webhook URLs, web
 * server config, keybindings, and workspace folders stay untouched.
 */
export async function resetPersonalProfile(): Promise<UserSettings> {
  dbg("api", "resetPersonalProfile");
  const settings = await invoke<UserSettings>(CMD.reset_personal_profile);
  notifyUserSettingsChanged(settings);
  return settings;
}

export async function getAgentSettings(agent: string): Promise<AgentSettings> {
  dbg("api", "getAgentSettings", agent);
  return invoke<AgentSettings>(CMD.get_agent_settings, { agent });
}

export async function updateAgentSettings(
  agent: string,
  patch: Partial<AgentSettings>,
): Promise<AgentSettings> {
  dbg("api", "updateAgentSettings", agent);
  const result = await invoke<AgentSettings>(CMD.update_agent_settings, { agent, patch });
  // Sync sidebar resume-gate cache with updated settings
  import("$lib/stores/agent-settings-cache.svelte").then((m) => m.refreshAgentSettingsCache(agent));
  return result;
}

/// Detect MiMo-Code availability, binary path, and version.
export async function detectMimoRuntime(): Promise<{
  available: boolean;
  binary: string;
  version: string | null;
}> {
  dbg("api", "detectMimoRuntime");
  const [available, binary, version] = await invoke<[boolean, string, string | null]>(
    CMD.detect_mimo_runtime,
  );
  return { available, binary, version };
}

// Feishu webhook notification
export async function sendFeishuNotification(
  title: string,
  body: string,
  status?: string,
  link?: string,
): Promise<void> {
  dbg("api", "sendFeishuNotification", { title, status });
  return invoke<void>(CMD.send_feishu_notification, { title, body, status, link });
}

// Filesystem
export async function listDirectory(path: string, showHidden?: boolean): Promise<DirListing> {
  dbg("api", "listDirectory", path, { showHidden });
  return invoke<DirListing>(CMD.list_directory, { path, showHidden });
}

export async function checkIsDirectory(path: string): Promise<boolean> {
  return invoke<boolean>(CMD.check_is_directory, { path });
}

// Remote filesystem (over SSH)
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

/**
 * Issue a one-time drop grant for a batch of absolute paths.
 *
 * The OS hands the renderer the absolute paths of the files the user
 * just dropped into the window. The renderer then asks the backend to
 * issue a short-lived grant (30 s) bound to exactly those paths, and
 * threads the returned `grantId` through to `readFileBase64` so the
 * read can succeed without re-opening the SSRF-like hole the P0-1
 * hardening closed.
 *
 * The grant id is bound to a specific set of canonical paths; a
 * different file (even in the same drop) needs a separate grant, and
 * a grant for one file cannot be used to read another.
 */
export async function issueDropGrant(paths: string[]): Promise<string> {
  return perfMarkAsync("ipc-issueDropGrant", () => invoke<string>("issue_drop_grant", { paths }), {
    count: paths.length,
  });
}

export interface MediaArtifactMetadata {
  path: string;
  name: string;
  size: number;
  mime: string;
  kind: string;
  previewable: boolean;
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

// Git
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
): Promise<import("./types").GitTimelineResponse> {
  dbg("api", "getGitTimeline", { cwd, limit });
  return invoke<import("./types").GitTimelineResponse>(CMD.get_git_timeline, { cwd, limit });
}

// Export
export async function exportConversation(runId: string): Promise<string> {
  dbg("api", "exportConversation", runId);
  return invoke<string>(CMD.export_conversation, { runId });
}

export async function writeHtmlExport(path: string, content: string): Promise<void> {
  dbg("api", "writeHtmlExport", { path, contentLen: content.length });
  return invoke<void>(CMD.write_html_export, { path, content });
}

export interface SummarizeResult {
  summary: string;
  markdown: string;
}

export async function summarizeConversation(runId: string): Promise<SummarizeResult> {
  dbg("api", "summarizeConversation", runId);
  return invoke<SummarizeResult>(CMD.summarize_conversation, { runId });
}

// Memory file candidates
export async function listMemoryFiles(
  cwd?: string,
): Promise<import("./types").MemoryFileCandidate[]> {
  dbg("api", "listMemoryFiles", { cwd });
  return invoke<import("./types").MemoryFileCandidate[]>(CMD.list_memory_files, {
    cwd: cwd ?? null,
  });
}

// Reveal a file in the system file browser (Finder/Explorer)
export async function revealFileInFinder(path: string): Promise<void> {
  dbg("api", "revealFileInFinder", path);
  return invoke<void>(CMD.reveal_file_in_finder, { path });
}

// Open a directory in the system file browser (Finder/Explorer) — shows the
// directory's contents (no selection). Used by the workspace card "open folder"
// action, where tauri-plugin-shell's `open` was unreliable.
export async function openDirectoryInFinder(path: string): Promise<void> {
  dbg("api", "openDirectoryInFinder", path);
  return invoke<void>(CMD.open_directory_in_finder, { path });
}

// Files
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

/** Cheap file size lookup — used by FilePreviewPane to skip readTextFile for huge files. */
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

// Task output
export async function readTaskOutput(path: string): Promise<string> {
  dbg("api", "readTaskOutput", path);
  return invoke<string>(CMD.read_task_output, { path });
}

// Stats
export async function getUsageOverview(
  days?: number,
  projectId?: string | null,
  tz?: string | null,
): Promise<UsageOverview> {
  dbg("api", "getUsageOverview", { days, projectId, tz });
  return invoke<UsageOverview>(CMD.get_usage_overview, {
    days: days ?? null,
    projectId: projectId ?? null,
    tz: tz ?? null,
  });
}

export async function getGlobalUsageOverview(days?: number): Promise<UsageOverview> {
  dbg("api", "getGlobalUsageOverview", { days });
  return invoke<UsageOverview>(CMD.get_global_usage_overview, { days: days ?? null });
}

export async function clearUsageCache(): Promise<void> {
  dbg("api", "clearUsageCache");
  return invoke<void>(CMD.clear_usage_cache);
}

export async function getHeatmapDaily(
  scope: "app" | "global",
): Promise<import("./types").DailyAggregate[]> {
  dbg("api", "getHeatmapDaily", { scope });
  return invoke<import("./types").DailyAggregate[]>(CMD.get_heatmap_daily, { scope });
}

// Diagnostics
export async function checkAgentCli(agent: string): Promise<CliCheckResult> {
  dbg("api", "checkAgentCli", agent);
  return invoke<CliCheckResult>(CMD.check_agent_cli, { agent });
}

export async function checkProjectInit(cwd: string): Promise<ProjectInitStatus> {
  dbg("api", "checkProjectInit", cwd);
  return invoke<ProjectInitStatus>(CMD.check_project_init, { cwd });
}

// ── Project Desk metadata (v1.2.0+) ──
//
// Lightweight per-project snapshot: stack fingerprint + detected scripts +
// CLAUDE.md/README excerpts. Returns `{}`-style defaults on parse failure so
// the project desk sidebar can render without crashing on weird repos.
export async function listProjectMetadata(cwd: string): Promise<ProjectMetadata> {
  dbg("api", "listProjectMetadata", cwd);
  return invoke<ProjectMetadata>(CMD.list_project_metadata, { cwd });
}

export async function listProjectGitStatus(cwd: string): Promise<ProjectGitStatus> {
  dbg("api", "listProjectGitStatus", cwd);
  return invoke<ProjectGitStatus>(CMD.list_project_git_status, { cwd });
}

export async function readProjectNotes(cwd: string): Promise<ProjectNotes> {
  dbg("api", "readProjectNotes", cwd);
  return invoke<ProjectNotes>(CMD.read_project_notes, { cwd });
}

export async function writeProjectNotes(cwd: string, content: string): Promise<void> {
  dbg("api", "writeProjectNotes", { cwd, contentLen: content.length });
  return invoke<void>(CMD.write_project_notes, { cwd, content });
}

export async function getCliDistTags(): Promise<CliDistTags> {
  dbg("api", "getCliDistTags");
  return invoke<CliDistTags>(CMD.get_cli_dist_tags);
}

export interface UpdateCliResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

/** One-click update for Claude Code (runs `npm install -g @anthropic-ai/claude-code`).
 *  Caller should re-run `checkAgentCli("claude")` afterwards to refresh the
 *  version cache displayed in the diagnostics panel. */
export async function updateClaudeCli(): Promise<UpdateCliResult> {
  dbg("api", "updateClaudeCli");
  return invoke<UpdateCliResult>(CMD.update_claude_cli);
}

export async function checkSshKey(): Promise<SshKeyInfo> {
  dbg("api", "checkSshKey");
  return invoke<SshKeyInfo>(CMD.check_ssh_key);
}

export async function generateSshKey(): Promise<SshKeyInfo> {
  dbg("api", "generateSshKey");
  return invoke<SshKeyInfo>(CMD.generate_ssh_key);
}

export async function detectLocalProxy(
  proxyId: string,
  baseUrl: string,
): Promise<import("./types").LocalProxyStatus> {
  dbg("api", "detectLocalProxy", { proxyId, baseUrl });
  return invoke<import("./types").LocalProxyStatus>(CMD.detect_local_proxy, { proxyId, baseUrl });
}

export async function testApiConnectivity(
  apiKey: string,
  baseUrl: string,
  authEnvVar: string,
  model: string,
): Promise<import("./types").ApiTestResult> {
  dbg("api", "testApiConnectivity", { baseUrl, authEnvVar, model });
  return invoke<import("./types").ApiTestResult>(CMD.test_api_connectivity, {
    apiKey,
    baseUrl,
    authEnvVar,
    model,
  });
}

export async function runDiagnostics(cwd: string): Promise<DiagnosticsReport> {
  dbg("api", "runDiagnostics", { cwd });
  return invoke<DiagnosticsReport>(CMD.run_diagnostics, { cwd });
}

export async function getDataDirectory(): Promise<string> {
  return invoke<string>(CMD.get_data_directory, {});
}

// Claude Code History Migration
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

// CLI Control Protocol
export async function getCliInfo(forceRefresh?: boolean, agent?: string): Promise<CliInfo> {
  dbg("api", "getCliInfo", { forceRefresh, agent });
  try {
    const info = await invoke<CliInfo>(CMD.get_cli_info, { forceRefresh, agent });
    dbg("api", "getCliInfo →", { agent: info.agent, models: info.models.length });
    return info;
  } catch (e) {
    dbgWarn("api", "getCliInfo error", e);
    throw e;
  }
}

// Session (event bus)
export async function startSession(
  runId: string,
  mode?: SessionMode,
  sessionId?: string,
  initialMessage?: string,
  attachments?: Array<{ content_base64: string; media_type: string; filename: string }>,
  platformId?: string,
  permissionModeOverride?: string,
  clientMessageId?: string | null,
): Promise<void> {
  dbg("api", "startSession", {
    runId,
    mode,
    sessionId,
    hasMessage: !!initialMessage,
    attachments: attachments?.length ?? 0,
    platformId,
    permissionModeOverride,
    clientMessageId,
  });
  return invoke("start_session", {
    runId,
    mode,
    sessionId,
    initialMessage,
    attachments: attachments ?? null,
    platformId: platformId ?? null,
    permissionModeOverride: permissionModeOverride ?? null,
    clientMessageId: clientMessageId ?? null,
  });
}

export async function sendSessionMessage(
  runId: string,
  message: string,
  attachments?: Array<{ content_base64: string; media_type: string; filename: string }>,
  clientMessageId?: string | null,
): Promise<void> {
  dbg("api", "sendSessionMessage", {
    runId,
    msgLen: message.length,
    attachments: attachments?.length ?? 0,
    clientMessageId,
  });
  return invoke("send_session_message", {
    runId,
    message,
    attachments: attachments ?? null,
    clientMessageId: clientMessageId ?? null,
  });
}

export async function sendSessionControl(
  runId: string,
  subtype: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  dbg("api", "sendSessionControl", { runId, subtype, params });
  try {
    const result = await invoke<Record<string, unknown>>("send_session_control", {
      runId,
      subtype,
      params: params ?? null,
    });
    dbg("api", "sendSessionControl →", result);
    return result;
  } catch (e) {
    dbgWarn("api", "sendSessionControl error", e);
    throw e;
  }
}

export async function stopSession(runId: string): Promise<void> {
  dbg("api", "stopSession", runId);
  return invoke("stop_session", { runId });
}

export async function getBusEvents(id: string, sinceSeq?: number): Promise<BusEvent[]> {
  dbg("api", "getBusEvents", { id, sinceSeq });
  return invoke<BusEvent[]>(CMD.get_bus_events, { id, sinceSeq });
}

export async function getToolResult(
  runId: string,
  toolUseId: string,
): Promise<Record<string, unknown> | null> {
  dbg("api", "getToolResult", { runId, toolUseId });
  return invoke<Record<string, unknown> | null>("get_tool_result", { runId, toolUseId });
}

export async function forkSession(runId: string): Promise<string> {
  dbg("api", "forkSession", { runId });
  return invoke<string>(CMD.fork_session, { runId });
}

export async function sideQuestion(runId: string, question: string): Promise<string> {
  dbg("api", "sideQuestion", { runId, question: question.slice(0, 50) });
  return invoke<string>(CMD.side_question, { runId, question });
}

export async function approveSessionTool(runId: string, toolName: string): Promise<void> {
  dbg("api", "approveSessionTool", { runId, toolName });
  return invoke("approve_session_tool", { runId, toolName });
}

export async function respondPermission(
  runId: string,
  requestId: string,
  behavior: string,
  updatedPermissions?: import("./types").PermissionSuggestion[],
  updatedInput?: Record<string, unknown>,
  denyMessage?: string,
  interrupt?: boolean,
  toolName?: string,
): Promise<void> {
  // Privacy-safe breadcrumb: do NOT log tool input, deny message text,
  // path/command arguments, or raw suggestion payloads. Only the
  // decision shape (allow/deny + interrupt + how-many suggestions) is
  // safe to surface.
  dbg("api", "respondPermission", {
    runId,
    requestId,
    behavior,
    hasUpdatedPermissions: !!updatedPermissions && updatedPermissions.length > 0,
    suggestionCount: updatedPermissions?.length ?? 0,
    hasUpdatedInput: updatedInput != null,
    hasDenyMessage: denyMessage != null && denyMessage.length > 0,
    interrupt,
    toolName,
  });
  return invoke("respond_permission", {
    runId,
    requestId,
    behavior,
    updatedPermissions: updatedPermissions ?? null,
    updatedInput: updatedInput ?? null,
    denyMessage: denyMessage ?? null,
    interrupt: interrupt ?? null,
    toolName: toolName ?? null,
  });
}

export async function respondHookCallback(
  runId: string,
  requestId: string,
  decision: "allow" | "deny" | "defer",
  // PreToolUse hooks can rewrite tool input alongside `allow` (CLI v2.1.85+).
  // Only honored by the CLI when decision == "allow".
  updatedInput?: Record<string, unknown>,
): Promise<void> {
  dbg("api", "respondHookCallback", {
    runId,
    requestId,
    decision,
    hasUpdatedInput: updatedInput != null,
  });
  return invoke("respond_hook_callback", {
    runId,
    requestId,
    decision,
    updatedInput: updatedInput ?? null,
  });
}

// ── Typed control request wrappers ──

export async function setSessionModel(runId: string, model: string) {
  return sendSessionControl(runId, "set_model", { model });
}

export async function interruptSession(runId: string) {
  return sendSessionControl(runId, "interrupt");
}

export async function setPermissionMode(runId: string, mode: string) {
  return sendSessionControl(runId, "set_permission_mode", { mode });
}

export async function setMaxThinkingTokens(runId: string, tokens: number) {
  return sendSessionControl(runId, "set_max_thinking_tokens", { max_thinking_tokens: tokens });
}

export async function getMcpStatus(runId: string) {
  return sendSessionControl(runId, "mcp_status");
}

export async function setMcpServers(runId: string, servers: Record<string, unknown>) {
  return sendSessionControl(runId, "mcp_set_servers", { servers });
}

export async function reconnectMcpServer(runId: string, serverName: string) {
  return sendSessionControl(runId, "mcp_reconnect", { serverName });
}

export async function toggleMcpServer(runId: string, serverName: string, enabled: boolean) {
  return sendSessionControl(runId, "mcp_toggle", { serverName, enabled });
}

export async function broadcastMcpToggle(serverName: string, enabled: boolean): Promise<number> {
  return invoke<number>(CMD.broadcast_mcp_toggle, { serverName, enabled });
}

export async function getDisabledMcpServers(): Promise<string[]> {
  return invoke<string[]>(CMD.get_disabled_mcp_servers);
}

export async function toggleMcpServerConfig(
  serverName: string,
  enabled: boolean,
  scope: string,
  cwd?: string,
): Promise<{ success: boolean; message: string }> {
  dbg("api", "toggleMcpServerConfig", { serverName, enabled, scope, cwd });
  return invoke("toggle_mcp_server_config", {
    name: serverName,
    enabled,
    scope,
    cwd: cwd ?? null,
  });
}

export async function rewindFiles(
  runId: string,
  opts: { userMessageId: string; dryRun?: boolean; files?: string[] },
) {
  return sendSessionControl(runId, "rewind_files", {
    user_message_id: opts.userMessageId,
    ...(opts.dryRun ? { dry_run: true } : {}),
    ...(opts.files ? { files: opts.files } : {}),
  });
}

export async function cancelControlRequest(runId: string, requestId: string) {
  dbg("api", "cancelControlRequest", { runId, requestId });
  return invoke("cancel_control_request", { runId, requestId });
}

export async function respondElicitation(
  runId: string,
  requestId: string,
  action: "accept" | "decline" | "cancel",
  content?: Record<string, unknown>,
): Promise<void> {
  dbg("api", "respondElicitation", { runId, requestId, action });
  return invoke("respond_elicitation", {
    runId,
    requestId,
    action,
    content: content ?? null,
  });
}

export async function getSessionRuntimeStatus(
  runId: string,
): Promise<{ actor_alive: boolean; run_id: string }> {
  dbg("api", "getSessionRuntimeStatus", { runId });
  return invoke("get_session_runtime_status", { runId });
}

// ── Teams ──

export async function listTeams(): Promise<TeamSummary[]> {
  dbg("api", "listTeams");
  return invoke<TeamSummary[]>(CMD.list_teams);
}

export async function getTeamConfig(name: string): Promise<TeamConfig> {
  dbg("api", "getTeamConfig", name);
  return invoke<TeamConfig>(CMD.get_team_config, { name });
}

export async function listTeamTasks(teamName: string): Promise<TeamTask[]> {
  dbg("api", "listTeamTasks", teamName);
  return invoke<TeamTask[]>(CMD.list_team_tasks, { teamName });
}

export async function getTeamTask(teamName: string, taskId: string): Promise<TeamTask> {
  dbg("api", "getTeamTask", { teamName, taskId });
  return invoke<TeamTask>(CMD.get_team_task, { teamName, taskId });
}

export async function getTeamInbox(
  teamName: string,
  agentName: string,
): Promise<TeamInboxMessage[]> {
  dbg("api", "getTeamInbox", { teamName, agentName });
  return invoke<TeamInboxMessage[]>(CMD.get_team_inbox, { teamName, agentName });
}

export async function getAllTeamInboxes(name: string): Promise<TeamInboxMessage[]> {
  dbg("api", "getAllTeamInboxes", name);
  return invoke<TeamInboxMessage[]>(CMD.get_all_team_inboxes, { name });
}

export async function deleteTeam(name: string): Promise<void> {
  dbg("api", "deleteTeam", name);
  return invoke<void>(CMD.delete_team, { name });
}

// ── Team Runs (MiWarp orchestration) ──

export async function listTeamPresets(): Promise<import("./types").TeamPreset[]> {
  dbg("api", "listTeamPresets");
  return invoke<import("./types").TeamPreset[]>(CMD.list_team_presets);
}

export async function createTeamRun(
  presetId: string,
  prompt: string,
  cwd: string,
  sourceRunId?: string,
  mode?: string,
): Promise<import("./types").TeamRun> {
  dbg("api", "createTeamRun", { presetId, prompt: prompt.slice(0, 60), cwd, mode });
  return invoke<import("./types").TeamRun>(CMD.create_team_run, {
    presetId,
    prompt,
    cwd,
    sourceRunId: sourceRunId ?? null,
    mode: mode ?? null,
  });
}

export async function listTeamRuns(): Promise<import("./types").TeamRun[]> {
  dbg("api", "listTeamRuns");
  return invoke<import("./types").TeamRun[]>(CMD.list_team_runs);
}

export async function getTeamRun(id: string): Promise<import("./types").TeamRun> {
  dbg("api", "getTeamRun", id);
  return invoke<import("./types").TeamRun>(CMD.get_team_run, { id });
}

export async function cancelTeamRun(id: string): Promise<import("./types").TeamRun> {
  dbg("api", "cancelTeamRun", id);
  return invoke<import("./types").TeamRun>(CMD.cancel_team_run, { id });
}

export async function updateTeamRunStatus(
  id: string,
  status: string,
  summary?: string,
  error?: string,
): Promise<import("./types").TeamRun> {
  dbg("api", "updateTeamRunStatus", { id, status });
  return invoke<import("./types").TeamRun>(CMD.update_team_run_status, {
    id,
    status,
    summary: summary ?? null,
    error: error ?? null,
  });
}

export async function updateTeamMemberRun(
  teamRunId: string,
  memberId: string,
  status: string,
  runId?: string,
  summary?: string,
  error?: string,
): Promise<import("./types").TeamRun> {
  dbg("api", "updateTeamMemberRun", { teamRunId, memberId, status });
  return invoke<import("./types").TeamRun>(CMD.update_team_member_run, {
    teamRunId,
    memberId,
    status,
    runId: runId ?? null,
    summary: summary ?? null,
    error: error ?? null,
  });
}

export async function setTeamRunLead(
  id: string,
  leadRunId: string,
  leadPlan?: string,
): Promise<import("./types").TeamRun> {
  dbg("api", "setTeamRunLead", { id, leadRunId });
  return invoke<import("./types").TeamRun>(CMD.set_team_run_lead, {
    id,
    leadRunId,
    leadPlan: leadPlan ?? null,
  });
}

export async function setTeamMemberTask(
  teamRunId: string,
  memberId: string,
  task: string,
): Promise<import("./types").TeamRun> {
  dbg("api", "setTeamMemberTask", { teamRunId, memberId });
  return invoke<import("./types").TeamRun>(CMD.set_team_member_task, {
    teamRunId,
    memberId,
    task,
  });
}

// ── Clipboard ──

export interface ClipboardFileInfo {
  path: string;
  name: string;
  size: number;
  mime_type: string;
}

export interface ClipboardFileContent {
  content_base64: string;
  content_text: string | null;
}

export async function getClipboardFiles(): Promise<ClipboardFileInfo[]> {
  dbg("api", "getClipboardFiles");
  return invoke<ClipboardFileInfo[]>(CMD.get_clipboard_files);
}

export async function readClipboardFile(
  path: string,
  asText: boolean,
): Promise<ClipboardFileContent> {
  dbg("api", "readClipboardFile", { path, asText });
  return invoke<ClipboardFileContent>(CMD.read_clipboard_file, { path, asText });
}

/** Save file to temp directory, return filesystem path. For >20MB PDFs from drag-drop/file picker. */
export async function saveTempAttachment(name: string, contentBase64: string): Promise<string> {
  dbg("api", "saveTempAttachment", { name, len: contentBase64.length });
  return invoke<string>(CMD.save_temp_attachment, { name, contentBase64 });
}

// ── Plugins ──

export async function listMarketplaces(): Promise<MarketplaceInfo[]> {
  dbg("api", "listMarketplaces");
  return invoke<MarketplaceInfo[]>(CMD.list_marketplaces);
}

export async function listMarketplacePlugins(): Promise<MarketplacePlugin[]> {
  dbg("api", "listMarketplacePlugins");
  return invoke<MarketplacePlugin[]>(CMD.list_marketplace_plugins);
}

export async function listProjectCommands(cwd?: string): Promise<import("./types").CliCommand[]> {
  dbg("api", "listProjectCommands", { cwd });
  return invoke<import("./types").CliCommand[]>(CMD.list_project_commands, { cwd: cwd ?? null });
}

export async function listStandaloneSkills(cwd?: string): Promise<StandaloneSkill[]> {
  dbg("api", "listStandaloneSkills", { cwd });
  return invoke<StandaloneSkill[]>(CMD.list_standalone_skills, { cwd: cwd ?? null });
}

/** Cheap skill counts only — does NOT load SKILL.md bodies. Use this from
 *  cold-start pages that just need a number (e.g. /personal hero stat) so we
 *  do not pay for the full skill list payload or hydrate `skillStore`. */
export async function getSkillSummary(cwd?: string): Promise<SkillSummary> {
  dbg("api", "getSkillSummary", { cwd });
  return invoke<SkillSummary>(CMD.get_skill_summary, { cwd: cwd ?? null });
}

export async function getSkillContent(path: string, cwd?: string): Promise<string> {
  dbg("api", "getSkillContent", path);
  return invoke<string>(CMD.get_skill_content, { path, cwd: cwd ?? "" });
}

export async function createSkill(
  name: string,
  description: string,
  content: string,
  scope: string,
  cwd?: string,
): Promise<StandaloneSkill> {
  dbg("api", "createSkill", { name, scope, cwd });
  return invoke<StandaloneSkill>(CMD.create_skill, {
    name,
    description,
    content,
    scope,
    cwd: cwd ?? null,
  });
}

export async function updateSkill(path: string, content: string, cwd?: string): Promise<void> {
  dbg("api", "updateSkill", { path, cwd });
  return invoke<void>(CMD.update_skill, { path, content, cwd: cwd ?? null });
}

export async function deleteSkill(path: string, cwd?: string): Promise<void> {
  dbg("api", "deleteSkill", { path, cwd });
  return invoke<void>(CMD.delete_skill, { path, cwd: cwd ?? null });
}

export async function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  dbg("api", "listInstalledPlugins");
  return invoke<InstalledPlugin[]>(CMD.list_installed_plugins);
}

export async function installPlugin(
  name: string,
  scope: string,
  cwd?: string,
): Promise<PluginOperationResult> {
  dbg("api", "installPlugin", { name, scope, cwd });
  return invoke<PluginOperationResult>(CMD.install_plugin, { name, scope, cwd });
}

export async function uninstallPlugin(
  name: string,
  scope: string,
  cwd?: string,
): Promise<PluginOperationResult> {
  dbg("api", "uninstallPlugin", { name, scope, cwd });
  return invoke<PluginOperationResult>(CMD.uninstall_plugin, { name, scope, cwd });
}

export async function enablePlugin(
  name: string,
  scope: string,
  cwd?: string,
): Promise<PluginOperationResult> {
  dbg("api", "enablePlugin", { name, scope, cwd });
  return invoke<PluginOperationResult>(CMD.enable_plugin, { name, scope, cwd });
}

export async function disablePlugin(
  name: string,
  scope: string,
  cwd?: string,
): Promise<PluginOperationResult> {
  dbg("api", "disablePlugin", { name, scope, cwd });
  return invoke<PluginOperationResult>(CMD.disable_plugin, { name, scope, cwd });
}

export async function updatePlugin(
  name: string,
  scope: string,
  cwd?: string,
): Promise<PluginOperationResult> {
  dbg("api", "updatePlugin", { name, scope, cwd });
  return invoke<PluginOperationResult>(CMD.update_plugin, { name, scope, cwd });
}

export async function addMarketplace(source: string): Promise<PluginOperationResult> {
  dbg("api", "addMarketplace", { source });
  return invoke<PluginOperationResult>(CMD.add_marketplace, { source });
}

export async function removeMarketplace(name: string): Promise<PluginOperationResult> {
  dbg("api", "removeMarketplace", { name });
  return invoke<PluginOperationResult>(CMD.remove_marketplace, { name });
}

export async function updateMarketplace(name?: string): Promise<PluginOperationResult> {
  dbg("api", "updateMarketplace", { name });
  return invoke<PluginOperationResult>(CMD.update_marketplace, { name: name ?? null });
}

// ── Community Skills ──

export async function checkCommunityHealth(): Promise<import("./types").ProviderHealth> {
  dbg("api", "checkCommunityHealth");
  return invoke<import("./types").ProviderHealth>(CMD.check_community_health);
}

export async function searchCommunitySkills(
  query: string,
  limit?: number,
): Promise<import("./types").CommunitySkillResult[]> {
  dbg("api", "searchCommunitySkills", { query, limit });
  return invoke<import("./types").CommunitySkillResult[]>(CMD.search_community_skills, {
    query,
    limit: limit ?? null,
  });
}

export async function getCommunitySkillDetail(
  source: string,
  skillId: string,
): Promise<import("./types").CommunitySkillDetail> {
  dbg("api", "getCommunitySkillDetail", { source, skillId });
  return invoke<import("./types").CommunitySkillDetail>(CMD.get_community_skill_detail, {
    source,
    skillId,
  });
}

export async function installCommunitySkill(
  source: string,
  skillId: string,
  scope: string,
  cwd?: string,
): Promise<PluginOperationResult> {
  dbg("api", "installCommunitySkill", { source, skillId, scope });
  return invoke<PluginOperationResult>(CMD.install_community_skill, {
    source,
    skillId,
    scope,
    cwd: cwd ?? null,
  });
}

// ── MCP Registry ──

export async function listConfiguredMcpServers(cwd?: string): Promise<ConfiguredMcpServer[]> {
  dbg("api", "listConfiguredMcpServers", { cwd });
  return invoke<ConfiguredMcpServer[]>(CMD.list_configured_mcp_servers, { cwd: cwd ?? null });
}

export async function addMcpServer(
  name: string,
  transport: string,
  scope: string,
  cwd?: string,
  configJson?: string,
  url?: string,
  envVars?: Record<string, string>,
  headers?: Record<string, string>,
): Promise<PluginOperationResult> {
  dbg("api", "addMcpServer", { name, transport, scope });
  return invoke<PluginOperationResult>(CMD.add_mcp_server, {
    name,
    transport,
    scope,
    cwd: cwd ?? null,
    configJson: configJson ?? null,
    url: url ?? null,
    envVars: envVars ?? null,
    headers: headers ?? null,
  });
}

export async function removeMcpServer(
  name: string,
  scope: string,
  cwd?: string,
): Promise<PluginOperationResult> {
  dbg("api", "removeMcpServer", { name, scope, cwd });
  return invoke<PluginOperationResult>(CMD.remove_mcp_server, {
    name,
    scope,
    cwd: cwd ?? null,
  });
}

export async function checkMcpRegistryHealth(): Promise<ProviderHealth> {
  dbg("api", "checkMcpRegistryHealth");
  return invoke<ProviderHealth>(CMD.check_mcp_registry_health);
}

export async function searchMcpRegistry(
  query: string,
  limit?: number,
  cursor?: string,
): Promise<McpRegistrySearchResult> {
  dbg("api", "searchMcpRegistry", { query, limit, cursor });
  return invoke<McpRegistrySearchResult>(CMD.search_mcp_registry, {
    query,
    limit: limit ?? null,
    cursor: cursor ?? null,
  });
}

// ── CLI Permissions ──

export interface CliPermissions {
  user: { allow: string[]; deny: string[] };
  project: { allow: string[]; deny: string[] };
  projectError?: string | null;
}

export async function getCliPermissions(cwd?: string): Promise<CliPermissions> {
  dbg("api", "getCliPermissions", { cwd });
  return invoke<CliPermissions>(CMD.get_cli_permissions, { cwd: cwd ?? null });
}

export async function updateCliPermissions(
  scope: "user" | "project",
  category: "allow" | "deny",
  rules: string[],
  cwd?: string,
): Promise<void> {
  dbg("api", "updateCliPermissions", { scope, category, count: rules.length });
  return invoke<void>(CMD.update_cli_permissions, {
    scope,
    category,
    rules,
    cwd: cwd ?? null,
  });
}

// ── CLI Config ──

export async function getCliConfig(): Promise<Record<string, unknown>> {
  dbg("api", "getCliConfig");
  return invoke<Record<string, unknown>>("get_cli_config");
}

export async function getProjectCliConfig(cwd: string): Promise<Record<string, unknown>> {
  dbg("api", "getProjectCliConfig", { cwd });
  return invoke<Record<string, unknown>>("get_project_cli_config", { cwd });
}

export async function updateCliConfig(
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  dbg("api", "updateCliConfig", { patch: redactSensitive(patch) });
  return invoke<Record<string, unknown>>("update_cli_config", { patch });
}

// ── App Updates ──

export async function checkForUpdates(): Promise<import("./types").UpdateInfo> {
  dbg("api", "checkForUpdates");
  return invoke<import("./types").UpdateInfo>(CMD.check_for_updates);
}

// ── Changelog ──

export async function getChangelog(): Promise<ChangelogEntry[]> {
  dbg("api", "getChangelog");
  return invoke<ChangelogEntry[]>(CMD.get_changelog);
}

export type ReadmeOrigin = "remote" | "remote-cache" | "local-fallback";

export interface ReadmeSource {
  content: string;
  origin: ReadmeOrigin;
}

/** Load app README markdown. Tries upstream GitHub (cached 5 min), then falls back
 * to bundled/repo-local copies. The returned `origin` tells the caller where the
 * bytes actually came from. */
export async function readAppReadme(locale?: string): Promise<ReadmeSource> {
  dbg("api", "readAppReadme", { locale });
  return invoke<ReadmeSource>(CMD.read_app_readme, { locale: locale ?? null });
}

/** Force a remote README refresh (bypasses the in-memory cache). */
export async function refreshAppReadme(locale?: string): Promise<ReadmeSource> {
  dbg("api", "refreshAppReadme", { locale });
  return invoke<ReadmeSource>(CMD.refresh_app_readme, { locale: locale ?? null });
}

// ── Onboarding ──

export async function checkAuthStatus(): Promise<import("./types").AuthCheckResult> {
  dbg("api", "checkAuthStatus");
  return invoke<import("./types").AuthCheckResult>(CMD.check_auth_status);
}

export async function detectInstallMethods(): Promise<import("./types").InstallMethod[]> {
  dbg("api", "detectInstallMethods");
  return invoke<import("./types").InstallMethod[]>(CMD.detect_install_methods);
}

export async function runClaudeLogin(): Promise<boolean> {
  dbg("api", "runClaudeLogin");
  return invoke<boolean>(CMD.run_claude_login);
}

export async function getAuthOverview(): Promise<import("./types").AuthOverview> {
  dbg("api", "getAuthOverview");
  return invoke<import("./types").AuthOverview>(CMD.get_auth_overview);
}

export async function setCliApiKey(key: string): Promise<void> {
  dbg("api", "setCliApiKey");
  return invoke<void>(CMD.set_cli_api_key, { key });
}

export async function removeCliApiKey(): Promise<void> {
  dbg("api", "removeCliApiKey");
  return invoke<void>(CMD.remove_cli_api_key);
}

export async function getProductBootstrapStatus(): Promise<
  import("./types").ProductBootstrapStatus
> {
  dbg("api", "getProductBootstrapStatus");
  return invoke<import("./types").ProductBootstrapStatus>(CMD.get_product_bootstrap_status);
}

export async function runProductBootstrap(
  force = false,
): Promise<import("./types").ProductBootstrapRunResult> {
  dbg("api", "runProductBootstrap", { force });
  return invoke<import("./types").ProductBootstrapRunResult>(CMD.run_product_bootstrap, { force });
}

// ── Screenshot ──

export async function captureScreenshot(): Promise<void> {
  dbg("api", "captureScreenshot");
  return invoke<void>(CMD.capture_screenshot);
}

export async function updateScreenshotHotkey(hotkey: string | null): Promise<void> {
  dbg("api", "updateScreenshotHotkey", { hotkey });
  return invoke<void>(CMD.update_screenshot_hotkey, { hotkey });
}

// ── Web Server ──

export async function getWebServerToken(): Promise<string | null> {
  dbg("api", "getWebServerToken");
  return invoke<string | null>(CMD.get_web_server_token);
}

export async function getWebServerStatus(): Promise<{
  enabled: boolean;
  running: boolean;
  port: number;
  bind: string;
  warning?: string;
}> {
  dbg("api", "getWebServerStatus");
  return invoke<{
    enabled: boolean;
    running: boolean;
    port: number;
    bind: string;
    warning?: string;
  }>(CMD.get_web_server_status);
}

export async function regenerateWebServerToken(): Promise<string> {
  dbg("api", "regenerateWebServerToken");
  return invoke<string>(CMD.regenerate_web_server_token);
}

export interface WebServerConfig {
  enabled: boolean;
  port: number;
  bind: string;
  allowed_origins: string[] | null;
  tunnel_url: string | null;
}

export interface RestartResult {
  started: boolean;
  config_saved: boolean;
}

export async function restartWebServer(config: WebServerConfig): Promise<RestartResult> {
  dbg("api", "restartWebServer", { enabled: config.enabled, port: config.port });
  return invoke<RestartResult>(CMD.restart_web_server, { config });
}

export async function getLocalIp(preferV6: boolean): Promise<string | null> {
  dbg("api", "getLocalIp", { preferV6 });
  return invoke<string | null>(CMD.get_local_ip, { preferV6 });
}

// ── Agents ──

export async function listAgents(cwd?: string): Promise<AgentDefinitionSummary[]> {
  dbg("api", "listAgents", { cwd });
  return invoke<AgentDefinitionSummary[]>(CMD.list_agents, { cwd: cwd ?? null });
}

export async function readAgentFile(
  scope: "user" | "project",
  fileName: string,
  cwd?: string,
): Promise<string> {
  dbg("api", "readAgentFile", { scope, fileName });
  return invoke<string>(CMD.read_agent_file, {
    scope,
    fileName,
    cwd: cwd ?? null,
  });
}

export async function createAgentFile(
  scope: "user" | "project",
  fileName: string,
  content: string,
  cwd?: string,
): Promise<void> {
  dbg("api", "createAgentFile", { scope, fileName });
  return invoke<void>(CMD.create_agent_file, {
    scope,
    fileName,
    content,
    cwd: cwd ?? null,
  });
}

export async function updateAgentFile(
  scope: "user" | "project",
  fileName: string,
  content: string,
  cwd?: string,
): Promise<void> {
  dbg("api", "updateAgentFile", { scope, fileName });
  return invoke<void>(CMD.update_agent_file, {
    scope,
    fileName,
    content,
    cwd: cwd ?? null,
  });
}

export async function deleteAgentFile(
  scope: "user" | "project",
  fileName: string,
  cwd?: string,
): Promise<void> {
  dbg("api", "deleteAgentFile", { scope, fileName });
  return invoke<void>(CMD.delete_agent_file, {
    scope,
    fileName,
    cwd: cwd ?? null,
  });
}

// ── Ralph Loop ──

export async function startRalphLoop(
  runId: string,
  prompt: string,
  maxIterations: number,
  completionPromise: string | null,
): Promise<void> {
  dbg("api", "startRalphLoop", { runId, maxIterations, completionPromise });
  return invoke<void>(CMD.start_ralph_loop, {
    runId,
    prompt,
    maxIterations,
    completionPromise,
  });
}

export async function cancelRalphLoop(
  runId: string,
): Promise<{ iteration: number; immediate: boolean }> {
  dbg("api", "cancelRalphLoop", { runId });
  return invoke<{ iteration: number; immediate: boolean }>(CMD.cancel_ralph_loop, { runId });
}

// ── Worktree ──

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

/**
 * Remove a git worktree.
 *
 * **Safety:** by default (`force = false`) the backend runs `git status
 * --porcelain` first and rejects with a `WorktreeDirtyError` payload if the
 * worktree has any uncommitted / untracked changes. Pass `force = true`
 * ONLY after the user has confirmed they want to discard dirty state.
 *
 * The Rust error is serialized via serde with `rename_all = "camelCase"`,
 * so the thrown payload looks like:
 *   { worktreePath, dirtyFiles: string[], message }
 */
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

/** Type guard for the `WorktreeDirtyError` payload from the Rust backend. */
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

// ── Runtime Control Plane ──

export type {
  ConfigTransactionPreview,
  ConfigTransactionResult,
  RuntimeControlPlaneList,
  RuntimeHubHealthResponse,
  RuntimeSnapshot,
  SessionRuntimeOverride,
} from "./runtime-control-plane/types";

export async function runtimeHubList(force = false): Promise<RuntimeControlPlaneList> {
  return invoke<RuntimeControlPlaneList>(CMD.runtime_hub_list, { force });
}

export async function runtimeHubHealth(
  runtimeId: string,
  force = false,
): Promise<RuntimeHubHealthResponse> {
  return invoke<RuntimeHubHealthResponse>(CMD.runtime_hub_health, { runtimeId, force });
}

export async function runtimeHubDiagnose(runtimeId: string): Promise<unknown> {
  return invoke(CMD.runtime_hub_diagnose, { runtimeId });
}

export async function runtimeHubSetDefault(runtimeId: string): Promise<string> {
  return invoke<string>(CMD.runtime_hub_set_default, { runtimeId });
}

export async function runtimeHubPreviewConfig(
  runtimeId: string,
  patch: Record<string, unknown>,
): Promise<ConfigTransactionPreview> {
  return invoke<ConfigTransactionPreview>(CMD.runtime_hub_preview_config, { runtimeId, patch });
}

export async function runtimeHubApplyConfig(
  runtimeId: string,
  patch: Record<string, unknown>,
): Promise<ConfigTransactionResult> {
  return invoke<ConfigTransactionResult>(CMD.runtime_hub_apply_config, { runtimeId, patch });
}

export async function runtimeHubStartConfigWatch(runtimeId: string): Promise<number> {
  return invoke<number>(CMD.runtime_hub_start_config_watch, { runtimeId });
}

export async function runtimeHubStopConfigWatch(runtimeId: string): Promise<boolean> {
  return invoke<boolean>(CMD.runtime_hub_stop_config_watch, { runtimeId });
}

// ── Fleet View (v1.2.0) ──
// See `docs/PLAN_FLEET_VIEW_V1.2.0.md` for the design.

import type { FleetMemberDetail, FleetMemberSummary, FleetMetrics, FleetSendResult } from "./types";

export interface ListFleetOptions {
  /**
   * Surface auto-archived members (older than 24h, not running). The desktop
   * UI hides these by default; the option is exposed for power users and
   * MCP/REST callers that want full visibility.
   */
  includeArchived?: boolean;
}

export async function listFleet(opts: ListFleetOptions = {}): Promise<FleetMemberSummary[]> {
  return invoke<FleetMemberSummary[]>(CMD.fleet_list, {
    includeArchived: opts.includeArchived ?? false,
  });
}

export async function getFleetMember(id: string): Promise<FleetMemberDetail> {
  return invoke<FleetMemberDetail>(CMD.fleet_get_member, { id });
}

export interface GetFleetMetricsOptions {
  includeArchived?: boolean;
}

export async function getFleetMetrics(opts: GetFleetMetricsOptions = {}): Promise<FleetMetrics> {
  return invoke<FleetMetrics>(CMD.fleet_get_metrics, {
    includeArchived: opts.includeArchived ?? false,
  });
}

export async function sendToFleetMember(id: string, prompt: string): Promise<FleetSendResult> {
  return invoke<FleetSendResult>(CMD.fleet_send_to_member, { id, prompt });
}

export async function stopFleetMember(id: string): Promise<boolean> {
  return invoke<boolean>(CMD.fleet_stop_member, { id });
}
