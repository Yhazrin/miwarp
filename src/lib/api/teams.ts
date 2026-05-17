import { getTransport } from "../transport";
import { dbg } from "../utils/debug";
import type {
  TeamSummary,
  TeamConfig,
  TeamTask,
  TeamInboxMessage,
  TeamPreset,
  TeamRun,
} from "../types";

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return getTransport().invoke<T>(cmd, args);
}

// ── Teams ──

export async function listTeams(): Promise<TeamSummary[]> {
  dbg("api", "listTeams");
  return invoke<TeamSummary[]>("list_teams");
}

export async function getTeamConfig(name: string): Promise<TeamConfig> {
  dbg("api", "getTeamConfig", name);
  return invoke<TeamConfig>("get_team_config", { name });
}

export async function listTeamTasks(teamName: string): Promise<TeamTask[]> {
  dbg("api", "listTeamTasks", teamName);
  return invoke<TeamTask[]>("list_team_tasks", { teamName });
}

export async function getTeamTask(teamName: string, taskId: string): Promise<TeamTask> {
  dbg("api", "getTeamTask", { teamName, taskId });
  return invoke<TeamTask>("get_team_task", { teamName, taskId });
}

export async function getTeamInbox(
  teamName: string,
  agentName: string,
): Promise<TeamInboxMessage[]> {
  dbg("api", "getTeamInbox", { teamName, agentName });
  return invoke<TeamInboxMessage[]>("get_team_inbox", { teamName, agentName });
}

export async function getAllTeamInboxes(name: string): Promise<TeamInboxMessage[]> {
  dbg("api", "getAllTeamInboxes", name);
  return invoke<TeamInboxMessage[]>("get_all_team_inboxes", { name });
}

export async function deleteTeam(name: string): Promise<void> {
  dbg("api", "deleteTeam", name);
  return invoke<void>("delete_team", { name });
}

// ── Team Runs (MiWarp orchestration) ──

export async function listTeamPresets(): Promise<TeamPreset[]> {
  dbg("api", "listTeamPresets");
  return invoke<TeamPreset[]>("list_team_presets");
}

export async function createTeamRun(
  presetId: string,
  prompt: string,
  cwd: string,
  sourceRunId?: string,
  mode?: string,
): Promise<TeamRun> {
  dbg("api", "createTeamRun", { presetId, prompt: prompt.slice(0, 60), cwd, mode });
  return invoke<TeamRun>("create_team_run", {
    presetId,
    prompt,
    cwd,
    sourceRunId: sourceRunId ?? null,
    mode: mode ?? null,
  });
}

export async function listTeamRuns(): Promise<TeamRun[]> {
  dbg("api", "listTeamRuns");
  return invoke<TeamRun[]>("list_team_runs");
}

export async function getTeamRun(id: string): Promise<TeamRun> {
  dbg("api", "getTeamRun", id);
  return invoke<TeamRun>("get_team_run", { id });
}

export async function cancelTeamRun(id: string): Promise<TeamRun> {
  dbg("api", "cancelTeamRun", id);
  return invoke<TeamRun>("cancel_team_run", { id });
}

export async function updateTeamRunStatus(
  id: string,
  status: string,
  summary?: string,
  error?: string,
): Promise<TeamRun> {
  dbg("api", "updateTeamRunStatus", { id, status });
  return invoke<TeamRun>("update_team_run_status", {
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
): Promise<TeamRun> {
  dbg("api", "updateTeamMemberRun", { teamRunId, memberId, status });
  return invoke<TeamRun>("update_team_member_run", {
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
): Promise<TeamRun> {
  dbg("api", "setTeamRunLead", { id, leadRunId });
  return invoke<TeamRun>("set_team_run_lead", {
    id,
    leadRunId,
    leadPlan: leadPlan ?? null,
  });
}

export async function setTeamMemberTask(
  teamRunId: string,
  memberId: string,
  task: string,
): Promise<TeamRun> {
  dbg("api", "setTeamMemberTask", { teamRunId, memberId });
  return invoke<TeamRun>("set_team_member_task", {
    teamRunId,
    memberId,
    task,
  });
}
