export type ArtifactKind =
  | "diff"
  | "file"
  | "plan"
  | "test_report"
  | "screenshot"
  | "mermaid"
  | "vega"
  | "mind_map"
  | "terminal_log"
  | "build"
  | "pr"
  | "diagnostic_bundle"
  | "context_pack";

export interface ArtifactRecord {
  id: string;
  kind: ArtifactKind;
  title: string;
  description?: string | null;
  run_id?: string | null;
  task_id?: string | null;
  workspace_cwd?: string | null;
  content_hash?: string | null;
  size_bytes?: number | null;
  mime_type?: string | null;
  source_uri?: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  tags: string[];
}

export type ArtifactGroupBy = "run" | "kind" | "task";

export interface ArtifactFilter {
  runId?: string | null;
  taskId?: string | null;
  kind?: ArtifactKind | "all";
  search?: string;
  pinnedOnly?: boolean;
}
