/**
 * API layer — typed wrappers around Tauri IPC commands.
 *
 * Domain modules:
 *   ./teams   — team management & orchestration runs
 *   ./plugins — plugins, skills, community marketplace
 *   ./mcp     — MCP server registry
 *
 * Remaining domains are inline here; future PRs will extract them.
 */
import { getTransport } from "../transport";
import { dbg, dbgWarn, redactSensitive } from "../utils/debug";
import { FAVORITES_CHANGED_KEY } from "../utils/storage-keys";
import { perfMarkAsync } from "../utils/perf";
import type {
  TaskRun,
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
  PermissionSuggestion,
  GitSummary,
} from "../types";

// Re-export domain modules
export * from "./teams";
export * from "./plugins";
export * from "./mcp";

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return getTransport().invoke<T>(cmd, args);
}

// ── Runs ──

export async function listRuns(): Promise<TaskRun[]> {
  dbg("api", "listRuns");
  try {
    const runs = await invoke<TaskRun[]>("list_runs");
    dbg("api", "listRuns →", runs.length);
    return runs;
  } catch (e) {
    dbgWarn("api", "listRuns error", e);
    throw e;
  }
}

export async function listRunsSince(since: string): Promise<TaskRun[]> {
  dbg("api", "listRunsSince", since);
  try {
    const runs = await invoke<TaskRun[]>("list_runs_since", { since });
    dbg("api", "listRunsSince →", runs.length);
    return runs;
  } catch (e) {
    dbgWarn("api", "listRunsSince error, falling back to full list", e);
    return listRuns();
  }
}

export async function getRun(id: string): Promise<TaskRun> {
  dbg("api", "getRun", id);
  return invoke<TaskRun>("get_run", { id });
}

export async function startRun(
  prompt: string,
  cwd: string,
  agent: string,
  model?: string,
  remoteHostName?: string,
  platformId?: string,
  executionPath?: string,
  /** When set, forces worktree for this run; omit to follow default_session_mode. */
  useWorktree?: boolean | null,
): Promise<TaskRun> {
  dbg("api", "startRun", {
    prompt: prompt.slice(0, 80),
    agent,
    cwd,
    remoteHostName,
    platformId,
    executionPath,
    useWorktree,
  });
  const args: Record<string, unknown> = {
    prompt,
    cwd,
    agent,
    model: model ?? null,
    remoteHostName: remoteHostName ?? null,
    platformId: platformId ?? null,
    executionPath: executionPath ?? null,
  };
  if (typeof useWorktree === "boolean") {
    args.useWorktreeOverride = useWorktree;
  }
  const result = await invoke<TaskRun>("start_run", args);
  dbg("api", "startRun →", result.id);
  return result;
}

export async function stopRun(id: string): Promise<boolean> {
  dbg("api", "stopRun", id);
  return invoke<boolean>("stop_run", { id });
}

export async function renameRun(id: string, name: string): Promise<void> {
  dbg("api", "renameRun", { id, name });
  return invoke<void>("rename_run", { id, name });
}

export async function updateRunModel(id: string, model: string): Promise<void> {
  dbg("api", "updateRunModel", { id, model });
  return invoke<void>("update_run_model", { id, model });
}

export async function softDeleteRuns(ids: string[]): Promise<number> {
  dbg("api", "softDeleteRuns", { ids });
  return invoke<number>("soft_delete_runs", { ids });
}

export async function hardDeleteRuns(ids: string[]): Promise<number> {
  dbg("api", "hardDeleteRuns", { ids });
  return invoke<number>("hard_delete_runs", { ids });
}

// ── Session Folders ──

export async function listSessionFolders(workspaceId: string): Promise<SessionFolder[]> {
  dbg("api", "listSessionFolders", { workspaceId });
  return invoke<SessionFolder[]>("list_session_folders", { workspaceId });
}

