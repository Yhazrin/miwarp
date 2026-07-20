// teams API functions
// Auto-generated from api.ts

import { getTransport } from "../transport";
import { dbg } from "../utils/debug";
import { CMD, type CmdName } from "../tauri-commands";

function invoke<T>(cmd: CmdName | string, args?: Record<string, unknown>): Promise<T> {
  return getTransport().invoke<T>(cmd, args);
}
import type { TeamSummary, TeamConfig, TeamTask, TeamInboxMessage } from "../types";
import type {} from "../runtime-control-plane/types";
import type {} from "../types/task";
import type {} from "../types/run-journal";
import type {} from "../types/attention-queue";

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

export async function listTeamPresets(): Promise<import("../types").TeamPreset[]> {
  dbg("api", "listTeamPresets");
  return invoke<import("../types").TeamPreset[]>(CMD.list_team_presets);
}

export async function createTeamRun(
  presetId: string,
  prompt: string,
  cwd: string,
  sourceRunId?: string,
  mode?: string,
): Promise<import("../types").TeamRun> {
  dbg("api", "createTeamRun", { presetId, prompt: prompt.slice(0, 60), cwd, mode });
  return invoke<import("../types").TeamRun>(CMD.create_team_run, {
    presetId,
    prompt,
    cwd,
    sourceRunId: sourceRunId ?? null,
    mode: mode ?? null,
  });
}

export async function listTeamRuns(): Promise<import("../types").TeamRun[]> {
  dbg("api", "listTeamRuns");
  return invoke<import("../types").TeamRun[]>(CMD.list_team_runs);
}

export async function getTeamRun(id: string): Promise<import("../types").TeamRun> {
  dbg("api", "getTeamRun", id);
  return invoke<import("../types").TeamRun>(CMD.get_team_run, { id });
}

export async function cancelTeamRun(id: string): Promise<import("../types").TeamRun> {
  dbg("api", "cancelTeamRun", id);
  return invoke<import("../types").TeamRun>(CMD.cancel_team_run, { id });
}

export async function updateTeamRunStatus(
  id: string,
  status: string,
  summary?: string,
  error?: string,
): Promise<import("../types").TeamRun> {
  dbg("api", "updateTeamRunStatus", { id, status });
  return invoke<import("../types").TeamRun>(CMD.update_team_run_status, {
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
): Promise<import("../types").TeamRun> {
  dbg("api", "updateTeamMemberRun", { teamRunId, memberId, status });
  return invoke<import("../types").TeamRun>(CMD.update_team_member_run, {
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
): Promise<import("../types").TeamRun> {
  dbg("api", "setTeamRunLead", { id, leadRunId });
  return invoke<import("../types").TeamRun>(CMD.set_team_run_lead, {
    id,
    leadRunId,
    leadPlan: leadPlan ?? null,
  });
}

export async function setTeamMemberTask(
  teamRunId: string,
  memberId: string,
  task: string,
): Promise<import("../types").TeamRun> {
  dbg("api", "setTeamMemberTask", { teamRunId, memberId });
  return invoke<import("../types").TeamRun>(CMD.set_team_member_task, {
    teamRunId,
    memberId,
    task,
  });
}
