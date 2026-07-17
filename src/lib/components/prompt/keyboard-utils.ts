/**
 * Pure keyboard utility functions extracted from PromptInput.svelte.
 * These handle detection and stripping of private-use and control characters
 * that appear in keyboard events from various platforms.
 */

const PRIVATE_USE_KEYBOARD_MIN = 0xf700;
const PRIVATE_USE_KEYBOARD_MAX = 0xf8ff;
;

export function isPrivateUseKeyboardChar(ch: string): boolean {
  if (!ch) return false;
  const cp = ch.codePointAt(0)!;
  return cp >= PRIVATE_USE_KEYBOARD_MIN && cp <= PRIVATE_USE_KEYBOARD_MAX;
}

function isStrippedKeyboardChar(ch: string): boolean {
  if (ch === "\n" || ch === "\t") return false;
  const cp = ch.codePointAt(0)!;
  if (cp < 0x20) return true;
  if (cp >= 0x7f && cp <= 0x9f) return true;
  if (cp >= PRIVATE_USE_KEYBOARD_MIN && cp <= PRIVATE_USE_KEYBOARD_MAX) return true;
  return false;
}

export function formatCodePoints(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    out.push(`U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
  }
  return out;
}

function hasAnsiArrowEscape(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /\x1b\[[ABCD]/.test(text);
}

export function hasKeyboardControlChars(text: string): boolean {
  if (hasAnsiArrowEscape(text)) return true;
  for (const ch of text) {
    if (isStrippedKeyboardChar(ch)) return true;
  }
  return false;
}

export function mapIndexAfterStrip(raw: string, index: number): number {
  let cleanPos = 0;
  let i = 0;
  while (i < raw.length && i < index) {
    if (
      raw.charCodeAt(i) === 0x1b &&
      i + 2 < raw.length &&
      raw[i + 1] === "[" &&
      "ABCD".includes(raw[i + 2])
    ) {
      i += 3;
      continue;
    }
    const cp = raw.codePointAt(i)!;
    const chLen = cp > 0xffff ? 2 : 1;
    const ch = raw.slice(i, i + chLen);
    if (!isStrippedKeyboardChar(ch)) cleanPos += chLen;
    i += chLen;
  }
  return cleanPos;
}

export function stripKeyboardControlChars(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (
      text.charCodeAt(i) === 0x1b &&
      i + 2 < text.length &&
      text[i + 1] === "[" &&
      "ABCD".includes(text[i + 2])
    ) {
      i += 3;
      continue;
    }
    const cp = text.codePointAt(i)!;
    const chLen = cp > 0xffff ? 2 : 1;
    const ch = text.slice(i, i + chLen);
    if (!isStrippedKeyboardChar(ch)) out += ch;
    i += chLen;
  }
  return out;
}
