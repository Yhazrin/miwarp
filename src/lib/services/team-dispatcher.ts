/**
 * Team Dispatcher Service
 *
 * Orchestrates TeamRun creation and execution.
 * Handles @team / /team detection, preset selection, and member run dispatch.
 */
import * as api from "$lib/api";
import type { TeamPreset, TeamRun, TeamMemberRun } from "$lib/types";
import { dbg, dbgWarn } from "$lib/utils/debug";

// ── Trigger detection ──

export type TeamTrigger = "@team" | "@团队" | "/team" | "/团队";

export interface TeamTriggerResult {
  prompt: string;
  trigger: TeamTrigger;
}

/** Detect @team / @团队 / /team / /团队 prefix in user input. Returns the prompt and trigger type. */
export function detectTeamTrigger(input: string): TeamTriggerResult | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^(@team|@团队|\/team|\/团队)\s*/i);
  if (!match) return null;
  const prompt = trimmed.slice(match[0].length).trim();
  if (!prompt) return null;
  return { prompt, trigger: match[1] as TeamTrigger };
}

/** Detect @team or @团队 prefix (legacy compat). Returns the prompt text, or null. */
export function detectTeamTag(input: string): string | null {
  const result = detectTeamTrigger(input);
  if (!result) return null;
  // Only match @-prefixed triggers for legacy compat
  return result.trigger.startsWith("@") ? result.prompt : null;
}

/** Strip team trigger prefix from input, returning the clean prompt. */
export function stripTeamTag(input: string): string {
  return input.replace(/^(@team|@团队|\/team|\/团队)\s*/i, "").trim();
}

// ── Natural language hint detection ──

const TEAM_HINT_PATTERNS = [
  /团队处理/,
  /交给团队/,
  /让团队/,
  /team\s+handle/i,
  /dispatch\s+to\s+team/i,
  /ask\s+the\s+team/i,
];

/** Check if input looks like it wants team dispatch but lacks explicit trigger. Returns true if hint should show. */
export function shouldShowTeamHint(input: string): boolean {
  const trimmed = input.trim();
  // Don't hint if already has explicit trigger
  if (detectTeamTrigger(trimmed)) return false;
  return TEAM_HINT_PATTERNS.some((p) => p.test(trimmed));
}

/** Get built-in presets. */
export async function getPresets(): Promise<TeamPreset[]> {
  return api.listTeamPresets();
}

/** Create a TeamRun and return it (does not start execution). */
export async function dispatchTeamRun(input: {
  presetId: string;
  prompt: string;
  cwd: string;
  sourceRunId?: string;
  mode?: string;
}): Promise<TeamRun> {
  const run = await api.createTeamRun(
    input.presetId,
    input.prompt,
    input.cwd,
    input.sourceRunId,
    input.mode,
  );
  dbg("team-dispatch", "dispatchTeamRun created", { id: run.id, preset: input.presetId });
  return run;
}

/**
 * Execute a TeamRun: create a planning run, parse tasks, create member runs.
 *
 * V1 implementation:
 * - Creates a lead planning run that generates task breakdowns
 * - For each member, creates a regular Claude run with system prompt + task
 * - Monitors member run completion via polling
 * - Creates a summary run when all members complete
 *
 * This function runs asynchronously and updates TeamRun state as it progresses.
 */
export async function executeTeamRun(
  teamRun: TeamRun,
  preset: TeamPreset,
  startRunFn: (prompt: string, cwd: string, agent: string) => Promise<{ id: string }>,
  onUpdate?: (run: TeamRun) => void,
): Promise<void> {
  try {
    // Phase 1: Planning
    await api.updateTeamRunStatus(teamRun.id, "planning");
    teamRun.status = "planning";
    onUpdate?.(teamRun);

    const planPrompt = buildPlanPrompt(teamRun.prompt, preset);
    const leadRun = await startRunFn(planPrompt, teamRun.cwd, "claude");
    await api.setTeamRunLead(teamRun.id, leadRun.id);
    teamRun.leadRunId = leadRun.id;
    onUpdate?.(teamRun);

    // Wait for lead run to complete, then extract plan
    const plan = await waitForRunCompletion(leadRun.id);
    const memberTasks = parsePlanForMemberTasks(plan, preset);

    // Update lead plan
    await api.setTeamRunLead(teamRun.id, leadRun.id, plan);
    teamRun.leadPlan = plan;

    // Phase 2: Member execution
    await api.updateTeamRunStatus(teamRun.id, "running");
    teamRun.status = "running";
    onUpdate?.(teamRun);

    // Assign tasks to members
    for (const assignment of memberTasks) {
      await api.setTeamMemberTask(teamRun.id, assignment.memberId, assignment.task);
    }

    // Start all member runs in parallel
    const memberRunPromises = memberTasks.map(async (assignment) => {
      const member = teamRun.memberRuns.find((m) => m.memberId === assignment.memberId);
      if (!member) return;

      try {
        await api.updateTeamMemberRun(teamRun.id, member.memberId, "running");
        member.status = "running";
        onUpdate?.(teamRun);

        const memberPrompt = buildMemberPrompt(assignment, teamRun.cwd);
        const memberRun = await startRunFn(memberPrompt, teamRun.cwd, "claude");
        await api.updateTeamMemberRun(teamRun.id, member.memberId, "running", memberRun.id);
        member.runId = memberRun.id;
        onUpdate?.(teamRun);

        // Wait for member run to complete
        const memberResult = await waitForRunCompletion(memberRun.id);
        await api.updateTeamMemberRun(
          teamRun.id,
          member.memberId,
          "completed",
          memberRun.id,
          memberResult,
        );
        member.status = "completed";
        member.summary = memberResult;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        await api.updateTeamMemberRun(
          teamRun.id,
          member.memberId,
          "failed",
          undefined,
          undefined,
          errMsg,
        );
        member.status = "failed";
        member.error = errMsg;
      }
      onUpdate?.(teamRun);
    });

    await Promise.allSettled(memberRunPromises);

    // Phase 3: Summary
    const allSucceeded = teamRun.memberRuns.every((m) => m.status === "completed");
    const anyFailed = teamRun.memberRuns.some((m) => m.status === "failed");

    if (allSucceeded) {
      const summary = buildLocalSummary(teamRun, preset);
      await api.updateTeamRunStatus(teamRun.id, "completed", summary);
      teamRun.status = "completed";
      teamRun.summary = summary;
    } else if (anyFailed) {
      const summary = buildLocalSummary(teamRun, preset);
      await api.updateTeamRunStatus(teamRun.id, "failed", summary, "Some members failed");
      teamRun.status = "failed";
      teamRun.summary = summary;
    }

    onUpdate?.(teamRun);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await api.updateTeamRunStatus(teamRun.id, "failed", undefined, errMsg);
    teamRun.status = "failed";
    teamRun.error = errMsg;
    onUpdate?.(teamRun);
  }
}

