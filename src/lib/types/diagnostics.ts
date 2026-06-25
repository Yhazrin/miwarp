export type DiagnosticsSeverity = "info" | "warning" | "error" | "critical";

export type DiagnosticsCategory =
  | "runtime_health"
  | "session_health"
  | "trace"
  | "performance"
  | "export";

export interface DiagnosticsEvent {
  id: string;
  timestamp: string;
  category: DiagnosticsCategory;
  severity: DiagnosticsSeverity;
  title: string;
  detail?: string | null;
  source?: string | null;
  span_id?: string | null;
  trace_id?: string | null;
  run_id?: string | null;
  task_id?: string | null;
}

export interface DiagnosticsBundle {
  id: string;
  created_at: string;
  size_bytes: number;
  redacted_fields: string[];
  destination: string;
}

export interface DiagnosticsSnapshot {
  generated_at: string;
  runtime_health: "healthy" | "degraded" | "unhealthy" | "unknown";
  session_health: "healthy" | "degraded" | "unhealthy" | "unknown";
  last_diagnostic_at?: string | null;
  performance_p50_ms?: number | null;
  performance_p95_ms?: number | null;
  performance_p99_ms?: number | null;
}

export interface DiagnosticsFilter {
  category?: DiagnosticsCategory | "all";
  severity?: DiagnosticsSeverity | "all";
  search?: string;
}
