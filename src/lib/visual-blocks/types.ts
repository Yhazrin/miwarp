/** Supported fenced-block visualization kinds in chat markdown. */
export type VisualBlockKind =
  | "mermaid"
  | "vega-lite"
  | "miwarp-progress"
  | "miwarp-kpi"
  | "miwarp-timeline"
  | "miwarp-mindmap";

export type VisualBlockTone = "default" | "on-primary";

export type ProgressItemStatus = "pending" | "active" | "done" | "failed";

export interface MiwarpProgressItem {
  label: string;
  status?: ProgressItemStatus;
  /** 0–100 when present */
  progress?: number;
  detail?: string;
}

export interface MiwarpProgressSpec {
  title?: string;
  summary?: string;
  items: MiwarpProgressItem[];
}

export type KpiTrend = "up" | "down" | "flat";
export type KpiItemStatus = "success" | "warning" | "error" | "neutral";

export interface MiwarpKpiItem {
  label: string;
  value: string;
  trend?: KpiTrend;
  detail?: string;
  status?: KpiItemStatus;
}

export interface MiwarpKpiSpec {
  title?: string;
  items: MiwarpKpiItem[];
}

export type TimelineItemState = "pending" | "active" | "done" | "failed";

export interface MiwarpTimelineItem {
  title: string;
  date?: string;
  state?: TimelineItemState;
  detail?: string;
}

export interface MiwarpTimelineSpec {
  title?: string;
  items: MiwarpTimelineItem[];
}

export interface MiwarpMindMapNode {
  id: string;
  label: string;
  children?: MiwarpMindMapNode[];
}

export interface MiwarpMindMapSpec {
  title?: string;
  root: MiwarpMindMapNode;
}

export type VisualBlockSpec =
  | { kind: "mermaid"; source: string }
  | { kind: "vega-lite"; spec: Record<string, unknown> }
  | { kind: "miwarp-progress"; spec: MiwarpProgressSpec }
  | { kind: "miwarp-kpi"; spec: MiwarpKpiSpec }
  | { kind: "miwarp-timeline"; spec: MiwarpTimelineSpec }
  | { kind: "miwarp-mindmap"; spec: MiwarpMindMapSpec };

export type VisualParseResult =
  | { ok: true; block: VisualBlockSpec }
  | { ok: false; reason: string };
