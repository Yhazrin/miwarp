export type { VisualBlockKind, VisualBlockSpec, VisualBlockTone, VisualParseResult } from "./types";
export { VISUAL_LIMITS } from "./limits";
export { resolveVisualBlockLang, isVisualBlockLang, VISUAL_SUMMARY_I18N_KEYS } from "./registry";
export { parseVisualBlock, isValidVisualBlock } from "./parse";
export {
  validateSourceText,
  validateMermaidSource,
  sanitizeMermaidForRender,
  sanitizeMermaidSvg,
  validateJsonValue,
} from "./security";
export { renderCodeBlockHtml, buildVisualBlockPlaceholder } from "./render-placeholder";
export { mountVisualBlocks } from "./mount-visual-blocks";
export {
  extractCompletedVisualFences,
  computeVisualBlockSignature,
  isEligibleStreamingVisualBlock,
  type StreamingContentSegment,
  type StreamingTextSegment,
  type StreamingVisualSegment,
} from "./extract-completed-visual-fences";
