import { Marked, type Token } from "marked";
import { escapeHtml } from "$lib/utils/ansi";
import { perfMark } from "$lib/utils/perf";
import { hljs } from "$lib/utils/hljs-init";
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
      let highlighted: string;

      if (language && hljs.getLanguage(language)) {
        try {
          highlighted = hljs.highlight(text, { language }).value;
        } catch {
          highlighted = escapeHtml(text);
        }
      } else {
        // Skip highlightAuto() — it tries all ~190 languages synchronously
        // and can freeze the UI for seconds on large code blocks
        highlighted = escapeHtml(text);
      }

      const displayLang = language || "text";
      const lineCount = text.split("\n").length;
      const collapsible = lineCount > 15;
      const lineBadge = collapsible
        ? `<span class="code-block-lines">${lineCount} lines</span>`
        : "";
      const collapsibleAttr = collapsible ? ' data-collapsible="true"' : "";

      return `<div class="code-block"${collapsibleAttr}><div class="code-block-header"><span class="code-block-lang">${escapeHtml(displayLang)}</span>${lineBadge}<button class="code-block-copy" data-code-copy>Copy</button></div><pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre></div>`;
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
        ADD_ATTR: ["class", "target", "data-code-copy", "data-collapsible", "id"],
      });
    },
    { chars: text.length, codeFenceCount: text.match(/```/g)?.length ?? 0 },
  );
}