/** All logical session folders across workspaces (sidebar + move dialog). */
export async function listAllSessionFolders(): Promise<SessionFolder[]> {
  dbg("api", "listAllSessionFolders");
  return invoke<SessionFolder[]>("list_all_session_folders");
}

export async function createSessionFolder(
  name: string,
  workspaceId: string,
): Promise<SessionFolder> {
  dbg("api", "createSessionFolder", { name, workspaceId });
  return invoke<SessionFolder>("create_session_folder", { name, workspaceId });
}

export async function renameSessionFolder(folderId: string, newName: string): Promise<void> {
  dbg("api", "renameSessionFolder", { folderId, newName });
  return invoke<void>("rename_session_folder", { folderId, newName });
}

export async function deleteSessionFolder(folderId: string, cascade: boolean): Promise<number> {
  dbg("api", "deleteSessionFolder", { folderId, cascade });
  return invoke<number>("delete_session_folder", { folderId, cascade });
}

export async function moveRunToFolder(runId: string, folderId: string | null): Promise<void> {
  dbg("api", "moveRunToFolder", { runId, folderId });
  return invoke<void>("move_run_to_folder", { runId, folderId });
}

export async function batchMoveToFolder(
  runIds: string[],
  folderId: string | null,
): Promise<number> {
  dbg("api", "batchMoveToFolder", { runIds, folderId });
  return invoke<number>("batch_move_to_folder", { runIds, folderId });
}

// ── Prompt search & favorites ──

export async function searchPrompts(query: string, limit?: number): Promise<PromptSearchResult[]> {
  dbg("api", "searchPrompts", { query, limit });
  return invoke<PromptSearchResult[]>("search_prompts", { query, limit });
}

export async function addPromptFavorite(
  runId: string,
  seq: number,
  text: string,
): Promise<PromptFavorite> {
  dbg("api", "addPromptFavorite", { runId, seq });
  const result = await invoke<PromptFavorite>("add_prompt_favorite", { runId, seq, text });
  window.dispatchEvent(new Event(FAVORITES_CHANGED_KEY));
  return result;
}

export async function removePromptFavorite(runId: string, seq: number): Promise<void> {
  dbg("api", "removePromptFavorite", { runId, seq });
  await invoke<void>("remove_prompt_favorite", { runId, seq });
  window.dispatchEvent(new Event(FAVORITES_CHANGED_KEY));
}

export async function updatePromptFavoriteTags(favoriteId: string, tags: string[]): Promise<void> {
  dbg("api", "updatePromptFavoriteTags", { favoriteId, tags });
  await invoke<void>("update_prompt_favorite_tags", { favoriteId, tags });
  window.dispatchEvent(new Event(FAVORITES_CHANGED_KEY));
}

export async function updatePromptFavoriteNote(favoriteId: string, note: string): Promise<void> {
  dbg("api", "updatePromptFavoriteNote", { favoriteId });
  await invoke<void>("update_prompt_favorite_note", { favoriteId, note });
  window.dispatchEvent(new Event(FAVORITES_CHANGED_KEY));
}

export async function listPromptFavorites(): Promise<PromptFavorite[]> {
  dbg("api", "listPromptFavorites");
  return invoke<PromptFavorite[]>("list_prompt_favorites");
}

export async function listPromptTags(): Promise<string[]> {
  dbg("api", "listPromptTags");
  return invoke<string[]>("list_prompt_tags");
}

// ── Run search ──

export async function searchRuns(filters: RunSearchFilters): Promise<RunSearchResponse> {
  dbg("api", "searchRuns", { filters });
  return invoke<RunSearchResponse>("search_runs", { filters });
}

export async function getRunFiles(runId: string): Promise<string[]> {
  dbg("api", "getRunFiles", runId);
  return invoke<string[]>("get_run_files", { runId });
}

// ── Chat ──

export async function sendChatMessage(
  runId: string,
  message: string,
  attachments?: Attachment[],
  model?: string,
): Promise<void> {
  dbg("api", "sendChatMessage", {
    runId,
    msgLen: message.length,
    attachments: attachments?.length ?? 0,
  });
  return invoke("send_chat_message", { runId, message, attachments, model });
}

