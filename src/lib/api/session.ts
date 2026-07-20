// session API functions
// Auto-generated from api.ts

import { getTransport } from "../transport";
import { dbg, dbgWarn } from "../utils/debug";
import { CMD, type CmdName } from "../tauri-commands";

function invoke<T>(cmd: CmdName | string, args?: Record<string, unknown>): Promise<T> {
  return getTransport().invoke<T>(cmd, args);
}
import type {
  TaskRun,
  RunSurface,
  RunEvent,
  RunArtifact,
  Attachment,
  BusEvent,
  SessionMode,
  SyncResult,
  RunSearchFilters,
  RunSearchResponse,
} from "../types";
import type {} from "../runtime-control-plane/types";
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
} from "../types/task";
import type {
  RunCheckpoint,
  RunJournalEvent,
  RunJournalReconcileReport,
  RunJournalSnapshot,
} from "../types/run-journal";
import type {
  AttentionAction,
  AttentionEvent,
  AttentionQueueSnapshot,
  AttentionReconcileReport,
} from "../types/attention-queue";

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

export async function searchRuns(filters: RunSearchFilters): Promise<RunSearchResponse> {
  dbg("api", "searchRuns", filters);
  return invoke<RunSearchResponse>(CMD.search_runs, { filters });
}

export async function getRunFiles(runId: string): Promise<string[]> {
  dbg("api", "getRunFiles", { runId });
  return invoke<string[]>(CMD.get_run_files, { runId });
}

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

export async function syncCliSession(runId: string): Promise<SyncResult> {
  dbg("api", "syncCliSession", { runId });
  return invoke<SyncResult>(CMD.sync_cli_session, { runId });
}

export async function getRunEvents(id: string, sinceSeq?: number): Promise<RunEvent[]> {
  dbg("api", "getRunEvents", { id, sinceSeq });
  return invoke<RunEvent[]>(CMD.get_run_events, { id, sinceSeq });
}

export async function getRunArtifacts(id: string): Promise<RunArtifact> {
  dbg("api", "getRunArtifacts", id);
  return invoke<RunArtifact>(CMD.get_run_artifacts, { id });
}

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
  updatedPermissions?: import("../types").PermissionSuggestion[],
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

export async function saveTempAttachment(name: string, contentBase64: string): Promise<string> {
  dbg("api", "saveTempAttachment", { name, len: contentBase64.length });
  return invoke<string>(CMD.save_temp_attachment, { name, contentBase64 });
}

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
