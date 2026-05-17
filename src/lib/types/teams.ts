// ── Team types (mirror Rust models.rs) ──

export interface TeamConfig {
  name: string;
  description: string;
  /** camelCase from serde rename */
  createdAt: number;
  leadAgentId: string;
  leadSessionId: string;
  members: TeamMember[];
}

export interface TeamMember {
  agentId: string;
  name: string;
  agentType: string;
  model: string;
  color: string;
  planModeRequired: boolean;
  joinedAt: number;
  tmuxPaneId: string;
  cwd: string;
  subscriptions: string[];
  backendType: string;
  /** The prompt given to spawned teammates (empty for leader) */
  prompt: string;
  /** Runtime active status from Claude Code SDK */
  isActive: boolean;
}

export interface TeamInboxMessage {
  from: string;
  text: string;
  summary: string;
  timestamp: string;
  color: string;
  read: boolean;
}

export interface TeamTask {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  owner: string;
  status: string;
  blocks: string[];
  blockedBy: string[];
  metadata?: unknown;
}

export interface TeamSummary {
  name: string;
  description: string;
  /** snake_case — internal type, not deserialized from Claude Code files */
  member_count: number;
  task_count: number;
  created_at: number;
}

// ── Team Run types ──
// MiWarp's own team orchestration (stored in ~/.miwarp/team-runs/)

export type TeamRunStatus =
  | "created"
  | "planning"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type TeamMemberRunStatus = "pending" | "running" | "completed" | "failed";

export interface TeamPresetMember {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  defaultModel?: string;
}

export interface TeamPreset {
  id: string;
  name: string;
  description: string;
  members: TeamPresetMember[];
}

export interface TeamMemberRun {
  id: string;
  memberId: string;
  memberName: string;
  role: string;
  task: string;
  status: TeamMemberRunStatus;
  runId?: string;
  summary?: string;
  error?: string;
}

export interface TeamRun {
  id: string;
  teamName: string;
  presetId: string;
  cwd: string;
  sourceRunId?: string;
  prompt: string;
  mode: string;
  status: TeamRunStatus;
  memberRuns: TeamMemberRun[];
  summary?: string;
  error?: string;
  leadRunId?: string;
  leadPlan?: string;
  createdAt: string;
  updatedAt: string;
}
