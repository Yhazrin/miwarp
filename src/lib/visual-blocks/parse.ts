import { VISUAL_LIMITS } from "./limits";
import {
  containsExternalMarkdownImage,
  validateJsonValue,
  validateMermaidSource,
  validateSourceText,
} from "./security";
import type {
  KpiItemStatus,
  KpiTrend,
  MiwarpKpiSpec,
  MiwarpProgressSpec,
  MiwarpTimelineSpec,
  ProgressItemStatus,
  TimelineItemState,
  VisualBlockKind,
  VisualBlockSpec,
  VisualParseResult,
} from "./types";

const PROGRESS_STATUS_ALIASES: Record<string, ProgressItemStatus> = {
  pending: "pending",
  active: "active",
  done: "done",
  failed: "failed",
  in_progress: "active",
  inprogress: "active",
  running: "active",
  completed: "done",
  complete: "done",
  success: "done",
  error: "failed",
};

const KPI_TRENDS = new Set<KpiTrend>(["up", "down", "flat"]);
const KPI_STATUSES = new Set<KpiItemStatus>(["success", "warning", "error", "neutral"]);

const TIMELINE_STATE_ALIASES: Record<string, TimelineItemState> = {
  pending: "pending",
  active: "active",
  done: "done",
  failed: "failed",
  in_progress: "active",
  inprogress: "active",
  running: "active",
  completed: "done",
  complete: "done",
  success: "done",
  error: "failed",
};

function parseJsonObject(
  source: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, reason: "empty_source" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "json_not_object" };
  }
  const walked = validateJsonValue(parsed);
  if (!walked.ok) return { ok: false, reason: walked.reason };
  return { ok: true, value: parsed as Record<string, unknown> };
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readItemsArray(value: Record<string, unknown>, keys: string[]): unknown[] | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return undefined;
}

function normalizeProgressStatus(raw: string): ProgressItemStatus {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return PROGRESS_STATUS_ALIASES[key] ?? "pending";
}

function normalizeTimelineState(raw: string): TimelineItemState | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const key = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
  return TIMELINE_STATE_ALIASES[key];
}

function readProgressValue(record: Record<string, unknown>): number | undefined {
  const raw = record.progress ?? record.value ?? record.percent;
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || Number.isNaN(raw)) {
    throw new Error("progress_value_invalid");
  }
  return Math.max(0, Math.min(100, raw));
}

function parseProgressSpec(source: string): VisualParseResult {
  const json = parseJsonObject(source);
  if (!json.ok) return { ok: false, reason: json.reason };
  const rawItems = readItemsArray(json.value, ["items", "steps", "tasks"]);
  if (!rawItems || rawItems.length === 0) {
    return { ok: false, reason: "progress_missing_items" };
  }
  if (rawItems.length > VISUAL_LIMITS.MAX_PROGRESS_ITEMS) {
    return { ok: false, reason: "progress_too_many_items" };
  }
  const items = rawItems.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`progress_item_${index}`);
    }
    const record = item as Record<string, unknown>;
    const label = asString(record.label ?? record.name ?? record.title).trim();
    if (!label) throw new Error(`progress_label_${index}`);
    const status = normalizeProgressStatus(asString(record.status, "pending"));
    const progress = readProgressValue(record);
    const detail = asString(record.detail ?? record.description).trim() || undefined;
    return { label, status, progress, detail };
  });

  const spec: MiwarpProgressSpec = {
    title: asString(json.value.title).trim() || undefined,
    summary: asString(json.value.summary ?? json.value.subtitle).trim() || undefined,
    items,
  };
  return { ok: true, block: { kind: "miwarp-progress", spec } };
}

