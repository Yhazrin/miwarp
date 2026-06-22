import { Marked, type Token } from "marked";
import { escapeHtml } from "$lib/utils/ansi";
import { perfMark } from "$lib/utils/perf";
import {
  buildVisualBlockPlaceholder,
  renderCodeBlockHtml,
} from "$lib/visual-blocks/render-placeholder";
import { resolveVisualBlockLang } from "$lib/visual-blocks/registry";
import DOMPurify from "dompurify";
import "highlight.js/styles/github-dark.min.css";

const marked = new Marked();

marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    // marked v15: table(token) receives a Token with header[] and rows[][]
    table(token: {
      header: Array<{ tokens: Token[]; align: string | null; header: boolean }>;
      rows: Array<Array<{ tokens: Token[]; align: string | null; header: boolean }>>;
    }) {
      // Build header cells
      const headerCells: string[] = [];
      for (const cell of token.header) {
        const content = this.parser.parseInline(cell.tokens);
        const tag = cell.align ? `<th align="${cell.align}">` : "<th>";
        headerCells.push(`${tag}${content}</th>`);
      }
      const headerRow = `<tr>${headerCells.join("")}</tr>`;

      // Build body rows
      const bodyRows: string[] = [];
      for (const row of token.rows) {
        const rowCells: string[] = [];
        for (const cell of row) {
          const content = this.parser.parseInline(cell.tokens);
          const tag = cell.align ? `<td align="${cell.align}">` : "<td>";
          rowCells.push(`${tag}${content}</td>`);
        }
        bodyRows.push(`<tr>${rowCells.join("")}</tr>`);
      }
      const body = bodyRows.length ? `<tbody>${bodyRows.join("")}</tbody>` : "";

      return `<div class="table-wrapper"><table><thead>${headerRow}</thead>${body}</table></div>`;
    },
    code({ text, lang }: { text: string; lang?: string }) {
      const language = lang || "";
      const visualKind = resolveVisualBlockLang(language);
      if (visualKind) {
        return buildVisualBlockPlaceholder({
          kind: visualKind,
          source: text,
          lang: language,
        });
      }
      return renderCodeBlockHtml(text, language);
    },
    // v1.0.6 / 5.4: inject id on headings so TOC anchor links work
    heading({ text: rawText, depth }: { text: string; depth: number }) {
      const text = rawText.replace(/<[^>]+>/g, "").trim();
      const id = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 80);
      return `<h${depth} id="${escapeHtml(id)}">${rawText}</h${depth}>`;
    },
  },
});

export function renderMarkdown(text: string): string {
  return perfMark(
    "md-render",
    () => {
      const raw = marked.parse(text);
      if (typeof raw !== "string") return "";
      return DOMPurify.sanitize(raw, {
        ADD_ATTR: [
          "class",
          "target",
          "data-code-copy",
          "data-collapsible",
          "id",
          "data-visual-block",
          "data-visual-kind",
          "data-visual-summary-key",
          "data-visual-mounted",
          "data-visual-render-state",
          "hidden",
          "aria-hidden",
          "aria-label",
          "role",
        ],
      });
    },
    { chars: text.length, codeFenceCount: text.match(/```/g)?.length ?? 0 },
  );
}
