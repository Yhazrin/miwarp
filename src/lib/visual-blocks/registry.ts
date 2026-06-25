import type { MessageKey } from "$lib/i18n/types";
import type { VisualBlockKind } from "./types";

const LANG_ALIASES: Record<string, VisualBlockKind> = {
  mermaid: "mermaid",
  "vega-lite": "vega-lite",
  vegalite: "vega-lite",
  vega: "vega-lite",
  "miwarp-progress": "miwarp-progress",
  progress: "miwarp-progress",
  "miwarp-kpi": "miwarp-kpi",
  kpi: "miwarp-kpi",
  "miwarp-timeline": "miwarp-timeline",
  timeline: "miwarp-timeline",
  "miwarp-mindmap": "miwarp-mindmap",
  mindmap: "miwarp-mindmap",
  "mind-map": "miwarp-mindmap",
};

/** Map a fenced-code language tag to a visual block kind, if supported. */
export function resolveVisualBlockLang(lang: string | undefined | null): VisualBlockKind | null {
  if (!lang) return null;
  const normalized = lang.trim().toLowerCase();
  return LANG_ALIASES[normalized] ?? null;
}

export function isVisualBlockLang(lang: string | undefined | null): boolean {
  return resolveVisualBlockLang(lang) !== null;
}

export const VISUAL_SUMMARY_I18N_KEYS = {
  mermaid: "visual_block_mermaid_summary",
  "vega-lite": "visual_block_vega_summary",
  "miwarp-progress": "visual_block_progress_summary",
  "miwarp-kpi": "visual_block_kpi_summary",
  "miwarp-timeline": "visual_block_timeline_summary",
  "miwarp-mindmap": "visual_block_mindmap_summary",
} as const satisfies Record<VisualBlockKind, MessageKey>;

export type VisualSummaryKey = (typeof VISUAL_SUMMARY_I18N_KEYS)[VisualBlockKind];