// ── CLI sync ──

export async function syncCliSession(runId: string): Promise<SyncResult> {
  dbg("api", "syncCliSession", { runId });
  return invoke<SyncResult>("sync_cli_session", { runId });
}

// ── Events ──

export async function getRunEvents(id: string, sinceSeq?: number): Promise<RunEvent[]> {
  dbg("api", "getRunEvents", { id, sinceSeq });
  return invoke<RunEvent[]>("get_run_events", { id, sinceSeq });
}

// ── Artifacts ──

export async function getRunArtifacts(id: string): Promise<RunArtifact> {
  dbg("api", "getRunArtifacts", id);
  return invoke<RunArtifact>("get_run_artifacts", { id });
}

// ── Settings ──

export async function getUserSettings(): Promise<UserSettings> {
  dbg("api", "getUserSettings");
  return invoke<UserSettings>("get_user_settings");
}

export async function updateUserSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
  dbg("api", "updateUserSettings");
  return invoke<UserSettings>("update_user_settings", { patch });
}

export async function getAgentSettings(agent: string): Promise<AgentSettings> {
  dbg("api", "getAgentSettings", agent);
  return invoke<AgentSettings>("get_agent_settings", { agent });
}

export async function updateAgentSettings(
  agent: string,
  patch: Partial<AgentSettings>,
): Promise<AgentSettings> {
  dbg("api", "updateAgentSettings", agent);
  const result = await invoke<AgentSettings>("update_agent_settings", { agent, patch });
  // Sync sidebar resume-gate cache with updated settings
  import("../stores/agent-settings-cache.svelte").then((m) => m.refreshAgentSettingsCache(agent));
  return result;
}

// ── Feishu webhook notification ──

export async function sendFeishuNotification(
  title: string,
  body: string,
  status?: string,
  link?: string,
): Promise<void> {
  dbg("api", "sendFeishuNotification", { title, status });
  return invoke<void>("send_feishu_notification", { title, body, status, link });
}

// ── Filesystem ──

export async function listDirectory(path: string, showHidden?: boolean): Promise<DirListing> {
  dbg("api", "listDirectory", path, { showHidden });
  return invoke<DirListing>("list_directory", { path, showHidden });
}

export async function checkIsDirectory(path: string): Promise<boolean> {
  return invoke<boolean>("check_is_directory", { path });
}

// Remote filesystem (over SSH)
export async function listRemoteDirectory(
  hostName: string,
  path: string,
  showHidden?: boolean,
): Promise<DirListing> {
  dbg("api", "listRemoteDirectory", { hostName, path, showHidden });
  return invoke<DirListing>("list_remote_directory", {
    hostName,
    path,
    showHidden: showHidden ?? null,
  });
}

export async function resolveRemoteHome(hostName: string): Promise<string> {
  dbg("api", "resolveRemoteHome", { hostName });
  return invoke<string>("resolve_remote_home", { hostName });
}

export async function readFileBase64(path: string, cwd?: string): Promise<[string, string]> {
  return perfMarkAsync(
    "ipc-readFileBase64",
    () => invoke<[string, string]>("read_file_base64", { path, cwd: cwd ?? null }),
    { path },
  );
}

// ── Git ──

export async function getGitSummary(cwd: string): Promise<GitSummary> {
  dbg("api", "getGitSummary", cwd);
  return invoke<GitSummary>("get_git_summary", { cwd });
}

export async function getGitBranch(cwd: string): Promise<string> {
  dbg("api", "getGitBranch", cwd);
  return invoke<string>("get_git_branch", { cwd });
}

export async function getGitDiff(cwd: string, staged: boolean, file?: string): Promise<string> {
  dbg("api", "getGitDiff", { cwd, staged, file });
  return perfMarkAsync(
    "ipc-getGitDiff",
    () => invoke<string>("get_git_diff", { cwd, staged, file: file ?? null }),
    { cwd, staged, file },
  );
}