function parseKpiSpec(source: string): VisualParseResult {
  const json = parseJsonObject(source);
  if (!json.ok) return { ok: false, reason: json.reason };
  const rawItems = readItemsArray(json.value, ["items", "metrics", "kpis"]);
  if (!rawItems || rawItems.length === 0) {
    return { ok: false, reason: "kpi_missing_items" };
  }
  if (rawItems.length > VISUAL_LIMITS.MAX_KPI_ITEMS) {
    return { ok: false, reason: "kpi_too_many_items" };
  }
  const items = rawItems.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`kpi_item_${index}`);
    }
    const record = item as Record<string, unknown>;
    const label = asString(record.label ?? record.name).trim();
    const rawValue = record.value;
    const value =
      typeof rawValue === "number" && !Number.isNaN(rawValue)
        ? String(rawValue)
        : asString(rawValue).trim();
    if (!label || !value) throw new Error(`kpi_required_${index}`);
    const trendRaw = asString(record.trend).trim();
    const trend = KPI_TRENDS.has(trendRaw as KpiTrend) ? (trendRaw as KpiTrend) : undefined;
    const detail = asString(record.detail ?? record.delta ?? record.subtitle).trim() || undefined;
    const statusRaw = asString(record.status).trim();
    const status = KPI_STATUSES.has(statusRaw as KpiItemStatus)
      ? (statusRaw as KpiItemStatus)
      : undefined;
    return { label, value, trend, detail, status };
  });

  const spec: MiwarpKpiSpec = {
    title: asString(json.value.title).trim() || undefined,
    items,
  };
  return { ok: true, block: { kind: "miwarp-kpi", spec } };
}

function parseTimelineSpec(source: string): VisualParseResult {
  const json = parseJsonObject(source);
  if (!json.ok) return { ok: false, reason: json.reason };
  const rawItems = readItemsArray(json.value, ["items", "events", "milestones"]);
  if (!rawItems || rawItems.length === 0) {
    return { ok: false, reason: "timeline_missing_items" };
  }
  if (rawItems.length > VISUAL_LIMITS.MAX_TIMELINE_ITEMS) {
    return { ok: false, reason: "timeline_too_many_items" };
  }
  const items = rawItems.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`timeline_item_${index}`);
    }
    const record = item as Record<string, unknown>;
    const title = asString(record.title ?? record.label ?? record.name).trim();
    if (!title) throw new Error(`timeline_title_${index}`);
    const date = asString(record.date ?? record.time ?? record.timestamp).trim() || undefined;
    const stateRaw = asString(record.state ?? record.status).trim();
    const state = stateRaw ? normalizeTimelineState(stateRaw) : undefined;
    const detail = asString(record.detail ?? record.description).trim() || undefined;
    return { title, date, state, detail };
  });

  const spec: MiwarpTimelineSpec = {
    title: asString(json.value.title).trim() || undefined,
    items,
  };
  return { ok: true, block: { kind: "miwarp-timeline", spec } };
}

function parseVegaLiteSpec(source: string): VisualParseResult {
  const json = parseJsonObject(source);
  if (!json.ok) return { ok: false, reason: json.reason };
  if (!("$schema" in json.value) && !("mark" in json.value) && !("layer" in json.value)) {
    return { ok: false, reason: "vega_missing_mark" };
  }
  return { ok: true, block: { kind: "vega-lite", spec: json.value } };
}

function parseMermaidSpec(source: string): VisualParseResult {
  const check = validateMermaidSource(source);
  if (!check.ok) return { ok: false, reason: check.reason };
  return { ok: true, block: { kind: "mermaid", source } };
}

/** Parse and validate a fenced visual block. Invalid specs return `{ ok: false }`. */
export function parseVisualBlock(kind: VisualBlockKind, source: string): VisualParseResult {
  const base = validateSourceText(source);
  if (!base.ok) return { ok: false, reason: base.reason };
  if (containsExternalMarkdownImage(source)) {
    return { ok: false, reason: "external_image" };
  }

  try {
    switch (kind) {
      case "mermaid":
        return parseMermaidSpec(source);
      case "vega-lite":
        return parseVegaLiteSpec(source);
      case "miwarp-progress":
        return parseProgressSpec(source);
      case "miwarp-kpi":
        return parseKpiSpec(source);
      case "miwarp-timeline":
        return parseTimelineSpec(source);
      default:
        return { ok: false, reason: "unknown_kind" };
    }
  } catch {
    return { ok: false, reason: "schema_invalid" };
  }
}

export function isValidVisualBlock(kind: VisualBlockKind, source: string): boolean {
  return parseVisualBlock(kind, source).ok;
}

export type { VisualBlockSpec };
