/**
 * Pure layout policy for the chat composer.
 *
 * The DOM code owns measuring a textarea; this module decides when that
 * measurement changes the composer mode. Keeping the expanded mode until the
 * draft is cleared avoids distracting collapse/expand churn while a user is
 * editing a multi-line draft.
 */
export const CAPSULE_LINE_HEIGHT_PX = 24;
export const MAX_COMPOSER_CONTENT_HEIGHT_PX = 4 * CAPSULE_LINE_HEIGHT_PX;

/**
 * Shared horizontal insets for the composer textarea in BOTH capsule and
 * multi-line modes. Capsule parks permission + send on the right; expanded
 * keeps the same right rail so soft-wrap width does not jump on newline.
 * 11.5rem ≈ 184px clears the compact right cluster with a small gap.
 */
export const COMPOSER_TEXTAREA_INSET_X = "pl-3 pr-[11.5rem]";

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
