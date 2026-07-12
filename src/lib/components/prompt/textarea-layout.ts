/**
 * Pure layout policy for the chat composer.
 *
 * The DOM code owns measuring a textarea; this module decides when that
 * measurement changes the composer mode. Keeping the expanded mode until the
 * draft is cleared is intentional: the expanded textarea is wider than the
 * capsule, so immediately re-evaluating the same text against the wider
 * layout would otherwise cause a capsule ↔ composer loop.
 */
export const CAPSULE_LINE_HEIGHT_PX = 24;
export const MAX_COMPOSER_CONTENT_HEIGHT_PX = 4 * CAPSULE_LINE_HEIGHT_PX;

export interface TextareaLayoutInput {
  contentHeight: number;
  hasNewline: boolean;
  hasText: boolean;
  isExpanded: boolean;
  pendingPermission: boolean;
}

export interface TextareaLayout {
  expanded: boolean;
  contentHeight: number;
}

export function resolveTextareaLayout(input: TextareaLayoutInput): TextareaLayout {
  const contentHeight = Math.max(0, input.contentHeight);
  const expanded =
    input.pendingPermission ||
    input.hasNewline ||
    (input.isExpanded && input.hasText) ||
    contentHeight > CAPSULE_LINE_HEIGHT_PX;

  return {
    expanded,
    contentHeight: expanded
      ? Math.min(Math.max(contentHeight, CAPSULE_LINE_HEIGHT_PX), MAX_COMPOSER_CONTENT_HEIGHT_PX)
      : CAPSULE_LINE_HEIGHT_PX,
  };
}
