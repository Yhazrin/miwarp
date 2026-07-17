export type SpecStatus =
  | "draft"
  | "clarifying"
  | "planned"
  | "implementing"
  | "verifying"
  | "accepted"
  | "rejected";

export type SpecPriority = "low" | "medium" | "high" | "critical";

export interface SpecAcceptanceCriterion {
  id: string;
  description: string;
  status: "pending" | "pass" | "fail" | "in_progress";
  linked_task_id?: string | null;
  linked_gate?: string | null;
}

export interface SpecPlanStep {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "done";
  linked_task_id?: string | null;
}

interface SpecClarification {
  id: string;
  question: string;
  answer?: string | null;
  answered_at?: string | null;
  answered_by?: string | null;
}

export interface SpecLinkedTask {
  task_id: string;
  role: "primary" | "verification" | "followup";
  status: "pending" | "in_progress" | "done" | "failed";
}

export interface SpecGate {
  id: string;
  name: string;
  verdict: "pending" | "pass" | "fail";
  criteria_ids: string[];
  last_run_at?: string | null;
}

export interface SpecRecord {
  id: string;
  title: string;
  summary: string;
  status: SpecStatus;
  priority: SpecPriority;
  owner?: string | null;
  tags: string[];
  acceptance_criteria: SpecAcceptanceCriterion[];
  plan_steps: SpecPlanStep[];
  clarifications: SpecClarification[];
  linked_tasks: SpecLinkedTask[];
  gates: SpecGate[];
  created_at: string;
  updated_at: string;
}

export interface SpecFilter {
  status?: SpecStatus | "all";
  priority?: SpecPriority | "all";
  search?: string;
}