export async function getGitStatus(cwd: string): Promise<string> {
  dbg("api", "getGitStatus", cwd);
  return invoke<string>("get_git_status", { cwd });
}

// ── Export ──

export async function exportConversation(runId: string): Promise<string> {
  dbg("api", "exportConversation", runId);
  return invoke<string>("export_conversation", { runId });
}

export async function writeHtmlExport(path: string, content: string): Promise<void> {
  dbg("api", "writeHtmlExport", { path, contentLen: content.length });
  return invoke<void>("write_html_export", { path, content });
}

// ── Memory file candidates ──

export async function listMemoryFiles(
  cwd?: string,
): Promise<import("../types").MemoryFileCandidate[]> {
  dbg("api", "listMemoryFiles", { cwd });
  return invoke<import("../types").MemoryFileCandidate[]>("list_memory_files", {
    cwd: cwd ?? null,
  });
}

// ── Files ──

export async function readTextFile(path: string, cwd?: string): Promise<string> {
  dbg("api", "readTextFile", path, { cwd });
  return perfMarkAsync(
    "ipc-readTextFile",
    async () => {
      const content = await invoke<string>("read_text_file", { path, cwd: cwd ?? null });
      return content;
    },
    { path, chars: 0 },
  );
}

/** Cheap file size lookup — used by FilePreviewPane to skip readTextFile for huge files. */
export async function statTextFile(path: string, cwd?: string): Promise<number> {
  dbg("api", "statTextFile", path, { cwd });
  return perfMarkAsync(
    "ipc-statTextFile",
    () => invoke<number>("stat_text_file", { path, cwd: cwd ?? null }),
    { path },
  );
}

export async function writeTextFile(path: string, content: string, cwd?: string): Promise<void> {
  dbg("api", "writeTextFile", path, { cwd });
  return invoke("write_text_file", { path, content, cwd: cwd ?? null });
}

// ── Task output ──

export async function readTaskOutput(path: string): Promise<string> {
  dbg("api", "readTaskOutput", path);
  return invoke<string>("read_task_output", { path });
}

// ── Stats ──

export async function getUsageOverview(days?: number): Promise<UsageOverview> {
  dbg("api", "getUsageOverview", { days });
  return invoke<UsageOverview>("get_usage_overview", { days: days ?? null });
}

export async function getGlobalUsageOverview(days?: number): Promise<UsageOverview> {
  dbg("api", "getGlobalUsageOverview", { days });
  return invoke<UsageOverview>("get_global_usage_overview", { days: days ?? null });
}

export async function clearUsageCache(): Promise<void> {
  dbg("api", "clearUsageCache");
  return invoke<void>("clear_usage_cache");
}

export async function getHeatmapDaily(
  scope: "app" | "global",
): Promise<import("../types").DailyAggregate[]> {
  dbg("api", "getHeatmapDaily", { scope });
  return invoke<import("../types").DailyAggregate[]>("get_heatmap_daily", { scope });
}

// ── Diagnostics ──

export async function checkAgentCli(agent: string): Promise<CliCheckResult> {
  dbg("api", "checkAgentCli", agent);
  return invoke<CliCheckResult>("check_agent_cli", { agent });
}

export async function checkProjectInit(cwd: string): Promise<ProjectInitStatus> {
  dbg("api", "checkProjectInit", cwd);
  return invoke<ProjectInitStatus>("check_project_init", { cwd });
}

export async function getCliDistTags(): Promise<CliDistTags> {
  dbg("api", "getCliDistTags");
  return invoke<CliDistTags>("get_cli_dist_tags");
}

/** Run official `claude update` (desktop only). Returns CLI stdout+stderr on success. */
export async function runClaudeSelfUpdate(): Promise<string> {
  dbg("api", "runClaudeSelfUpdate");
  return invoke<string>("run_claude_self_update");
}

