/**
 * Sanitize user-visible prompt text: strip C0/C1 control characters that can appear
 * when WebView or CLI transcripts inject garbage (e.g. ArrowRight mis-reported as \x1d).
 */
export function sanitizePromptText(text: string): string {
  let out = "";
  for (const ch of text) {
    if (ch === "\n" || ch === "\t") {
      out += ch;
      continue;
    }
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20) continue;
    if (cp >= 0x7f && cp <= 0x9f) continue;
    out += ch;
  }
  return out;
}

export function containsDisallowedPromptControls(text: string): boolean {
  return sanitizePromptText(text) !== text;
}

/** True when the key would move the caret, not insert a printable character. */
export function isPromptNavigationKey(e: KeyboardEvent): boolean {
  if (
    e.key === "ArrowLeft" ||
    e.key === "ArrowRight" ||
    e.key === "ArrowUp" ||
    e.key === "ArrowDown" ||
    e.key === "Home" ||
    e.key === "End" ||
    e.key === "PageUp" ||
    e.key === "PageDown"
  ) {
    return true;
  }
  const code = e.keyCode || e.which;
  return code >= 37 && code <= 40;
}

/**
 * WebKit/Tauri sometimes reports ArrowRight as a C0 control char (e.g. U+001D).
 * Returns the intended navigation direction when detected.
 */
export function misencodedNavigationDirection(
  e: KeyboardEvent,
): "left" | "right" | "up" | "down" | null {
  if (isPromptNavigationKey(e) && e.key.length > 1) {
    if (e.key === "ArrowLeft") return "left";
    if (e.key === "ArrowRight") return "right";
    if (e.key === "ArrowUp") return "up";
    if (e.key === "ArrowDown") return "down";
  }

  if (e.key.length !== 1) return null;
  const cp = e.key.charCodeAt(0);
  if (cp >= 0x20) return null;

  const code = e.keyCode || e.which;
  if (code === 37 || cp === 0x1c) return "left";
  if (code === 39 || cp === 0x1d) return "right";
  if (code === 38 || cp === 0x1e) return "up";
  if (code === 40 || cp === 0x1f) return "down";
  return null;
}

export function moveTextareaCaret(
  el: HTMLTextAreaElement,
  direction: "left" | "right" | "up" | "down",
): void {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? start;
  const value = el.value;

  if (direction === "left") {
    const next = Math.max(0, start - 1);
    el.selectionStart = el.selectionEnd = end === start ? next : start;
    return;
  }
  if (direction === "right") {
    const next = Math.min(value.length, start + 1);
    el.selectionStart = el.selectionEnd = end === start ? next : end;
    return;
  }

  // up/down: only move between lines when value has hard newlines
  const before = value.slice(0, start);
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineEndIdx = value.indexOf("\n", start);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const col = start - lineStart;

  if (direction === "up") {
    if (lineStart === 0) return;
    const prevLineStart = value.lastIndexOf("\n", lineStart - 2) + 1;
    const prevLineLen = lineStart - 1 - prevLineStart;
    const next = prevLineStart + Math.min(col, prevLineLen);
    el.selectionStart = el.selectionEnd = next;
    return;
  }

  if (lineEnd >= value.length) return;
  const nextLineEndIdx = value.indexOf("\n", lineEnd + 1);
  const nextLineEnd = nextLineEndIdx === -1 ? value.length : nextLineEndIdx;
  const nextLineLen = nextLineEnd - (lineEnd + 1);
  const next = lineEnd + 1 + Math.min(col, nextLineLen);
  el.selectionStart = el.selectionEnd = next;
}
