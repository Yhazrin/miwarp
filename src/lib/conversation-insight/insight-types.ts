/**
 * Types for the HTML session insight report feature.
 */

export interface InsightContext {
  session: InsightSession;
  messages: InsightMessage[];
  toolCalls: InsightToolCall[];
  fileChanges: InsightFileChange[];
  errors: InsightError[];
  usage: InsightUsage;
  metadata: InsightMetadata;
}

export interface InsightSession {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  agent: string;
  model: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  branch?: string;
  worktreePath?: string;
  parentRunId?: string;
  remoteHostName?: string;
}

export interface InsightMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface InsightToolCall {
  name: string;
  input: string;
  output?: string;
  durationMs?: number;
  success: boolean;
  timestamp: string;
}

export interface InsightFileChange {
  path: string;
  type: "created" | "modified" | "deleted";
  description?: string;
  timestamp?: string;
}

export interface InsightError {
  message: string;
  timestamp: string;
  resolved: boolean;
}

export interface InsightUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  turnCount: number;
}

export interface InsightMetadata {
  toolCallCount: number;
  fileChangeCount: number;
  errorCount: number;
  permissionRequests: number;
}

export interface InsightReport {
  title: string;
  oneSentenceSummary: string;
  background: string;
  goals: string;
  keyDecisions: string[];
  processSteps: ProcessStep[];
  fileImpact: FileImpact[];
  finalResult: string;
  risksAndNextSteps: string[];
  appendix: AppendixSection;
}

export interface ProcessStep {
  phase: string;
  description: string;
  timestamp?: string;
}

export interface FileImpact {
  path: string;
  type: "created" | "modified" | "deleted";
  responsibility: string;
}

export interface AppendixSection {
  toolCallSummary: { name: string; count: number }[];
  keyCommands: string[];
  errorsAndFixes: { error: string; fix: string }[];
}

export interface InsightCardState {
  status: "idle" | "generating" | "ready" | "error";
  report?: InsightReport;
  html?: string;
  error?: string;
}
