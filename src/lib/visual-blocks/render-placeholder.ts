import { escapeHtml } from "$lib/utils/ansi";
import { hljs } from "$lib/utils/hljs-init";
import { parseVisualBlock } from "./parse";
import { VISUAL_SUMMARY_I18N_KEYS } from "./registry";
import type { VisualBlockKind } from "./types";

/** Shared code-block HTML used for fallback and non-visual fences. */
export function renderCodeBlockHtml(text: string, lang: string): string {
  const language = lang || "";
  let highlighted: string;

  if (language && hljs.getLanguage(language)) {
    try {
      highlighted = hljs.highlight(text, { language }).value;
    } catch {
      highlighted = escapeHtml(text);
    }
  } else {
    highlighted = escapeHtml(text);
  }

  const displayLang = language || "text";
  const lineCount = text.split("\n").length;
  const collapsible = lineCount > 15;
  const lineBadge = collapsible ? `<span class="code-block-lines">${lineCount} lines</span>` : "";
  const collapsibleAttr = collapsible ? ' data-collapsible="true"' : "";

  return `<div class="code-block"${collapsibleAttr}><div class="code-block-header"><span class="code-block-lang">${escapeHtml(displayLang)}</span>${lineBadge}<button class="code-block-copy" data-code-copy type="button">${escapeHtml("Copy")}</button></div><pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre></div>`;
}

/**
 * Emit a visual-block host placeholder with an embedded raw fallback code block.
 * Invalid specs fall back to a plain code block only.
 */
export function buildVisualBlockPlaceholder(opts: {
  kind: VisualBlockKind;
  source: string;
  lang: string;
}): string {
  const parsed = parseVisualBlock(opts.kind, opts.source);
  if (!parsed.ok) {
    return renderCodeBlockHtml(opts.source, opts.lang);
  }

  const fallback = renderCodeBlockHtml(opts.source, opts.lang);
  const summaryKey = VISUAL_SUMMARY_I18N_KEYS[opts.kind];

  return `<div class="visual-block-host" data-visual-block data-visual-kind="${escapeHtml(opts.kind)}" data-visual-summary-key="${escapeHtml(summaryKey)}" role="figure" aria-label="visualization"><pre class="visual-block-source" hidden aria-hidden="true">${escapeHtml(opts.source)}</pre><div class="visual-block-mount"></div><div class="visual-block-fallback">${fallback}</div></div>`;
}
