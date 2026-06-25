/** Hard limits for visual block parsing — kept in pure TS for testability. */
export const VISUAL_LIMITS = {
  /** Max raw fenced-block source characters. */
  MAX_SOURCE_CHARS: 50_000,
  /** Max JSON object nesting depth. */
  MAX_JSON_DEPTH: 20,
  /** Max items in any array while walking JSON. */
  MAX_ARRAY_ITEMS: 500,
  /** Max keys in any object while walking JSON. */
  MAX_OBJECT_KEYS: 200,
  /** Max non-empty lines in a Mermaid diagram. */
  MAX_MERMAID_LINES: 500,
  MAX_PROGRESS_ITEMS: 50,
  MAX_KPI_ITEMS: 20,
  MAX_TIMELINE_ITEMS: 100,
  MAX_MINDMAP_CHILDREN: 50,
  MAX_MINDMAP_DEPTH: 6,
  /** Collapse visualization panel when content exceeds this height (px). */
  COLLAPSE_HEIGHT_PX: 320,
} as const;