export async function checkSshKey(): Promise<SshKeyInfo> {
  dbg("api", "checkSshKey");
  return invoke<SshKeyInfo>("check_ssh_key");
}

export async function generateSshKey(): Promise<SshKeyInfo> {
  dbg("api", "generateSshKey");
  return invoke<SshKeyInfo>("generate_ssh_key");
}

export async function detectLocalProxy(
  proxyId: string,
  baseUrl: string,
): Promise<import("../types").LocalProxyStatus> {
  dbg("api", "detectLocalProxy", { proxyId, baseUrl });
  return invoke<import("../types").LocalProxyStatus>("detect_local_proxy", { proxyId, baseUrl });
}

export async function testApiConnectivity(
  apiKey: string,
  baseUrl: string,
  authEnvVar: string,
  model: string,
): Promise<import("../types").ApiTestResult> {
  dbg("api", "testApiConnectivity", { baseUrl, authEnvVar, model });
  return invoke<import("../types").ApiTestResult>("test_api_connectivity", {
    apiKey,
    baseUrl,
    authEnvVar,
    model,
  });
}

export async function runDiagnostics(cwd: string): Promise<DiagnosticsReport> {
  dbg("api", "runDiagnostics", { cwd });
  return invoke<DiagnosticsReport>("run_diagnostics", { cwd });
}

export async function testRemoteHost(
  host: string,
  user: string,
  port?: number,
  keyPath?: string,
  remoteClaudePath?: string,
): Promise<RemoteTestResult> {
  dbg("api", "testRemoteHost", { host, user, port });
  return invoke<RemoteTestResult>("test_remote_host", {
    host,
    user,
    port: port ?? null,
    keyPath: keyPath ?? null,
    remoteClaudePath: remoteClaudePath ?? null,
  });
}

// ── CLI Control Protocol ──

export async function getCliInfo(forceRefresh?: boolean): Promise<CliInfo> {
  dbg("api", "getCliInfo", { forceRefresh });
  try {
    const info = await invoke<CliInfo>("get_cli_info", { forceRefresh });
    dbg("api", "getCliInfo →", { models: info.models.length });
    return info;
  } catch (e) {
    dbgWarn("api", "getCliInfo error", e);
    throw e;
  }
}

// ── Session (event bus) ──

export async function startSession(
  runId: string,
  mode?: SessionMode,
  sessionId?: string,
  initialMessage?: string,
  attachments?: Array<{ content_base64: string; media_type: string; filename: string }>,
  platformId?: string,
  permissionModeOverride?: string,
): Promise<void> {
  dbg("api", "startSession", {
    runId,
    mode,
    sessionId,
    hasMessage: !!initialMessage,
    attachments: attachments?.length ?? 0,
    platformId,
    permissionModeOverride,
  });
  return invoke("start_session", {
    runId,
    mode,
    sessionId,
    initialMessage,
    attachments: attachments ?? null,
    platformId: platformId ?? null,
    permissionModeOverride: permissionModeOverride ?? null,
  });
}

