/**
 * v1.0.6 / 5.4: Extract a table-of-contents outline from markdown text.
 * Parses headings (lines starting with #) and returns a flat list
 * with nesting level for sidebar/TOC display.
 */

export interface TocEntry {
  id: string;
  text: string;
  level: number; // 1-6
  line: number;
}

/**
 * Extract headings from markdown text.
 * Returns a flat array of TocEntry sorted by appearance.
 */
export function extractToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const lines = markdown.split(/\r?\n/);
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Toggle code block state
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].replace(/[*_`~[\]]/g, "").trim();
      const id = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 80);

      entries.push({ id, text, level, line: i });
    }
  }

  return entries;
}

/**
 * Generate a slug from heading text (for anchor links).
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}
