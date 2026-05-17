import type { UsageState } from "$lib/stores/types";
import type { McpServerInfo, RunStatus, SessionInfoData, TaskRun } from "$lib/types";

export function aggregateCumulativeTokens(usage: UsageState): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
} {
  const mu = usage.modelUsage;
  if (!mu || Object.keys(mu).length === 0) {
    return {
      input: usage.inputTokens,
      output: usage.outputTokens,
      cacheRead: usage.cacheReadTokens,
      cacheWrite: usage.cacheWriteTokens,
    };
  }
  let input = 0,
    output = 0,
    cacheRead = 0,
    cacheWrite = 0;
  for (const entry of Object.values(mu)) {
    input += entry.input_tokens;
    output += entry.output_tokens;
    cacheRead += entry.cache_read_tokens;
    cacheWrite += entry.cache_write_tokens;
  }
  return { input, output, cacheRead, cacheWrite };
}

/** Read-only snapshot for Session Info panel — no store references. */
export interface SessionInfoSelectorInput {
  run: TaskRun;
  sessionCwd: string;
  numTurns: number;
  durationMs: number;
  model: string;
  agent: string;
  cliVersion: string;
  permissionMode: string;
  fastModeState: string;
  cost: number;
  cumulative: ReturnType<typeof aggregateCumulativeTokens>;
  usage: UsageState;
  contextWindow: number;
  contextUtilization: number;
  compactCount: number;
  microcompactCount: number;
  mcpServers: McpServerInfo[];
  remoteHostName?: string | null;
  platformId?: string | null;
  authSourceLabel?: string | null;
  platformName?: string | undefined;
  cliUpdateAvailable?: string | undefined;
}

export function buildSessionInfoData(input: SessionInfoSelectorInput): SessionInfoData {
  const { run, cumulative, usage, ...rest } = input;
  const status = (run.status ?? "pending") as RunStatus;
  return {
    sessionId: run.session_id,
    runId: run.id,
    runName: run.name,
    cwd: rest.sessionCwd || run.cwd,
    numTurns: rest.numTurns,
    status,
    startedAt: run.started_at ?? null,
    endedAt: run.ended_at ?? null,
    lastTurnDurationMs: rest.durationMs,
    tokensEstimated: !usage.modelUsage || Object.keys(usage.modelUsage).length === 0,
    model: run.model ?? rest.model,
    agent: run.agent ?? rest.agent,
    cliVersion: rest.cliVersion,
    permissionMode: rest.permissionMode,
    fastModeState: rest.fastModeState,
    cost: rest.cost,
    inputTokens: cumulative.input,
    outputTokens: cumulative.output,
    cacheReadTokens: cumulative.cacheRead,
    cacheWriteTokens: cumulative.cacheWrite,
    contextWindow: rest.contextWindow,
    contextUtilization: rest.contextUtilization,
    compactCount: rest.compactCount,
    microcompactCount: rest.microcompactCount,
    mcpServers: rest.mcpServers,
    remoteHostName: rest.remoteHostName,
    platformId: rest.platformId,
    cliUsageIncomplete: run.cli_usage_incomplete ?? false,
    runSource: run.source,
    authSourceLabel: rest.authSourceLabel || undefined,
    platformName: rest.platformName,
    cliUpdateAvailable: rest.cliUpdateAvailable,
  };
}