export async function sendSessionMessage(
  runId: string,
  message: string,
  attachments?: Array<{ content_base64: string; media_type: string; filename: string }>,
): Promise<void> {
  dbg("api", "sendSessionMessage", {
    runId,
    msgLen: message.length,
    attachments: attachments?.length ?? 0,
  });
  return invoke("send_session_message", {
    runId,
    message,
    attachments: attachments ?? null,
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

export interface LoadRunDataResult {
  run: TaskRun;
  busEvents: BusEvent[];
}

export async function loadRunData(id: string, syncCli = false): Promise<LoadRunDataResult> {
  dbg("api", "loadRunData", { id, syncCli });
  return invoke<LoadRunDataResult>("load_run_data", { id, syncCli });
}

export async function getBusEvents(id: string, sinceSeq?: number): Promise<BusEvent[]> {
  dbg("api", "getBusEvents", { id, sinceSeq });
  return invoke<BusEvent[]>("get_bus_events", { id, sinceSeq });
}

export async function getToolResult(
  runId: string,
  toolUseId: string,
): Promise<Record<string, unknown>> {
  dbg("api", "getToolResult", { runId, toolUseId });
  return invoke<Record<string, unknown>>("get_tool_result", { runId, toolUseId });
}

export async function forkSession(runId: string): Promise<string> {
  dbg("api", "forkSession", runId);
  return invoke<string>("fork_session", { runId });
}

export async function sideQuestion(runId: string, question: string): Promise<string> {
  dbg("api", "sideQuestion", { runId, question });
  return invoke<string>("side_question", { runId, question });
}

export async function approveSessionTool(runId: string, toolName: string): Promise<void> {
  dbg("api", "approveSessionTool", { runId, toolName });
  return invoke("approve_session_tool", { runId, toolName });
}

export async function respondPermission(
  runId: string,
  requestId: string,
  behavior: string,
  updatedPermissions?: PermissionSuggestion[],
  updatedInput?: Record<string, unknown>,
  denyMessage?: string,
  interrupt?: boolean,
): Promise<void> {
  dbg("api", "respondPermission", {
    runId,
    requestId,
    behavior,
    updatedPermissions,
    updatedInput,
    denyMessage,
  });
  return invoke("respond_permission", {
    runId,
    requestId,
    behavior,
    updatedPermissions: updatedPermissions ?? null,
    updatedInput: updatedInput ?? null,
    denyMessage: denyMessage ?? null,
    interrupt: interrupt ?? null,
  });
}

export async function respondHookCallback(
  runId: string,
  requestId: string,
  decision: "allow" | "deny" | "defer",
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
  dbg("api", "broadcastMcpToggle", { serverName, enabled });
  return invoke<number>("broadcast_mcp_toggle", { serverName, enabled });
}

export async function getDisabledMcpServers(): Promise<string[]> {
  dbg("api", "getDisabledMcpServers");
  return invoke<string[]>("get_disabled_mcp_servers");
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
  return invoke<ClipboardFileInfo[]>("get_clipboard_files");
}

export async function readClipboardFile(
  path: string,
  asText: boolean,
): Promise<ClipboardFileContent> {
  dbg("api", "readClipboardFile", { path, asText });
  return invoke<ClipboardFileContent>("read_clipboard_file", { path, asText });
}

/** Save file to temp directory, return filesystem path. For >20MB PDFs from drag-drop/file picker. */
export async function saveTempAttachment(name: string, contentBase64: string): Promise<string> {
  dbg("api", "saveTempAttachment", { name, len: contentBase64.length });
  return invoke<string>("save_temp_attachment", { name, contentBase64 });
}

// ── CLI Permissions ──

export interface CliPermissions {
  user: { allow: string[]; deny: string[] };
  project: { allow: string[]; deny: string[] };
  projectError?: string | null;
}

export async function getCliPermissions(cwd?: string): Promise<CliPermissions> {
  dbg("api", "getCliPermissions", { cwd });
  return invoke<CliPermissions>("get_cli_permissions", { cwd: cwd ?? null });
}

export async function updateCliPermissions(
  scope: "user" | "project",
  category: "allow" | "deny",
  rules: string[],
  cwd?: string,
): Promise<void> {
  dbg("api", "updateCliPermissions", { scope, category, count: rules.length });
  return invoke<void>("update_cli_permissions", {
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

export async function checkForUpdates(): Promise<import("../types").UpdateInfo> {
  dbg("api", "checkForUpdates");
  return invoke<import("../types").UpdateInfo>("check_for_updates");
}

// ── Changelog ──

export async function getChangelog(): Promise<ChangelogEntry[]> {
  dbg("api", "getChangelog");
  return invoke<ChangelogEntry[]>("get_changelog");
}

// ── Onboarding ──

export async function checkAuthStatus(): Promise<import("../types").AuthCheckResult> {
  dbg("api", "checkAuthStatus");
  return invoke<import("../types").AuthCheckResult>("check_auth_status");
}

export async function detectInstallMethods(): Promise<import("../types").InstallMethod[]> {
  dbg("api", "detectInstallMethods");
  return invoke<import("../types").InstallMethod[]>("detect_install_methods");
}

export async function runClaudeLogin(): Promise<boolean> {
  dbg("api", "runClaudeLogin");
  return invoke<boolean>("run_claude_login");
}

export async function getAuthOverview(): Promise<import("../types").AuthOverview> {
  dbg("api", "getAuthOverview");
  return invoke<import("../types").AuthOverview>("get_auth_overview");
}

export async function setCliApiKey(key: string): Promise<void> {
  dbg("api", "setCliApiKey");
  return invoke<void>("set_cli_api_key", { key });
}

export async function removeCliApiKey(): Promise<void> {
  dbg("api", "removeCliApiKey");
  return invoke<void>("remove_cli_api_key");
}

// ── Screenshot ──

export async function captureScreenshot(): Promise<void> {
  dbg("api", "captureScreenshot");
  return invoke<void>("capture_screenshot");
}

export async function updateScreenshotHotkey(hotkey: string | null): Promise<void> {
  dbg("api", "updateScreenshotHotkey", { hotkey });
  return invoke<void>("update_screenshot_hotkey", { hotkey });
}

// ── Web Server ──

export async function getWebServerToken(): Promise<string | null> {
  dbg("api", "getWebServerToken");
  return invoke<string | null>("get_web_server_token");
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
  }>("get_web_server_status");
}

export async function regenerateWebServerToken(): Promise<string> {
  dbg("api", "regenerateWebServerToken");
  return invoke<string>("regenerate_web_server_token");
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
  return invoke<RestartResult>("restart_web_server", { config });
}

export async function getLocalIp(preferV6: boolean): Promise<string | null> {
  dbg("api", "getLocalIp", { preferV6 });
  return invoke<string | null>("get_local_ip", { preferV6 });
}

// ── Agents ──

export async function listAgents(cwd?: string): Promise<AgentDefinitionSummary[]> {
  dbg("api", "listAgents", { cwd });
  return invoke<AgentDefinitionSummary[]>("list_agents", { cwd: cwd ?? null });
}

export async function readAgentFile(
  scope: "user" | "project",
  fileName: string,
  cwd?: string,
): Promise<string> {
  dbg("api", "readAgentFile", { scope, fileName });
  return invoke<string>("read_agent_file", {
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
  return invoke<void>("create_agent_file", {
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
  return invoke<void>("update_agent_file", {
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
  return invoke<void>("delete_agent_file", {
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
  return invoke<void>("start_ralph_loop", {
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
  return invoke<{ iteration: number; immediate: boolean }>("cancel_ralph_loop", { runId });
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
  return invoke<WorktreeInfo>("create_worktree", { parentCwd, sessionIdShort, branchName });
}

export async function autoCommit(cwd: string, message: string): Promise<AutoCommitResult> {
  dbg("api", "autoCommit", { cwd, message });
  return invoke<AutoCommitResult>("auto_commit", { cwd, message });
}

export async function createPullRequest(
  cwd: string,
  branch: string,
  baseBranch: string,
): Promise<string> {
  dbg("api", "createPullRequest", { cwd, branch, baseBranch });
  return invoke<string>("create_pull_request", { cwd, branch, baseBranch });
}

export async function removeWorktree(
  worktreePath: string,
  parentCwd: string,
  branchName?: string,
): Promise<void> {
  dbg("api", "removeWorktree", { worktreePath, parentCwd, branchName });
  return invoke<void>("remove_worktree", {
    worktreePath,
    parentCwd,
    branchName: branchName ?? null,
  });
}

export async function listWorktrees(parentCwd: string): Promise<WorktreeEntry[]> {
  dbg("api", "listWorktrees", { parentCwd });
  return invoke<WorktreeEntry[]>("list_worktrees", { parentCwd });
}