// ── Prompt builders ──

function buildPlanPrompt(userPrompt: string, preset: TeamPreset): string {
  const memberDescriptions = preset.members
    .map((m) => `- ${m.name} (${m.role}): ${m.systemPrompt.slice(0, 100)}...`)
    .join("\n");

  return `You are a project lead planning a team task. The team has these members:
${memberDescriptions}

The user's task is:
"${userPrompt}"

Please analyze this task and create a breakdown for each team member. For each member, specify:
1. What specific subtask they should work on
2. Any dependencies on other members' work

Output your plan as a structured document with clear sections for each member.
Use this format:

## Plan Overview
[Brief overview of the approach]

## Member Tasks

### Architect
[Specific task for the architect]

### Frontend Dev
[Specific task for the frontend developer]

### Backend Dev
[Specific task for the backend developer]

### QA Engineer
[Specific task for the QA engineer]

Be concrete and actionable. Focus on what each person should actually implement.`;
}

function buildMemberPrompt(assignment: { memberId: string; task: string }, cwd: string): string {
  return `You are working on a team project in the directory: ${cwd}

Your specific task:
${assignment.task}

Focus on your assigned task. Be thorough and complete. If you need to coordinate with other team members, document what they need to know in your output.

When you're done, provide a clear summary of what you implemented and any issues encountered.`;
}

// ── Plan parsing ──

interface MemberTaskAssignment {
  memberId: string;
  task: string;
}

function parsePlanForMemberTasks(plan: string, preset: TeamPreset): MemberTaskAssignment[] {
  const assignments: MemberTaskAssignment[] = [];

  for (const member of preset.members) {
    // Try to extract section for this member
    const patterns = [
      new RegExp(`### ${member.name}\\s*\\n([\\s\\S]*?)(?=### |$)`, "i"),
      new RegExp(`## ${member.name}\\s*\\n([\\s\\S]*?)(?=## |$)`, "i"),
      new RegExp(`${member.name}\\s*:?\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i"),
    ];

    let task = "";
    for (const pattern of patterns) {
      const match = plan.match(pattern);
      if (match && match[1]) {
        task = match[1].trim();
        break;
      }
    }

    // Fallback: generate a generic task
    if (!task) {
      task = `Work on the following task as ${member.name} (${member.role}):\n\n${plan.slice(0, 500)}`;
    }

    assignments.push({
      memberId: member.id,
      task,
    });
  }

  return assignments;
}

// ── Run completion polling ──

async function waitForRunCompletion(runId: string, maxWaitMs = 300_000): Promise<string> {
  const startTime = Date.now();
  const pollInterval = 2000;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const run = await api.getRun(runId);
      if (run.status === "completed" || run.status === "failed" || run.status === "stopped") {
        // Try to get the last assistant message as the result
        try {
          const events = await api.getRunEvents(runId, 0);
          const assistantEvents = events.filter((e: { type: string }) => e.type === "assistant");
          if (assistantEvents.length > 0) {
            const lastEvent = assistantEvents[assistantEvents.length - 1];
            const text = lastEvent.payload?.text || lastEvent.payload?.content || "";
            return typeof text === "string" ? text : JSON.stringify(text);
          }
        } catch {
          // Fall through to return status
        }
        return run.status === "completed" ? "Task completed" : `Task ${run.status}`;
      }
    } catch {
      // Run might not exist yet, keep polling
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return "Task timed out after 5 minutes";
}

// ── Summary builder ──

function buildLocalSummary(teamRun: TeamRun, preset: TeamPreset): string {
  const lines: string[] = [];
  lines.push(`# Team Task Summary`);
  lines.push(`**Team:** ${preset.name}`);
  lines.push(`**Task:** ${teamRun.prompt}`);
  lines.push(`**Status:** ${teamRun.status}`);
  lines.push("");

  for (const member of teamRun.memberRuns) {
    const icon = member.status === "completed" ? "✓" : member.status === "failed" ? "✗" : "○";
    lines.push(`## ${icon} ${member.memberName} (${member.role})`);
    if (member.task) {
      lines.push(`**Task:** ${member.task.slice(0, 200)}${member.task.length > 200 ? "..." : ""}`);
    }
    if (member.summary) {
      lines.push(
        `**Result:** ${member.summary.slice(0, 500)}${member.summary.length > 500 ? "..." : ""}`,
      );
    }
    if (member.error) {
      lines.push(`**Error:** ${member.error}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
