import { VISUAL_LIMITS } from "./limits";
import { isValidVisualBlock } from "./parse";
import { resolveVisualBlockLang } from "./registry";
import type { VisualBlockKind } from "./types";

export type StreamingTextSegment = {
  type: "text";
  key: string;
  text: string;
};

export type StreamingVisualSegment = {
  type: "visual";
  key: string;
  kind: VisualBlockKind;
  lang: string;
  source: string;
  signature: string;
};

export type StreamingContentSegment = StreamingTextSegment | StreamingVisualSegment;

/** Stable fingerprint for a completed visual block — used to avoid remounting unchanged blocks. */
export function computeVisualBlockSignature(kind: VisualBlockKind, source: string): string {
  return `${kind}:${source.length}:${hashString(source)}`;
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function isLineStart(text: string, index: number): boolean {
  if (index === 0) return true;
  if (text[index - 1] === "\n") return true;
  return text[index - 1] === "\r" && (index < 2 || text[index - 2] === "\n");
}

function findFenceOpen(
  text: string,
  from: number,
): { index: number; lang: string; contentStart: number } | null {
  let searchFrom = from;
  while (searchFrom < text.length) {
    const tick = text.indexOf("```", searchFrom);
    if (tick === -1) return null;
    if (!isLineStart(text, tick)) {
      searchFrom = tick + 3;
      continue;
    }

    const lineBreak = text.indexOf("\n", tick + 3);
    if (lineBreak === -1) {
      return {
        index: tick,
        lang: text.slice(tick + 3).trim(),
        contentStart: text.length,
      };
    }

    const lang = text
      .slice(tick + 3, lineBreak)
      .replace(/\r$/, "")
      .trim();
    return { index: tick, lang, contentStart: lineBreak + 1 };
  }
  return null;
}

function findFenceClose(
  text: string,
  from: number,
): { contentEnd: number; fenceEnd: number } | null {
  let searchFrom = from;
  while (searchFrom < text.length) {
    const tick = text.indexOf("```", searchFrom);
    if (tick === -1) return null;
    if (!isLineStart(text, tick)) {
      searchFrom = tick + 3;
      continue;
    }

    let cursor = tick + 3;
    while (cursor < text.length && (text[cursor] === " " || text[cursor] === "\t")) {
      cursor++;
    }

    if (cursor >= text.length) {
      return { contentEnd: tick, fenceEnd: cursor };
    }

    if (text[cursor] === "\r") {
      const next = cursor + 1;
      if (next < text.length && text[next] === "\n") {
        return { contentEnd: tick, fenceEnd: next + 1 };
      }
      return { contentEnd: tick, fenceEnd: next };
    }

    if (text[cursor] === "\n") {
      return { contentEnd: tick, fenceEnd: cursor + 1 };
    }

    searchFrom = tick + 3;
  }
  return null;
}

/** Whether a closed fence should render as a visual block during streaming (not plain text). */
export function isEligibleStreamingVisualBlock(kind: VisualBlockKind, source: string): boolean {
  if (source.length > VISUAL_LIMITS.MAX_SOURCE_CHARS) return false;
  return isValidVisualBlock(kind, source);
}

function pushTextSegment(
  segments: StreamingContentSegment[],
  textIndex: number,
  text: string,
): number {
  if (text.length === 0) return textIndex;
  segments.push({ type: "text", key: `text-${textIndex}`, text });
  return textIndex + 1;
}

/**
 * Split streaming markdown into plain-text segments and completed visual fenced blocks.
 * Only closed fences with supported languages and valid specs become visual segments.
 * Everything else (including unclosed fences, unsupported langs, oversize/invalid blocks)
 * stays as literal text for safe {@html}-free display.
 */
export function extractCompletedVisualFences(raw: string): StreamingContentSegment[] {
  const segments: StreamingContentSegment[] = [];
  let pos = 0;
  let visualIndex = 0;
  let textIndex = 0;

  while (pos < raw.length) {
    const open = findFenceOpen(raw, pos);
    if (!open) {
      textIndex = pushTextSegment(segments, textIndex, raw.slice(pos));
      break;
    }

    if (open.index > pos) {
      textIndex = pushTextSegment(segments, textIndex, raw.slice(pos, open.index));
    }

    const close = findFenceClose(raw, open.contentStart);
    if (!close) {
      textIndex = pushTextSegment(segments, textIndex, raw.slice(open.index));
      break;
    }

    let source = raw.slice(open.contentStart, close.contentEnd);
    if (source.endsWith("\r\n")) {
      source = source.slice(0, -2);
    } else if (source.endsWith("\n")) {
      source = source.slice(0, -1);
    }
    const fullFenceText = raw.slice(open.index, close.fenceEnd);
    const kind = resolveVisualBlockLang(open.lang);

    if (kind && isEligibleStreamingVisualBlock(kind, source)) {
      const signature = computeVisualBlockSignature(kind, source);
      segments.push({
        type: "visual",
        key: `visual-${visualIndex}-${signature}`,
        kind,
        lang: open.lang,
        source,
        signature,
      });
      visualIndex++;
    } else if (kind && source.length > VISUAL_LIMITS.MAX_SOURCE_CHARS) {
      textIndex = pushTextSegment(segments, textIndex, fullFenceText);
    } else if (kind) {
      // Supported lang but invalid spec — fall back to plain text (not HTML code block).
      textIndex = pushTextSegment(segments, textIndex, fullFenceText);
    } else {
      textIndex = pushTextSegment(segments, textIndex, fullFenceText);
    }

    pos = close.fenceEnd;
  }

  return segments;
}
